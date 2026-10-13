// Auslöse-Logik für den Live-Scan (rein, testbar).
//
// Ziel: aus der Hand in unter einer Sekunde auslösen, auch mit Hülle, Spiegelung und leichtem Wackeln.
//  - Bewegung wird relativ zur Kartengröße gemessen (Karte nah an der Kamera wackelt in Pixeln mehr) und gegen
//    die geglättete Lage der letzten Bilder verglichen, nicht nur Bild gegen Bild. Je Karte zählt der Median
//    der vier Ecken, damit eine einzelne von einer Spiegelung verschobene Ecke nicht alles zurücksetzt.
//  - Aussetzer der Kantenerkennung (Spiegelung, Finger, Unschärfe) bis graceMs werden überbrückt, statt von
//    vorn zu zählen.
//  - Schärfe wird relativ zum besten Wert der letzten Sekunden bewertet (Bewegungsunschärfe erkennen), mit einer
//    niedrigen festen Untergrenze; so blockiert ein glatter Tisch nicht die Aufnahme.
//  - Ist die Karte länger als patienceMs sicher im Bild und bewegt sich nur mäßig, wird trotzdem ausgelöst.
//    Geraten wird dadurch nicht: die Aufnahme prüft die Karte danach am großen Foto gegen den Katalog.
//  - Danach nicht erneut auslösen, solange dieselben Karten im Bild bleiben (Doppel-Schutz); erst wenn sie länger
//    als graceMs weg sind oder an anderer Stelle liegen, ist wieder Platz für eine Aufnahme.

import type { Quad } from './rgba';

export interface TriggerConfig {
  /** so lange (ms) muss die Karte ruhig liegen */
  steadyMs: number;
  /** ruhig = geglättete Bewegung je Bild höchstens dieser Anteil der Kartendiagonale */
  maxMove: number;
  /** Aussetzer der Kartensuche so lange (ms) überbrücken */
  graceMs: number;
  /** nach so langer Zeit (ms) mit Karte im Bild auch bei mäßiger Bewegung auslösen … */
  patienceMs: number;
  /** … solange die geglättete Bewegung darunter bleibt */
  looseMove: number;
  /** feste Untergrenze der Schärfe (Laplace-Varianz) */
  minSharp: number;
  /** Schärfe mindestens dieser Anteil des besten Werts der letzten Sekunden */
  relSharp: number;
}

export const DEFAULT_TRIGGER: TriggerConfig = {
  steadyMs: 300,
  maxMove: 0.03,
  graceMs: 450,
  patienceMs: 1200,
  looseMove: 0.07,
  minSharp: 12,
  relSharp: 0.5,
};

export type TriggerState = 'searching' | 'steadying' | 'fire' | 'cooldown';

interface Frame {
  quads: Quad[];
  h: number;
}

