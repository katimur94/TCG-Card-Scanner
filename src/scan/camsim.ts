// Künstliche Handy-Kamera (nur für Tests und Messungen): Karte auf dem Tisch, Handy in der Hand.
// Nachgebildet werden die Dinge, an denen die Live-Erkennung in echt scheitert:
//  - Wackeln der Hand: langsames Schwanken (0,3–1,5 Hz) plus Zittern (8–12 Hz), leichte Drehung und Zoom,
//  - Bewegungsunschärfe während der Belichtung (1/30 s),
//  - Kartenhülle: etwas größer als die Karte, heller Folienrand, Spiegelstreifen, der beim Wackeln wandert,
//  - Toploader (dicker, stärkere Spiegelung), Finger am Kartenrand, Lampenlicht, Vignette, Rauschen.

import { homography } from './detect';
import { CARD_RATIO, rgba, type Point, type Quad, type RGBA } from './rgba';

export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

export type Sleeve = 'none' | 'sleeve' | 'toploader';
export type Shake = 'still' | 'light' | 'normal' | 'strong';

export interface SimScene {
  /** Kartenbild (Alpha = abgerundete Ecken); sonst wird eine künstliche Karte gezeichnet */
  texture?: RGBA;
  /** Kartenhöhe als Anteil der Bildhöhe */
  size?: number;
  /** Grundneigung der Karte im Bild (Grad) */
  angle?: number;
  sleeve?: Sleeve;
  /** 0..1 – Stärke der Spiegelung auf der Hülle */
  glare?: number;
  shake?: Shake;
  finger?: boolean;
  table?: 'wood' | 'dark' | 'light';
  seed?: number;
  /** Karte wird in den ersten `enter` Sekunden von unten ins Bild geschoben */
  enter?: number;
  /** leerer Tisch (keine Karte) */
  empty?: boolean;
}

const SHAKE: Record<Shake, { drift: number; tremor: number; rot: number; zoom: number }> = {
  still: { drift: 0, tremor: 0, rot: 0, zoom: 0 },
  light: { drift: 0.012, tremor: 0.003, rot: 0.5, zoom: 0.01 },
  normal: { drift: 0.022, tremor: 0.005, rot: 0.9, zoom: 0.018 },
  strong: { drift: 0.035, tremor: 0.008, rot: 1.5, zoom: 0.03 },
};

/** Künstliches Kartenbild 300×419: farbiger Rand, Bildfenster, Textzeilen, abgerundete Ecken. */
export function cardTexture(seed = 1, style: 'yellow' | 'silver' | 'dark' = 'yellow'): RGBA {
  const r = rng(seed * 7919 + 13);
  const w = 300;
  const h = Math.round(w / CARD_RATIO);
  const img = rgba(w, h);
  const frame: [number, number, number] = style === 'yellow' ? [236, 205, 72] : style === 'silver' ? [196, 200, 206] : [38, 36, 44];
  const hue = [60 + r() * 160, 60 + r() * 160, 60 + r() * 160];
  const panel: [number, number, number] = [200 + r() * 40, 190 + r() * 40, 150 + r() * 60];
  const rad = 0.045 * w;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const v = y / h;
      const cx = Math.min(x, w - 1 - x);
      const cy = Math.min(y, h - 1 - y);
      let a = 255;
      if (cx < rad && cy < rad) {
        const d = Math.hypot(rad - cx, rad - cy) - rad;
        a = d > 0.5 ? 0 : d < -0.5 ? 255 : (0.5 - d) * 255;
      }
      let c: number[];
      const border = u < 0.045 || u > 0.955 || v < 0.035 || v > 0.965;
      if (border) c = frame;
      else if (u > 0.08 && u < 0.92 && v > 0.11 && v < 0.5)
        c = [hue[0] + 70 * Math.sin(u * 19 + v * 5), hue[1] + 60 * Math.cos(v * 23 - u * 3), hue[2] + 50 * Math.sin((u - v) * 11)];
      else if (v > 0.06 && v < 0.095 && u > 0.08 && u < 0.6) c = [30, 30, 30];
      else if (v > 0.56 && v < 0.88 && Math.floor(v * 46) % 3 === 0 && u > 0.1 && u < 0.85) c = [45, 42, 40];
      else c = panel;
      const i = (y * w + x) * 4;
      img.data[i] = c[0];
      img.data[i + 1] = c[1];
      img.data[i + 2] = c[2];
      img.data[i + 3] = a;
    }
  return img;
}

