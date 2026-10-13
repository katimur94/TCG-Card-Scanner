// Auslöse-Logik für den Live-Scan (rein, testbar):
//  - Auslösen, wenn die Kartenecken über 5 Bilder weniger als 6 px (bezogen auf 720p) wandern
//    und das Bild scharf genug ist.
//  - Danach nicht erneut auslösen, solange dieselben Karten im Bild bleiben (Doppel-Schutz);
//    erst wenn das Bild sich deutlich ändert oder die Karten verschwinden, ist wieder Platz für eine Aufnahme.

import type { Quad } from './rgba';

export interface TriggerConfig {
  frames: number; // so viele ruhige Bilder in Folge
  maxMove: number; // px, bezogen auf die Bildhöhe ref
  ref: number; // Bezugshöhe (720p)
  minSharp: number; // Laplace-Varianz
}

export const DEFAULT_TRIGGER: TriggerConfig = { frames: 5, maxMove: 6, ref: 720, minSharp: 60 };

export type TriggerState = 'searching' | 'steadying' | 'fire' | 'cooldown';

interface Frame {
  quads: Quad[];
  h: number;
}

const centerOf = (q: Quad) => [(q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2];

/** Größte Eckverschiebung zwischen zwei Aufnahmen (gleiche Anzahl Karten, nächste Zuordnung). */
export function movement(a: Frame, b: Frame): number {
  if (a.quads.length !== b.quads.length || !a.quads.length) return Infinity;
  const s = 1 / a.h;
  let worst = 0;
  const used = new Set<number>();
  for (const qa of a.quads) {
    const ca = centerOf(qa);
    let bi = -1;
    let bd = Infinity;
    b.quads.forEach((qb, i) => {
      if (used.has(i)) return;
      const cb = centerOf(qb);
      const d = Math.hypot(ca[0] - cb[0], ca[1] - cb[1]);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    });
    if (bi < 0) return Infinity;
    used.add(bi);
    for (let k = 0; k < 4; k++) worst = Math.max(worst, Math.hypot(qa[k][0] - b.quads[bi][k][0], qa[k][1] - b.quads[bi][k][1]) * s);
  }
  return worst; // Anteil der Bildhöhe
}

export class Trigger {
  private history: Frame[] = [];
  private lastFired: Frame | null = null;
  state: TriggerState = 'searching';
  constructor(private cfg: TriggerConfig = DEFAULT_TRIGGER) {}

  /** Ein Vorschaubild auswerten. Liefert 'fire', wenn jetzt aufgenommen werden soll. */
  push(quads: Quad[], h: number, sharp: number): TriggerState {
    const f = { quads, h };
    const limit = this.cfg.maxMove / this.cfg.ref;
    if (this.lastFired) {
      // Doppel-Schutz: solange dieselben Karten ruhig im Bild sind, nicht erneut auslösen
      const gone = !quads.length || movement(this.lastFired, f) > limit * 8;
      if (!gone) {
        this.state = 'cooldown';
        return this.state;
      }
      if (!quads.length) this.lastFired = null;
      else this.lastFired = null; // deutlich bewegt: neue Lage zählt als neue Aufnahme
    }
    if (!quads.length) {
      this.history = [];
      this.state = 'searching';
      return this.state;
    }
    this.history.push(f);
    if (this.history.length > this.cfg.frames) this.history.shift();
    const steady =
      this.history.length >= this.cfg.frames && this.history.every((h2, i) => i === 0 || movement(this.history[i - 1], h2) <= limit);
    if (steady && sharp >= this.cfg.minSharp) {
      this.lastFired = f;
      this.history = [];
      this.state = 'fire';
    } else this.state = 'steadying';
    return this.state;
  }

  /** Nach einer manuellen Aufnahme ebenfalls Doppel-Schutz aktivieren. */
  markFired(quads: Quad[], h: number) {
    this.lastFired = { quads, h };
    this.history = [];
  }

  reset() {
    this.history = [];
    this.lastFired = null;
    this.state = 'searching';
  }
}