const centerOf = (q: Quad) => [(q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2];
const diag = (q: Quad) => (Math.hypot(q[2][0] - q[0][0], q[2][1] - q[0][1]) + Math.hypot(q[3][0] - q[1][0], q[3][1] - q[1][1])) / 2;

/** Karten zweier Aufnahmen einander zuordnen (nächste Mitte). null, wenn die Anzahl nicht passt. */
function pair(a: Quad[], b: Quad[]): Array<[Quad, Quad]> | null {
  if (a.length !== b.length || !a.length) return null;
  const used = new Set<number>();
  const out: Array<[Quad, Quad]> = [];
  for (const qa of a) {
    const ca = centerOf(qa);
    let bi = -1;
    let bd = Infinity;
    b.forEach((qb, i) => {
      if (used.has(i)) return;
      const cb = centerOf(qb);
      const d = Math.hypot(ca[0] - cb[0], ca[1] - cb[1]);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    });
    if (bi < 0) return null;
    used.add(bi);
    out.push([qa, b[bi]]);
  }
  return out;
}

/** Bewegung relativ zur Kartengröße: je Karte Median der vier Eckverschiebungen / Diagonale, davon das Maximum. */
export function relMovement(a: Quad[], b: Quad[]): number {
  const pairs = pair(a, b);
  if (!pairs) return Infinity;
  let worst = 0;
  for (const [qa, qb] of pairs) {
    const d = [0, 1, 2, 3].map((k) => Math.hypot(qa[k][0] - qb[k][0], qa[k][1] - qb[k][1])).sort((x, y) => x - y);
    worst = Math.max(worst, (d[1] + d[2]) / 2 / Math.max(1, diag(qa)));
  }
  return worst;
}

/** Dieselben Karten ungefähr an derselben Stelle? (Mitte höchstens 30 % der Diagonale versetzt, Größe ähnlich) */
function sameCards(a: Quad[], b: Quad[]): boolean {
  const pairs = pair(a, b);
  if (!pairs) return false;
  return pairs.every(([qa, qb]) => {
    const ca = centerOf(qa);
    const cb = centerOf(qb);
    const da = Math.max(1, diag(qa));
    const ratio = diag(qb) / da;
    return Math.hypot(ca[0] - cb[0], ca[1] - cb[1]) <= 0.3 * da && ratio > 0.7 && ratio < 1.4;
  });
}

const lerpQuads = (a: Quad[], b: Quad[], t: number): Quad[] => {
  const pairs = pair(a, b);
  if (!pairs) return b;
  return pairs.map(([qa, qb]) => qa.map((p, k) => [p[0] + (qb[k][0] - p[0]) * t, p[1] + (qb[k][1] - p[1]) * t]) as Quad);
};

export class Trigger {
  private track: Quad[] | null = null; // geglättete Lage
  private since = 0; // seit wann dieselben Karten im Bild sind
  private lastSeen = -Infinity;
  private move = 0; // geglättete Bewegung je Bild
  private steadySince: number | null = null;
  private pendingCount: { n: number; frames: number } | null = null;
  private sharpHist: Array<[number, number]> = [];
  private lastFired: Frame | null = null;
  private firedSeen = -Infinity;
  state: TriggerState = 'searching';
  constructor(private cfg: TriggerConfig = DEFAULT_TRIGGER) {}

  /** Ein Vorschaubild auswerten (now in ms). Liefert 'fire', wenn jetzt aufgenommen werden soll. */
  push(quads: Quad[], h: number, sharp: number, now: number = performance.now()): TriggerState {
    const c = this.cfg;
    const f = { quads, h };
    if (this.lastFired) {
      // Doppel-Schutz: solange dieselben Karten im Bild bleiben, nicht erneut auslösen. Die gemerkte Lage wandert
      // mit (Wackeln, leicht verschieben), und kurze Aussetzer der Kartensuche zählen nicht als „Karte weg“.
      if (quads.length && sameCards(this.lastFired.quads, quads)) {
        this.lastFired = f;
        this.firedSeen = now;
        this.state = 'cooldown';
        return this.state;
      }
      if (now - this.firedSeen < c.graceMs) {
        this.state = 'cooldown';
        return this.state;
      }
      this.lastFired = null; // Karten weg oder deutlich bewegt: neue Lage zählt als neue Aufnahme
      this.reset(false);
    }

    this.sharpHist.push([now, sharp]);
    while (this.sharpHist.length && now - this.sharpHist[0][0] > 2500) this.sharpHist.shift();

    if (!quads.length) {
      if (now - this.lastSeen > c.graceMs) {
        this.reset(false);
        this.state = 'searching';
      }
      return this.state;
    }

    if (this.track && quads.length !== this.track.length) {
      // andere Anzahl: erst übernehmen, wenn sie sich zwei Bilder lang hält (sonst Aussetzer)
      this.pendingCount = this.pendingCount?.n === quads.length ? { n: quads.length, frames: this.pendingCount.frames + 1 } : { n: quads.length, frames: 1 };
      if (this.pendingCount.frames < 2 && now - this.lastSeen <= c.graceMs) return this.state;
      this.track = null;
    }
    this.pendingCount = null;

    const m = this.track ? relMovement(this.track, quads) : Infinity;
    if (!this.track || m > 0.25) {
      // neue Karte oder großer Sprung
      this.track = quads;
      this.since = now;
      this.move = c.maxMove * 2;
      this.steadySince = null;
    } else {
      this.move = 0.5 * this.move + 0.5 * m;
      this.track = lerpQuads(this.track, quads, 0.5);
    }
    this.lastSeen = now;

    if (this.move <= c.maxMove) this.steadySince ??= now;
    else this.steadySince = null;

    const peak = Math.max(...this.sharpHist.map((s) => s[1]));
    const sharpOk = sharp >= c.minSharp && sharp >= c.relSharp * peak;
    const steady = this.steadySince != null && now - this.steadySince >= c.steadyMs;
    const patient = now - this.since >= c.patienceMs && this.move <= c.looseMove;
    if (sharpOk && (steady || patient)) {
      this.lastFired = f;
      this.firedSeen = now;
      this.track = null;
      this.state = 'fire';
    } else this.state = 'steadying';
    return this.state;
  }

  /** Nach einer manuellen Aufnahme ebenfalls Doppel-Schutz aktivieren. */
  markFired(quads: Quad[], h: number, now: number = performance.now()) {
    this.lastFired = { quads, h };
    this.firedSeen = now;
    this.track = null;
  }

  reset(full = true) {
    this.track = null;
    this.steadySince = null;
    this.pendingCount = null;
    this.lastSeen = -Infinity;
    if (full) {
      this.lastFired = null;
      this.sharpHist = [];
      this.state = 'searching';
    }
  }
}
