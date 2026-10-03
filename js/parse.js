// Wertet den OCR-Text einer Karte aus: Kartennummer, Set-Kürzel, Sprachcode und Namenszeilen.

import { norm } from './util.js';
import { langFromPrintedCode } from './lang.js';

const PREFIXES = ['TG', 'GG', 'SV', 'RC', 'SH', 'H'];
const DIGIT_FIX = { O: '0', o: '0', D: '0', Q: '0', I: '1', l: '1', i: '1', '|': '1', '!': '1', S: '5', s: '5', B: '8', Z: '2', z: '2', G: '6', g: '9', T: '7' };

function fixDigits(s) {
  return s.replace(/[OoDQIli|!SsBZzGgT]/g, (c) => DIGIT_FIX[c] ?? c);
}

const isDigits = (s) => /^\d{1,3}$/.test(s);

/**
 * Zerlegt einen Teil der Kartennummer.
 * "TG05" -> {prefix:'TG', digits:'05'} · "O25" -> {prefix:'', digits:'025'} · "MEW 025" -> {prefix:'', digits:'025'}
 * @param {boolean} first  true für den Teil vor dem Schrägstrich (dann zählt der Block direkt am "/")
 */
function splitPart(raw, first) {
  const parts = raw.trim().split(/\s+/);
  let chunk = first ? parts[parts.length - 1] : parts[0];
  let prefix = '';
  if (parts.length > 1 && PREFIXES.includes(parts[0].toUpperCase()) && /^\d/.test(parts[1])) {
    prefix = parts[0].toUpperCase();
    chunk = parts[1];
  }
  const m = chunk.match(/^([A-Za-z]{0,3})(.*)$/);
  const letters = m[1].toUpperCase();
  if (!prefix && letters && PREFIXES.includes(letters) && isDigits(fixDigits(m[2]))) {
    return { prefix: letters, digits: fixDigits(m[2]) };
  }
  // Buchstaben, die vermutlich falsch gelesene Ziffern sind (O25 -> 025)
  const whole = fixDigits(chunk);
  if (isDigits(whole)) return { prefix, digits: whole };
  const tail = fixDigits(m[2]);
  if (isDigits(tail)) return { prefix, digits: tail };
  return null;
}

// Nummer im Format 025/165, 4/102, TG05/TG30, SV045/SV122, GG12/GG70
const NUM_RE = /(?:^|[^A-Za-z0-9])([A-Za-z]{0,3}\s?[0-9OoDQIli|!SsBZzGgT]{1,3})\s{0,2}[/⁄∕]\s{0,2}([A-Za-z]{0,3}\s?[0-9OoDQIli|!SsBZzGgT]{2,3})(?![0-9])/g;
// Promo-Nummern ohne Schrägstrich
const PROMO_RE = /\b(SWSH|SM|XY|BW|DP|HGSS|SVP|MEP)\s?-?\s?(\d{1,3})\b/g;
// Ab Karmesin & Purpur: "PAL DE 123/193" (Set-Kürzel + Sprachcode)
const PRINTED_RE = /\b([A-Z]{3})\s*(EN|DE|FR|IT|ES|PT)\b/g;

const STAGE_WORDS = [
  'basic', 'basis', 'base', 'de base', 'basico', 'stage', 'phase', 'niveau', 'fase', 'estagio', 'level', 'restored',
  'evolves from', 'entwickelt sich aus', 'evolue de', 'evoluciona de', 'si evolve da', 'evolui de', 'put this card', 'trainer',
  'item', 'supporter', 'unterstutzer', 'dresseur', 'objet', 'entrenador', 'partidario', 'objeto', 'allenatore', 'aiuto',
  'strumento', 'treinador', 'apoiador', 'stadium', 'stadion', 'stade', 'estadio', 'stadio', 'pokemon tool', 'ausrustung',
  'tool', 'ace spec', 'tera',
];
const STAGE_RE = new RegExp(`\\b(${STAGE_WORDS.map((w) => w.replace(/ /g, '\\s')).join('|')})\\b`, 'g');

