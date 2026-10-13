import { describe, expect, it } from 'vitest';
import { background, binderPage, drawCard } from './synth';
import { center, detectCards, findCardQuad, findCardQuads, homography, inside, quadAspect, warp } from './detect';
import type { Point } from './rgba';

const near = (a: Point, b: Point, tol: number) => Math.hypot(a[0] - b[0], a[1] - b[1]) < tol;

describe('Kartensuche', () => {
  it('findet eine einzelne Karte, die das Bild füllt', () => {
    const img = background(600, 800, 2);
    drawCard(img, { center: [300, 400], w: 520, h: 726, angle: 2 }, 5);
    const q = findCardQuad(img);
    expect(q).not.toBeNull();
    expect(quadAspect(q!)).toBeGreaterThan(0.64);
    expect(quadAspect(q!)).toBeLessThan(0.79);
    expect(near(center(q!), [300, 400], 20)).toBe(true);
  });

  it('findet mehrere verstreute, gedrehte Karten', () => {
    const img = background(1200, 900, 4);
    const cards = [
      { center: [250, 300] as Point, w: 220, h: 307, angle: -18 },
      { center: [650, 280] as Point, w: 200, h: 279, angle: 7 },
      { center: [980, 560] as Point, w: 210, h: 293, angle: 63 },
      { center: [450, 680] as Point, w: 190, h: 265, angle: -95 },
    ];
    cards.forEach((c, i) => drawCard(img, c, 11 + i));
    const found = findCardQuads(img);
    expect(found).toHaveLength(4);
    for (const c of cards) expect(found.some((d) => inside(c.center, d.quad) && near(center(d.quad), c.center, 25))).toBe(true);
    // immer Hochformat
    for (const d of found) expect(quadAspect(d.quad)).toBeLessThan(0.85);
  });

  it('teilt eine Binderseite in 3×3 Karten (Lesereihenfolge)', () => {
    for (const gap of [12, 6]) {
      const { img, cards } = binderPage(3, gap);
      const found = findCardQuads(img);
      expect(found).toHaveLength(9);
      found.forEach((d, i) => expect(near(center(d.quad), cards[i].center, 30)).toBe(true));
    }
  });

  it('leicht schräge Binderseite', () => {
    const { img, cards } = binderPage(5, 8, 6);
    const found = findCardQuads(img);
    expect(found).toHaveLength(9);
    for (const c of cards) expect(found.some((d) => near(center(d.quad), c.center, 30))).toBe(true);
  });

  it('meldet auf leerem Grund keine Karte', () => {
    expect(detectCards(background(800, 600, 9))).toHaveLength(0);
  });

  it('entzerrt ein Viereck auf das Kartenformat', () => {
    const img = background(400, 400, 1);
    drawCard(img, { center: [200, 200], w: 200, h: 279, angle: 0 }, 2);
    const q: [Point, Point, Point, Point] = [
      [100, 60.5],
      [300, 60.5],
      [300, 339.5],
      [100, 339.5],
    ];
    const out = warp(img, q, 100, 140);
    expect(out.width).toBe(100);
    // Ecke liegt auf dem gelben Rand
    expect(out.data[(2 * 100 + 2) * 4]).toBeGreaterThan(200);
    const H = homography(
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      q,
    );
    expect(H).toHaveLength(9);
  });
});
