// Karten im Bild finden und gerade rücken – reine Funktionen auf Pixel-Arrays.
//
// Zwei Wege:
//  1. findCardQuad: eine Karte, die den Großteil des Bildes füllt (Kamera-Rahmen, Nahaufnahme).
//     Sucht die vier Kartenkanten als Geraden mit kleinem Winkel (übernommen aus der ersten Version).
//  2. findCardQuads: mehrere Karten (bis 9, z. B. eine Binderseite) in beliebiger Lage.
//     Kantenbild -> geschlossene Flächen -> kleinstes umschließendes Rechteck je Fläche ->
//     Kartenformat prüfen; aneinanderliegende Karten werden über die Trennkanten in ein Raster geteilt.

import { CARD_RATIO, resize, rgba, type Point, type Quad, type RGBA } from './rgba';

export const RECT_W = 245;
export const RECT_H = 342;

// ---------- Hilfen ----------

const refl = (i: number, n: number) => (i < 0 ? -i : i >= n ? 2 * n - 2 - i : i);

/** Gaußfilter (σ) auf einem Kanal, Ränder gespiegelt. */
export function blur(src: Float32Array, w: number, h: number, sigma = 1.2): Float32Array {
  const r = Math.max(1, Math.ceil(sigma * 3));
  const k: number[] = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) sum += k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const kk = Float64Array.from(k);
  const n = 2 * r + 1;
  // Innen ohne Randspiegelung (schnell), nur an den Rändern refl()
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let a = 0;
      if (x >= r && x < w - r) {
        const b = row + x - r;
        for (let i = 0; i < n; i++) a += src[b + i] * kk[i];
      } else for (let i = -r; i <= r; i++) a += src[row + refl(x + i, w)] * kk[i + r];
      tmp[row + x] = a;
    }
  }
  for (let y = 0; y < h; y++) {
    const inner = y >= r && y < h - r;
    for (let x = 0; x < w; x++) {
      let a = 0;
      if (inner) {
        let j = (y - r) * w + x;
        for (let i = 0; i < n; i++, j += w) a += tmp[j] * kk[i];
      } else for (let i = -r; i <= r; i++) a += tmp[refl(y + i, h) * w + x] * kk[i + r];
      out[y * w + x] = a;
    }
  }
  return out;
}

/** Sobel-Gradienten (Betrag x, Betrag y), Maximum über die Farbkanäle. */
function gradients(img: RGBA, sigma = 1.2) {
  const { width: W, height: H, data: d } = img;
  const gx = new Float32Array(W * H);
  const gy = new Float32Array(W * H);
  for (let ch = 0; ch < 3; ch++) {
    const plane = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) plane[i] = d[i * 4 + ch];
    const b = blur(plane, W, H, sigma);
    for (let y = 0; y < H; y++) {
      const ym = refl(y - 1, H) * W;
      const y0 = y * W;
      const yp = refl(y + 1, H) * W;
      for (let x = 0; x < W; x++) {
        const xm = refl(x - 1, W);
        const xp = refl(x + 1, W);
        const vx = Math.abs(b[ym + xp] - b[ym + xm] + 2 * (b[y0 + xp] - b[y0 + xm]) + b[yp + xp] - b[yp + xm]);
        const vy = Math.abs(b[yp + xm] - b[ym + xm] + 2 * (b[yp + x] - b[ym + x]) + b[yp + xp] - b[ym + xp]);
        const i = y0 + x;
        if (vx > gx[i]) gx[i] = vx;
        if (vy > gy[i]) gy[i] = vy;
      }
    }
  }
  return { gx, gy };
}

