// Bilderkennung: Karte im Kamerabild finden, gerade rücken und per Bild-Merkmalen im Kartenindex suchen.
//
// Ablauf: Kanten der Karte suchen (vier Linien mit kleinem Winkel) -> perspektivisch entzerren
// -> DINOv2-small (ONNX, int8, im Browser) mit gelerntem Whitening -> 128-D-Vektor -> Ähnlichkeit
// zu allen Kartenbildern (data/vision/). Erzeugt wird der Index mit scripts/build-vision-index.py.

const ORT_VERSION = '1.30.0';
const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
const BASE = new URL('../', import.meta.url);
const KEYS_URL = new URL('data/vision/keys.json', BASE).href;
// Modell und Vektoren tragen den Modell-Hash in der URL: der Service Worker cacht sie dauerhaft,
// und Index und Schlüssel passen immer zusammen.
const modelUrl = (meta) => new URL(`models/card-embed.onnx?v=${meta.model}`, BASE).href;
const indexUrl = (meta) => new URL(`data/vision/index.bin?v=${meta.model}-${meta.count}`, BASE).href;

let metaPromise = null;
function getMeta() {
  metaPromise ||= fetch(KEYS_URL)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Index: HTTP ${r.status}`))))
    .catch((err) => {
      metaPromise = null;
      throw err;
    });
  return metaPromise;
}

const CARD = 63 / 88;
const RECT_W = 245;
const RECT_H = 342;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

let sessionPromise = null;
let indexPromise = null;
let sessionReady = false;
let indexReady = false;

async function loadSession() {
  const ort = await import(`${ORT_BASE}ort.wasm.min.mjs`);
  ort.env.wasm.wasmPaths = ORT_BASE;
  // GitHub Pages liefert keine COOP/COEP-Header -> kein SharedArrayBuffer, also ein Thread
  ort.env.wasm.numThreads = 1;
  const res = await fetch(modelUrl(await getMeta()));
  if (!res.ok) throw new Error(`Modell: HTTP ${res.status}`);
  const session = await ort.InferenceSession.create(new Uint8Array(await res.arrayBuffer()), {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  return { ort, session };
}

async function loadIndex() {
  const meta = await getMeta();
  const res = await fetch(indexUrl(meta));
  if (!res.ok) throw new Error(`Index: HTTP ${res.status}`);
  const vectors = new Int8Array(await res.arrayBuffer());
  const rows = [];
  for (const [group, setId, ids] of meta.sets) for (const localId of ids) rows.push({ group, setId, localId });
  if (rows.length * meta.dims !== vectors.length) throw new Error('Bildindex beschädigt');
  return { dims: meta.dims, scale: meta.scale, rows, vectors };
}

function getSession() {
  sessionPromise ||= loadSession().then(
    (s) => ((sessionReady = true), s),
    (err) => {
      sessionPromise = null;
      throw err;
    },
  );
  return sessionPromise;
}

function getIndex() {
  indexPromise ||= loadIndex().then(
    (i) => ((indexReady = true), i),
    (err) => {
      indexPromise = null;
      throw err;
    },
  );
  return indexPromise;
}

/** Sind Modell und Index geladen (Bildsuche ohne Download-Wartezeit möglich)? */
export const visionReady = () => sessionReady && indexReady;

/** Modell und Index im Hintergrund vorladen. */
export function warmupVision() {
  return Promise.all([getSession(), getIndex()]).then(
    () => true,
    () => false,
  );
}

// ---------- Karte finden ----------

/** Gaußfilter (σ 1,2) je Kanal, Ränder gespiegelt. */
function blur(src, w, h) {
  const r = 5;
  const k = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) sum += k[i + r] = Math.exp(-(i * i) / (2 * 1.2 * 1.2));
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const refl = (i, n) => (i < 0 ? -i : i >= n ? 2 * n - 2 - i : i);
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) a += src[y * w + refl(x + i, w)] * k[i + r];
      tmp[y * w + x] = a;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) a += tmp[refl(y + i, h) * w + x] * k[i + r];
      out[y * w + x] = a;
    }
  }
  return out;
}

/** Betrag der Sobel-Gradienten (x und y), Maximum über die Farbkanäle. */
function edgeMaps(canvas, W = 300) {
  const s = W / canvas.width;
  const H = Math.round(canvas.height * s);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  const gx = new Float32Array(W * H);
  const gy = new Float32Array(W * H);
  const refl = (i, n) => (i < 0 ? -i : i >= n ? 2 * n - 2 - i : i);
  for (let ch = 0; ch < 3; ch++) {
    const plane = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) plane[i] = d[i * 4 + ch];
    const b = blur(plane, W, H);
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
  return { gx, gy, W, H, s };
}

const SLOPES = Array.from({ length: 41 }, (_, i) => -0.2 + i * 0.01);

/**
 * Stärkste Kante in einem Randbereich: Linie x = c + t·(y − H/2) (vertikal) bzw. y = c + t·(x − W/2).
 * Bevorzugt die äußerste ausreichend starke Linie, damit innere Rahmenlinien der Karte nicht gewinnen.
 */
function bestLine(g, W, H, vertical, lo, hi, outerFirst, rel = 0.4) {
  const L = vertical ? H : W;
  const N = vertical ? W : H;
  const n = 60;
  const u = Array.from({ length: n }, (_, i) => 0.12 * L + ((0.88 - 0.12) * L * i) / (n - 1));
  const uc = L / 2;
  const c0 = Math.floor(lo * N);
  const c1 = Math.floor(hi * N);
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
      vals.sort();
      const score = 0.25 * (vals[n / 2 - 1] + vals[n / 2]) + (0.5 * sum) / n;
      best[i * cols + j] = score;
      if (score > m) m = score;
    }
  }
  if (m <= 0) return null;
  const col = new Float32Array(cols);
  for (let j = 0; j < cols; j++) for (let i = 0; i < SLOPES.length; i++) col[j] = Math.max(col[j], best[i * cols + j]);
  let j = -1;
  if (outerFirst) {
    for (let x = 0; x < cols; x++) if (col[x] >= rel * m) { j = x; break; }
  } else {
    for (let x = cols - 1; x >= 0; x--) if (col[x] >= rel * m) { j = x; break; }
  }
  let jj = j;
  for (let x = Math.max(0, j - 3); x <= Math.min(cols - 1, j + 3); x++) if (col[x] > col[jj]) jj = x;
  let bi = 0;
  for (let i = 1; i < SLOPES.length; i++) if (best[i * cols + jj] > best[bi * cols + jj]) bi = i;
  return { c: c0 + jj, t: SLOPES[bi] };
}

/**
 * Vier Ecken der Karte (oben links, oben rechts, unten rechts, unten links) in Bildkoordinaten
 * oder null, wenn keine plausible Karte gefunden wurde.
 */
export function findCardQuad(canvas) {
  const { gx, gy, W, H, s } = edgeMaps(canvas);
  const l = bestLine(gx, W, H, true, 0, 0.33, true);
  const r = bestLine(gx, W, H, true, 0.67, 1, false);
  const t = bestLine(gy, W, H, false, 0, 0.3, true);
  const b = bestLine(gy, W, H, false, 0.7, 1, false);
  if (!l || !r || !t || !b) return null;
  const vx = (ln) => (y) => ln.c + ln.t * (y - H / 2);
  const hy = (ln) => (x) => ln.c + ln.t * (x - W / 2);
  const inter = (fx, fy) => {
    let y = H / 2;
    let x = 0;
    for (let i = 0; i < 8; i++) {
      x = fx(y);
      y = fy(x);
    }
    return [x / s, y / s];
  };
  const q = [inter(vx(l), hy(t)), inter(vx(r), hy(t)), inter(vx(r), hy(b)), inter(vx(l), hy(b))];
  return quadOk(q, canvas.width, canvas.height) ? q : null;
}

function quadOk(q, w, h) {
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const asp = (dist(q[0], q[1]) + dist(q[3], q[2])) / (dist(q[0], q[3]) + dist(q[1], q[2]));
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const [x1, y1] = q[i];
    const [x2, y2] = q[(i + 1) % 4];
    area += x1 * y2 - x2 * y1;
  }
  area = Math.abs(area) / 2 / (w * h);
  return asp > 0.85 * CARD && asp < 1.15 * CARD && area > 0.35;
}

/** Homographie, die die Punkte src auf dst abbildet (je 4 Punkte). */
function homography(src, dst) {
  const A = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // Gauß-Elimination mit Pivotsuche
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

/** Karte perspektivisch entzerren (bilinear, Rand wiederholt). */
export function warpCard(canvas, quad, w = RECT_W, h = RECT_H) {
  const sw = canvas.width;
  const sh = canvas.height;
  const src = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, sw, sh).data;
  // Abbildung Zielpixel -> Quellpunkt (wie cv2.warpPerspective)
  const H = homography([[0, 0], [w, 0], [w, h], [0, h]], quad);
  const out = new ImageData(w, h);
  const o = out.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const z = H[6] * x + H[7] * y + H[8];
      const fx = Math.min(sw - 1, Math.max(0, (H[0] * x + H[1] * y + H[2]) / z));
      const fy = Math.min(sh - 1, Math.max(0, (H[3] * x + H[4] * y + H[5]) / z));
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
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').putImageData(out, 0, 0);
  return c;
}

/** Ausschnitt ohne den 4-%-Rand des Kamerarahmens (wenn keine Kartenkanten gefunden wurden). */
function innerCrop(canvas, margin = 0.04) {
  const f = margin / (1 + 2 * margin);
  const x = Math.floor(canvas.width * f);
  const y = Math.floor(canvas.height * f);
  const c = document.createElement('canvas');
  c.width = canvas.width - 2 * x;
  c.height = canvas.height - 2 * y;
  c.getContext('2d').drawImage(canvas, x, y, c.width, c.height, 0, 0, c.width, c.height);
  return c;
}

/**
 * Entzerrte Karte (oder bester Ausschnitt) als Canvas.
 * @param {Array|null|undefined} quad  bereits gefundene Ecken (undefined = selbst suchen)
 */
export function cardView(canvas, quad) {
  if (quad === undefined) quad = findCardQuad(canvas);
  return { quad, view: quad ? warpCard(canvas, quad) : innerCrop(canvas) };
}

/** Gerade gerückte Karte in höherer Auflösung (für die Texterkennung). */
export function straightCard(canvas, quad, width = 900) {
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  // nicht über die Auflösung des Fotos hinaus vergrößern
  const w = Math.round(Math.min(width, Math.max(dist(quad[0], quad[1]), dist(quad[3], quad[2])) * 1.25));
  return warpCard(canvas, quad, w, Math.round(w / CARD));
}

// ---------- Merkmale & Suche ----------

function toTensor(ort, view, [IN_W, IN_H]) {
  const c = document.createElement('canvas');
  c.width = IN_W;
  c.height = IN_H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(view, 0, 0, IN_W, IN_H);
  const d = ctx.getImageData(0, 0, IN_W, IN_H).data;
  const n = IN_W * IN_H;
  const x = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    for (let ch = 0; ch < 3; ch++) x[ch * n + i] = (d[i * 4 + ch] / 255 - MEAN[ch]) / STD[ch];
  }
  return new ort.Tensor('float32', x, [1, 3, IN_H, IN_W]);
}

/** 128-D-Merkmalsvektor (L2-normiert) eines Kartenbildes. */
export async function embedCard(view) {
  const [{ ort, session }, meta] = await Promise.all([getSession(), getMeta()]);
  const out = await session.run({ pixel_values: toTensor(ort, view, meta.input) });
  const v = Float32Array.from(out.embedding.data);
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

/** Ähnlichste Karten im Index: [{group, setId, localId, sim}] absteigend. */
export async function nearestCards(vec, k = 24) {
  const { dims, scale, rows, vectors } = await getIndex();
  const sims = new Float32Array(rows.length);
  for (let r = 0, o = 0; r < rows.length; r++, o += dims) {
    let s = 0;
    for (let j = 0; j < dims; j++) s += vectors[o + j] * vec[j];
    sims[r] = s * scale;
  }
  const top = [];
  for (let r = 0; r < rows.length; r++) {
    if (top.length < k || sims[r] > top[top.length - 1].sim) {
      top.push({ ...rows[r], sim: sims[r] });
      top.sort((a, b) => b.sim - a.sim);
      if (top.length > k) top.pop();
    }
  }
  return top;
}

// ---------- Sprache am Kartenbild ----------
// Vergleicht die grobe Textstruktur (Namensleiste, Attacken-/Textbereich) des Fotos mit
// vorberechneten Signaturen derselben Karte in jeder Sprache (scripts/build-vision-index.py).
// Funktioniert auch, wenn der Text zu unscharf zum Lesen ist: Wortlängen und Zeilen bleiben sichtbar.

const SIG_VERSION = 'lsig1';
const SIG_REGIONS = [
  { box: [0.02, 0.12, 0.05, 0.8], grid: [3, 16] },
  { box: [0.5, 0.92, 0.04, 0.96], grid: [8, 16] },
];
const sigCache = new Map();

function gaussian(src, w, h, sigma) {
  // Kernelgröße wie OpenCV für float-Bilder: round(sigma * 8 + 1) | 1
  const r = (Math.round(sigma * 8 + 1) | 1) >> 1;
  const k = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) sum += k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const refl = (i, n) => (i < 0 ? -i : i >= n ? 2 * n - 2 - i : i);
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) a += src[y * w + refl(x + i, w)] * k[i + r];
      tmp[y * w + x] = a;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) a += tmp[refl(y + i, h) * w + x] * k[i + r];
      out[y * w + x] = a;
    }
  }
  return out;
}

/** Kantenenergie des entzerrten Kartenbildes (245 x 342): |Laplace| weichgezeichnet. */
function languageFeatures(view) {
  let src = view;
  if (view.width !== RECT_W || view.height !== RECT_H) {
    src = document.createElement('canvas');
    src.width = RECT_W;
    src.height = RECT_H;
    const c = src.getContext('2d');
    c.imageSmoothingQuality = 'high';
    c.drawImage(view, 0, 0, RECT_W, RECT_H);
  }
  const w = RECT_W;
  const h = RECT_H;
  const d = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  const b = gaussian(g, w, h, 0.8);
  const refl = (i, n) => (i < 0 ? -i : i >= n ? 2 * n - 2 - i : i);
  const e = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const ym = refl(y - 1, h) * w;
    const yp = refl(y + 1, h) * w;
    for (let x = 0; x < w; x++) {
      const xm = refl(x - 1, w);
      const xp = refl(x + 1, w);
      // OpenCV-Laplace mit ksize 3: [[2,0,2],[0,-8,0],[2,0,2]]
      e[y * w + x] = Math.abs(2 * (b[ym + xm] + b[ym + xp] + b[yp + xm] + b[yp + xp]) - 8 * b[y * w + x]);
    }
  }
  return { f: gaussian(e, w, h, 1.5), w, h };
}

/** Flächenmittel eines (Teil-)Bereichs auf ein grobes Raster, mittelwertfrei und L2-normiert. */
function regionSignature({ f, w, h }, box, grid, dx = 0, dy = 0, sc = 1) {
  const [y0, y1, x0, x1] = box;
  const [gh, gw] = grid;
  const cy = ((y0 + y1) / 2) * h + dy;
  const cx = ((x0 + x1) / 2) * w + dx;
  const hh = ((y1 - y0) * h * sc) / 2;
  const ww = ((x1 - x0) * w * sc) / 2;
  const Y0 = Math.max(0, Math.round(cy - hh));
  const Y1 = Math.min(h, Math.round(cy + hh));
  const X0 = Math.max(0, Math.round(cx - ww));
  const X1 = Math.min(w, Math.round(cx + ww));
  const out = new Float32Array(gh * gw);
  const fy = (Y1 - Y0) / gh;
  const fx = (X1 - X0) / gw;
  for (let gy = 0; gy < gh; gy++) {
    const ya = Y0 + gy * fy;
    const yb = ya + fy;
    for (let gx = 0; gx < gw; gx++) {
      const xa = X0 + gx * fx;
      const xb = xa + fx;
      let sum = 0;
      let area = 0;
      for (let y = Math.floor(ya); y < Math.ceil(yb); y++) {
        const wy = Math.min(yb, y + 1) - Math.max(ya, y);
        if (wy <= 0) continue;
        for (let x = Math.floor(xa); x < Math.ceil(xb); x++) {
          const wx = Math.min(xb, x + 1) - Math.max(xa, x);
          if (wx <= 0) continue;
          sum += f[y * w + x] * wx * wy;
          area += wx * wy;
        }
      }
      out[gy * gw + gx] = area ? sum / area : 0;
    }
  }
  let mean = 0;
  for (const v of out) mean += v;
  mean /= out.length;
  let n = 0;
  for (let i = 0; i < out.length; i++) {
    out[i] -= mean;
    n += out[i] * out[i];
  }
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= n;
  return out;
}

/** Gespeicherte 4-bit-Signatur entpacken, je Bereich L2-normiert. */
function decodeSignature(b64) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const vals = new Float32Array(bytes.length * 2);
  for (let i = 0; i < bytes.length; i++) {
    vals[2 * i] = (bytes[i] & 15) - 8;
    vals[2 * i + 1] = (bytes[i] >> 4) - 8;
  }
  const parts = [];
  let o = 0;
  for (const { grid } of SIG_REGIONS) {
    const n = grid[0] * grid[1];
    const p = vals.slice(o, o + n);
    o += n;
    let s = 0;
    for (const v of p) s += v * v;
    s = Math.sqrt(s) || 1;
    for (let i = 0; i < n; i++) p[i] /= s;
    parts.push(p);
  }
  return parts;
}

function loadSignatures(setId) {
  if (!sigCache.has(setId)) {
    const url = new URL(`data/vision/lang/${encodeURIComponent(setId)}.json`, BASE).href;
    sigCache.set(
      setId,
      fetch(url)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => (d?.v === SIG_VERSION ? d.cards : null))
        .catch(() => {
          sigCache.delete(setId);
          return null;
        }),
    );
  }
  return sigCache.get(setId);
}

/**
 * Kartensprache am Bild bestimmen (nur internationale Karten).
 * @returns {Promise<{best: string, margin: number, scores: object, langs: string[]}|null>}
 */
export async function languageFromImage(view, setId, localId) {
  const cards = await loadSignatures(setId);
  const refs = cards?.[localId];
  const langs = refs ? Object.keys(refs) : [];
  if (langs.length < 2) return null;
  const decoded = Object.fromEntries(langs.map((l) => [l, decodeSignature(refs[l])]));
  const feat = languageFeatures(view);
  // Toleranz für ungenaue Kanten (z. B. Toploader): Verschiebung und Skalierung durchprobieren
  const shifts = [-12, -8, -4, 0, 4, 8, 12];
  const scores = Object.fromEntries(langs.map((l) => [l, 0]));
  SIG_REGIONS.forEach(({ box, grid }, r) => {
    const best = Object.fromEntries(langs.map((l) => [l, -1]));
    for (const dx of shifts) {
      for (const dy of shifts) {
        for (const sc of [0.92, 0.96, 1, 1.04, 1.08]) {
          const q = regionSignature(feat, box, grid, dx, dy, sc);
          for (const l of langs) {
            const ref = decoded[l][r];
            let s = 0;
            for (let i = 0; i < q.length; i++) s += q[i] * ref[i];
            if (s > best[l]) best[l] = s;
          }
        }
      }
    }
    for (const l of langs) scores[l] += best[l];
  });
  const ranked = langs.sort((a, b) => scores[b] - scores[a]);
  return { best: ranked[0], margin: scores[ranked[0]] - scores[ranked[1]], scores, langs: ranked };
}

/**
 * Komplette Bildsuche für einen Kamera-Ausschnitt.
 * @returns {Promise<{matches: Array, quad: Array|null, view: HTMLCanvasElement, ms: number}>}
 */
export async function visualSearch(canvas, { k = 24, quad } = {}) {
  const t0 = performance.now();
  if (quad === undefined) quad = findCardQuad(canvas);
  // Steckt die Karte in einem Toploader oder einer Hülle, findet die Kantensuche oft deren Rand.
  // Darum zusätzlich engere Ausschnitte (typischer Toploader: seitlich und oben mehr Spiel) prüfen
  // und den Ausschnitt mit dem eindeutigsten Treffer nehmen.
  const quads = quad ? [quad, insetQuad(quad, 0.05, 0.05, 0.02), insetQuad(quad, 0.085, 0.09, 0.03)] : [null];
  let best = null;
  for (const q of quads) {
    const view = q ? warpCard(canvas, q) : innerCrop(canvas);
    const matches = await nearestCards(await embedCard(view), k);
    if (!best || matches[0].sim > best.matches[0].sim) best = { matches, quad: q, view };
    // eindeutiger Treffer -> weitere Ausschnitte sparen (Abstand ≥ 0,08 war im Test immer richtig)
    if (best.matches[0].sim >= 0.7 && best.matches[0].sim - best.matches[1].sim >= 0.08) break;
  }
  return { ...best, ms: Math.round(performance.now() - t0) };
}

/** Viereck nach innen verkleinern (Anteile der Breite seitlich, der Höhe oben/unten). */
function insetQuad(q, side, top, bottom) {
  const at = (u, v) => {
    const x = (1 - v) * ((1 - u) * q[0][0] + u * q[1][0]) + v * ((1 - u) * q[3][0] + u * q[2][0]);
    const y = (1 - v) * ((1 - u) * q[0][1] + u * q[1][1]) + v * ((1 - u) * q[3][1] + u * q[2][1]);
    return [x, y];
  };
  return [at(side, top), at(1 - side, top), at(1 - side, 1 - bottom), at(side, 1 - bottom)];
}
