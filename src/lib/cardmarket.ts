// Ersatz-Preise direkt aus Cardmarkets Preisguide, wenn TCGdex für eine Karte keinen Cardmarket-Preis hat.
// Daten: data/cm/ (scripts/build-cardmarket.mjs). Zuordnung über Name + Attacken, Erweiterung über das Set.

import { dataUrl } from './api';
import type { CardmarketPricing, TcgdexCard } from './types';

// [idProduct, Name, idExpansion, trend, avg, low, avg1, avg7, avg30, trendH, avgH, lowH, avg7H, avg30H]
type ProductRow = [number, string, number, ...Array<number | null>];
interface Shard {
  updated?: string;
  products: Record<string, ProductRow[]>;
}

const shards = new Map<string, Promise<Shard | null>>();
let expansionsPromise: Promise<Record<string, number[]>> | null = null;

/** Muss zu scripts/build-cardmarket.mjs passen. */
const normName = (s: unknown) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function loadJSON<T>(path: string): Promise<T | null> {
  return fetch(dataUrl(path)).then((r) => (r.ok ? (r.json() as Promise<T>) : null));
}

function expansions() {
  expansionsPromise ||= loadJSON<{ sets: Record<string, number[]> }>('data/cm/expansions.json')
    .then((d) => d?.sets || {})
    .catch(() => {
      expansionsPromise = null;
      return {};
    });
  return expansionsPromise;
}

function shard(word: string): Promise<Shard | null> {
  const key = (word.slice(0, 2) || '_').padEnd(2, '_');
  if (!shards.has(key)) {
    shards.set(
      key,
      loadJSON<Shard>(`data/cm/p/${key}.json`).catch(() => {
        shards.delete(key);
        return null;
      }),
    );
  }
  return shards.get(key)!;
}

function parseProduct(name: string) {
  const m = String(name).match(/^(.*?)\s*\[(.*)\]\s*$/);
  return { base: normName(m ? m[1] : name), moves: m ? m[2].split('|').map(normName).filter(Boolean) : [] };
}

/**
 * Cardmarket-Preis einer (englischen) TCGdex-Karte aus dem Preisguide.
 * @param {object} card    englische Kartendaten von TCGdex (Name, Attacken, Fähigkeiten)
 * @param {string} setId   TCGdex-Set
 * @param {Array} sameName lokale Nummern der Karten mit gleichem Namen im Set (für Nachdrucke im selben Set)
 * @returns {Promise<object|null>} im Format von TCGdex pricing.cardmarket (+ source, matches)
 */
export async function cardmarketPrice(
  card: Pick<TcgdexCard, 'name' | 'localId' | 'attacks' | 'abilities'> | null,
  setId: string,
  sameName: string[] = [],
): Promise<CardmarketPricing | null> {
  const base = normName(card?.name);
  if (!base) return null;
  const [data, exp] = await Promise.all([shard(base.split(' ')[0]), expansions()]);
  const list = data?.products?.[base.split(' ')[0]];
  if (!list) return null;
  const moves = new Set(
    [...(card!.abilities || []), ...(card!.attacks || [])].map((a) => normName(a.name)).filter(Boolean),
  );
  let found = list.filter((row) => {
    const p = parseProduct(row[1]);
    if (!(p.base === base || p.base.startsWith(`${base} `))) return false;
    if (!moves.size) return !p.moves.length || p.base === base;
    const inter = p.moves.filter((x) => moves.has(x)).length;
    return inter / new Set([...p.moves, ...moves]).size >= 0.6;
  });
  const setExp = exp[setId] || [];
  const inSet = found.filter((r) => setExp.includes(r[2]));
  if (inSet.length) {
    // Erweiterung mit den meisten Stimmen zuerst
    const first = setExp.find((e) => inSet.some((r) => r[2] === e));
    found = inSet.filter((r) => r[2] === first);
  } else if (setExp.length) {
    return null; // Karte in der zugeordneten Erweiterung nicht gefunden – lieber kein falscher Preis
  }
  if (!found.length) return null;
  found.sort((a, b) => a[0] - b[0]);
  // Mehrere Produkte (z. B. normale und Full-Art-Version): Rang der Kartennummer im Set übernehmen
  let row = found[0];
  if (found.length > 1 && sameName.length === found.length) {
    const rank = sameName.indexOf(card!.localId);
    if (rank >= 0) row = found[rank];
  }
  const [idProduct, , , trend, avg, low, avg1, avg7, avg30, trendH, avgH, lowH, avg7H, avg30H] = row;
  const n = (v: number | null | undefined) => v || undefined;
  const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
  return {
    idProduct,
    trend: n(num(trend)),
    avg: n(num(avg)),
    low: n(num(low)),
    avg1: n(num(avg1)),
    avg7: n(num(avg7)),
    avg30: n(num(avg30)),
    'trend-holo': n(num(trendH)),
    'avg-holo': n(num(avgH)),
    'low-holo': n(num(lowH)),
    'avg7-holo': n(num(avg7H)),
    'avg30-holo': n(num(avg30H)),
    updated: data!.updated,
    unit: 'EUR',
    source: 'cardmarket',
    ambiguous: found.length > 1 && sameName.length !== found.length,
  };
}