const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function quadArea(q: Quad): number {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const [x1, y1] = q[i];
    const [x2, y2] = q[(i + 1) % 4];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

/** Seitenverhältnis Breite/Höhe eines Vierecks (Mittel gegenüberliegender Seiten). */
export function quadAspect(q: Quad): number {
  return (dist(q[0], q[1]) + dist(q[3], q[2])) / (dist(q[0], q[3]) + dist(q[1], q[2]));
}

// ---------- 1) Eine Karte, die das Bild füllt ----------

/** Median (gerade Anzahl: Mittel der beiden mittleren Werte) per Quickselect – ordnet a dabei teilweise um. */
function median(a: Float32Array): number {
  const n = a.length;
  const k = n >> 1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const pivot = a[(lo + hi) >> 1];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (a[i] < pivot) i++;
      while (a[j] > pivot) j--;
      if (i <= j) {
        const t = a[i];
        a[i] = a[j];
        a[j] = t;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else break;
  }
  if (n & 1) return a[k];
  let below = -Infinity;
  for (let i = 0; i < k; i++) if (a[i] > below) below = a[i];
  return (below + a[k]) / 2;
}

const SLOPES = Array.from({ length: 41 }, (_, i) => -0.2 + i * 0.01);

/**
 * Stärkste Kante in einem Randbereich: Linie x = c + t·(y − H/2) (vertikal) bzw. y = c + t·(x − W/2).
 * Bevorzugt die äußerste ausreichend starke Linie, damit innere Rahmenlinien der Karte nicht gewinnen.
 */
function bestLine(g: Float32Array, W: number, H: number, vertical: boolean, lo: number, hi: number, outerFirst: boolean, rel = 0.4) {
  const L = vertical ? H : W;
  const N = vertical ? W : H;
  const n = 60;
  const u = Array.from({ length: n }, (_, i) => 0.12 * L + ((0.88 - 0.12) * L * i) / (n - 1));
  const uc = L / 2;
  const c0 = Math.floor(lo * N);
  const c1 = Math.min(N - 1, Math.floor(hi * N));
  const cols = c1 - c0 + 1;
  const best = new Float32Array(SLOPES.length * cols);
  const vals = new Float32Array(n);
  let m = 0;
  for (let i = 0; i < SLOPES.length; i++) {
    const t = SLOPES[i];
    for (let j = 0; j < cols; j++) {
      const c = c0 + j;
      let sum = 0;
      for (let k = 0; k < n; k++) {
        const p = Math.min(N - 1, Math.max(0, Math.round(c + t * (u[k] - uc))));
        const q = Math.round(u[k]);
        const v = vertical ? g[q * W + p] : g[p * W + q];
        vals[k] = v;
        sum += v;
      }
      const score = 0.5 * median(vals) + (0.5 * sum) / n;
      best[i * cols + j] = score;
      if (score > m) m = score;
    }
  }
  if (m <= 0) return null;
  const col = new Float32Array(cols);
  for (let j = 0; j < cols; j++) for (let i = 0; i < SLOPES.length; i++) col[j] = Math.max(col[j], best[i * cols + j]);
  let j = -1;
  if (outerFirst) {
    for (let x = 0; x < cols; x++)
      if (col[x] >= rel * m) {
        j = x;
        break;
      }
  } else {
    for (let x = cols - 1; x >= 0; x--)
      if (col[x] >= rel * m) {
        j = x;
        break;
      }
  }
  if (j < 0) return null;
  let jj = j;
  for (let x = Math.max(0, j - 3); x <= Math.min(cols - 1, j + 3); x++) if (col[x] > col[jj]) jj = x;
  let bi = 0;
  for (let i = 1; i < SLOPES.length; i++) if (best[i * cols + jj] > best[bi * cols + jj]) bi = i;
  return { c: c0 + jj, t: SLOPES[bi] };
}

function quadOk(q: Quad, w: number, h: number, minArea = 0.35) {
  const asp = quadAspect(q);
  return asp > 0.85 * CARD_RATIO && asp < 1.15 * CARD_RATIO && quadArea(q) / (w * h) > minArea;
}

/** Vier Ecken einer Karte, die den Großteil des Bildes füllt – oder null. W: Arbeitsbreite (Live-Vorschau kleiner). */
export function findCardQuad(img: RGBA, W = 300): Quad | null {
  const s = W / img.width;
  const H = Math.round(img.height * s);
  const small = resize(img, W, H);
  const { gx, gy } = gradients(small);
  const l = bestLine(gx, W, H, true, 0, 0.33, true);
  const r = bestLine(gx, W, H, true, 0.67, 1, false);
  const t = bestLine(gy, W, H, false, 0, 0.3, true);
  const b = bestLine(gy, W, H, false, 0.7, 1, false);
  if (!l || !r || !t || !b) return null;
  const vx = (ln: { c: number; t: number }) => (y: number) => ln.c + ln.t * (y - H / 2);
  const hy = (ln: { c: number; t: number }) => (x: number) => ln.c + ln.t * (x - W / 2);
  const inter = (fx: (y: number) => number, fy: (x: number) => number): Point => {
    let y = H / 2;
    let x = 0;
    for (let i = 0; i < 8; i++) {
      x = fx(y);
      y = fy(x);
    }
    return [x / s, y / s];
  };
  const q: Quad = [inter(vx(l), hy(t)), inter(vx(r), hy(t)), inter(vx(r), hy(b)), inter(vx(l), hy(b))];
  return quadOk(q, img.width, img.height) ? q : null;
}

// ---------- Entzerren ----------

/** Homographie, die die Punkte src auf dst abbildet (je 4 Punkte). */
export function homography(src: Point[], dst: Point[]): number[] {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  const h = A.map((row, i) => row[8] / row[i]);
  return [...h, 1];
}

/** Karte perspektivisch entzerren (bilinear). */
export function warp(img: RGBA, quad: Quad, w = RECT_W, h = RECT_H): RGBA {
  const sw = img.width;
  const sh = img.height;
  const src = img.data;
  const H = homography(
    [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ],
    quad,
  );
  const out = rgba(w, h);
  const o = out.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const z = H[6] * px + H[7] * py + H[8];
      const fx = Math.min(sw - 1, Math.max(0, (H[0] * px + H[1] * py + H[2]) / z - 0.5));
      const fy = Math.min(sh - 1, Math.max(0, (H[3] * px + H[4] * py + H[5]) / z - 0.5));
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const x1 = Math.min(sw - 1, x0 + 1);
      const y1 = Math.min(sh - 1, y0 + 1);
      const ax = fx - x0;
      const ay = fy - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;
      const t = (y * w + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const top = src[i00 + ch] + (src[i10 + ch] - src[i00 + ch]) * ax;
        const bot = src[i01 + ch] + (src[i11 + ch] - src[i01 + ch]) * ax;
        o[t + ch] = top + (bot - top) * ay;
      }
      o[t + 3] = 255;
    }
  }
  return out;
}

