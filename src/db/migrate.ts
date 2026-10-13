// Einmalige Übernahme der Daten aus der alten App (IndexedDB "holoscan") in die neue Datenbank.
// Die alte Datenbank wird nur gelesen. Bereits übernommene Einträge (gleiche ID) werden nie überschrieben,
// ein erneuter Lauf ergänzt nur, was fehlt.

import type { CollectionItem, HoloDB, PricePoints, Region, ScanHistoryEntry, Photo } from './schema';
import { readLegacy, type LegacyDump } from './legacy';
import { DEFAULT_SETTINGS, settingsFromLegacy, type AppSettings } from '../state/settingsModel';

export const MIGRATION_KEY = 'migration.v1';
export const SETTINGS_KEY = 'app';
export const PORTFOLIO_KEY = 'portfolio';

export interface MigrationReport {
  at: number;
  found: boolean;
  items: number;
  history: number;
  prices: number;
  photos: number;
  skipped: number;
}

type Obj = Record<string, unknown>;

export const toCents = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};
const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : v == null ? fallback : String(v));
const strOrNull = (v: unknown) => (typeof v === 'string' && v ? v : null);
const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const time = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback);

/** "sv10.5w-012" -> ["sv10.5w", "012"] (Set-IDs enthalten selbst Bindestriche, z. B. "tk-xy-b"). */
export function splitCardId(id: string): [string, string] {
  const i = id.lastIndexOf('-');
  return i > 0 ? [id.slice(0, i), id.slice(i + 1)] : [id, ''];
}

export function dataUrlToBlob(url: string): Blob | null {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
  if (!m) return null;
  const type = m[1] || 'application/octet-stream';
  try {
    if (m[2]) {
      const bin = atob(m[3]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type });
    }
    return new Blob([decodeURIComponent(m[3])], { type });
  } catch {
    return null;
  }
}

/** Ein Sammlungs-/Merklisten-Eintrag der alten App -> neuer Posten (+ ggf. eigenes Foto). */
export function itemFromLegacy(o: Obj, now = Date.now()): { item: CollectionItem; photo: Photo | null } | null {
  const id = strOrNull(o.uid);
  const cardId = strOrNull(o.id);
  if (!id || !cardId) return null;
  const [setFromId, localFromId] = splitCardId(cardId);
  const region: Region = o.group === 'ja' ? 'ja' : 'intl';
  const qty = Math.max(1, Math.floor(Number(o.qty)) || 1);
  const cond = Number(o.condition);
  let photo: Photo | null = null;
  if (typeof o.scanImage === 'string' && o.scanImage.startsWith('data:')) {
    const blob = dataUrlToBlob(o.scanImage);
    if (blob) photo = { id: `legacy-${id}`, blob };
  }
  const createdAt = time(o.addedAt, now);
  const item: CollectionItem = {
    id,
    list: o.list === 'wish' ? 'wish' : 'collection',
    cardId,
    setId: strOrNull(o.setId) ?? setFromId,
    localId: o.localId != null ? str(o.localId) : localFromId,
    region,
    lang: strOrNull(o.lang) ?? (region === 'ja' ? 'ja' : 'en'),
    name: str(o.name, cardId),
    setName: str(o.setName),
    setDate: strOrNull(o.setDate),
    official: numOrNull(o.official),
    image: strOrNull(o.image),
    photoId: photo?.id ?? null,
    variantKey: str(o.variantKey, 'normal'),
    variantLabel: str(o.variantLabel),
    condition: Number.isInteger(cond) && cond >= 1 && cond <= 7 ? cond : 2,
    qty,
    pricePaidCents: toCents(o.buyPrice),
    paidAt: o.buyPrice != null ? createdAt : null,
    origin: o.buyPrice != null ? 'kauf' : null,
    note: str(o.note),
    idProduct: numOrNull(o.idProduct),
    priceCents: toCents(o.price),
    priceUpdated: strOrNull(o.priceUpdated),
    addedPriceCents: toCents(o.addedPrice),
    targetCents: toCents(o.target),
    alarmedAt: numOrNull(o.alarmedAt),
    createdAt,
    updatedAt: now,
    checkedAt: numOrNull(o.checkedAt),
    rarity: strOrNull(o.rarity),
  };
  return { item, photo };
}