/** Tischplatte als Textur (größer als das Bild, damit beim Wackeln kein Rand sichtbar wird). */
function tableTexture(w: number, h: number, kind: 'wood' | 'dark' | 'light', seed: number): RGBA {
  const r = rng(seed * 104729 + 7);
  const img = rgba(w, h);
  const base = kind === 'wood' ? [122, 82, 54] : kind === 'dark' ? [42, 40, 46] : [214, 210, 202];
  const ph = Array.from({ length: 6 }, () => r() * Math.PI * 2);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 0;
      if (kind === 'wood') {
        const warp = 6 * Math.sin(y * 0.013 + ph[0]) + 3 * Math.sin(y * 0.041 + ph[1]);
        v = 18 * Math.sin((x + warp) * 0.11 + ph[2]) + 10 * Math.sin((x + warp) * 0.37 + ph[3]) + 8 * Math.sin(x * 0.023 + ph[4]);
      } else v = 6 * Math.sin(x * 0.05 + ph[0]) * Math.sin(y * 0.04 + ph[1]);
      const n = (r() - 0.5) * 14;
      const i = (y * w + x) * 4;
      img.data[i] = base[0] + v + n;
      img.data[i + 1] = base[1] + v * 0.75 + n;
      img.data[i + 2] = base[2] + v * 0.5 + n;
      img.data[i + 3] = 255;
    }
  return img;
}

interface Pose {
  dx: number;
  dy: number;
  rot: number; // rad
  zoom: number;
  tilt: number; // für die Spiegelung (wandert mit der Neigung)
}

