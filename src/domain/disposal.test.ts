import { beforeEach, describe, expect, it } from 'vitest';
import { db, type CollectionItem } from '../db/schema';
import { DISPOSALS_KEY, disposals, disposePost, summarizeDisposals } from './collection';
import { applyImport, exportBackup, planImport } from './backup';

const item = (patch: Partial<CollectionItem> = {}): CollectionItem => ({
  id: 'p1',
  list: 'collection',
  cardId: 'sv01-25',
  setId: 'sv01',
  localId: '25',
  region: 'intl',
  lang: 'de',
  name: 'Glurak',
  setName: 'Karmesin & Purpur',
  setDate: null,
  official: 198,
  image: null,
  photoId: null,
  variantKey: 'normal',
  variantLabel: 'Standard',
  condition: 2,
  qty: 3,
  pricePaidCents: 200,
  paidAt: null,
  origin: 'kauf',
  note: '',
  idProduct: null,
  priceCents: 500,
  priceUpdated: null,
  addedPriceCents: 400,
  targetCents: null,
  alarmedAt: null,
  createdAt: 1,
  updatedAt: 1,
  checkedAt: null,
  rarity: null,
  ...patch,
});

beforeEach(async () => {
  await db.collection_items.clear();
  await db.settings.delete(DISPOSALS_KEY);
});

describe('Verkauft / verloren', () => {
  it('verringert die Menge, vermerkt den Verkauf und lässt sich rückgängig machen', async () => {
    await db.collection_items.add(item());
    const undo = await disposePost('p1', { reason: 'sold', qty: 2, soldCents: 450 }, 1000);
    expect((await db.collection_items.get('p1'))?.qty).toBe(1);
    const log = await disposals();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ reason: 'sold', qty: 2, soldCents: 450, paidCents: 200, at: 1000 });
    expect(summarizeDisposals(log)).toMatchObject({ sold: 2, revenueCents: 900, realizedCents: 500 });

    await undo();
    expect((await db.collection_items.get('p1'))?.qty).toBe(3);
    expect(await disposals()).toEqual([]);
  });

  it('löscht den Posten, wenn alle Karten verloren sind, und merkt sich nie einen Verkaufspreis', async () => {
    await db.collection_items.add(item({ qty: 1 }));
    await disposePost('p1', { reason: 'lost', qty: 5, soldCents: 999 });
    expect(await db.collection_items.get('p1')).toBeUndefined();
    const [g] = await disposals();
    expect(g).toMatchObject({ reason: 'lost', qty: 1, soldCents: null });
    expect(summarizeDisposals([g])).toMatchObject({ lost: 1, sold: 0, lostValueCents: 500 });
  });

  it('Verkauf ohne Preis zählt mit, aber nicht zum Erlös', () => {
    const s = summarizeDisposals([
      { reason: 'sold', qty: 1, soldCents: null, paidCents: 100, valueCents: 300 } as never,
    ]);
    expect(s).toMatchObject({ sold: 1, revenueCents: 0, realizedCents: null });
  });

  it('kommt ins Backup und wird beim Import zusammengeführt statt verdoppelt', async () => {
    await db.collection_items.add(item());
    await disposePost('p1', { reason: 'sold', qty: 1, soldCents: 300 });
    const file = await exportBackup();
    expect(file.disposals).toHaveLength(1);

    const plan = planImport(JSON.stringify({ ...file, disposals: [...file.disposals!, { id: 'kaputt' }] }));
    expect(plan.disposals).toHaveLength(1);
    await applyImport(plan, 'merge');
    expect(await disposals()).toHaveLength(1);

    await db.settings.delete(DISPOSALS_KEY);
    await applyImport(plan, 'merge');
    expect(await disposals()).toHaveLength(1);
  });
});
