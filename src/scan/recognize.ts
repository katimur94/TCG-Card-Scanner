// Erkennung je gefundener Karte: Bildsuche -> (bei Bedarf) Texterkennung -> Zuordnung zum Kartenindex ->
// Kartensprache -> Entscheidung „sicher“ oder „nachfragen“ (nie raten).

import { analyzeImage, imageLanguage, rgbaToCanvas } from './vision';
import { readCard } from './ocr';
import { parseCard, type ParsedCard } from '../lib/parse';
import { identify, nameLanguage, type Candidate } from '../lib/identify';
import { detectLanguage } from '../lib/lang';
import { loadSets } from '../lib/api';
import type { FoundCard, RGBA } from './visionProtocol';
import type { OcrLine, OcrResult } from '../lib/types';
import { aiAvailable, readCardAI, type AiCardRead } from '../ai/client';
import { getSettings } from '../state/settings';
import { rgbaToBlob } from './vision';

/** Schwellen – kalibriert mit scripts/calibrate (siehe docs/FINDINGS.md). */
export const THRESHOLDS = {
  /** Mindest-Bildähnlichkeit, ab der die Bildsuche allein entscheiden darf. */
  visualSure: 0.62,
  /** Mindestabstand zur nächsten Karte (Bildähnlichkeit). */
  visualMargin: 0.12,
  /** Ähnlichkeitsabstand, unter dem zwei Karten als gleiches Motiv (Nachdruck) gelten. */
  reprintSim: 0.035,
  /** Mindest-Sicherheit der Gesamtauswertung. */
  confidence: 0.72,
  /** Mindest-Punktabstand zum Zweitplatzierten. */
  scoreMargin: 12,
  /** Ab dieser Breite (Pixel) lohnt sich Texterkennung. */
  ocrMinWidth: 330,
};

export interface Recognized {
  status: 'sure' | 'ask';
  best: Candidate | null;
  /** höchstens 3 verschiedene Karten zur Auswahl */
  options: Candidate[];
  lang: string;
  langSource: string;
  /** Sprache unsicher: diese Sprachen zur Auswahl anbieten (höchstens 3) */
  langOptions: string[];
  card: FoundCard;
  usedOcr: boolean;
  reason: string;
}

const EMPTY_OCR: OcrResult = { lines: [], text: '' };

/** Zwei Kandidaten mit (fast) gleichem Motiv = Nachdrucke; dann entscheidet nur Text. */
function sameArt(card: FoundCard, a: Candidate, b: Candidate) {
  const sa = card.matches.find((m) => m.group === a.group && m.setId === a.setId && m.localId === a.localId)?.sim;
  const sb = card.matches.find((m) => m.group === b.group && m.setId === b.setId && m.localId === b.localId)?.sim;
  return sa != null && sb != null && Math.abs(sa - sb) < THRESHOLDS.reprintSim;
}

function distinct(cands: Candidate[], n = 3) {
  const out: Candidate[] = [];
  for (const c of cands) if (!out.some((o) => o.key === c.key)) out.push(c);
  return out.slice(0, n);
}

async function analyzeCard(card: FoundCard, ocr: OcrResult, opts: { scanLang: string; fallback: string }) {
  const idx = await loadSets();
  const parsed = parseCard(ocr, idx);
  const autoLang = opts.scanLang === 'auto';
  const det = autoLang
    ? detectLanguage(ocr.text, { printedLang: parsed.printedLang, lines: ocr.lines })
    : { lang: opts.scanLang, confidence: 1, evidence: [], jaHint: opts.scanLang === 'ja' ? 1 : 0, scores: {} };
  const cands = await identify(parsed, { lang: det.lang, fallback: opts.fallback, jaHint: det.jaHint, visual: card.matches });
  return { parsed, det, cands };
}

