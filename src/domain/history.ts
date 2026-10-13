// Kursverlauf: tägliche Preis-Historie aus der Daten-Pipeline (data/prices/history/) plus eigene Abrufe.
// Format je Datei (spaltenweise): { v: 2, updated, days: [YYYYMMDD…], t: { [idProduct]: [Cent|null…] }, h: {…} }
// t = Preistrend, h = Reverse Holo. Muss zu scripts/build-price-history.mjs passen.

import { dataUrl } from '../lib/api';
import { db } from '../db/schema';
import type { Point } from '../ui/LineChart';

export const HISTORY_SHARDS = 512;
export const shardOf = (idProduct: number) => idProduct % HISTORY_SHARDS;

export interface HistoryFile {
  v: 2;
  updated?: string;
  days: number[];
  t: Record<string, Array<number | null>>;
  h: Record<string, Array<number | null>>;
}

const shards = new Map<number, Promise<HistoryFile | null>>();

function loadShard(n: number) {
  if (!shards.has(n)) {
    shards.set(
      n,
      fetch(dataUrl(`data/prices/history/${n}.json`))
        .then((r) => (r.ok ? (r.json() as Promise<HistoryFile>) : null))
        .then((d) => (d?.v === 2 ? d : null))
        .catch(() => {
          shards.delete(n);
          return null;
        }),
    );
  }
  return shards.get(n)!;
}

const dayOf = (n: number) => {
  const s = String(n);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
};

/** Punkte eines Produkts aus einer Historien-Datei (reine Funktion). */
export function seriesFrom(file: HistoryFile | null, idProduct: number, reverse = false): Point[] {
  const col = file?.[reverse ? 'h' : 't']?.[String(idProduct)];
  if (!file || !col) return [];
  const out: Point[] = [];
  file.days.forEach((d, i) => {
    const c = col[i];
    if (typeof c === 'number' && c > 0) out.push({ d: dayOf(d), c });
  });
  return out;
}

export async function guideHistory(idProduct: number | null | undefined, reverse = false): Promise<Point[]> {
  if (!idProduct) return [];
  return seriesFrom(await loadShard(shardOf(idProduct)), idProduct, reverse);
}

/** Pipeline-Historie und eigene Abrufe zusammenführen (pro Tag ein Punkt, Pipeline hat Vorrang). */
export async function priceSeries(
  idProduct: number | null | undefined,
  reverse: boolean,
  ownKey: string | null,
): Promise<Point[]> {
  const [guide, own] = await Promise.all([
    guideHistory(idProduct, reverse),
    ownKey ? db.price_points.get(ownKey) : undefined,
  ]);
  const byDay = new Map<string, number>();
  for (const p of own?.points || []) byDay.set(p.d, p.c);
  for (const p of guide) byDay.set(p.d, p.c);
  return [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([d, c]) => ({ d, c }));
}