/** Lampenlicht von oben links und Vignette (am Bild, nicht an der Welt); x, y in 0..1. */
function lightAt(x: number, y: number) {
  const lx = x - 0.38;
  const ly = y - 0.3;
  const vx = x - 0.5;
  const vy = y - 0.5;
  return 0.82 + 0.3 * Math.exp(-(lx * lx + ly * ly) / 0.18) - 0.45 * (vx * vx + vy * vy);
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * Eine Kamera-Szene: liefert Bilder zu beliebigen Zeitpunkten und die wahre Lage der Karte.
 * Koordinaten: Bildpixel (Breite W, Höhe H); die Welt ist so groß wie das Bild bei Zoom 1.
 */
export class CamSim {
  readonly W: number;
  readonly H: number;
  private tex: RGBA;
  private table: RGBA;
  private tableScale: number;
  private world: Quad; // Karte in Weltkoordinaten (Pixel bei Referenzauflösung)
  private toUV: number[]; // Welt -> Karte (0..1)
  private sh: (typeof SHAKE)[Shake];
  private waves: Array<{ f: number; p: number; a: number; axis: number }>;
  private sleeve: Sleeve;
  private glare: number;
  private finger: boolean;
  private noise: () => number;
  private glarePhase: number;

  constructor(
    private scene: SimScene,
    W = 360,
    H = 640,
  ) {
    this.W = W;
    this.H = H;
    const seed = scene.seed ?? 1;
    const r = rng(seed);
    this.tex = scene.texture ?? cardTexture(seed, (['yellow', 'silver', 'dark'] as const)[seed % 3]);
    this.sleeve = scene.sleeve ?? 'none';
    this.glare = scene.glare ?? (this.sleeve === 'none' ? 0 : this.sleeve === 'sleeve' ? 0.55 : 0.8);
    this.finger = !!scene.finger;
    this.sh = SHAKE[scene.shake ?? 'light'];
    // Tisch in fester Auflösung (Referenz 360 breit), größer als das Bild
    this.tableScale = 360 / W;
    this.table = tableTexture(Math.round(W * this.tableScale * 1.4), Math.round(H * this.tableScale * 1.4), scene.table ?? 'wood', seed);
    // Karte: Mitte leicht versetzt, Neigung, leichte Perspektive (Handy nicht ganz parallel zum Tisch)
    const ch = (scene.size ?? 0.55) * H;
    const cw = ch * CARD_RATIO;
    const a = ((scene.angle ?? (r() - 0.5) * 8) * Math.PI) / 180;
    const cx = W / 2 + (r() - 0.5) * 0.06 * W;
    const cy = H / 2 + (r() - 0.5) * 0.06 * H;
    const kx = (r() - 0.5) * 0.06 * cw; // Trapez: obere Kante schmaler/breiter
    const corners: Point[] = [
      [-cw / 2 + kx, -ch / 2],
      [cw / 2 - kx, -ch / 2],
      [cw / 2, ch / 2],
      [-cw / 2, ch / 2],
    ];
    this.world = corners.map(([x, y]) => [cx + x * Math.cos(a) - y * Math.sin(a), cy + x * Math.sin(a) + y * Math.cos(a)]) as Quad;
    this.toUV = homography(this.world, [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]);
    // Wackeln: Summe von Sinuswellen mit zufälligen Phasen (0 = x, 1 = y, 2 = Drehung, 3 = Zoom, 4 = Neigung)
    this.waves = [];
    for (let axis = 0; axis < 5; axis++) {
      for (const f of [0.35 + r() * 0.3, 0.8 + r() * 0.4, 1.3 + r() * 0.4]) this.waves.push({ f, p: r() * 6.283, a: 1 / 3, axis });
      for (const f of [8 + r() * 2, 10.5 + r() * 2]) this.waves.push({ f, p: r() * 6.283, a: -0.5, axis }); // a<0: Zittern
    }
    this.noise = rng(seed * 31 + 5);
    this.glarePhase = r();
  }

  pose(t: number): Pose {
    const v = [0, 0, 0, 0, 0];
    for (const w of this.waves) {
      const s = Math.sin(2 * Math.PI * w.f * t + w.p);
      if (w.a > 0) v[w.axis] += w.a * s;
    }
    const H = this.H;
    const enter = this.scene.enter ?? 0;
    const e = enter > 0 && t < enter ? 1 - Math.pow(1 - t / enter, 3) : 1;
    return {
      dx: v[0] * this.sh.drift * H + this.tremor(t, 0),
      dy: v[1] * this.sh.drift * H + this.tremor(t, 1) + (1 - e) * 0.9 * H,
      rot: v[2] * this.sh.rot * (Math.PI / 180),
      zoom: 1 + v[3] * this.sh.zoom,
      tilt: v[4],
    };
  }

  private tremor(t: number, axis: number) {
    let s = 0;
    for (const w of this.waves) if (w.a < 0 && w.axis === axis) s += -w.a * Math.sin(2 * Math.PI * w.f * t + w.p);
    return s * this.sh.tremor * this.H;
  }

  /** Bildpunkt -> Welt für eine Kamera-Lage. */
  private inv(p: Pose) {
    const c = Math.cos(-p.rot);
    const s = Math.sin(-p.rot);
    const cx = this.W / 2;
    const cy = this.H / 2;
    return (x: number, y: number): Point => {
      const ux = (x - cx) / p.zoom - p.dx;
      const uy = (y - cy) / p.zoom - p.dy;
      return [cx + ux * c - uy * s, cy + ux * s + uy * c];
    };
  }

  private fwd(p: Pose) {
    const c = Math.cos(p.rot);
    const s = Math.sin(p.rot);
    const cx = this.W / 2;
    const cy = this.H / 2;
    return ([x, y]: Point): Point => {
      const ux = x - cx;
      const uy = y - cy;
      return [cx + (ux * c - uy * s + p.dx) * p.zoom, cy + (ux * s + uy * c + p.dy) * p.zoom];
    };
  }

  /** Wahre Kartenecken im Bild zum Zeitpunkt t (Mitte der Belichtung). */
  truth(t: number, scale = 1): Quad {
    const f = this.fwd(this.pose(t));
    return this.world.map((q) => f(q).map((v) => v * scale)) as unknown as Quad;
  }

  /** Weg der Kartenecken während einer Belichtung (Pixel). */
  blurAt(t: number, exposure = 1 / 30): number {
    const a = this.truth(t - exposure / 2);
    const b = this.truth(t + exposure / 2);
    let m = 0;
    for (let k = 0; k < 4; k++) m = Math.max(m, Math.hypot(a[k][0] - b[k][0], a[k][1] - b[k][1]));
    return m;
  }

  /** Bild zum Zeitpunkt t in Auflösung (W·scale)×(H·scale), mit Bewegungsunschärfe über die Belichtungszeit. */
  frame(t: number, scale = 1, exposure = 1 / 30): RGBA {
    const W = Math.round(this.W * scale);
    const H = Math.round(this.H * scale);
    // Bewegung während der Belichtung abschätzen -> Anzahl Teilbilder
    const blurPx = this.blurAt(t, exposure) * scale;
    const n = Math.min(5, Math.max(1, Math.ceil(blurPx / 1.5)));
    const acc = new Float32Array(W * H * 3);
    for (let k = 0; k < n; k++) {
      const ts = n === 1 ? t : t - exposure / 2 + (exposure * (k + 0.5)) / n;
      this.render(ts, W, H, scale, acc);
    }
    const out = rgba(W, H);
    const nz = this.noise;
    for (let i = 0; i < W * H; i++) {
      const g = (nz() + nz() + nz() - 1.5) * 7; // Sensorrauschen
      out.data[i * 4] = acc[i * 3] / n + g;
      out.data[i * 4 + 1] = acc[i * 3 + 1] / n + g;
      out.data[i * 4 + 2] = acc[i * 3 + 2] / n + g;
      out.data[i * 4 + 3] = 255;
    }
    return out;
  }

  private render(t: number, W: number, H: number, scale: number, acc: Float32Array) {
    const p = this.pose(t);
    const inv = this.inv(p);
    const M = this.toUV;
    const tex = this.tex;
    const tw = tex.width;
    const th = tex.height;
    const td = tex.data;
    const tb = this.table;
    const ts = this.tableScale;
    const tox = (tb.width - this.W * ts) / 2;
    const toy = (tb.height - this.H * ts) / 2;
    const sl = this.sleeve;
    const ex = sl === 'toploader' ? 0.07 : sl === 'sleeve' ? 0.025 : 0; // Hülle größer als die Karte (Anteil)
    const exTop = sl === 'toploader' ? 0.05 : 0.02;
    // Spiegelstreifen: Richtung und Lage hängen an der Neigung des Handys (wandert doppelt so schnell)
    const gAng = 0.9 + 0.25 * Math.sin(this.glarePhase * 6.28);
    const gN: Point = [Math.cos(gAng), Math.sin(gAng)];
    const gPos = 0.25 + 0.5 * this.glarePhase + 0.35 * p.tilt;
    const gW = sl === 'toploader' ? 0.07 : 0.05;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const [wx, wy] = inv((x + 0.5) / scale, (y + 0.5) / scale);
        // Tisch
        const bx = Math.min(tb.width - 1, Math.max(0, Math.round(wx * ts + tox)));
        const by = Math.min(tb.height - 1, Math.max(0, Math.round(wy * ts + toy)));
        const bi = (by * tb.width + bx) * 4;
        let r = tb.data[bi];
        let g = tb.data[bi + 1];
        let b = tb.data[bi + 2];
        if (this.scene.empty) {
          const i = (y * W + x) * 3;
          const light = lightAt(x / W, y / H);
          acc[i] += r * light;
          acc[i + 1] += g * light;
          acc[i + 2] += b * light;
          continue;
        }
        // Welt -> Karte
        const z = M[6] * wx + M[7] * wy + M[8];
        const u = (M[0] * wx + M[1] * wy + M[2]) / z;
        const v = (M[3] * wx + M[4] * wy + M[5]) / z;
        // weicher Schatten unter Karte/Hülle
        const su = u - 0.015;
        const sv = v - 0.02;
        const out = Math.max(-ex - su, su - 1 - ex, -exTop - sv, sv - 1 - ex, 0);
        const shadow = 1 - 0.35 * (1 - smooth(0, 0.04, out));
        r *= shadow;
        g *= shadow;
        b *= shadow;
        const inSleeve = ex > 0 && u > -ex && u < 1 + ex && v > -exTop && v < 1 + ex;
        if (inSleeve) {
          // Folie: leicht milchig, Rand glänzt (ungleichmäßig)
          r = r * 0.9 + 22;
          g = g * 0.9 + 22;
          b = b * 0.9 + 24;
          const de = Math.min(u + ex, 1 + ex - u, v + exTop, 1 + ex - v);
          const edgeW = sl === 'toploader' ? 0.012 : 0.006;
          if (de < edgeW) {
            const k = (sl === 'toploader' ? 70 : 45) * (0.6 + 0.4 * Math.sin((u + v) * 31));
            r += k;
            g += k;
            b += k;
          }
        }
        if (u >= 0 && u < 1 && v >= 0 && v < 1) {
          // Karte (bilinear)
          const fx = u * tw - 0.5;
          const fy = v * th - 0.5;
          const x0 = Math.max(0, Math.min(tw - 1, Math.floor(fx)));
          const y0 = Math.max(0, Math.min(th - 1, Math.floor(fy)));
          const x1 = Math.min(tw - 1, x0 + 1);
          const y1 = Math.min(th - 1, y0 + 1);
          const ax = Math.min(1, Math.max(0, fx - x0));
          const ay = Math.min(1, Math.max(0, fy - y0));
          const i00 = (y0 * tw + x0) * 4;
          const i10 = (y0 * tw + x1) * 4;
          const i01 = (y1 * tw + x0) * 4;
          const i11 = (y1 * tw + x1) * 4;
          const sample = (c: number) =>
            (td[i00 + c] * (1 - ax) + td[i10 + c] * ax) * (1 - ay) + (td[i01 + c] * (1 - ax) + td[i11 + c] * ax) * ay;
          const al = sample(3) / 255;
          if (al > 0) {
            let cr = sample(0);
            let cg = sample(1);
            let cb = sample(2);
            if (inSleeve) {
              cr = cr * 0.9 + 18;
              cg = cg * 0.9 + 18;
              cb = cb * 0.9 + 20;
            }
            r = r * (1 - al) + cr * al;
            g = g * (1 - al) + cg * al;
            b = b * (1 - al) + cb * al;
          }
        }
        if (inSleeve && this.glare > 0) {
          // Spiegelstreifen (sättigt bis Weiß) plus ein kleiner Lichtfleck
          const d = u * gN[0] + v * gN[1] - gPos;
          let k = Math.exp(-(d * d) / (2 * gW * gW));
          const hx = u - (0.7 - 0.3 * p.tilt);
          const hy = v - 0.25;
          k += 0.8 * Math.exp(-(hx * hx + hy * hy) / (2 * 0.03 * 0.03));
          const add = 255 * this.glare * Math.min(1.2, k);
          r += add;
          g += add;
          b += add * 0.97;
        }
        if (this.finger) {
          // Finger hält die Karte am linken Rand
          const fu = (u + 0.04) / 0.13;
          const fv = (v - 0.68) / 0.075;
          const fd = fu * fu + fv * fv;
          if (fd < 1) {
            const shade = 0.75 + 0.25 * Math.sqrt(1 - fd);
            r = 222 * shade;
            g = 170 * shade;
            b = 140 * shade;
          }
        }
        const light = lightAt(x / W, y / H);
        const i = (y * W + x) * 3;
        acc[i] += Math.min(255, r) * light;
        acc[i + 1] += Math.min(255, g) * light;
        acc[i + 2] += Math.min(255, b) * light;
      }
    }
  }
}