/** Kartensprache wie in der ersten Version: Aufdruck/Begriffe -> Name -> Textstruktur am Bild. */
async function language(card: FoundCard, best: Candidate | null, parsed: ParsedCard, det: { lang: string | null; confidence: number }, opts: { scanLang: string; fallback: string }) {
  const intlFallback = opts.fallback === 'ja' ? 'en' : opts.fallback;
  if (opts.scanLang !== 'auto') return { lang: opts.scanLang, source: 'fest eingestellt', options: [] as string[] };
  if (best?.group === 'ja') return { lang: 'ja', source: 'japanische Ausgabe erkannt', options: [] };
  let lang = det.lang && det.lang !== 'ja' ? det.lang : null;
  let source = lang ? (parsed.printedLang ? 'vom Aufdruck erkannt' : 'automatisch erkannt') : 'nicht erkannt';
  const sure = !!parsed.printedLang || (!!lang && det.confidence >= 0.7);
  if (sure || !best) return { lang: lang || intlFallback, source, options: [] };

  let nameTies: string[] = [];
  const nl = await nameLanguage(best, parsed).catch(() => null);
  if (nl && nl.score >= 0.75) {
    nameTies = nl.ties;
    if (nl.ties.length === 1) {
      lang = nl.best;
      source = 'am Kartennamen erkannt';
    }
  }
  const img = await imageLanguage(card.view, best.setId, best.localId).catch(() => null);
  if (img && (!lang || source !== 'am Kartennamen erkannt')) {
    const s = img.scores;
    const clear = img.margin >= 0.08;
    if (!lang || (clear && !(lang in s && s[lang] >= s[img.best] - 0.08))) {
      lang = img.best;
      source = 'am Kartenbild erkannt';
    }
    // unsicher: bis zu drei naheliegende Sprachen anbieten
    if (!clear && !nameTies.length) {
      const opts3 = img.langs.filter((l) => s[l] >= s[img.best] - 0.08).slice(0, 3);
      return { lang: lang || intlFallback, source, options: opts3.length > 1 ? opts3 : [] };
    }
  }
  if (!lang) return { lang: intlFallback, source: 'Standard', options: nameTies.length > 1 ? nameTies.slice(0, 3) : [] };
  return { lang, source, options: nameTies.length > 1 && !nameTies.includes(lang) ? [lang, ...nameTies].slice(0, 3) : [] };
}

/** KI-Ergebnis als zusätzliche „Textzeilen“ (Name oben, Nummer unten) – so prüft die normale Auswertung es gegen den Katalog. */
export function aiLines(ai: AiCardRead): OcrLine[] {
  const lines: OcrLine[] = [];
  if (ai.name) lines.push({ text: ai.name, conf: 0.99, y: 0.05, h: 0.06, x0: 0.1, x1: 0.7, pass: 'ai' });
  if (ai.number) lines.push({ text: `${ai.setCode ? `${ai.setCode} ` : ''}${ai.number}`, conf: 0.99, y: 0.95, h: 0.02, x0: 0.05, x1: 0.4, pass: 'ai' });
  return lines;
}

