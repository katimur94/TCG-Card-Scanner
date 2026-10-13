// Bewertung von Posten und Depot – reine Funktionen, alle Beträge in Cent.

import type { CollectionItem } from '../db/schema';
import { conditionFactor } from '../lib/pricing';

/** Marktwert pro Stück im Zustand des Postens (Basis: Preistrend NM der Variante). */
export function unitValueCents(item: Pick<CollectionItem, 'priceCents' | 'condition'>): number | null {
  if (item.priceCents == null || item.priceCents <= 0) return null;
  return Math.round(item.priceCents * conditionFactor(item.condition || 2));
}

export function valueCents(item: CollectionItem): number | null {
  const u = unitValueCents(item);
  return u == null ? null : u * item.qty;
}

/** Einstand pro Stück: gezahlter Preis, sonst (ohne Angabe) nichts. */
export const costCents = (item: CollectionItem) =>
  item.pricePaidCents == null ? null : item.pricePaidCents * item.qty;

/** Entwicklung seit dem Kauf: gegen den Kaufpreis, sonst gegen den Marktwert beim Hinzufügen. */
export function performance(item: CollectionItem): { delta: number; ratio: number } | null {
  const now = unitValueCents(item);
  if (now == null) return null;
  const basis =
    item.pricePaidCents ??
    (item.addedPriceCents != null
      ? unitValueCents({ priceCents: item.addedPriceCents, condition: item.condition })
      : null);
  if (basis == null) return null;
  if (basis === 0) return { delta: now * item.qty, ratio: now > 0 ? 1 : 0 };
  return { delta: (now - basis) * item.qty, ratio: (now - basis) / basis };
}

export function glowOf(item: CollectionItem): 'gain' | 'loss' | null {
  const p = performance(item);
  if (!p || Math.abs(p.ratio) < 0.02) return null;
  return p.ratio > 0 ? 'gain' : 'loss';
}

export interface Depot {
  valueCents: number; // Trendpreis × Menge (Zustand berücksichtigt)
  investedCents: number; // Summe der Kaufpreise (nur Posten mit Kaufpreis)
  investedValueCents: number; // heutiger Wert genau dieser Posten
  gainCents: number;
  gainRatio: number | null;
  cards: number; // Anzahl Karten (Menge)
  unpriced: number; // Karten ohne Preis – nicht als 0 € gewertet
  top: Array<{ item: CollectionItem; delta: number; ratio: number }>;
  flop: Array<{ item: CollectionItem; delta: number; ratio: number }>;
}

export function depotOf(items: CollectionItem[]): Depot {
  let value = 0;
  let invested = 0;
  let investedValue = 0;
  let cards = 0;
  let unpriced = 0;
  const perf: Depot['top'] = [];
  for (const it of items) {
    if (it.list !== 'collection') continue;
    cards += it.qty;
    const v = valueCents(it);
    if (v == null) {
      unpriced += it.qty;
      continue;
    }
    value += v;
    const c = costCents(it);
    if (c != null) {
      invested += c;
      investedValue += v;
    }
    const p = performance(it);
    if (p) perf.push({ item: it, ...p });
  }
  const gain = investedValue - invested;
  perf.sort((a, b) => b.delta - a.delta);
  return {
    valueCents: value,
    investedCents: invested,
    investedValueCents: investedValue,
    gainCents: gain,
    gainRatio: invested > 0 ? gain / invested : null,
    cards,
    unpriced,
    top: perf.filter((p) => p.delta > 0).slice(0, 5),
    flop: perf
      .filter((p) => p.delta < 0)
      .reverse()
      .slice(0, 5),
  };
}

/** Tagesänderung des Sammlungswerts aus dem Wertverlauf (letzter Tag gegen den Tag davor). */
export function dayChange(points: Array<{ d: string; c: number }>, current: number): number | null {
  const today = new Date().toISOString().slice(0, 10);
  const prev = [...points].reverse().find((p) => p.d < today);
  if (!prev || prev.c <= 0) return null;
  return (current - prev.c) / prev.c;
}