// ---------- Messlauf: wie lange dauert es bis zur Aufnahme? ----------

export interface Preview {
  quads: Quad[];
  sharp: number;
}

export interface CaptureRun {
  /** Sekunden bis zur automatischen Aufnahme (null = nicht ausgelöst) */
  fireT: number | null;
  /** Lage der Karte, die die volle Aufnahme gefunden hat, als Überdeckung mit der wahren Karte (0..1) */
  iou: number;
  /** Anteil der Vorschaubilder, in denen genau eine Karte gefunden wurde */
  seen: number;
  /** Bewegungsunschärfe beim Auslösen: Weg der Kartenecken während der Belichtung (Vorschau-Pixel) */
  blur: number;
}

/** Simulierte Live-Vorschau: alle 1/fps Sekunden ein Bild -> detect -> trigger; nach dem Auslösen Kontrolle am großen Bild. */
export function simulateCapture(
  sim: CamSim,
  detect: (img: RGBA) => Preview,
  trigger: { push(quads: Quad[], h: number, sharp: number, now?: number): string },
  /** Kandidaten der vollen Aufnahme (z. B. Karte und – bei geteilter Fläche – die ganze Fläche); der beste zählt */
  confirm: ((img: RGBA) => Quad[]) | null,
  { fps = 8, maxT = 12, start = 0.3, confirmScale = 2 } = {},
): CaptureRun {
  let seen = 0;
  let n = 0;
  for (let t = start; t <= maxT; t += 1 / fps) {
    const img = sim.frame(t);
    const res = detect(img);
    n++;
    if (res.quads.length === 1) seen++;
    if (trigger.push(res.quads, img.height, res.sharp, t * 1000) === 'fire') {
      let iou = 0;
      if (confirm) {
        const tc = t + 0.05; // Foto kommt kurz nach dem Auslösen (nächstes Kamerabild)
        const truth = sim.truth(tc, confirmScale);
        for (const q of confirm(sim.frame(tc, confirmScale))) iou = Math.max(iou, quadIoU(q, truth, sim.W * confirmScale, sim.H * confirmScale));
      }
      return { fireT: t - start, iou, seen: seen / n, blur: sim.blurAt(t + 0.05) };
    }
  }
  return { fireT: null, iou: 0, seen: seen / n, blur: 0 };
}

/** Überdeckung zweier Vierecke (gerastert, reicht für Tests). */
export function quadIoU(a: Quad, b: Quad, W: number, H: number): number {
  const ins = (q: Quad, x: number, y: number) => {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const p = q[i];
      const r = q[(i + 1) % 4];
      const c = (r[0] - p[0]) * (y - p[1]) - (r[1] - p[1]) * (x - p[0]);
      if (c === 0) continue;
      if (!sign) sign = Math.sign(c);
      else if (Math.sign(c) !== sign) return false;
    }
    return true;
  };
  let inter = 0;
  let uni = 0;
  const step = Math.max(1, Math.round(Math.max(W, H) / 300));
  for (let y = 0; y < H; y += step)
    for (let x = 0; x < W; x += step) {
      const ia = ins(a, x, y);
      const ib = ins(b, x, y);
      if (ia && ib) inter++;
      if (ia || ib) uni++;
    }
  return uni ? inter / uni : 0;
}
