// Komplette Erkennung: Bild -> Bildsuche + OCR -> Auswertung -> Kandidaten + Kartensprache.

import { readCard } from './ocr.js';
import { parseCard } from './parse.js';
import { identify, nameLanguage } from './identify.js';
import { detectLanguage } from './lang.js';
import { loadSets } from './api.js';
import { visualSearch, visionReady, findCardQuad, straightCard, languageFromImage } from './vision.js';
import { sleep } from './util.js';
import { readCardAI, aiLines } from './ai.js';

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{fitToText?: boolean, scanLang?: string, fallback?: string, useVision?: boolean, ai?: {key, model, mode}, onStatus?: Function}} opts
 * @returns {Promise<{cands: Array, best: object|null, cardLang: string, langSource: string, parsed, det, ocr, vision, ms: number}>}
 */
export async function recognize(canvas, { fitToText = false, scanLang = 'auto', fallback = 'de', useVision = true, ai = null, onStatus } = {}) {
  const t0 = performance.now();
  const idx = await loadSets();
  // Beim allerersten Scan wird das Modell evtl. noch geladen – dann nicht darauf warten
  const visionWasReady = visionReady();
  // Kartenkanten suchen: Bildsuche und Texterkennung arbeiten dann mit der gerade gerückten Karte
  let quad = null;
  try {
    quad = fitToText ? null : findCardQuad(canvas);
  } catch (err) {
    console.warn('[HoloScan] Kantensuche fehlgeschlagen:', err);
  }
  // Bildsuche läuft parallel zur Texterkennung (die arbeitet in einem Worker)
  const visionP = useVision
    ? visualSearch(canvas, { quad }).catch((err) => {
        console.warn('[HoloScan] Bildsuche nicht verfügbar:', err);
        return null;
      })
    : Promise.resolve(null);
  const ocr = await readCard(quad ? straightCard(canvas, quad) : canvas, {
    fitToText,
    onStatus,
    hasNumber: (lines) => parseCard({ lines, text: lines.map((l) => l.text).join('\n') }, idx).numbers.length > 0,
  });
  onStatus?.('Karte wird gesucht …');
  const vision = await (visionWasReady ? visionP : Promise.race([visionP, sleep(1500).then(() => null)]));
  let result = await analyze({ ocr, vision, idx, scanLang, fallback, onStatus });

  // KI-Leser (optional): bei unsicherem Ergebnis die gerade gerückte Karte lesen lassen
  if (ai?.key && (ai.mode === 'always' || isUncertain(result))) {
    onStatus?.('KI liest die Karte …');
    try {
      const read = await readCardAI(vision?.view || canvas, ai);
      const merged = { lines: [...aiLines(read), ...ocr.lines], text: '' };
      merged.text = merged.lines.map((l) => l.text).join('\n');
      result = { ...(await analyze({ ocr: merged, vision, idx, scanLang, fallback, onStatus, ai: read })), aiRead: read };
    } catch (err) {
      console.warn('[HoloScan] KI-Leser:', err);
      result.aiError = err.message || String(err);
    }
  }
  return { ...result, ocr, vision, ms: Math.round(performance.now() - t0) };
}

/** Unsicher = geringe Übereinstimmung, knapper Zweitplatzierter oder Sprache nicht aus dem Text gelesen. */
function isUncertain({ best, cands, det, parsed }) {
  if (!best || best.confidence < 0.75) return true;
  if (cands[1] && cands[0].score - cands[1].score < 15) return true;
  return best.group === 'intl' && !parsed.printedLang && !(det.lang && det.confidence >= 0.7);
}

