import { describe, expect, it } from 'vitest';
import { Trigger, relMovement } from './trigger';
import type { Quad } from './rgba';

const card = (x: number, y: number, s = 1): Quad => [
  [x, y],
  [x + 200 * s, y],
  [x + 200 * s, y + 280 * s],
  [x, y + 280 * s],
];

/** Bilder im Takt der Live-Vorschau (125 ms) einspeisen; liefert die Zustände. */
function feed(t: Trigger, frames: Array<Quad[]>, sharp: number | number[] = 200, t0 = 0) {
  return frames.map((q, i) => t.push(q, 720, Array.isArray(sharp) ? sharp[i] : sharp, t0 + i * 125));
}

const firstFire = (states: string[]) => states.indexOf('fire');

describe('Live-Auslöser', () => {
  it('löst bei ruhiger, scharfer Karte nach gut einer halben Sekunde aus', () => {
    const states = feed(new Trigger(), [0, 1, 2, 1, 0, 1, 2].map((d) => [card(100 + d, 100)]));
    expect(firstFire(states)).toBeGreaterThan(0);
    expect(firstFire(states) * 125).toBeLessThanOrEqual(625);
  });

  it('verzeiht leichtes Zittern der Hand (wenige Pixel je Bild)', () => {
    const wobble = Array.from({ length: 12 }, (_, i) => [card(100 + 4 * Math.sin(i * 2.1), 100 + 4 * Math.cos(i * 1.7))]);
    expect(firstFire(feed(new Trigger(), wobble)) * 125).toBeLessThanOrEqual(750);
  });

  it('wartet, solange die Karte stark bewegt wird', () => {
    const shake = Array.from({ length: 40 }, (_, i) => [card(100 + (i % 2) * 40, 100)]);
    expect(feed(new Trigger(), shake)).not.toContain('fire');
  });

  it('löst bei mäßigem Wackeln spätestens nach der Geduldszeit aus', () => {
    const wobble = Array.from({ length: 30 }, (_, i) => [card(100 + (i % 2) * 24, 100)]);
    const at = firstFire(feed(new Trigger(), wobble)) * 125;
    expect(at).toBeGreaterThanOrEqual(1000);
    expect(at).toBeLessThanOrEqual(1500);
  });

  it('wartet bei Bewegungsunschärfe (Schärfe deutlich unter dem besten Wert) und bei sehr flauem Bild', () => {
    const still = Array.from({ length: 20 }, () => [card(100, 100)]);
    const sharp = still.map((_, i) => (i < 2 ? 400 : 120));
    expect(feed(new Trigger(), still, sharp)).not.toContain('fire');
    expect(feed(new Trigger(), still, 5)).not.toContain('fire');
  });

  it('überbrückt kurze Aussetzer der Kartensuche (Spiegelung, Finger)', () => {
    const frames: Quad[][] = [[card(100, 100)], [card(101, 100)], [], [card(100, 101)], [], [card(101, 101)], [card(100, 100)]];
    expect(feed(new Trigger(), frames)).toContain('fire');
  });

  it('eine einzelne verrutschte Ecke (Spiegelung) setzt nicht zurück', () => {
    const glitch = (q: Quad): Quad => [[q[0][0] - 25, q[0][1] - 20], q[1], q[2], q[3]];
    const frames = Array.from({ length: 8 }, (_, i) => [i % 3 === 1 ? glitch(card(100, 100)) : card(100, 100)]);
    expect(firstFire(feed(new Trigger(), frames)) * 125).toBeLessThanOrEqual(625);
  });

  it('Doppel-Schutz: dieselbe Karte im Bild löst nicht erneut aus, auch nicht nach einem Aussetzer', () => {
    const t = new Trigger();
    const s1 = feed(t, Array.from({ length: 8 }, () => [card(100, 100)]));
    expect(s1.filter((s) => s === 'fire')).toHaveLength(1);
    const s2 = feed(t, Array.from({ length: 20 }, (_, i) => (i === 5 ? [] : [card(100 + (i % 3), 100)])), 200, 1000);
    expect(s2.every((s) => s === 'cooldown')).toBe(true);
    // Karte langsam verschoben (Wackeln, Nachfassen): weiterhin dieselbe Karte
    const drift = feed(t, Array.from({ length: 16 }, (_, i) => [card(100 + i * 6, 100 + i * 3)]), 200, 3500);
    expect(drift.every((s) => s === 'cooldown')).toBe(true);
    // Karte weg (länger als die Überbrückung), neue Karte hingehalten -> wieder auslösen
    feed(t, [[], [], [], [], []], 0, 5600);
    expect(feed(t, Array.from({ length: 8 }, () => [card(300, 120)]), 200, 6400)).toContain('fire');
  });

  it('Bewegung wird relativ zur Kartengröße gemessen', () => {
    expect(relMovement([card(0, 0)], [])).toBe(Infinity);
    expect(relMovement([card(0, 0)], [card(0, 0)])).toBe(0);
    // doppelt so große Karte: gleiche Pixelbewegung zählt halb so viel
    expect(relMovement([card(0, 0, 2)], [card(10, 0, 2)])).toBeCloseTo(relMovement([card(0, 0)], [card(10, 0)]) / 2);
  });
});
