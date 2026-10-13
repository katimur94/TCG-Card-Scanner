import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { HoloDB } from './schema';
import { migrateFromLegacy, MIGRATION_KEY, SETTINGS_KEY, PORTFOLIO_KEY, splitCardId, toCents } from './migrate';
import type { AppSettings } from '../state/settingsModel';

// Die alte App schreibt mit legacy/js/db.js – genau dieses Modul wird hier benutzt,
// damit der Test echte Daten der alten Version erzeugt.
async function legacyDb(): Promise<{
  put(store: string, value: unknown, key?: string): Promise<void>;
  putMany(store: string, values: unknown[]): Promise<void>;
}> {
  vi.resetModules();
  // @ts-expect-error – altes JavaScript-Modul ohne Typen
  return (await import('../../legacy/js/db.js')).db;
}

let idb: IDBFactory;
let db: HoloDB;

beforeEach(() => {
  idb = new IDBFactory();
  globalThis.indexedDB = idb;
});

function newDb() {
  return new HoloDB('holo-test', { indexedDB: idb, IDBKeyRange });
}

const legacyItem = {
  uid: 'm1abc',
  list: 'collection',
  qty: 2,
  condition: 3,
  addedAt: 1759500000000,
  checkedAt: 1759600000000,
  addedPrice: 12.5,
  id: 'sv10.5w-012',
  group: 'intl',
  setId: 'sv10.5w',
  localId: '012',
  lang: 'de',
  name: 'Glurak ex',
  setName: 'Weiße Flamme',
  setDate: '2025-07-18',
  official: 86,
  image: 'https://assets.tcgdex.net/de/sv/sv10.5w/012',
  variantKey: 'holo',
  variantLabel: 'Holo',
  price: 14.99,
  priceUpdated: '2026-10-12',
  idProduct: 812345,
  buyPrice: 8,
};

