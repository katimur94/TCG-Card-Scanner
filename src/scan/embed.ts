// Bildsuche: DINOv2-small (ONNX, int8) mit gelerntem Whitening -> 128-D-Vektor -> Ähnlichkeit zu allen
// Kartenbildern (data/vision/, erzeugt mit scripts/build-vision-index.py). Dazu die Sprache am Kartenbild.
// Läuft im Worker (vision.worker.ts); nur fetch und Pixel-Arrays, kein DOM.

import { gray, resize, type RGBA } from './rgba';
import { RECT_H, RECT_W } from './detect';
import type { Region } from '../db/schema';

// Gleiche Version und URL wie in der ersten App-Version: liegt bei bisherigen Nutzern schon im Cache.
const ORT_VERSION = '1.30.0';
const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

export interface VisionMeta {
  model: string;
  count: number;
  dims: number;
  scale: number;
  input: [number, number];
  sets: Array<[Region, string, string[]]>;
}

export interface Match {
  group: Region;
  setId: string;
  localId: string;
  sim: number;
}

let base = '';
/** Basis-URL der App (z. B. https://…/TCG-Card-Scanner/), vom Hauptthread gesetzt. */
export const setBase = (b: string) => (base = b);
const url = (p: string) => new URL(p, base).href;

let metaP: Promise<VisionMeta> | null = null;
function getMeta() {
  metaP ||= fetch(url('data/vision/keys.json'))
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Index: HTTP ${r.status}`))))
    .catch((err) => {
      metaP = null;
      throw err;
    });
  return metaP;
}

// Minimal-Typen für onnxruntime-web (vom CDN geladen)
interface OrtTensor {
  data: Float32Array;
}
interface OrtSession {
  run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensor>>;
}
interface Ort {
  env: { wasm: { wasmPaths: string; numThreads: number } };
  Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown;
  InferenceSession: { create(model: Uint8Array, opts: object): Promise<OrtSession> };
}

let sessionP: Promise<{ ort: Ort; session: OrtSession }> | null = null;
let indexP: Promise<{ dims: number; scale: number; rows: Array<Omit<Match, 'sim'>>; vectors: Int8Array }> | null = null;
const ready = { session: false, index: false };

export const visionReady = () => ready.session && ready.index;

function getSession() {
  sessionP ||= (async () => {
    const ort = (await import(/* @vite-ignore */ `${ORT_BASE}ort.wasm.min.mjs`)) as Ort;
    ort.env.wasm.wasmPaths = ORT_BASE;
    // GitHub Pages liefert keine COOP/COEP-Header -> kein SharedArrayBuffer, also ein Thread
    ort.env.wasm.numThreads = 1;
    const meta = await getMeta();
    const res = await fetch(url(`models/card-embed.onnx?v=${meta.model}`));
    if (!res.ok) throw new Error(`Modell: HTTP ${res.status}`);
    const session = await ort.InferenceSession.create(new Uint8Array(await res.arrayBuffer()), {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
    ready.session = true;
    return { ort, session };
  })().catch((err) => {
    sessionP = null;
    throw err;
  });
  return sessionP;
}

function getIndex() {
  indexP ||= (async () => {
    const meta = await getMeta();
    const res = await fetch(url(`data/vision/index.bin?v=${meta.model}-${meta.count}`));
    if (!res.ok) throw new Error(`Index: HTTP ${res.status}`);
    const vectors = new Int8Array(await res.arrayBuffer());
    const rows: Array<Omit<Match, 'sim'>> = [];
    for (const [group, setId, ids] of meta.sets) for (const localId of ids) rows.push({ group, setId, localId });
    if (rows.length * meta.dims !== vectors.length) throw new Error('Bildindex beschädigt');
    ready.index = true;
    return { dims: meta.dims, scale: meta.scale, rows, vectors };
  })().catch((err) => {
    indexP = null;
    throw err;
  });
  return indexP;
}

export function warmup() {
  return Promise.all([getSession(), getIndex()]).then(
    () => true,
    () => false,
  );
}

/** 128-D-Merkmalsvektor (L2-normiert) eines entzerrten Kartenbildes. */
export async function embed(view: RGBA): Promise<Float32Array> {
  const [{ ort, session }, meta] = await Promise.all([getSession(), getMeta()]);
  const [IN_W, IN_H] = meta.input;
  const small = resize(view, IN_W, IN_H);
  const n = IN_W * IN_H;
  const x = new Float32Array(3 * n);
  const d = small.data;
  for (let i = 0; i < n; i++) for (let ch = 0; ch < 3; ch++) x[ch * n + i] = (d[i * 4 + ch] / 255 - MEAN[ch]) / STD[ch];
  const out = await session.run({ pixel_values: new ort.Tensor('float32', x, [1, 3, IN_H, IN_W]) });
  const v = Float32Array.from(out.embedding.data);
  let norm = 0;
  for (const a of v) norm += a * a;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

/** Ähnlichste Karten im Index, absteigend. */
export async function nearest(vec: Float32Array, k = 24): Promise<Match[]> {
  const { dims, scale, rows, vectors } = await getIndex();
  const top: Match[] = [];
  for (let r = 0, o = 0; r < rows.length; r++, o += dims) {
    let s = 0;
    for (let j = 0; j < dims; j++) s += vectors[o + j] * vec[j];
    s *= scale;
    if (top.length < k || s > top[top.length - 1].sim) {
      top.push({ ...rows[r], sim: s });
      top.sort((a, b) => b.sim - a.sim);
      if (top.length > k) top.pop();
    }
  }
  return top;
}

// ---------- Sprache am Kartenbild ----------
// Vergleicht die grobe Textstruktur (Namensleiste, Textbereich) des Fotos mit vorberechneten Signaturen
// derselben Karte in jeder Sprache. Funktioniert auch, wenn der Text zu unscharf zum Lesen ist.

const SIG_VERSION = 'lsig1';
const SIG_REGIONS: Array<{ box: [number, number, number, number]; grid: [number, number] }> = [
  { box: [0.02, 0.12, 0.05, 0.8], grid: [3, 16] },
  { box: [0.5, 0.92, 0.04, 0.96], grid: [8, 16] },
];
const sigCache = new Map<string, Promise<Record<string, Record<string, string>> | null>>();

const refl = (i: number, n: number) => (i < 0 ? -i : i >= n ? 2 * n - 2 - i : i);

/** Gauß wie OpenCV für float-Bilder: Kernelgröße round(sigma * 8 + 1) | 1. */
function gaussianCv(src: Float32Array, w: number, h: number, sigma: number) {
  const r = (Math.round(sigma * 8 + 1) | 1) >> 1;
  const k: number[] = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) sum += k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) a += src[y * w + refl(x + i, w)] * k[i + r];
      tmp[y * w + x] = a;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) a += tmp[refl(y + i, h) * w + x] * k[i + r];
      out[y * w + x] = a;
    }
  return out;
}

function languageFeatures(view: RGBA) {
  const src = view.width === RECT_W && view.height === RECT_H ? view : resize(view, RECT_W, RECT_H);
  const w = RECT_W;
  const h = RECT_H;
  const b = gaussianCv(gray(src), w, h, 0.8);
  const e = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const ym = refl(y - 1, h) * w;
    const yp = refl(y + 1, h) * w;
    for (let x = 0; x < w; x++) {
      const xm = refl(x - 1, w);
      const xp = refl(x + 1, w);
      e[y * w + x] = Math.abs(2 * (b[ym + xm] + b[ym + xp] + b[yp + xm] + b[yp + xp]) - 8 * b[y * w + x]);
    }
  }
  return { f: gaussianCv(e, w, h, 1.5), w, h };
}

function regionSignature(
  { f, w, h }: { f: Float32Array; w: number; h: number },
  box: [number, number, number, number],
  grid: [number, number],
  dx = 0,
  dy = 0,
  sc = 1,
) {
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

function decodeSignature(b64: string) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const vals = new Float32Array(bytes.length * 2);
  for (let i = 0; i < bytes.length; i++) {
    vals[2 * i] = (bytes[i] & 15) - 8;
    vals[2 * i + 1] = (bytes[i] >> 4) - 8;
  }
  const parts: Float32Array[] = [];
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

function loadSignatures(setId: string) {
  if (!sigCache.has(setId)) {
    sigCache.set(
      setId,
      fetch(url(`data/vision/lang/${encodeURIComponent(setId)}.json`))
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => (d?.v === SIG_VERSION ? (d.cards as Record<string, Record<string, string>>) : null))
        .catch(() => {
          sigCache.delete(setId);
          return null;
        }),
    );
  }
  return sigCache.get(setId)!;
}

export interface ImageLang {
  best: string;
  margin: number;
  scores: Record<string, number>;
  langs: string[];
}

/** Kartensprache am Bild (nur internationale Karten), oder null. */
export async function languageFromImage(view: RGBA, setId: string, localId: string): Promise<ImageLang | null> {
  const cards = await loadSignatures(setId);
  const refs = cards?.[localId];
  const langs = refs ? Object.keys(refs) : [];
  if (langs.length < 2) return null;
  const decoded = Object.fromEntries(langs.map((l) => [l, decodeSignature(refs![l])]));
  const feat = languageFeatures(view);
  const shifts = [-12, -8, -4, 0, 4, 8, 12];
  const scores: Record<string, number> = Object.fromEntries(langs.map((l) => [l, 0]));
  SIG_REGIONS.forEach(({ box, grid }, r) => {
    const best: Record<string, number> = Object.fromEntries(langs.map((l) => [l, -1]));
    for (const dx of shifts)
      for (const dy of shifts)
        for (const sc of [0.92, 0.96, 1, 1.04, 1.08]) {
          const q = regionSignature(feat, box, grid, dx, dy, sc);
          for (const l of langs) {
            const ref = decoded[l][r];
            let s = 0;
            for (let i = 0; i < q.length; i++) s += q[i] * ref[i];
            if (s > best[l]) best[l] = s;
          }
        }
    for (const l of langs) scores[l] += best[l];
  });
  const ranked = langs.sort((a, b) => scores[b] - scores[a]);
  return { best: ranked[0], margin: scores[ranked[0]] - scores[ranked[1]], scores, langs: ranked };
}

