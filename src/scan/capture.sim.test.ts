// Live-Scan mit künstlicher Handy-Kamera: Karte in Hülle/Toploader, Spiegelung, Finger, wackelnde Hand.
// Gemessen wird die Zeit bis zur automatischen Aufnahme – und ob das Foto dann die richtige Fläche zeigt.
// Ausführliche Messung (mehr Szenen, alte gegen neue Logik): docs/FINDINGS.md, Abschnitt „Live-Scan“.

import { describe, expect, it } from 'vitest';
import { CamSim, simulateCapture, type SimScene } from './camsim';
import { detectCards } from './detect';
import { sharpness } from './rgba';
import { Trigger } from './trigger';

const preview = (img: Parameters<typeof detectCards>[0]) => ({
  quads: detectCards(img, { side: 360, fast: true }).map((d) => d.quad),
  sharp: sharpness(img),
});
// Die Aufnahme prüft eine geteilte Fläche auch als Ganzes gegen den Katalog (vision.worker) – beides zählt
const confirm = (img: Parameters<typeof detectCards>[0]) => {
  const d = detectCards(img)[0];
  return d ? [d.quad, ...(d.whole ? [d.whole] : [])] : [];
};

function run(scene: SimScene, maxT = 4) {
  return simulateCapture(new CamSim(scene), preview, new Trigger(), confirm, { maxT });
}

describe('Live-Scan aus der Hand (simulierte Kamera)', () => {
  const scenes: Array<[string, SimScene]> = [
    ['Karte in Hülle, leichtes Wackeln', { seed: 16, sleeve: 'sleeve', shake: 'light', table: 'wood' }],
    ['Toploader auf dunklem Tisch, normales Wackeln', { seed: 29, sleeve: 'toploader', shake: 'normal', table: 'dark' }],
    ['Hülle, Finger am Rand, heller Tisch', { seed: 36, sleeve: 'sleeve', shake: 'normal', finger: true, table: 'light' }],
    ['ohne Hülle, heller Tisch, Finger', { seed: 34, shake: 'light', finger: true, table: 'light' }],
  ];
  for (const [name, scene] of scenes) {
    it(`${name}: Aufnahme in unter 1,5 s, Foto zeigt die Karte`, () => {
      const r = run(scene);
      expect(r.fireT).not.toBeNull();
      expect(r.fireT!).toBeLessThan(1.5);
      expect(r.iou).toBeGreaterThan(0.7);
    }, 60_000);
  }

  it('Karte wird ins Bild geschoben: erst auslösen, wenn sie angekommen ist', () => {
    const r = run({ seed: 61, sleeve: 'sleeve', shake: 'light', enter: 1.2 });
    expect(r.fireT).not.toBeNull();
    expect(r.fireT!).toBeGreaterThan(0.6);
    expect(r.fireT!).toBeLessThan(2.5);
    expect(r.iou).toBeGreaterThan(0.7);
  }, 60_000);

  it('leerer Tisch: keine Aufnahme', () => {
    for (const table of ['wood', 'dark', 'light'] as const) expect(run({ seed: 71, empty: true, shake: 'normal', table }, 2).fireT).toBeNull();
  }, 60_000);
});