describe('Übernahme aus der alten App', () => {
  it('übernimmt Sammlung, Merkliste, Verlauf, Preise, Einstellungen und Wertverlauf', async () => {
    const old = await legacyDb();
    await old.putMany('items', [
      legacyItem,
      {
        uid: 'w1',
        list: 'wish',
        qty: 1,
        id: 'tk-xy-b-3',
        group: 'intl',
        lang: 'en',
        name: 'Pikachu',
        target: '5,50',
        scanImage: 'data:image/jpeg;base64,/9j/4AAQ',
        price: null,
      },
      {
        uid: 'ja1',
        id: 'SV2a-201',
        group: 'ja',
        setId: 'SV2a',
        localId: '201',
        name: 'リザードンex',
        qty: '3',
        price: 120,
      },
    ]);
    await old.put('history', {
      uid: 'h1',
      at: 1759700000000,
      id: 'base1-4',
      group: 'intl',
      setId: 'base1',
      localId: '4',
      lang: 'en',
      name: 'Charizard',
      price: 300.1,
    });
    await old.put(
      'prices',
      [
        { d: '2026-10-01', v: 14.5 },
        { d: '2026-10-02', v: 14.99 },
      ],
      'intl:sv10.5w-012:holo',
    );
    await old.put(
      'kv',
      {
        scanLang: 'auto',
        fallbackLang: 'en',
        condition: 3,
        haptics: false,
        aiKey: 'sk-or-test',
        aiModel: 'x/y:free',
        aiMode: 'always',
        batch: true,
      },
      'settings',
    );
    await old.put('kv', [{ d: '2026-10-01', v: 29.98, n: 2 }], 'portfolio');

    db = newDb();
    const report = await migrateFromLegacy(db, { idb });
    expect(report).toMatchObject({ found: true, items: 3, history: 1, prices: 1, photos: 1, skipped: 0 });

    const glurak = await db.collection_items.get('m1abc');
    expect(glurak).toMatchObject({
      list: 'collection',
      cardId: 'sv10.5w-012',
      setId: 'sv10.5w',
      localId: '012',
      region: 'intl',
      lang: 'de',
      qty: 2,
      condition: 3,
      priceCents: 1499,
      addedPriceCents: 1250,
      pricePaidCents: 800,
      origin: 'kauf',
      variantKey: 'holo',
      idProduct: 812345,
      createdAt: 1759500000000,
    });

    const wish = await db.collection_items.get('w1');
    expect(wish).toMatchObject({
      list: 'wish',
      setId: 'tk-xy-b',
      localId: '3',
      targetCents: 550,
      priceCents: null,
      condition: 2,
    });
    expect(wish?.photoId).toBe('legacy-w1');
    const photo = await db.photos.get('legacy-w1');
    expect(photo?.blob.type).toBe('image/jpeg');

    const ja = await db.collection_items.get('ja1');
    expect(ja).toMatchObject({ region: 'ja', lang: 'ja', qty: 3, priceCents: 12000 });

    expect(await db.scan_history.get('h1')).toMatchObject({ cardId: 'base1-4', priceCents: 30010 });
    expect((await db.price_points.get('intl:sv10.5w-012:holo'))?.points).toEqual([
      { d: '2026-10-01', c: 1450 },
      { d: '2026-10-02', c: 1499 },
    ]);

    const settings = (await db.settings.get(SETTINGS_KEY))?.value as AppSettings;
    expect(settings).toMatchObject({
      fallbackLang: 'en',
      condition: 3,
      haptics: false,
    });
    // Der OpenRouter-Schlüssel der alten Version wird nicht übernommen
    expect(JSON.stringify(settings)).not.toContain('sk-or-test');
    expect((await db.settings.get(PORTFOLIO_KEY))?.value).toEqual([{ d: '2026-10-01', c: 2998, n: 2 }]);
  });

  it('läuft nur einmal und überschreibt danach nichts', async () => {
    const old = await legacyDb();
    await old.put('items', legacyItem);
    db = newDb();
    await migrateFromLegacy(db, { idb });
    await db.collection_items.update('m1abc', { qty: 7 });
    expect(await migrateFromLegacy(db, { idb })).toBeNull();
    // erzwungen: ergänzt nur Fehlendes, ändert bestehende Posten nicht
    const again = await migrateFromLegacy(db, { idb, force: true });
    expect(again?.items).toBe(0);
    expect((await db.collection_items.get('m1abc'))?.qty).toBe(7);
  });

  it('ergänzt bei erzwungenem Lauf Karten, die später in der alten App dazukamen', async () => {
    const old = await legacyDb();
    await old.put('items', legacyItem);
    db = newDb();
    await migrateFromLegacy(db, { idb });
    await old.put('items', { ...legacyItem, uid: 'later' });
    const again = await migrateFromLegacy(db, { idb, force: true });
    expect(again?.items).toBe(1);
    expect(await db.collection_items.count()).toBe(2);
  });

  it('lässt die alte Datenbank unverändert', async () => {
    const old = await legacyDb();
    await old.put('items', legacyItem);
    db = newDb();
    await migrateFromLegacy(db, { idb });
    const conn = await new Promise<IDBDatabase>((res) => {
      const r = idb.open('holoscan');
      r.onsuccess = () => res(r.result);
    });
    expect(conn.version).toBe(1);
    const all = await new Promise<unknown[]>((res) => {
      const r = conn.transaction('items').objectStore('items').getAll();
      r.onsuccess = () => res(r.result);
    });
    conn.close();
    expect(all).toEqual([legacyItem]);
  });

  it('legt keine alte Datenbank an, wenn es keine gibt', async () => {
    db = newDb();
    const report = await migrateFromLegacy(db, { idb });
    expect(report).toMatchObject({ found: false, items: 0 });
    const names = (await idb.databases()).map((d) => d.name);
    expect(names).not.toContain('holoscan');
    expect(await db.settings.get(MIGRATION_KEY)).toBeTruthy();
  });

  it('überspringt kaputte Einträge statt abzubrechen', async () => {
    const old = await legacyDb();
    await old.putMany('items', [legacyItem, { uid: 'broken' }]);
    db = newDb();
    const report = await migrateFromLegacy(db, { idb });
    expect(report).toMatchObject({ items: 1, skipped: 1 });
  });
});

describe('Hilfsfunktionen', () => {
  it('teilt Karten-IDs mit Bindestrich im Set-Namen richtig', () => {
    expect(splitCardId('tk-xy-b-3')).toEqual(['tk-xy-b', '3']);
    expect(splitCardId('swsh3-136')).toEqual(['swsh3', '136']);
  });
  it('rechnet Euro in Cent ohne Rundungsfehler', () => {
    expect(toCents(14.99)).toBe(1499);
    expect(toCents(0.07)).toBe(7);
    expect(toCents('5,50')).toBe(550);
    expect(toCents(-1)).toBeNull();
    expect(toCents('abc')).toBeNull();
  });
});
