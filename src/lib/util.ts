// Kleine Helfer für Formatierung und Textvergleich.

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const usd = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'USD' });
const pct = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

/** Euro-Betrag (Gleitkomma) formatieren. */
export function money(v: number | null | undefined, unit: 'EUR' | 'USD' = 'EUR') {
  if (v == null || Number.isNaN(v)) return '–';
  return (unit === 'USD' ? usd : eur).format(v);
}

/** Cent-Betrag formatieren. */
export const cents = (c: number | null | undefined) => (c == null ? '–' : eur.format(c / 100));

/** Euro (Gleitkomma) -> ganze Cent. */
export const toCents = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? null : Math.round(v * 100);

/** Veränderung als "▲ 3,2 %" / "▼ 1,0 %" (nie nur Farbe). */
export function change(ratio: number | null | undefined) {
  if (ratio == null || !Number.isFinite(ratio)) return '–';
  const arrow = ratio > 0.0005 ? '▲' : ratio < -0.0005 ? '▼' : '■';
  return `${arrow} ${pct.format(Math.abs(ratio) * 100)} %`;
}

export function date(
  v: string | number | Date | null | undefined,
  opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' },
) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('de-DE', opts);
}

export const today = () => new Date().toISOString().slice(0, 10);

export function haptic(pattern: number | number[] = 12) {
  try {
    if (document.documentElement.dataset.haptics !== 'off') navigator.vibrate?.(pattern);
  } catch {
    /* nicht unterstützt */
  }
}

// ---------- Textvergleich ----------

/** Kleinbuchstaben, ohne Akzente, nur a-z0-9 (und CJK) und Leerzeichen. */
export function norm(s: unknown) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9぀-ヿ㐀-鿿가-힯]+/g, ' ')
    .trim();
}

export function levenshtein(a: string, b: string) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array<number>(b.length + 1);
  let cur = new Array<number>(b.length + 1);
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
export function ratio(a: string, b: string) {
  if (!a || !b) return 0;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

/**
 * Wie gut kommt `needle` (z. B. Kartenname) irgendwo in `hay` (OCR-Zeile) vor?
 * Fenster-Vergleich, tolerant gegenüber OCR-Fehlern und Zusatztext wie „KP 120“.
 */
export function partialRatio(needle: string, hay: string) {
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

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function download(filename: string, content: Blob | string, type = 'application/octet-stream') {
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
