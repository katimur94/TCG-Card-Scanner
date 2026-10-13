// Neue Datenbank "holo" (Dexie). Die alte Datenbank "holoscan" bleibt unverändert bestehen
// und wird nur einmalig gelesen (siehe migrate.ts).

import Dexie, { type EntityTable } from 'dexie';

export type Region = 'intl' | 'ja';
export type ListKind = 'collection' | 'wish';
export type Origin = 'kauf' | 'booster' | 'tausch' | 'geschenk';

/** Ein Posten: eine Karte in Sprache/Variante/Zustand mit Menge und Kaufpreis pro Stück. */
export interface CollectionItem {
  id: string;
  list: ListKind;
  cardId: string; // TCGdex-ID, z. B. "swsh3-136"
  setId: string;
  localId: string;
  region: Region;
  lang: string;
  name: string;
  setName: string;
  setDate: string | null;
  official: number | null;
  image: string | null; // TCGdex-Bildbasis (ohne /low.webp)
  photoId: string | null; // eigenes Foto (Tabelle photos)
  variantKey: string;
  variantLabel: string;
  condition: number; // Cardmarket 1 (MT) … 7 (PO)
  qty: number;
  pricePaidCents: number | null; // pro Stück
  paidAt: number | null;
  origin: Origin | null;
  note: string;
  idProduct: number | null; // Cardmarket-Produkt
  priceCents: number | null; // letzter bekannter Marktwert (NM, Variante)
  priceUpdated: string | null;
  addedPriceCents: number | null; // Marktwert beim Hinzufügen
  targetCents: number | null; // Preisalarm (Merkliste)
  alarmedAt: number | null;
  createdAt: number;
  updatedAt: number;
  checkedAt: number | null;
  rarity: string | null; // englische TCGdex-Seltenheit (für Glanz und Filter)
}

export interface Photo {
  id: string;
  blob: Blob;
}

export interface ScanHistoryEntry {
  id: string;
  at: number;
  cardId: string;
  setId: string;
  localId: string;
  region: Region;
  lang: string;
  name: string;
  setName: string;
  image: string | null;
  photoId: string | null;
  priceCents: number | null;
  variantLabel: string | null;
}

export interface ScanQueueEntry {
  id: string;
  imageBlob: Blob;
  status: 'pending' | 'done' | 'failed';
  candidates: unknown;
  createdAt: number;
}

export interface PriceCacheEntry {
  cardmarketId: number;
  trend: number | null;
  avg1: number | null;
  avg7: number | null;
  avg30: number | null;
  low: number | null;
  asOf: string;
}

/** Eigene Preisabrufe je Karte/Variante (ein Punkt pro Tag), Werte in Cent. */
export interface PricePoints {
  key: string; // `${region}:${cardId}:${variantKey}`
  points: Array<{ d: string; c: number }>;
}

export interface AiUsage {
  id: string; // `${dayPacific}|${model}`
  dayPacific: string;
  model: string;
  count: number;
  exhaustedUntil: number | null;
}

export interface Setting {
  key: string;
  value: unknown;
}

export class HoloDB extends Dexie {
  collection_items!: EntityTable<CollectionItem, 'id'>;
  photos!: EntityTable<Photo, 'id'>;
  scan_history!: EntityTable<ScanHistoryEntry, 'id'>;
  scan_queue!: EntityTable<ScanQueueEntry, 'id'>;
  price_cache!: EntityTable<PriceCacheEntry, 'cardmarketId'>;
  price_points!: EntityTable<PricePoints, 'key'>;
  ai_usage!: EntityTable<AiUsage, 'id'>;
  settings!: EntityTable<Setting, 'key'>;

  constructor(name = 'holo', options?: { indexedDB?: IDBFactory; IDBKeyRange?: typeof IDBKeyRange }) {
    super(name, options);
    this.version(1).stores({
      collection_items: 'id, list, cardId, setId, lang, createdAt',
      photos: 'id',
      scan_history: 'id, at',
      scan_queue: 'id, status, createdAt',
      price_cache: 'cardmarketId',
      price_points: 'key',
      ai_usage: 'id, dayPacific',
      settings: 'key',
    });
  }
}

export const db = new HoloDB();
