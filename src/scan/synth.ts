// Künstliche Testbilder (nur für Tests): Karten als Rechtecke mit Rahmen und Struktur auf unruhigem Grund.

import { rgba, type Point, type RGBA } from './rgba';

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

export interface SynthCard {
  center: Point;
  w: number;
  h: number;
  angle: number; // Grad
}

/** Hintergrund mit Rauschen und weichen Flecken. */
export function background(w: number, h: number, seed = 1, base: [number, number, number] = [70, 60, 55]): RGBA {
  const r = rng(seed);
  const img = rgba(w, h);
  const blobs = Array.from({ length: 6 }, () => ({ x: r() * w, y: r() * h, rad: 40 + r() * 160, d: (r() - 0.5) * 40 }));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (const b of blobs) v += b.d * Math.exp(-((x - b.x) ** 2 + (y - b.y) ** 2) / (2 * b.rad * b.rad));
      const n = (r() - 0.5) * 18;
      const i = (y * w + x) * 4;
      img.data[i] = base[0] + v + n;
      img.data[i + 1] = base[1] + v + n;
      img.data[i + 2] = base[2] + v + n;
      img.data[i + 3] = 255;
    }
  return img;
}

/** Karte zeichnen: heller Rand, dunkle Innenfläche mit „Bild“ und „Textzeilen“. */
export function drawCard(img: RGBA, c: SynthCard, seed = 7) {
  const r = rng(seed);
  const a = (c.angle * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const hue: [number, number, number] = [80 + r() * 150, 80 + r() * 150, 80 + r() * 150];
  const x0 = Math.floor(c.center[0] - c.w);
  const x1 = Math.ceil(c.center[0] + c.w);
  const y0 = Math.floor(c.center[1] - c.h);
  const y1 = Math.ceil(c.center[1] + c.h);
  for (let y = Math.max(0, y0); y < Math.min(img.height, y1); y++)
    for (let x = Math.max(0, x0); x < Math.min(img.width, x1); x++) {
      const dx = x - c.center[0];
      const dy = y - c.center[1];
      const u = (dx * cos + dy * sin) / c.w + 0.5;
      const v = (-dx * sin + dy * cos) / c.h + 0.5;
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      const border = u < 0.05 || u > 0.95 || v < 0.035 || v > 0.965;
      const art = u > 0.1 && u < 0.9 && v > 0.12 && v < 0.5;
      const text = v > 0.6 && v < 0.9 && Math.floor(v * 40) % 3 === 0 && u > 0.1 && u < 0.85;
      let col: [number, number, number];
      if (border) col = [235, 205, 70];
      else if (art) col = [hue[0] + 60 * Math.sin(u * 17), hue[1] + 60 * Math.cos(v * 13), hue[2] + 40 * Math.sin((u + v) * 9)];
      else if (text) col = [40, 40, 40];
      else col = [215, 210, 200];
      const i = (y * img.width + x) * 4;
      img.data[i] = col[0];
      img.data[i + 1] = col[1];
      img.data[i + 2] = col[2];
    }
}

/** Binderseite: 3×3 Karten mit kleinem Abstand. */
export function binderPage(seed = 3, gap = 8, angle = 0): { img: RGBA; cards: SynthCard[] } {
  const img = background(900, 1200, seed, [40, 40, 48]);
  const cw = 230;
  const ch = Math.round(cw / (63 / 88));
  const cards: SynthCard[] = [];
  const a = (angle * Math.PI) / 180;
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) {
      const ox = (c - 1) * (cw + gap);
      const oy = (r - 1) * (ch + gap);
      const center: Point = [450 + ox * Math.cos(a) - oy * Math.sin(a), 600 + ox * Math.sin(a) + oy * Math.cos(a)];
      const card = { center, w: cw, h: ch, angle };
      drawCard(img, card, seed * 31 + r * 3 + c);
      cards.push(card);
    }
  return { img, cards };
}
