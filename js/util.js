// Kleine Helfer für DOM, Formatierung und Textvergleich.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const usd = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'USD' });
const pct = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0, signDisplay: 'always' });

export function money(v, unit = 'EUR') {
  if (v == null || Number.isNaN(v)) return '–';
  return (unit === 'USD' ? usd : eur).format(v);
}

export const percent = (v) => `${pct.format(v * 100)} %`;

export function date(v, opts = { day: '2-digit', month: '2-digit', year: 'numeric' }) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('de-DE', opts);
}

export function relTime(v) {
  const d = new Date(v).getTime();
  const s = Math.round((Date.now() - d) / 1000);
  if (s < 60) return 'gerade eben';
  const m = Math.round(s / 60);
  if (m < 60) return `vor ${m} Min.`;
  const h = Math.round(m / 60);
  if (h < 24) return `vor ${h} Std.`;
  const days = Math.round(h / 24);
  if (days < 7) return days === 1 ? 'gestern' : `vor ${days} Tagen`;
  return date(v);
}

export const today = () => new Date().toISOString().slice(0, 10);

export function haptic(pattern = 12) {
  try {
    if (document.documentElement.dataset.haptics !== 'off') navigator.vibrate?.(pattern);
  } catch {
    /* nicht unterstützt */
  }
}

// ---------- Textvergleich ----------

/** Kleinbuchstaben, ohne Akzente, nur a-z0-9 und Leerzeichen. */
export function norm(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9぀-ヿ㐀-鿿가-힯]+/g, ' ')
    .trim();
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  let cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/** Ähnlichkeit 0..1 zweier (bereits normalisierter) Strings. */
export function ratio(a, b) {
  if (!a || !b) return 0;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

/**
 * Wie gut kommt `needle` (z. B. Kartenname) irgendwo in `hay` (OCR-Zeile) vor?
 * Fenster-Vergleich, tolerant gegenüber OCR-Fehlern und Zusatztext wie „KP 120“.
 */
export function partialRatio(needle, hay) {
  if (!needle || !hay) return 0;
  if (hay.length <= needle.length) return ratio(needle, hay);
  if (hay.includes(needle)) return 1;
  let best = 0;
  const n = needle.length;
  for (let w = Math.max(1, n - 1); w <= n + 1; w++) {
    for (let i = 0; i + w <= hay.length; i++) {
      const r = ratio(needle, hay.slice(i, i + w));
      if (r > best) best = r;
      if (best === 1) return 1;
    }
  }
  return best;
}

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

export function download(filename, content, type = 'application/octet-stream') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
