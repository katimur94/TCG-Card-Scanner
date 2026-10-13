import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/schema';
import { applyImport, exportBackup, planImport, validItem } from './backup';

beforeEach(async () => {
  await db.collection_items.clear();
  await db.photos.clear();
  await db.price_points.clear();
});

const legacyBackup = {
  app: 'HoloScan',
  v: 1,
  exported: '2026-10-05T10:00:00Z',
  items: [
    {
      uid: 'a1',
      list: 'collection',
      id: 'sv01-25',
      group: 'intl',
      setId: 'sv01',
      localId: '25',
      lang: 'de',
      name: 'Glurak',
      qty: 2,
      condition: 2,
      price: 3.5,
      addedAt: 1759500000000,
      buyPrice: 2,
    },
    { uid: 'bad' },
  ],
};

describe('Backup', () => {
  it('importiert Backups der alten App und überspringt kaputte Einträge', async () => {
    const plan = planImport(JSON.stringify(legacyBackup));
    expect(plan).toMatchObject({ legacy: true, skipped: 1 });
    expect(plan.items[0]).toMatchObject({ id: 'a1', qty: 2, priceCents: 350, pricePaidCents: 200 });
    const r = await applyImport(plan, 'merge');
    expect(r.added).toBe(1);
  });

  it('Rundreise: Export und Import im neuen Format', async () => {
    await applyImport(planImport(JSON.stringify(legacyBackup)), 'merge');
    const file = await exportBackup();
    await db.collection_items.clear();
    const r = await applyImport(planImport(JSON.stringify(file)), 'replace');
    expect(r.added).toBe(1);
    expect((await db.collection_items.get('a1'))?.name).toBe('Glurak');
  });

  it('Ersetzen mit leerem/ungültigem Backup löscht nichts', async () => {
    await applyImport(planImport(JSON.stringify(legacyBackup)), 'merge');
    const plan = planImport(JSON.stringify({ app: 'HoloScan', v: 2, items: [{ id: 'x', qty: '3' }] }));
    await expect(applyImport(plan, 'replace')).rejects.toThrow();
    expect(await db.collection_items.count()).toBe(1);
  });

  it('weist eingeschleuste Werte ab', () => {
    const good = validItem({
      id: 'x',
      list: 'collection',
      cardId: 'a-1',
      setId: 'a',
      localId: '1',
      region: 'intl',
      lang: 'de',
      name: 'X',
      qty: 1,
      condition: 2,
      createdAt: 1,
    });
    expect(good).not.toBeNull();
    expect(validItem({ ...good, pricePaidCents: '"><img src=x onerror=alert(1)>' })).toBeNull();
    expect(validItem({ ...good, qty: '3' })).toBeNull();
    expect(validItem({ ...good, image: 'javascript:alert(1)' })).toBeNull();
    expect(validItem({ ...good, name: 123 })).toBeNull();
  });

  it('meldet kein JSON verständlich', () => {
    expect(() => planImport('kein json')).toThrow(/kein gültiges JSON/);
  });
});
