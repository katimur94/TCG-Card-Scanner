// Sammlung und Merkliste: Posten anlegen, ändern, löschen (mit Rückgängig), Preise auffrischen.

import { db, type CollectionItem, type ListKind, type Origin } from '../db/schema';
import { PORTFOLIO_KEY } from '../db/migrate';
import { loadCardData, type CardData } from './cardData';
import { depotOf } from './valuation';
import { uid, today, toCents } from '../lib/util';

export interface NewPost {
  list: ListKind;
  data: CardData;
  variantKey: string;
  condition: number;
  qty?: number;
  pricePaidCents?: number | null;
  origin?: Origin | null;
  note?: string;
  photoId?: string | null;
  targetCents?: number | null;
}

export function postFromCard(p: NewPost, now = Date.now()): CollectionItem {
  const v = p.data.variants.find((x) => x.key === p.variantKey) || p.data.variants[0];
  const priceCents = toCents(v?.cm?.value ?? null);
  return {
    id: uid(),
    list: p.list,
    cardId: p.data.ref.id,
    setId: p.data.ref.setId,
    localId: p.data.ref.localId,
    region: p.data.ref.region,
    lang: p.data.ref.lang,
    name: p.data.display.name,
    setName: p.data.setName,
    setDate: p.data.setDate,
    official: p.data.official,
    image: p.data.imageBase,
    photoId: p.photoId ?? null,
    variantKey: v?.key || 'normal',
    variantLabel: v?.label || '',
    condition: p.condition,
    qty: Math.max(1, p.qty ?? 1),
    pricePaidCents: p.pricePaidCents ?? null,
    paidAt: p.pricePaidCents != null ? now : null,
    origin: p.origin ?? null,
    note: p.note ?? '',
    idProduct: v?.cm?.idProduct ?? null,
    priceCents,
    priceUpdated: v?.cm?.updated ?? null,
    addedPriceCents: priceCents,
    targetCents: p.targetCents ?? null,
    alarmedAt: null,
    createdAt: now,
    updatedAt: now,
    // ohne Preis (z. B. offline hinzugefügt): beim nächsten Auffrischen sofort nachladen
    checkedAt: priceCents == null ? null : now,
    rarity: p.data.rarity,
  };
}

export async function addPost(p: NewPost): Promise<CollectionItem> {
  const item = postFromCard(p);
  await db.collection_items.add(item);
  if (item.priceCents) await recordPrice(priceKeyOf(item), item.priceCents);
  return item;
}

export async function updatePost(id: string, patch: Partial<CollectionItem>) {
  await db.collection_items.update(id, { ...patch, updatedAt: Date.now() });
}

/** Löscht einen Posten und liefert eine Funktion zum Wiederherstellen (5-Sekunden-Rückgängig). */
export async function removePost(id: string): Promise<() => Promise<void>> {
  const item = await db.collection_items.get(id);
  await db.collection_items.delete(id);
  return async () => {
    if (item) await db.collection_items.put(item);
  };
}

export const priceKeyOf = (i: Pick<CollectionItem, 'region' | 'cardId' | 'variantKey'>) =>
  `${i.region}:${i.cardId}:${i.variantKey}`;

/** Eigener Preisverlauf: ein Punkt pro Tag, höchstens ein Jahr. */
export async function recordPrice(key: string, c: number) {
  if (!c) return;
  const row = (await db.price_points.get(key)) || { key, points: [] };
  const d = today();
  const last = row.points[row.points.length - 1];
  if (last?.d === d) last.c = c;
  else row.points.push({ d, c });
  row.points = row.points.slice(-365);
  await db.price_points.put(row);
}

export async function recordPortfolio(valueCents: number, count: number) {
  const row = await db.settings.get(PORTFOLIO_KEY);
  const points = ((row?.value as Array<{ d: string; c: number; n: number | null }>) || []).slice();
  const d = today();
  const last = points[points.length - 1];
  if (last?.d === d) Object.assign(last, { c: valueCents, n: count });
  else points.push({ d, c: valueCents, n: count });
  await db.settings.put({ key: PORTFOLIO_KEY, value: points.slice(-730) });
  return points;
}

export async function portfolioHistory(): Promise<Array<{ d: string; c: number; n: number | null }>> {
  return ((await db.settings.get(PORTFOLIO_KEY))?.value as Array<{ d: string; c: number; n: number | null }>) || [];
}

export interface RefreshResult {
  updated: number;
  failed: number;
  alarms: CollectionItem[];
}

/**
 * Preise aller Posten auffrischen (älter als maxAgeMs). Schreibt gesammelt am Ende,
 * damit die Oberfläche nur einmal neu rechnet. Merkliste: Preisalarm bei Unterschreiten des Ziels.
 */
export async function refreshPrices({
  maxAgeMs = 6 * 3600 * 1000,
  onProgress,
}: { maxAgeMs?: number; onProgress?: (done: number, total: number) => void } = {}): Promise<RefreshResult> {
  const items = await db.collection_items.toArray();
  const due = items.filter((i) => !i.checkedAt || Date.now() - i.checkedAt > maxAgeMs);
  const result: RefreshResult = { updated: 0, failed: 0, alarms: [] };
  const patches = new Map<string, Partial<CollectionItem>>();
  // gleiche Karte nur einmal laden
  const byCard = new Map<string, CollectionItem[]>();
  for (const i of due) {
    const k = `${i.region}:${i.cardId}:${i.region === 'ja' ? 'ja' : 'intl'}`;
    if (!byCard.has(k)) byCard.set(k, []);
    byCard.get(k)!.push(i);
  }
  let done = 0;
  const groups = [...byCard.values()];
  const worker = async () => {
    while (groups.length) {
      const group = groups.shift()!;
      const first = group[0];
      try {
        const data = await loadCardData({
          region: first.region,
          setId: first.setId,
          localId: first.localId,
          id: first.cardId,
          lang: first.region === 'ja' ? 'ja' : 'en',
        });
        for (const it of group) {
          const v = data.variants.find((x) => x.key === it.variantKey) || data.variants[0];
          const c = toCents(v?.cm?.value ?? null);
          const patch: Partial<CollectionItem> = { checkedAt: Date.now(), rarity: it.rarity ?? data.rarity };
          if (c != null) {
            patch.priceCents = c;
            patch.priceUpdated = v?.cm?.updated ?? null;
            patch.idProduct = v?.cm?.idProduct ?? it.idProduct;
            await recordPrice(priceKeyOf(it), c);
            if (
              it.list === 'wish' &&
              it.targetCents != null &&
              c <= it.targetCents &&
              (!it.alarmedAt || Date.now() - it.alarmedAt > 24 * 3600 * 1000)
            ) {
              patch.alarmedAt = Date.now();
              result.alarms.push({ ...it, ...patch });
            }
          }
          if (!it.image && data.imageBase) patch.image = data.imageBase;
          patches.set(it.id, patch);
          result.updated++;
        }
      } catch {
        result.failed += group.length;
      }
      done++;
      onProgress?.(done, byCard.size);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  if (patches.size) {
    await db.transaction('rw', db.collection_items, async () => {
      for (const [id, patch] of patches) await db.collection_items.update(id, patch);
    });
  }
  const all = await db.collection_items.toArray();
  const depot = depotOf(all);
  if (depot.cards) await recordPortfolio(depot.valueCents, depot.cards);
  return result;
}
