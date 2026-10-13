// Binder: Posten zu Taschen bündeln, sortieren, filtern, in 3×3-Seiten teilen.

import type { CollectionItem, ListKind } from '../db/schema';
import { performance, unitValueCents } from './valuation';

/** Eine Tasche = gleiche Karte, Sprache und Variante (mehrere Posten mit Mengen-Badge). */
export interface Pocket {
  key: string;
  items: CollectionItem[];
  first: CollectionItem;
  qty: number;
  valueCents: number | null;
  gainCents: number | null; // seit Kauf (nur Posten mit Bezugswert)
  gainRatio: number | null;
}

export type SortKey = 'value' | 'gain' | 'set' | 'added';
export interface BinderFilter {
  list: ListKind;
  query: string;
  lang: string | null;
  setId: string | null;
  rarity: string | null;
  trend: 'plus' | 'minus' | null;
}

export function pocketsOf(items: CollectionItem[], list: ListKind): Pocket[] {
  const map = new Map<string, CollectionItem[]>();
  for (const it of items) {
    if (it.list !== list) continue;
    const k = `${it.region}:${it.cardId}:${it.lang}:${it.variantKey}`;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(it);
  }
  return [...map.entries()].map(([key, its]) => {
    its.sort((a, b) => a.createdAt - b.createdAt);
    let value: number | null = null;
    let gain: number | null = null;
    let basis = 0;
    for (const it of its) {
      const u = unitValueCents(it);
      if (u != null) value = (value ?? 0) + u * it.qty;
      const p = performance(it);
      if (p) {
        gain = (gain ?? 0) + p.delta;
        basis += (u ?? 0) * it.qty - p.delta;
      }
    }
    return {
      key,
      items: its,
      first: its[0],
      qty: its.reduce((a, b) => a + b.qty, 0),
      valueCents: value,
      gainCents: gain,
      gainRatio: gain != null && basis > 0 ? gain / basis : null,
    };
  });
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function filterPockets(pockets: Pocket[], f: BinderFilter): Pocket[] {
  const q = norm(f.query.trim());
  return pockets.filter((p) => {
    const it = p.first;
    if (f.lang && it.lang !== f.lang) return false;
    if (f.setId && it.setId !== f.setId) return false;
    if (f.rarity && (it.rarity || '') !== f.rarity) return false;
    if (f.trend === 'plus' && !(p.gainCents != null && p.gainCents > 0)) return false;
    if (f.trend === 'minus' && !(p.gainCents != null && p.gainCents < 0)) return false;
    if (q) {
      const hay = norm(
        `${it.name} ${it.setName} ${it.localId} ${it.official ? `${it.localId}/${it.official}` : ''} ${it.setId}`,
      );
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

export function sortPockets(pockets: Pocket[], key: SortKey): Pocket[] {
  const s = [...pockets];
  const added = (p: Pocket) => Math.max(...p.items.map((i) => i.createdAt));
  switch (key) {
    case 'value':
      return s.sort((a, b) => (b.valueCents ?? -1) - (a.valueCents ?? -1));
    case 'gain':
      return s.sort((a, b) => (b.gainCents ?? -Infinity) - (a.gainCents ?? -Infinity));
    case 'set':
      return s.sort(
        (a, b) =>
          (b.first.setDate || '').localeCompare(a.first.setDate || '') ||
          a.first.setId.localeCompare(b.first.setId) ||
          localNum(a.first.localId) - localNum(b.first.localId),
      );
    case 'added':
      return s.sort((a, b) => added(b) - added(a));
  }
}

const localNum = (id: string) => {
  const n = parseInt(id.replace(/^\D+/, ''), 10);
  return Number.isNaN(n) ? 9999 : n;
};

export function pages<T>(list: T[], size = 9): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out.length ? out : [[]];
}
