// Texterkennung mit Tesseract.js (eigener Worker, Modelle werden gecacht) – übertragen aus der ersten Version.
// Liest die gerade gerückte Karte: ganze Karte, Namensleiste und vergrößert den unteren Rand (Nummer, Set-Kürzel).

import type { OcrLine, OcrResult } from '../lib/types';

const CORE = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0';
const base = () => new URL(import.meta.env.BASE_URL, location.href).href;

interface TessWorker {
  setParameters(p: Record<string, string>): Promise<unknown>;
  recognize(img: HTMLCanvasElement, opts: object, out: object): Promise<{ data: TessData }>;
}
interface TessData {
  blocks?: Array<{ paragraphs?: Array<{ lines?: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }> }> }>;
}

let workerP: Promise<TessWorker> | null = null;
let statusCb: ((s: string | null) => void) | null = null;

const STATUS_TEXT: Record<string, string> = {
  'loading tesseract core': 'Texterkennung wird geladen …',
  'initializing tesseract': 'Texterkennung wird gestartet …',
  'loading language traineddata': 'Sprachmodell wird geladen …',
  'recognizing text': 'Text wird gelesen …',
};

function getWorker() {
  workerP ||= (async () => {
    const mod = await import(/* @vite-ignore */ new URL('vendor/tesseract/tesseract.esm.min.js', base()).href);
    const T = mod.default as { createWorker: (lang: string, oem: number, opts: object) => Promise<TessWorker> };
    return T.createWorker('eng', 1, {
      workerPath: new URL('vendor/tesseract/worker.min.js', base()).href,
      workerBlobURL: false,
      corePath: CORE,
      logger: (m: { status: string }) => statusCb?.(STATUS_TEXT[m.status] || null),
      errorHandler: () => {},
    });
  })().catch((err) => {
    workerP = null;
    throw err;
  });
  return workerP;
}

export const warmupOcr = () =>
  getWorker().then(
    () => true,
    () => false,
  );

/** Ausschnitt skalieren und Kontrast strecken (Graustufen). */
function prepare(src: HTMLCanvasElement, { x = 0, y = 0, w, h, targetW = 1200, maxH = 2400 }: { x?: number; y?: number; w?: number; h?: number; targetW?: number; maxH?: number }) {
  const sw = w ?? src.width;
  const sh = h ?? src.height;
  let scale = targetW / sw;
  if (sh * scale > maxH) scale = maxH / sh;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * scale));
  c.height = Math.max(1, Math.round(sh * scale));
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, x, y, sw, sh, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const l = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    d[i] = l;
    hist[l | 0]++;
  }
  const total = d.length / 4;
  let lo = 0;
  let hi = 255;
  for (let acc = 0, i = 0; i < 256; i++)
    if ((acc += hist[i]) > total * 0.01) {
      lo = i;
      break;
    }
  for (let acc = 0, i = 255; i >= 0; i--)
    if ((acc += hist[i]) > total * 0.01) {
      hi = i;
      break;
    }
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / range));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function linesOf(data: TessData, { offsetY = 0, spanY = 1, height, width }: { offsetY?: number; spanY?: number; height: number; width?: number }): OcrLine[] {
  const out: OcrLine[] = [];
  for (const block of data.blocks || [])
    for (const para of block.paragraphs || [])
      for (const line of para.lines || []) {
        const text = (line.text || '').replace(/\s+/g, ' ').trim();
        if (!text) continue;
        const cy = (line.bbox.y0 + line.bbox.y1) / 2 / height;
        out.push({
          text,
          conf: line.confidence / 100,
          y: offsetY + cy * spanY,
          h: ((line.bbox.y1 - line.bbox.y0) / height) * spanY,
          x0: width ? line.bbox.x0 / width : 0,
          x1: width ? line.bbox.x1 / width : 1,
        });
      }
  return out;
}

async function run(worker: TessWorker, canvas: HTMLCanvasElement, psm: string) {
  await worker.setParameters({ tessedit_pageseg_mode: psm, user_defined_dpi: '300' });
  const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
  return data;
}

/**
 * Liest eine gerade gerückte Karte.
 * @param hasNumber liefert sie true, entfällt der zweite Durchgang für die Kartennummer
 */
export async function readCard(card: HTMLCanvasElement, { onStatus, hasNumber }: { onStatus?: (s: string | null) => void; hasNumber?: (lines: OcrLine[]) => boolean } = {}): Promise<OcrResult> {
  statusCb = onStatus || null;
  try {
    const worker = await getWorker();
    const full = prepare(card, { targetW: 1100, maxH: 2400 });
    let lines = linesOf(await run(worker, full, '11'), { height: full.height, width: full.width }).map((l) => ({ ...l, pass: 'full' }));
    const strip = async (from: number, to: number, targetW: number, pass: string) => {
      const can = prepare(card, { x: 0, y: card.height * from, w: card.width, h: card.height * (to - from), targetW, maxH: 1000 });
      const data = await run(worker, can, '11');
      return linesOf(data, { height: can.height, offsetY: from, spanY: to - from }).map((l) => ({ ...l, pass }));
    };
    lines = lines.concat(await strip(0, 0.17, 1400, 'top'));
    if (!hasNumber || !hasNumber(lines)) {
      onStatus?.('Kartennummer wird gelesen …');
      lines = lines.concat(await strip(0.78, 1, 2000, 'bottom'));
    }
    return { lines, text: lines.map((l) => l.text).join('\n') };
  } finally {
    statusCb = null;
  }
}