/** Gerade gerückte Karte in höherer Auflösung (für Texterkennung und Foto), nie über die Quelle hinaus. */
export function straighten(img: RGBA, quad: Quad, width = 900): RGBA {
  const w = Math.round(Math.min(width, Math.max(dist(quad[0], quad[1]), dist(quad[3], quad[2])) * 1.25));
  return warp(img, quad, Math.max(60, w), Math.max(84, Math.round(w / CARD_RATIO)));
}

/** Viereck nach innen verkleinern (Anteile der Breite seitlich, der Höhe oben/unten). */
export function insetQuad(q: Quad, side: number, top: number, bottom: number): Quad {
  const at = (u: number, v: number): Point => {
    const x = (1 - v) * ((1 - u) * q[0][0] + u * q[1][0]) + v * ((1 - u) * q[3][0] + u * q[2][0]);
    const y = (1 - v) * ((1 - u) * q[0][1] + u * q[1][1]) + v * ((1 - u) * q[3][1] + u * q[2][1]);
    return [x, y];
  };
  return [at(side, top), at(1 - side, top), at(1 - side, 1 - bottom), at(side, 1 - bottom)];
}

/** Viereck um 180° gedreht (Karte steht auf dem Kopf). */
export const flipQuad = (q: Quad): Quad => [q[2], q[3], q[0], q[1]];

// ---------- 2) Mehrere Karten ----------

const DET_SIDE = 600;
export let DEBUG: Array<Record<string, number>> | null = null;
export const setDebug = (on: boolean) => (DEBUG = on ? [] : null);

export interface Detection {
  quad: Quad;
  /** 0..1 – wie sicher die Fläche eine Karte ist (Füllgrad, Format, Kanten). */
  score: number;
  /** Teil eines Rasters (z. B. Binderseite) – Zeile/Spalte, sonst null. */
  cell: [number, number] | null;
  /** Fläche, aus der die Karte stammt (gleiche Nummer = gleiche Fläche) */
  group?: number;
  /** Wurde die Fläche geteilt und hätte sie auch als eine Karte gepasst: diese eine Karte (Gegenprobe per Bildsuche) */
  whole?: Quad;
}

