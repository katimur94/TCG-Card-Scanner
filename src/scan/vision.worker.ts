/// <reference lib="webworker" />
// Hintergrund-Thread für die Bilderkennung: Karten finden, entzerren, Bildsuche, Sprache am Bild.
// So bleibt die Oberfläche flüssig, auch wenn das Bildmodell rechnet.

import { detectCards, flipQuad, insetQuad, straighten, warp } from './detect';
import { embed, languageFromImage, nearest, setBase, warmup, visionReady, type Match } from './embed';
import { glare, sharpness, type Quad, type RGBA } from './rgba';
import type { VisionRequest, VisionResponse, FoundCard } from './visionProtocol';

declare const self: DedicatedWorkerGlobalScope;

/** Bildsuche für eine Karte: mehrere Ausschnitte (Toploader/Hülle) und notfalls 180° gedreht. */
async function searchCard(img: RGBA, quad: Quad) {
  // Steckt die Karte in einem Toploader, liegt die gefundene Kante oft an dessen Rand – engere Ausschnitte prüfen
  const variants: Quad[] = [quad, insetQuad(quad, 0.05, 0.05, 0.02), insetQuad(quad, 0.085, 0.09, 0.03)];
  let best: { matches: Match[]; quad: Quad; view: RGBA } | null = null;
  const tryQuads = async (list: Quad[]) => {
    for (const q of list) {
      const view = warp(img, q);
      const matches = await nearest(await embed(view), 24);
      if (!best || matches[0].sim > best.matches[0].sim) best = { matches, quad: q, view };
      // eindeutiger Treffer -> weitere Ausschnitte sparen
      if (best.matches[0].sim >= 0.7 && best.matches[0].sim - best.matches[1].sim >= 0.08) return true;
    }
    return false;
  };
  if (!(await tryQuads(variants)) && best!.matches[0].sim < 0.66) {
    // Karte steht vielleicht auf dem Kopf
    await tryQuads(variants.map(flipQuad));
  }
  return best!;
}

async function analyze(img: RGBA, { straight = true, single = false }: { straight?: boolean; single?: boolean }) {
  const t0 = performance.now();
  let dets = detectCards(img);
  if (single && dets.length > 1) dets = dets.slice(0, 1);
  const results: Array<{ det: (typeof dets)[number]; r: Awaited<ReturnType<typeof searchCard>> }> = [];
  for (const d of dets) results.push({ det: d, r: await searchCard(img, d.quad) });

  // Gegenprobe für geteilte Flächen: passt die Fläche als eine Karte besser zum Katalog, war die Teilung falsch
  // (z. B. Grenze zwischen Bildfenster und Textfeld statt Lücke zwischen zwei Karten).
  const groups = new Map<number, typeof results>();
  for (const x of results) if (x.det.group != null && x.det.whole) groups.set(x.det.group, [...(groups.get(x.det.group) || []), x]);
  for (const [, members] of groups) {
    const whole = members[0].det.whole!;
    const w = await searchCard(img, whole);
    const mean = members.reduce((a, m) => a + m.r.matches[0].sim, 0) / members.length;
    if (w.matches[0].sim > mean + 0.02) {
      const first = results.indexOf(members[0]);
      for (const m of members) results.splice(results.indexOf(m), 1);
      results.splice(first, 0, { det: { quad: whole, score: members[0].det.score, cell: null }, r: w });
    }
  }

  // Gegenstände ohne jede Ähnlichkeit zu einer Karte verwerfen, wenn daneben echte Karten liegen
  const good = results.some((x) => x.r.matches[0].sim >= 0.6);
  const kept = results.filter((x) => !good || results.length === 1 || x.r.matches[0].sim >= 0.42);

  const cards: FoundCard[] = [];
  for (const { det, r } of kept) {
    const big = straight ? straighten(img, r.quad, 900) : null;
    cards.push({
      quad: r.quad,
      cell: det.cell,
      detScore: det.score,
      matches: r.matches,
      view: r.view,
      straight: big,
      sharp: sharpness(r.view),
      glare: glare(r.view),
    });
  }
  return { cards, ms: Math.round(performance.now() - t0) };
}

self.onmessage = async (e: MessageEvent<VisionRequest>) => {
  const m = e.data;
  const reply = (res: VisionResponse, transfer: Transferable[] = []) => self.postMessage(res, transfer);
  try {
    switch (m.type) {
      case 'init':
        setBase(m.base);
        reply({ id: m.id, ok: true, result: null });
        break;
      case 'warmup':
        reply({ id: m.id, ok: true, result: await warmup() });
        break;
      case 'ready':
        reply({ id: m.id, ok: true, result: visionReady() });
        break;
      case 'detect': {
        // schnell: nur Karten finden (Live-Vorschau, Ruhe-Erkennung). Wie bei der Aufnahme mit der
        // Einzelkarten-Suche als Rückfall – sonst zerfällt eine Karte in Hülle oder auf hellem Grund oft in Teile
        // oder wird gar nicht gefunden, und die Vorschau kommt nie zur Ruhe.
        const dets = detectCards(m.image, { side: m.side ?? 360, fast: true });
        reply({ id: m.id, ok: true, result: { quads: dets.map((d) => d.quad), sharp: sharpness(m.image) } });
        break;
      }
      case 'analyze': {
        const res = await analyze(m.image, m.opts || {});
        const transfer: Transferable[] = [];
        for (const c of res.cards) {
          transfer.push(c.view.data.buffer);
          if (c.straight) transfer.push(c.straight.data.buffer);
        }
        reply({ id: m.id, ok: true, result: res }, transfer);
        break;
      }
      case 'lang':
        reply({ id: m.id, ok: true, result: await languageFromImage(m.view, m.setId, m.localId) });
        break;
    }
  } catch (err) {
    reply({ id: m.id, ok: false, error: (err as Error)?.message || String(err) });
  }
};
