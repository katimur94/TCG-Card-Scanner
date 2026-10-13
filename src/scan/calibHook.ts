// Nur für die Kalibrierung (Seite mit ?calib): Erkennung eines Bildes per URL, Ergebnis als schlichtes JSON.

import { fileToRGBA, warmupVision } from './vision';
import { recognizeImage } from './recognize';
import { center } from './detect';

declare global {
  interface Window {
    __holoscanCalib?: {
      warmup(): Promise<boolean>;
      recognizeUrl(url: string, opts?: { scanLang?: string; fallback?: string }): Promise<unknown>;
    };
  }
}

window.__holoscanCalib = {
  warmup: () => warmupVision(),
  async recognizeUrl(url, opts = {}) {
    const blob = await (await fetch(url)).blob();
    const img = await fileToRGBA(blob, 2000);
    const t0 = performance.now();
    const res = await recognizeImage(img, { scanLang: opts.scanLang || 'auto', fallback: opts.fallback || 'en' });
    return {
      ms: Math.round(performance.now() - t0),
      scale: 2000 / Math.max(img.width, img.height),
      width: img.width,
      height: img.height,
      cards: res.map((r) => ({
        status: r.status,
        reason: r.reason,
        center: center(r.card.quad),
        best: r.best && { group: r.best.group, setId: r.best.setId, localId: r.best.localId, name: r.best.name, confidence: r.best.confidence, score: r.best.score, reasons: r.best.reasons },
        options: r.options.map((o) => ({ group: o.group, setId: o.setId, localId: o.localId, score: o.score })),
        sims: r.card.matches.slice(0, 3).map((m) => ({ setId: m.setId, localId: m.localId, sim: m.sim })),
        usedOcr: r.usedOcr,
        lang: r.lang,
        width: r.card.straight?.width || 0,
      })),
    };
  },
};
