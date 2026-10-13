import { describe, expect, it } from 'vitest';
import type { CollectionItem } from '../db/schema';
import { pocketsOf, filterPockets, sortPockets, pages } from './binder';
import { depotOf, performance, unitValueCents } from './valuation';

const base: CollectionItem = {
  id: 'a',
  list: 'collection',
  cardId: 'sv01-25',
  setId: 'sv01',
  localId: '25',
  region: 'intl',
  lang: 'de',
  name: 'Glurak',
  setName: 'Karmesin & Purpur',
  setDate: '2023-03-31',
  official: 198,
  image: null,
  photoId: null,
  variantKey: 'normal',
  variantLabel: 'Normal',
  condition: 2,
  qty: 1,
  pricePaidCents: null,
  paidAt: null,
  origin: null,
  note: '',
  idProduct: 1,
  priceCents: 1000,
  priceUpdated: null,
  addedPriceCents: 1000,
  targetCents: null,
  alarmedAt: null,
  createdAt: 1,
  updatedAt: 1,
  checkedAt: 1,
  rarity: 'Rare',
};
const item = (p: Partial<CollectionItem>): CollectionItem => ({ ...base, ...p });

describe('Bewertung', () => {
  it('berechnet den Wert im Zustand (EX = 85 %)', () => {
    expect(unitValueCents(item({ condition: 3 }))).toBe(850);
  });
  it('Gewinn gegen Kaufpreis, sonst gegen den Wert beim Hinzufügen', () => {
    expect(performance(item({ pricePaidCents: 500, qty: 2 }))).toEqual({ delta: 1000, ratio: 1 });
    expect(performance(item({ addedPriceCents: 1250 }))).toEqual({ delta: -250, ratio: -0.2 });
  });
  it('Depot zählt Karten ohne Preis separat und nicht als 0 €', () => {
    const d = depotOf([
      item({ qty: 2, pricePaidCents: 800 }),
      item({ id: 'b', priceCents: null }),
      item({ id: 'w', list: 'wish' }),
    ]);
    expect(d).toMatchObject({ valueCents: 2000, investedCents: 1600, gainCents: 400, cards: 3, unpriced: 1 });
    expect(d.gainRatio).toBeCloseTo(0.25);
    expect(d.top[0].item.id).toBe('a');
  });
  it('Geschenkt (0 €) zählt voll als Gewinn', () => {
    expect(depotOf([item({ pricePaidCents: 0, origin: 'geschenk' })]).gainCents).toBe(1000);
  });
});

describe('Binder', () => {
  const items = [
    item({ id: '1', qty: 2, pricePaidCents: 500 }),
    item({ id: '2', qty: 1, pricePaidCents: 1500, createdAt: 5 }),
    item({
      id: '3',
      cardId: 'base1-4',
      setId: 'base1',
      localId: '4',
      name: 'Charizard',
      lang: 'en',
      priceCents: 30000,
      setDate: '1999-01-09',
      official: 102,
    }),
    item({ id: '4', variantKey: 'reverse' }),
  ];
  it('bündelt gleiche Karte/Sprache/Variante zu einer Tasche mit Menge', () => {
    const p = pocketsOf(items, 'collection');
    expect(p).toHaveLength(3);
    const glurak = p.find((x) => x.key === 'intl:sv01-25:de:normal')!;
    expect(glurak.qty).toBe(3);
    expect(glurak.valueCents).toBe(3000);
    expect(glurak.gainCents).toBe(500); // 2×(+5 €) und 1×(−5 €)
  });
  it('filtert und sortiert', () => {
    const p = pocketsOf(items, 'collection');
    expect(
      filterPockets(p, { list: 'collection', query: '4/198', lang: null, setId: null, rarity: null, trend: null }),
    ).toHaveLength(0);
    expect(
      filterPockets(p, { list: 'collection', query: '4/102', lang: null, setId: null, rarity: null, trend: null }),
    ).toHaveLength(1);
    expect(
      filterPockets(p, { list: 'collection', query: 'chariz', lang: null, setId: null, rarity: null, trend: null }),
    ).toHaveLength(1);
    expect(
      filterPockets(p, { list: 'collection', query: '', lang: 'en', setId: null, rarity: null, trend: null }),
    ).toHaveLength(1);
    expect(sortPockets(p, 'value')[0].first.name).toBe('Charizard');
    expect(sortPockets(p, 'set')[0].first.setId).toBe('sv01');
  });
  it('teilt in 3×3-Seiten', () => {
    expect(pages([...Array(10).keys()]).map((x) => x.length)).toEqual([9, 1]);
    expect(pages([])).toEqual([[]]);
  });
});
