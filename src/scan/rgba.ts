// Bilder als reine Pixel-Arrays (läuft im Hauptthread, im Worker und in Node-Tests gleich).

export interface RGBA {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export type Point = [number, number];
/** Vier Ecken: oben links, oben rechts, unten rechts, unten links. */
export type Quad = [Point, Point, Point, Point];

export const CARD_RATIO = 63 / 88;

export function rgba(width: number, height: number): RGBA {
  return { data: new Uint8ClampedArray(width * height * 4), width, height };
}

/** Graustufen (Luma) als Float32Array. */
export function gray(img: RGBA): Float32Array {
  const n = img.width * img.height;
  const out = new Float32Array(n);
  const d = img.data;
  for (let i = 0; i < n; i++) out[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  return out;
}

/**
 * Skalieren. Beim Verkleinern wird über die Fläche gemittelt (wie ein Browser mit hoher Qualität),
 * sonst bilinear.
 */
export function resize(img: RGBA, w: number, h: number): RGBA {
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  const out = rgba(w, h);
  const sx = img.width / w;
  const sy = img.height / h;
  const s = img.data;
  const o = out.data;
  if (sx >= 1.5 || sy >= 1.5) {
    for (let y = 0; y < h; y++) {
      const y0 = Math.floor(y * sy);
      const y1 = Math.min(img.height, Math.max(y0 + 1, Math.floor((y + 1) * sy)));
      for (let x = 0; x < w; x++) {
        const x0 = Math.floor(x * sx);
        const x1 = Math.min(img.width, Math.max(x0 + 1, Math.floor((x + 1) * sx)));
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let yy = y0; yy < y1; yy++) {
          for (let xx = x0; xx < x1; xx++) {
            const i = (yy * img.width + xx) * 4;
            r += s[i];
            g += s[i + 1];
            b += s[i + 2];
            n++;
          }
        }
        const t = (y * w + x) * 4;
        o[t] = r / n;
        o[t + 1] = g / n;
        o[t + 2] = b / n;
        o[t + 3] = 255;
      }
    }
    return out;
  }
  for (let y = 0; y < h; y++) {
    const fy = Math.min(img.height - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(img.height - 1, y0 + 1);
    const ay = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(img.width - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(img.width - 1, x0 + 1);
      const ax = fx - x0;
      const t = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const a = s[(y0 * img.width + x0) * 4 + c] * (1 - ax) + s[(y0 * img.width + x1) * 4 + c] * ax;
        const b = s[(y1 * img.width + x0) * 4 + c] * (1 - ax) + s[(y1 * img.width + x1) * 4 + c] * ax;
        o[t + c] = a * (1 - ay) + b * ay;
      }
      o[t + 3] = 255;
    }
  }
  return out;
}

/** Auf eine maximale Kantenlänge verkleinern (nie vergrößern). */
export function fit(img: RGBA, maxSide: number): RGBA {
  const s = maxSide / Math.max(img.width, img.height);
  return s >= 1 ? img : resize(img, img.width * s, img.height * s);
}

export function crop(img: RGBA, x: number, y: number, w: number, h: number): RGBA {
  x = Math.max(0, Math.floor(x));
  y = Math.max(0, Math.floor(y));
  w = Math.max(1, Math.min(img.width - x, Math.floor(w)));
  h = Math.max(1, Math.min(img.height - y, Math.floor(h)));
  const out = rgba(w, h);
  for (let r = 0; r < h; r++) {
    const from = ((y + r) * img.width + x) * 4;
    out.data.set(img.data.subarray(from, from + w * 4), r * w * 4);
  }
  return out;
}

export function rotate180(img: RGBA): RGBA {
  const out = rgba(img.width, img.height);
  const n = img.width * img.height;
  const s = img.data;
  const o = out.data;
  for (let i = 0; i < n; i++) {
    const a = i * 4;
    const b = (n - 1 - i) * 4;
    o[a] = s[b];
    o[a + 1] = s[b + 1];
    o[a + 2] = s[b + 2];
    o[a + 3] = s[b + 3];
  }
  return out;
}

/** Schärfe: Varianz des Laplace-Operators (auf Graustufen). */
export function sharpness(img: RGBA): number {
  const g = gray(img);
  const w = img.width;
  const h = img.height;
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = g[i - 1] + g[i + 1] + g[i - w] + g[i + w] - 4 * g[i];
      sum += l;
      sum2 += l * l;
      n++;
    }
  }
  if (!n) return 0;
  const m = sum / n;
  return sum2 / n - m * m;
}

/** Anteil sehr heller, gesättigter Lichtreflexe (Spiegelung auf Hülle oder Holo). */
export function glare(img: RGBA): number {
  const d = img.data;
  const n = img.width * img.height;
  let hot = 0;
  for (let i = 0; i < n; i++) {
    const r = d[i * 4];
    const g = d[i * 4 + 1];
    const b = d[i * 4 + 2];
    if (r > 245 && g > 245 && b > 245) hot++;
  }
  return hot / n;
}