// "Entwickelt sich aus Glumanda" & Co.: der Name dahinter ist die Vorstufe, nicht diese Karte
// Tolerant gegenüber abgeschnittenen Wörtern ("volution de Fouinette", "rrn sich aus Glutexo").
const EVOLVES_RE = /\b(\S*vol\S*\s+(from|de|da)|(\S+\s+)?sich aus)\s+\S+(\s+(ex|v|gx))?/g;
// WotC-Ära: "Put Charizard on the Stage 1 card"
const PUT_RE = /\b(put|lege|place|pon|metti|coloque)\b.*\b(card|karte|carte|carta)\b/g;

/** Bereinigt eine Zeile aus dem Namensbereich. */
function cleanNameLine(text) {
  let t = norm(text);
  t = t.replace(EVOLVES_RE, ' ').replace(PUT_RE, ' ');
  t = t.replace(/\b(hp|kp|pv|ps)\s*\d{1,3}\b/g, ' ').replace(/\b\d{1,3}\s*(hp|kp|pv|ps)\b/g, ' ');
  t = t.replace(STAGE_RE, ' ');
  t = t.replace(/\b\d+\b/g, ' ');
  // einzelne Buchstaben (Rauschen) entfernen, aber "v", "ex", "gx" behalten
  t = t.replace(/\b(?!v\b)[a-z]\b/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

/**
 * @param {{lines: Array<{text:string, conf:number, y:number, x:number}>, text:string}} ocr
 *        y/x: Mittelpunkt der Zeile relativ zur Karte (0..1)
 * @param {{byAbbr: Map, sets: Array}} index
 */
export function parseCard(ocr, index) {
  const numbers = [];
  const promos = [];
  const codes = new Set();
  const jaCodes = new Set();
  let printedLang = null;
  let printedCode = null;

  const jaIds = new Map();
  for (const s of index?.sets || []) if (s.g === 'ja') jaIds.set(s.id.toLowerCase(), s.id);

  for (const line of ocr.lines) {
    const raw = line.text;

    for (const m of raw.matchAll(NUM_RE)) {
      const a = splitPart(m[1], true);
      const b = splitPart(m[2], false);
      if (!a || !b) continue;
      const num = parseInt(a.digits, 10);
      const total = parseInt(b.digits, 10);
      // Gesamtzahlen > 400 gibt es nicht – sind dann eine falsch gelesene Ziffer (189 -> 789), nur unscharf nutzbar
      if (!(total >= 5 && total <= 999) || num > 500) continue;
      const prefix = a.prefix || b.prefix;
      numbers.push({
        num,
        numRaw: a.digits,
        total,
        prefix,
        y: line.y,
        conf: line.conf,
        // unten auf der Karte und mit Ziffern ohne Korrektur = verlässlicher
        weight: (line.y > 0.75 ? 2 : 1) + (/^\d+$/.test(m[1].replace(/^[A-Za-z]+/, '')) ? 0.5 : 0),
      });
    }

    // Schrägstrich als 7/1/l/Punkt gelesen: "0067 165", "006. 165" -> 006/165
    // (nur dreistellig wie seit Schwert & Schild üblich; wird über die Sets geprüft)
    if (!/[/⁄∕]/.test(raw)) {
      for (const m of raw.matchAll(/(?:^|\D)(\d{3})\s?[7lI1|.,;:]\s?(\d{3})(?!\d)/g)) {
        const num = parseInt(m[1], 10);
        const total = parseInt(m[2], 10);
        if (total >= 20 && total <= 400 && num <= 500) {
          numbers.push({ num, numRaw: m[1], total, prefix: '', y: line.y, conf: line.conf, weight: 0.6 });
        }
      }
    }

    for (const m of raw.matchAll(PROMO_RE)) promos.push({ prefix: m[1], num: parseInt(m[2], 10), y: line.y });

    for (const m of raw.matchAll(PRINTED_RE)) {
      if (index?.byAbbr?.has(m[1])) {
        printedCode = m[1];
        printedLang = langFromPrintedCode(m[2]);
        codes.add(m[1]);
      }
    }

    // Set-Kürzel stehen unten links neben der Nummer
    const nearBottom = line.y > 0.75;
    for (const tok of raw.split(/[^A-Za-z0-9+]+/)) {
      if (nearBottom && tok.length >= 3 && tok.length <= 5 && /^[A-Z]+$/.test(tok) && index?.byAbbr?.has(tok)) codes.add(tok);
      if (nearBottom && tok.length >= 2 && /\d/.test(tok) && /^[A-Za-z]/.test(tok)) {
        const ja = jaIds.get(tok.toLowerCase());
        if (ja && tok.length >= 3) jaCodes.add(ja);
      }
    }
  }

  // Namenszeilen: oberer Kartenbereich; der Name ist dort die größte Schrift
  const nameLines = ocr.lines
    .filter((l) => l.y < 0.2)
    .map((l) => ({ text: cleanNameLine(l.text), y: l.y, conf: l.conf, h: l.h || 0 }))
    .filter((l) => l.text.length >= 3)
    .sort((a, b) => b.h * (0.5 + b.conf) - a.h * (0.5 + a.conf) || a.y - b.y);

  const allLines = ocr.lines.map((l) => cleanNameLine(l.text)).filter((t) => t.length >= 3);

  const hp = ocr.text.match(/\b(HP|KP|PV|PS)\s*(\d{2,3})\b|\b(\d{2,3})\s*(HP|KP|PV|PS)\b/);

  // Copyright-Jahr ("©2023 Pokémon/Nintendo/…", "© 1999 Wizards") – liegt nahe am Erscheinungsjahr
  let year = null;
  const maxYear = new Date().getFullYear() + 1;
  for (const l of ocr.lines) {
    if (!/©|nintendo|creatures|game\s?freak|wizards/i.test(l.text)) continue;
    for (const m of l.text.matchAll(/(?:^|\D)((?:19|20)\d{2})(?!\d)/g)) {
      const y = parseInt(m[1], 10);
      if (y >= 1995 && y <= maxYear && (!year || y > year)) year = y;
    }
  }

  numbers.sort((a, b) => b.weight - a.weight);

  return {
    numbers,
    promos,
    codes: [...codes],
    jaCodes: [...jaCodes],
    printedCode,
    printedLang,
    nameLines,
    allLines,
    hp: hp ? parseInt(hp[2] || hp[3], 10) : null,
    year,
  };
}

/** Freitext-Suche: "MEW 25", "25/165", "4/102", "Glurak ex". */
export function parseQuery(q) {
  const s = String(q || '').trim();
  const out = { name: '', num: null, total: null, code: null, prefix: '' };
  const slash = s.match(/(?:^|\s)(TG|GG|SV|RC|H)?\s?(\d{1,3})\s*\/\s*(TG|GG|SV|RC|H)?\s?(\d{1,3})(?!\d)/i);
  let rest = s;
  if (slash) {
    out.prefix = (slash[1] || slash[3] || '').toUpperCase();
    out.num = parseInt(slash[2], 10);
    out.total = parseInt(slash[4], 10);
    rest = s.replace(slash[0], ' ');
  }
  // Set-Kürzel: "MEW 25", "SV2a 25", "M2a 92", "S8b 10"
  const code = rest.match(/\b([A-Za-z]{2,4}|[A-Za-z]{1,4}\d{1,2}[a-zA-Z]?)\s+#?(\d{1,3})\b/);
  if (!slash && code) {
    out.code = code[1];
    out.num = parseInt(code[2], 10);
    rest = rest.replace(code[0], ' ');
  } else if (!slash) {
    const lone = rest.match(/(?:^|\s)#?(\d{1,3})(?:\s|$)/);
    if (lone && rest.replace(lone[0], '').trim()) {
      out.num = parseInt(lone[1], 10);
      rest = rest.replace(lone[0], ' ');
    }
  }
  out.name = rest.replace(/\s+/g, ' ').trim();
  return out;
}
