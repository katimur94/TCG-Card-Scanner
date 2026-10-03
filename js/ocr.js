// Texterkennung mit Tesseract.js (läuft komplett im Browser, Modelle werden gecacht).

import Tesseract from '../vendor/tesseract/tesseract.esm.min.js';

const WORKER = new URL('../vendor/tesseract/worker.min.js', import.meta.url).href;
const CORE = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0';

let workerPromise = null;
let statusCb = null;

const STATUS_TEXT = {
  'loading tesseract core': 'Texterkennung wird geladen …',
  'initializing tesseract': 'Texterkennung wird gestartet …',
  'loading language traineddata': 'Sprachmodell wird geladen …',
  'loading language traineddata (from cache)': 'Sprachmodell wird geladen …',
  'initializing api': 'Texterkennung wird vorbereitet …',
  'recognizing text': 'Text wird gelesen …',
};

function getWorker() {
  if (!workerPromise) {
    workerPromise = Tesseract.createWorker('eng', 1, {
      workerPath: WORKER,
      workerBlobURL: false,
      corePath: CORE,
      logger: (m) => statusCb?.(STATUS_TEXT[m.status] || null, m.progress),
      errorHandler: () => {},
    }).catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

/** OCR-Engine im Hintergrund vorladen (z. B. sobald die Kamera läuft). */
export function warmup() {
  return getWorker().then(
    () => true,
    () => false,
  );
}

export const isReady = () => !!workerPromise;

/**
 * Schneidet einen Bereich aus, skaliert ihn und verstärkt den Kontrast (Graustufen).
 * @returns {HTMLCanvasElement}
 */
export function prepare(src, { x = 0, y = 0, w, h, targetW = 1200, maxH = 2400 }) {
  const sw = w ?? src.width;
  const sh = h ?? src.height;
  let scale = targetW / sw;
  if (sh * scale > maxH) scale = maxH / sh;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * scale));
  c.height = Math.max(1, Math.round(sh * scale));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
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
  // Kontrast auf 1.–99. Perzentil strecken
  const total = d.length / 4;
  let lo = 0;
  let hi = 255;
  for (let acc = 0, i = 0; i < 256; i++) if ((acc += hist[i]) > total * 0.01) { lo = i; break; }
  for (let acc = 0, i = 255; i >= 0; i--) if ((acc += hist[i]) > total * 0.01) { hi = i; break; }
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / range));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Zeilen mit Lage relativ zur Karte (y, h) bzw. zum Bild (x0/x1 als Anteil der Breite). */
function linesOf(data, { offsetY = 0, spanY = 1, height, width }) {
  const out = [];
  for (const block of data.blocks || []) {
    for (const para of block.paragraphs || []) {
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
    }
  }
  return out;
}

/**
 * Kartenbereich in einem Foto aus der Lage der Textzeilen schätzen.
 * Name ~7 % unter der Oberkante, Copyright ~95 %; lange Textzeilen füllen ~84 % der Kartenbreite.
 * @returns {{top, span, left, right}} relativ zum Bild
 */
function estimateCard(lines, imgW, imgH) {
  const good = lines.filter((l) => l.conf >= 0.5 && /[A-Za-z0-9]{3}/.test(l.text));
  if (good.length < 4) return null;
  const minY = Math.min(...good.map((l) => l.y));
  const maxY = Math.max(...good.map((l) => l.y));
  const long = good.filter((l) => l.text.length >= 18);
  let cardH = (maxY - minY) / 0.88;
  let left = 0;
  let right = 1;
  if (long.length >= 2) {
    left = Math.min(...long.map((l) => l.x0));
    right = Math.max(...long.map((l) => l.x1));
    const cardW = (right - left) / 0.84;
    const pad = cardW * 0.1;
    left = Math.max(0, left - pad);
    right = Math.min(1, right + pad);
    // Höhe aus der Breite (Seitenverhältnis 63:88), umgerechnet auf die Bildhöhe
    const fromWidth = (cardW * imgW * (88 / 63)) / imgH;
    // Fehlt oben Text (Name nicht gelesen), ist die Höhe aus der Breite verlässlicher
    if (cardH < fromWidth * 0.8) cardH = fromWidth;
    return { top: Math.max(0, maxY + 0.05 * cardH - cardH), span: Math.min(1, cardH), left, right };
  }
  cardH = Math.max(0.25, cardH);
  return { top: Math.max(0, minY - 0.07 * cardH), span: Math.min(1, cardH), left, right };
}

async function run(worker, canvas, psm) {
  await worker.setParameters({ tessedit_pageseg_mode: psm, user_defined_dpi: '300' });
  const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
  return data;
}

/**
 * Liest eine Karte.
 * @param {HTMLCanvasElement} card  Bild der Karte (Kamera-Ausschnitt) oder ganzes Foto (Upload)
 * @param {{fitToText?: boolean, onStatus?: Function, hasNumber?: Function}} opts
 *        fitToText: Kartenbereich aus der Lage der Textzeilen schätzen (bei Fotos)
 *        hasNumber: Prüffunktion – liefert sie true, entfällt der zweite Durchgang für die Kartennummer
 * @returns {Promise<{lines, text}>}
 */
export async function readCard(card, { fitToText = false, onStatus, hasNumber } = {}) {
  statusCb = onStatus;
  try {
    const worker = await getWorker();
    onStatus?.('Text wird gelesen …');

    // 1) Ganze Karte, "verstreuter Text" – findet Name, Attacken, Schwäche/Resistenz und meist die Nummer
    const full = prepare(card, { targetW: fitToText ? 1600 : 1100, maxH: 2400 });
    let lines = linesOf(await run(worker, full, '11'), { height: full.height, width: full.width }).map((l) => ({ ...l, pass: 'full' }));

    // Bei Fotos: Kartenbereich aus der Lage verlässlicher Textzeilen schätzen
    let top = 0;
    let span = 1;
    let left = 0;
    let right = 1;
    if (fitToText) {
      const est = estimateCard(lines, card.width, card.height);
      if (est) {
        ({ top, span, left, right } = est);
        span = Math.min(1 - top, span);
        lines = lines.map((l) => ({ ...l, y: (l.y - top) / span }));
      }
    }

    // Streifen der Karte vergrößert lesen (seitlich auf die Karte zugeschnitten)
    const strip = async (from, to, targetW, pass) => {
      const y0 = top + span * from;
      const hRel = Math.min(1 - y0, span * (to - from));
      if (hRel <= 0.01) return [];
      const x = card.width * left;
      const w = card.width * (right - left);
      const can = prepare(card, { x, y: card.height * y0, w, h: card.height * hRel, targetW, maxH: 1000 });
      const data = await run(worker, can, '11');
      return linesOf(data, { height: can.height, offsetY: from, spanY: hRel / span }).map((l) => ({ ...l, pass }));
    };

    // 2) Namensleiste oben vergrößert (schnell)
    lines = lines.concat(await strip(0, 0.17, 1400, 'top'));

    // 3) Unterer Rand vergrößert – dort stehen Kartennummer, Set-Kürzel und Sprachcode
    if (!hasNumber || !hasNumber(lines)) {
      onStatus?.('Kartennummer wird gelesen …');
      lines = lines.concat(await strip(fitToText ? 0.74 : 0.78, 1, 2000, 'bottom'));
    }

    const text = lines.map((l) => l.text).join('\n');
    return { lines, text };
  } finally {
    statusCb = null;
  }
}