/** Monotone-Chain-Hülle. */
function hull(pts: Point[]): Point[] {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Point[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Point[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

interface Rect {
  cx: number;
  cy: number;
  w: number; // entlang ux
  h: number; // entlang uy
  ux: Point; // Einheitsvektor der Breite
  uy: Point;
}

/** Kleinstes umschließendes Rechteck (Drehschieber über die Hüllkanten). */
function minAreaRect(h: Point[]): Rect | null {
  if (h.length < 3) return null;
  let best: Rect | null = null;
  let bestArea = Infinity;
  for (let i = 0; i < h.length; i++) {
    const a = h[i];
    const b = h[(i + 1) % h.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    const ux: Point = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const uy: Point = [-ux[1], ux[0]];
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const p of h) {
      const u = p[0] * ux[0] + p[1] * ux[1];
      const v = p[0] * uy[0] + p[1] * uy[1];
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < bestArea) {
      bestArea = area;
      const cu = (minU + maxU) / 2;
      const cv = (minV + maxV) / 2;
      best = { cx: cu * ux[0] + cv * uy[0], cy: cu * ux[1] + cv * uy[1], w: maxU - minU, h: maxV - minV, ux, uy };
    }
  }
  return best;
}

/** Punkt im Rechteck-Koordinatensystem (u, v in 0..1) -> Bild. */
const rectAt = (r: Rect, u: number, v: number): Point => [
  r.cx + (u - 0.5) * r.w * r.ux[0] + (v - 0.5) * r.h * r.uy[0],
  r.cy + (u - 0.5) * r.w * r.ux[1] + (v - 0.5) * r.h * r.uy[1],
];

/**
 * Viereck einer Rasterzelle, immer als Hochformat (oben links, oben rechts, unten rechts, unten links).
 * Liegt die Karte quer, wird so gedreht, dass die lange Seite senkrecht steht; ob sie dann auf dem Kopf steht,
 * entscheidet später die Bildsuche (beide Richtungen werden geprüft).
 */
function cellQuad(r: Rect, row: number, col: number, rows: number, cols: number): Quad {
  const u0 = col / cols;
  const u1 = (col + 1) / cols;
  const v0 = row / rows;
  const v1 = (row + 1) / rows;
  let q: Quad = [rectAt(r, u0, v0), rectAt(r, u1, v0), rectAt(r, u1, v1), rectAt(r, u0, v1)];
  const wide = (r.w / cols) > (r.h / rows);
  if (wide) q = [q[3], q[0], q[1], q[2]]; // 90° drehen: linke Seite wird oben
  // Natürliche Lage bevorzugen: die Ecke „oben links“ soll oben (und eher links) im Bild liegen
  const topLeftness = (p: Point) => p[1] + 0.3 * p[0];
  if (topLeftness(q[2]) < topLeftness(q[0])) q = flipQuad(q);
  return q;
}

/**
 * Anteil der Punkte entlang einer Linie im Rechteck, an denen eine starke Kante quer zur Linie liegt
 * (beste Lage in ±tol). Gemessen wird nur der Gradient senkrecht zur Linie, damit z. B. waagrechte
 * Textzeilen eine senkrechte Trennlinie nicht vortäuschen.
 */
function lineSupport(gx: Float32Array, gy: Float32Array, thr: number, W: number, H: number, r: Rect, horizontal: boolean, pos: number, tol: number): number {
  // Normale der Linie: für senkrechte Linien die Breitenrichtung (ux), für waagrechte uy
  const nrm = horizontal ? r.uy : r.ux;
  const ax = Math.abs(nrm[0]);
  const ay = Math.abs(nrm[1]);
  let best = 0;
  const steps = 6;
  for (let s = -steps; s <= steps; s++) {
    const p = pos + (s / steps) * tol;
    let hit = 0;
    let n = 0;
    for (let i = 0; i <= 60; i++) {
      const t = 0.05 + (0.9 * i) / 60;
      const [x, y] = horizontal ? rectAt(r, t, p) : rectAt(r, p, t);
      const xi = Math.round(x);
      const yi = Math.round(y);
      if (xi < 1 || yi < 1 || xi >= W - 1 || yi >= H - 1) continue;
      n++;
      let on = 0;
      for (let dy = -1; dy <= 1 && !on; dy++)
        for (let dx = -1; dx <= 1 && !on; dx++) {
          const j = (yi + dy) * W + xi + dx;
          if (gx[j] * ax + gy[j] * ay > thr) on = 1;
        }
      hit += on;
    }
    if (n) best = Math.max(best, hit / n);
  }
  return best;
}

function quantile(a: Float32Array, q: number): number {
  const s = Float32Array.from(a).sort();
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

/**
 * Alle Karten im Bild (bis 9). Leer, wenn keine geschlossene kartenförmige Fläche gefunden wurde.
 * Die Ecken sind in Koordinaten des Eingangsbildes.
 */
export function findCardQuads(img: RGBA, { max = 9, side = DET_SIDE } = {}): Detection[] {
  const s = Math.min(1, side / Math.max(img.width, img.height));
  const small = s < 1 ? resize(img, img.width * s, img.height * s) : img;
  const W = small.width;
  const H = small.height;
  const { gx, gy } = gradients(small, 1.0);
  const mag = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) mag[i] = Math.hypot(gx[i], gy[i]);
  const tau = Math.max(40, quantile(mag, 0.82));
  const tauHi = Math.max(80, quantile(mag, 0.94));

  // Kantenbild schließen (3×3 dilatieren)
  const e0 = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) e0[i] = mag[i] > tau ? 1 : 0;
  const edge = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let v = 0;
      for (let dy = -1; dy <= 1 && !v; dy++)
        for (let dx = -1; dx <= 1 && !v; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < W && yy < H) v = e0[yy * W + xx];
        }
      edge[y * W + x] = v;
    }

  // Hintergrund: vom Bildrand aus über Nicht-Kanten-Pixel erreichbar
  const bg = new Uint8Array(W * H);
  const stack: number[] = [];
  const push = (i: number) => {
    if (!bg[i] && !edge[i]) {
      bg[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < W; x++) {
    push(x);
    push((H - 1) * W + x);
  }
  for (let y = 0; y < H; y++) {
    push(y * W);
    push(y * W + W - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % W;
    const y = (i - x) / W;
    if (x > 0) push(i - 1);
    if (x < W - 1) push(i + 1);
    if (y > 0) push(i - W);
    if (y < H - 1) push(i + W);
  }

  // Zusammenhängende Flächen (alles, was nicht Hintergrund ist)
  const label = new Int32Array(W * H).fill(-1);
  const out: Detection[] = [];
  const minArea = 0.012 * W * H;
  let next = 0;
  for (let start = 0; start < W * H; start++) {
    if (bg[start] || label[start] >= 0) continue;
    const id = next++;
    const comp: number[] = [start];
    label[start] = id;
    const boundary: Point[] = [];
    for (let k = 0; k < comp.length; k++) {
      const i = comp[k];
      const x = i % W;
      const y = (i - x) / W;
      let border = false;
      const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
      for (const j of nb) {
        if (j < 0 || bg[j]) {
          border = true;
          continue;
        }
        if (label[j] < 0) {
          label[j] = id;
          comp.push(j);
        }
      }
      if (border) boundary.push([x + 0.5, y + 0.5]);
    }
    if (comp.length < minArea || comp.length > 0.97 * W * H) continue;
    const rect = minAreaRect(hull(boundary));
    if (!rect || rect.w < 8 || rect.h < 8) continue;
    const fill = comp.length / (rect.w * rect.h);
    if (fill < 0.72) continue;
    out.push(...splitGrid(rect, fill, gx, gy, tauHi, W, H, s).map((d) => ({ ...d, group: id })));
  }

  // Doppelte (überlappende) Treffer entfernen, größte Sicherheit zuerst
  out.sort((a, b) => b.score - a.score);
  const kept: Detection[] = [];
  for (const d of out) {
    const c = center(d.quad);
    if (kept.some((k) => inside(c, k.quad))) continue;
    kept.push(d);
    if (kept.length >= max) break;
  }
  // Lesereihenfolge: Zeilen von oben nach unten, darin von links nach rechts
  return sortReading(kept);
}

/** Fläche in ein Raster aus Karten teilen (1×1 bis 3×3), wenn Format und Trennkanten passen. */
function splitGrid(rect: Rect, fill: number, gx: Float32Array, gy: Float32Array, thr: number, W: number, H: number, s: number): Detection[] {
  const support = (horizontal: boolean, pos: number, tol: number) => lineSupport(gx, gy, thr, W, H, rect, horizontal, pos, tol);
  let best: { rows: number; cols: number; score: number } | null = null;
  let wholeFits = false;
  for (let rows = 1; rows <= 3; rows++) {
    for (let cols = 1; cols <= 3; cols++) {
      const cw = rect.w / cols;
      const ch = rect.h / rows;
      const ratio = Math.min(cw, ch) / Math.max(cw, ch);
      const fmt = 1 - Math.abs(ratio - CARD_RATIO) / CARD_RATIO;
      if (fmt < 0.88) continue;
      if (rows === 1 && cols === 1) wholeFits = true;
      // Trennkanten müssen auf ganzer Länge sichtbar und klar stärker sein als Linien innerhalb der Karten.
      // Nötig, weil zwei Karten nebeneinander fast das Format einer quer liegenden Karte haben und ein
      // 3×3-Raster als Ganzes wieder Kartenformat hat.
      let sep = 1;
      let contrast = 1;
      const check = (horizontal: boolean, n: number) => {
        for (let k = 1; k < n; k++) {
          const at = support(horizontal, k / n, 0.025);
          let ctrl = 0;
          for (const f of [0.25, 0.4, 0.6, 0.75]) {
            ctrl = Math.max(ctrl, support(horizontal, (k - 1 + f) / n, 0.008));
            ctrl = Math.max(ctrl, support(horizontal, (k + f) / n, 0.008));
          }
          sep = Math.min(sep, at);
          contrast = Math.min(contrast, at - ctrl);
        }
      };
      check(false, cols);
      check(true, rows);
      if (rows * cols > 1) DEBUG?.push({ rows, cols, sep, contrast, w: rect.w, h: rect.h });
      if (rows * cols > 1 && (sep < 0.55 || contrast < 0.06)) continue;
      const score = fmt * 0.6 + Math.min(1, fill) * 0.4 + (rows * cols > 1 ? 0.05 * sep : 0);
      if (!best || rows * cols > best.rows * best.cols || (rows * cols === best.rows * best.cols && score > best.score)) {
        best = { rows, cols, score };
      }
    }
  }
  if (!best) return [];
  const scaleBack = (q: Quad): Quad => q.map(([x, y]) => [x / s, y / s]) as Quad;
  const res: Detection[] = [];
  const multi = best.rows * best.cols > 1;
  const whole = multi && wholeFits ? scaleBack(cellQuad(rect, 0, 0, 1, 1)) : undefined;
  for (let r = 0; r < best.rows; r++)
    for (let c = 0; c < best.cols; c++)
      res.push({ quad: scaleBack(cellQuad(rect, r, c, best.rows, best.cols)), score: best.score, cell: multi ? [r, c] : null, whole });
  return res;
}

export const center = (q: Quad): Point => [(q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4];

/** Punkt im (konvexen) Viereck? */
export function inside(p: Point, q: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (c === 0) continue;
    if (sign === 0) sign = Math.sign(c);
    else if (Math.sign(c) !== sign) return false;
  }
  return true;
}

function sortReading(list: Detection[]): Detection[] {
  if (list.length < 2) return list;
  const hs = list.map((d) => Math.abs(d.quad[3][1] - d.quad[0][1]));
  const rowTol = 0.5 * (hs.reduce((a, b) => a + b, 0) / hs.length);
  return list.slice().sort((a, b) => {
    const ca = center(a.quad);
    const cb = center(b.quad);
    return Math.abs(ca[1] - cb[1]) > rowTol ? ca[1] - cb[1] : ca[0] - cb[0];
  });
}

/**
 * Karten im Bild: erst die Mehrkarten-Suche; findet sie nichts (z. B. Karte füllt das Bild und berührt
 * den Rand), die Einzelkarten-Suche; sonst null.
 * fast (Live-Vorschau): die Einzelkarten-Suche nur, wenn ihr Ergebnis etwas ändern kann, und kleiner gerechnet.
 */
export function detectCards(img: RGBA, opts: { side?: number; max?: number; fast?: boolean } = {}): Detection[] {
  const multi = findCardQuads(img, opts);
  // Mehr als zwei Treffer oder lauter ungeteilte Flächen: die Einzelkarten-Suche würde nichts ändern
  if (opts.fast && multi.length && (multi.length > 2 || multi.every((d) => !d.cell))) return multi;
  const one = findCardQuad(img, opts.fast ? 240 : 300);
  if (one) {
    // Findet die Mehrkarten-Suche nur Teile einer großen Karte (z. B. das Bildfenster, wenn sich der helle
    // Kartenrand nicht vom Untergrund abhebt), gewinnt die Einzelkarten-Suche.
    const big = quadArea(one);
    const partsOfOne = multi.length <= 2 && multi.every((d) => inside(center(d.quad), one) && quadArea(d.quad) < 0.6 * big);
    if (!multi.length || partsOfOne) return [{ quad: one, score: 0.7, cell: null }];
  }
  return multi;
}