/** Auswertung der gelesenen Zeilen + Bildtreffer -> Kandidaten und Kartensprache. */
async function analyze({ ocr, vision, idx, scanLang, fallback, onStatus, ai = null }) {
  const parsed = parseCard(ocr, idx);
  const autoLang = scanLang === 'auto';
  let det = autoLang
    ? detectLanguage(ocr.text, { printedLang: parsed.printedLang, lines: ocr.lines })
    : { lang: scanLang, confidence: 1, evidence: [], jaHint: scanLang === 'ja' ? 1 : 0 };
  // Von der KI gelesene Sprache zählt wie ein Aufdruck
  if (autoLang && ai?.language) det = { lang: ai.language, confidence: 0.95, evidence: ['KI'], jaHint: ai.language === 'ja' ? 1 : 0 };
  const cands = await identify(parsed, { lang: det.lang, fallback, jaHint: det.jaHint, visual: vision?.matches });
  const best = cands[0] || null;

  const intlFallback = fallback === 'ja' ? 'en' : fallback;
  let cardLang = intlFallback;
  let langSource = 'nicht erkannt – Standard';
  if (!autoLang) {
    cardLang = scanLang;
    langSource = 'fest eingestellt';
  } else if (det.lang) {
    cardLang = det.lang;
    langSource = ai?.language ? 'von der KI gelesen' : parsed.printedLang ? 'vom Aufdruck erkannt' : 'automatisch erkannt';
  }
  if (best?.group === 'ja') {
    cardLang = 'ja';
    if (autoLang && det.lang !== 'ja') langSource = 'japanische Ausgabe erkannt';
  } else if (cardLang === 'ja') {
    cardLang = intlFallback;
  }

  // Unsichere Sprache? Den gelesenen Namen mit allen Sprachversionen der Karte vergleichen.
  if (autoLang && !ai?.language && best?.group === 'intl' && !parsed.printedLang && (!det.lang || det.confidence < 0.7)) {
    onStatus?.('Sprache wird geprüft …');
    const nl = await nameLanguage(best, parsed).catch(() => null);
    if (nl && nl.score >= 0.75 && !(det.lang && nl.ties.includes(det.lang))) {
      if (nl.ties.length === 1) {
        cardLang = nl.best;
        langSource = 'am Kartennamen erkannt';
      } else if (!det.lang) {
        cardLang = nl.ties.includes(intlFallback) ? intlFallback : nl.ties[0];
        langSource = nl.ties.includes(intlFallback) ? 'Standard (Name in mehreren Sprachen gleich)' : 'am Kartennamen erkannt';
      }
    }
  }

  // Sprache am Kartenbild: Textstruktur des Fotos gegen dieselbe Karte in jeder Sprache
  // (hilft vor allem, wenn der Text zu unscharf zum Lesen ist)
  let imageLang = null;
  if (autoLang && !ai?.language && best?.group === 'intl' && !parsed.printedLang && vision?.quad) {
    imageLang = await languageFromImage(vision.view, best.setId, best.localId).catch(() => null);
    const ocrLang = det.lang && det.lang !== 'ja' ? det.lang : null;
    if (imageLang && imageLang.best !== cardLang) {
      const s = imageLang.scores;
      const near = (l, tol) => l in s && s[l] >= s[imageLang.best] - tol;
      const byName = langSource === 'am Kartennamen erkannt';
      // gelesene Sprachbegriffe behalten Vorrang, wenn das Bild sie nicht klar widerlegt
      const textConfirmed = ocrLang && (!(ocrLang in s) || (det.confidence >= 0.7 && near(ocrLang, 0.08)));
      // ein (oft nur teilweise gelesener) Name zählt nur bei fast gleichem Bildwert
      const nameConfirmed = byName && (!(cardLang in s) || near(cardLang, 0.01));
      // ohne Text: Standardsprache nur bei Gleichstand – oder wenn es kein Vergleichsbild in ihr gibt
      const fallbackKept = !ocrLang && !byName && (intlFallback in s ? near(intlFallback, 0.005) : imageLang.margin < 0.1);
      if (!textConfirmed && !nameConfirmed && !fallbackKept) {
        cardLang = imageLang.best;
        langSource = 'am Kartenbild erkannt';
      }
    }
  }

  return { cands, best, cardLang, langSource, parsed, det, imageLang };
}