async function toBase64Jpeg(img: RGBA) {
  const blob = await rgbaToBlob(img, 0.88);
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function recognizeCard(
  card: FoundCard,
  opts: { scanLang: string; fallback: string; onStatus?: (s: string | null) => void; allowOcr?: boolean; allowAi?: boolean },
): Promise<Recognized> {
  const t = THRESHOLDS;
  // 1) nur Bild
  let ocr = EMPTY_OCR;
  let { parsed, det, cands } = await analyzeCard(card, ocr, opts);
  const top = card.matches[0];
  const nextOther = card.matches.find((m) => m !== top && (m.setId !== top.setId || m.localId !== top.localId));
  const visualClear = !!top && top.sim >= t.visualSure && (!nextOther || top.sim - nextOther.sim >= t.visualMargin);
  let usedOcr = false;

  // 2) Text lesen, wenn das Bild allein nicht eindeutig ist (Nachdrucke, schlechtes Foto) oder die Sprache
  //    sich am Bild nicht klar bestimmen lässt. Texterkennung ist der langsamste Schritt – nur wenn nötig.
  const wide = (card.straight?.width || 0) >= t.ocrMinWidth;
  const reprint = !!cands[1] && sameArt(card, cands[0], cands[1]);
  const needsText = !visualClear || reprint;
  let langByImage = false;
  if (!needsText && opts.scanLang === 'auto' && cands[0]?.group === 'intl') {
    const img = await imageLanguage(card.view, cands[0].setId, cands[0].localId).catch(() => null);
    langByImage = !img || img.margin >= 0.08;
  } else if (!needsText) langByImage = true;
  if (wide && card.straight && opts.allowOcr !== false && (needsText || !langByImage)) {
    opts.onStatus?.('Text wird gelesen …');
    const idx = await loadSets();
    try {
      ocr = await readCard(rgbaToCanvas(card.straight), {
        onStatus: opts.onStatus,
        hasNumber: (lines) => parseCard({ lines, text: lines.map((l) => l.text).join('\n') }, idx).numbers.length > 0,
      });
      usedOcr = true;
      ({ parsed, det, cands } = await analyzeCard(card, ocr, opts));
    } catch (err) {
      console.warn('[HoloScan] Texterkennung:', err);
    }
  }

  const best = cands[0] || null;
  const second = cands.find((c) => c.key !== best?.key);
  const lang = await language(card, best, parsed, det, opts);

  // 3) Entscheiden: lieber nachfragen als falsch
  let status: Recognized['status'] = 'ask';
  let reason = 'unsicher';
  if (best) {
    const margin = second ? best.score - second.score : 99;
    const confident = (best.confidence ?? 0) >= t.confidence && margin >= t.scoreMargin;
    const textBacked = best.reasons.some((r) => r === 'nummer' || r === 'name+nummer' || r === 'promo' || r === 'kürzel');
    const reprintRisk = !!second && sameArt(card, best, second) && !textBacked;
    if (reprintRisk) reason = 'gleiches Motiv in mehreren Sets – Nummer nicht lesbar';
    else if (confident && (visualClear || textBacked)) {
      status = 'sure';
      reason = visualClear && textBacked ? 'Bild und Text' : visualClear ? 'Bild' : 'Text';
    } else reason = 'knapper Abstand';
  } else reason = 'keine passende Karte';

  // 4) Notfall: KI-Leser (nur mit Schlüssel des Nutzers). Das Ergebnis muss gegen den Katalog bestehen:
  //    Set + Nummer müssen passen, der Name allein reicht nie.
  const s = getSettings();
  const ai = {
    geminiKey: s.geminiKey,
    geminiModels: s.geminiModels,
    geminiLimits: s.geminiLimits,
  };
  let aiUsed: AiCardRead | null = null;
  if (status === 'ask' && card.straight && opts.allowAi !== false && aiAvailable(ai) && navigator.onLine) {
    opts.onStatus?.('KI liest die Karte …');
    try {
      aiUsed = await readCardAI(await toBase64Jpeg(card.straight), ai);
      const merged: OcrResult = { lines: [...aiLines(aiUsed), ...ocr.lines], text: '' };
      merged.text = merged.lines.map((l) => l.text).join('\n');
      const again = await analyzeCard(card, merged, { ...opts, scanLang: opts.scanLang === 'auto' && aiUsed.language ? aiUsed.language : opts.scanLang });
      const b2 = again.cands[0];
      const s2 = again.cands.find((c) => c.key !== b2?.key);
      const numberOk = !!b2 && b2.reasons.some((r) => r === 'nummer' || r === 'name+nummer' || r === 'promo');
      if (b2 && numberOk && (b2.confidence ?? 0) >= t.confidence && (!s2 || b2.score - s2.score >= t.scoreMargin)) {
        return {
          status: 'sure',
          best: b2,
          options: distinct(again.cands),
          lang: b2.group === 'ja' ? 'ja' : aiUsed.language && aiUsed.language !== 'ja' ? aiUsed.language : lang.lang,
          langSource: aiUsed.language ? 'von der KI gelesen' : lang.source,
          langOptions: [],
          card,
          usedOcr,
          reason: `KI (${aiUsed.model}) + Katalog`,
        };
      }
      reason = 'KI-Antwort passt nicht zum Katalog';
    } catch (err) {
      console.warn('[HoloScan] KI-Leser:', err);
    }
  }

  return {
    status,
    best,
    options: distinct(cands),
    lang: lang.lang,
    langSource: lang.source,
    langOptions: lang.options,
    card,
    usedOcr,
    reason,
  };
}

/** Ganzes Bild: alle Karten finden und einzeln auswerten. */
export async function recognizeImage(image: RGBA, opts: { scanLang: string; fallback: string; onStatus?: (s: string | null) => void; onCard?: (r: Recognized, i: number, n: number) => void }) {
  opts.onStatus?.('Karten werden gesucht …');
  const { cards } = await analyzeImage(image, { straight: true });
  const out: Recognized[] = [];
  for (let i = 0; i < cards.length; i++) {
    opts.onStatus?.(cards.length > 1 ? `Karte ${i + 1} von ${cards.length} …` : 'Karte wird erkannt …');
    const r = await recognizeCard(cards[i], opts);
    out.push(r);
    opts.onCard?.(r, i, cards.length);
  }
  return out;
}
