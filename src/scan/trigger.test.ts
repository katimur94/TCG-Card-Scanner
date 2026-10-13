import { describe, expect, it } from 'vitest';
import { Trigger, movement } from './trigger';
import type { Quad } from './rgba';

const card = (x: number, y: number, s = 1): Quad => [
  [x, y],
  [x + 200 * s, y],
  [x + 200 * s, y + 280 * s],
  [x, y + 280 * s],
];

describe('Live-Auslöser', () => {
  it('löst nach 5 ruhigen, scharfen Bildern aus', () => {
    const t = new Trigger();
    const states = [0, 1, 2, 1, 0].map((d) => t.push([card(100 + d, 100)], 720, 200));
    expect(states.slice(0, 4).every((s) => s === 'steadying')).toBe(true);
    expect(states[4]).toBe('fire');
  });

  it('wartet, solange die Karte wackelt oder unscharf ist', () => {
    const t = new Trigger();
    for (let i = 0; i < 10; i++) expect(t.push([card(100 + (i % 2) * 20, 100)], 720, 200)).toBe('steadying');
    const u = new Trigger();
    for (let i = 0; i < 10; i++) expect(u.push([card(100, 100)], 720, 10)).toBe('steadying');
  });

  it('Doppel-Schutz: dieselbe Karte im Bild löst nicht erneut aus', () => {
    const t = new Trigger();
    for (let i = 0; i < 5; i++) t.push([card(100, 100)], 720, 200);
    for (let i = 0; i < 20; i++) expect(t.push([card(100 + (i % 3), 100)], 720, 200)).toBe('cooldown');
    // Karte weg, neue Karte hingehalten -> wieder auslösen
    expect(t.push([], 720, 0)).toBe('searching');
    const s = [0, 0, 0, 0, 0].map(() => t.push([card(300, 120)], 720, 200));
    expect(s[4]).toBe('fire');
  });

  it('Bewegung wird relativ zur Bildhöhe gemessen', () => {
    expect(movement({ quads: [card(0, 0)], h: 720 }, { quads: [card(6, 0)], h: 720 })).toBeCloseTo(6 / 720);
    expect(movement({ quads: [card(0, 0)], h: 720 }, { quads: [], h: 720 })).toBe(Infinity);
  });
});
