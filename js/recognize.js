// Komplette Erkennung: Bild -> OCR -> Auswertung -> Kandidaten + Kartensprache.

import { readCard } from './ocr.js';
import { parseCard } from './parse.js';
import { identify, nameLanguage } from './identify.js';
import { detectLanguage } from './lang.js';
import { loadSets } from './api.js';

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{fitToText?: boolean, scanLang?: string, fallback?: string, onStatus?: Function}} opts
 * @returns {Promise<{cands: Array, best: object|null, cardLang: string, langSource: string, parsed, det, ocr, ms: number}>}
 */
export async function recognize(canvas, { fitToText = false, scanLang = 'auto', fallback = 'de', onStatus } = {}) {
  const t0 = performance.now();
  const idx = await loadSets();
  const ocr = await readCard(canvas, {
    fitToText,
    onStatus,
    hasNumber: (lines) => parseCard({ lines, text: lines.map((l) => l.text).join('\n') }, idx).numbers.length > 0,
  });
  onStatus?.('Karte wird gesucht …');
  const parsed = parseCard(ocr, idx);
  const autoLang = scanLang === 'auto';
  const det = autoLang
    ? detectLanguage(ocr.text, { printedLang: parsed.printedLang, lines: ocr.lines })
    : { lang: scanLang, confidence: 1, evidence: [], jaHint: scanLang === 'ja' ? 1 : 0 };
  const cands = await identify(parsed, { lang: det.lang, fallback, jaHint: det.jaHint });
  const best = cands[0] || null;

  const intlFallback = fallback === 'ja' ? 'en' : fallback;
  let cardLang = intlFallback;
  let langSource = 'nicht erkannt – Standard';
  if (!autoLang) {
    cardLang = scanLang;
    langSource = 'fest eingestellt';
  } else if (det.lang) {
    cardLang = det.lang;
    langSource = parsed.printedLang ? 'vom Aufdruck erkannt' : 'automatisch erkannt';
  }
  if (best?.group === 'ja') {
    cardLang = 'ja';
    if (autoLang && det.lang !== 'ja') langSource = 'japanische Ausgabe erkannt';
  } else if (cardLang === 'ja') {
    cardLang = intlFallback;
  }

  // Unsichere Sprache? Den gelesenen Namen mit allen Sprachversionen der Karte vergleichen.
  if (autoLang && best?.group === 'intl' && !parsed.printedLang && (!det.lang || det.confidence < 0.7)) {
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

  return { cands, best, cardLang, langSource, parsed, det, ocr, ms: Math.round(performance.now() - t0) };
}