export function historyFromLegacy(o: Obj): { entry: ScanHistoryEntry; photo: Photo | null } | null {
  const id = strOrNull(o.uid);
  const cardId = strOrNull(o.id);
  if (!id || !cardId) return null;
  const [setFromId, localFromId] = splitCardId(cardId);
  let photo: Photo | null = null;
  if (typeof o.scanImage === 'string' && o.scanImage.startsWith('data:')) {
    const blob = dataUrlToBlob(o.scanImage);
    if (blob) photo = { id: `legacy-h-${id}`, blob };
  }
  const region: Region = o.group === 'ja' ? 'ja' : 'intl';
  return {
    entry: {
      id,
      at: time(o.at, Date.now()),
      cardId,
      setId: strOrNull(o.setId) ?? setFromId,
      localId: o.localId != null ? str(o.localId) : localFromId,
      region,
      lang: strOrNull(o.lang) ?? (region === 'ja' ? 'ja' : 'en'),
      name: str(o.name, cardId),
      setName: str(o.setName),
      image: strOrNull(o.image),
      photoId: photo?.id ?? null,
      priceCents: toCents(o.price),
      variantLabel: strOrNull(o.variantLabel),
    },
    photo,
  };
}

export function pricesFromLegacy(p: { key: string; points: Array<{ d: string; v: number }> }): PricePoints | null {
  const points = p.points
    .filter((x) => x && typeof x.d === 'string' && toCents(x.v) != null)
    .map((x) => ({ d: x.d, c: toCents(x.v) as number }));
  return points.length ? { key: p.key, points } : null;
}

/** Wendet einen Datenstand der alten App auf die neue Datenbank an (nur fehlende Einträge). */
export async function applyLegacy(db: HoloDB, dump: LegacyDump, now = Date.now()): Promise<MigrationReport> {
  const report: MigrationReport = { at: now, found: true, items: 0, history: 0, prices: 0, photos: 0, skipped: 0 };
  const items: CollectionItem[] = [];
  const photos: Photo[] = [];
  for (const o of dump.items) {
    const r = itemFromLegacy(o, now);
    if (!r) {
      report.skipped++;
      continue;
    }
    items.push(r.item);
    if (r.photo) photos.push(r.photo);
  }
  const history: ScanHistoryEntry[] = [];
  for (const o of dump.history) {
    const r = historyFromLegacy(o);
    if (!r) continue;
    history.push(r.entry);
    if (r.photo) photos.push(r.photo);
  }
  const prices = dump.prices.map(pricesFromLegacy).filter((p): p is PricePoints => !!p);

  await db.transaction(
    'rw',
    [db.collection_items, db.scan_history, db.price_points, db.photos, db.settings],
    async () => {
      const missing = async <T extends { id?: string; key?: string }>(
        table: { bulkGet(keys: string[]): Promise<(T | undefined)[]> },
        rows: T[],
        keyOf: (r: T) => string,
      ) => {
        const existing = await table.bulkGet(rows.map(keyOf));
        return rows.filter((_, i) => !existing[i]);
      };
      const newItems = await missing(db.collection_items, items, (r) => r.id);
      const newHistory = await missing(db.scan_history, history, (r) => r.id);
      const newPrices = await missing(db.price_points, prices, (r) => r.key);
      const newPhotos = await missing(db.photos, photos, (r) => r.id);
      await db.collection_items.bulkAdd(newItems);
      await db.scan_history.bulkAdd(newHistory);
      await db.price_points.bulkAdd(newPrices);
      await db.photos.bulkAdd(newPhotos);
      report.items = newItems.length;
      report.history = newHistory.length;
      report.prices = newPrices.length;
      report.photos = newPhotos.length;

      // Einstellungen: nur beim ersten Mal übernehmen (spätere Änderungen in der neuen App gewinnen).
      if (!(await db.settings.get(SETTINGS_KEY))) {
        const settings: AppSettings = { ...DEFAULT_SETTINGS, ...settingsFromLegacy(dump.settings) };
        await db.settings.put({ key: SETTINGS_KEY, value: settings });
      }
      if (!(await db.settings.get(PORTFOLIO_KEY)) && dump.portfolio.length) {
        const points = dump.portfolio
          .filter((p) => p && typeof p.d === 'string' && toCents(p.v) != null)
          .map((p) => ({ d: p.d, c: toCents(p.v) as number, n: typeof p.n === 'number' ? p.n : null }));
        await db.settings.put({ key: PORTFOLIO_KEY, value: points });
      }
    },
  );
  return report;
}

/**
 * Beim Start aufrufen. Läuft genau einmal (Merker in settings); mit force erneut, ergänzt dann nur Fehlendes.
 * Bei einem Fehler wird nichts geschrieben (eine Transaktion) und kein Merker gesetzt; der nächste Start versucht es erneut.
 */
export async function migrateFromLegacy(
  db: HoloDB,
  { force = false, idb = globalThis.indexedDB }: { force?: boolean; idb?: IDBFactory } = {},
): Promise<MigrationReport | null> {
  if (!idb) return null;
  if (!force && (await db.settings.get(MIGRATION_KEY))) return null;
  const dump = await readLegacy(idb);
  const report = dump
    ? await applyLegacy(db, dump)
    : { at: Date.now(), found: false, items: 0, history: 0, prices: 0, photos: 0, skipped: 0 };
  await db.settings.put({ key: MIGRATION_KEY, value: report });
  return report;
}
