// Export und Import (JSON-Backup, CSV für Excel). Importiert auch Backups der alten App (v1).
// Alles wird vor dem Schreiben geprüft und in einer einzigen Transaktion gespeichert –
// ein fehlerhafter Eintrag kann die Sammlung nie halb oder ganz löschen.

import { db, type CollectionItem, type Photo } from '../db/schema';
import { itemFromLegacy, dataUrlToBlob } from '../db/migrate';
import { unitValueCents } from './valuation';
import { langInfo } from '../lib/lang';
import { conditionInfo } from '../lib/pricing';

export const BACKUP_APP = 'HoloScan';
export const BACKUP_VERSION = 2;

export interface BackupFile {
  app: string;
  v: number;
  exported: string;
  items: CollectionItem[];
  photos?: Array<{ id: string; dataUrl: string }>;
  priceHistory?: Array<{ key: string; points: Array<{ d: string; c: number }> }>;
}

async function blobToDataUrl(b: Blob): Promise<string> {
  const buf = new Uint8Array(await b.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return `data:${b.type || 'application/octet-stream'};base64,${btoa(bin)}`;
}

export async function exportBackup(): Promise<BackupFile> {
  const [items, photos, prices] = await Promise.all([
    db.collection_items.toArray(),
    db.photos.toArray(),
    db.price_points.toArray(),
  ]);
  const used = new Set(items.map((i) => i.photoId).filter(Boolean));
  return {
    app: BACKUP_APP,
    v: BACKUP_VERSION,
    exported: new Date().toISOString(),
    items,
    photos: await Promise.all(
      photos.filter((p) => used.has(p.id)).map(async (p) => ({ id: p.id, dataUrl: await blobToDataUrl(p.blob) })),
    ),
    priceHistory: prices,
  };
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const nullable = (v: unknown, check: (x: unknown) => boolean) => v == null || check(v);
const isCents = (v: unknown) => isNum(v) && Number.isInteger(v) && v >= 0;

/** Strenge Prüfung eines Postens im neuen Format. Unbekannte Felder werden verworfen. */
export function validItem(o: unknown): CollectionItem | null {
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  const ok =
    isStr(r.id) &&
    r.id.length > 0 &&
    (r.list === 'collection' || r.list === 'wish') &&
    isStr(r.cardId) &&
    isStr(r.setId) &&
    isStr(r.localId) &&
    (r.region === 'intl' || r.region === 'ja') &&
    isStr(r.lang) &&
    isStr(r.name) &&
    isNum(r.qty) &&
    Number.isInteger(r.qty) &&
    r.qty >= 1 &&
    r.qty <= 9999 &&
    isNum(r.condition) &&
    r.condition >= 1 &&
    r.condition <= 7 &&
    nullable(r.pricePaidCents, isCents) &&
    nullable(r.priceCents, isCents) &&
    nullable(r.addedPriceCents, isCents) &&
    nullable(r.targetCents, isCents) &&
    nullable(r.image, (v) => isStr(v) && /^https:\/\/assets\.tcgdex\.net\//.test(v)) &&
    nullable(r.idProduct, isNum) &&
    isNum(r.createdAt);
  if (!ok) return null;
  const str = (v: unknown) => (isStr(v) ? v : '');
  const strN = (v: unknown) => (isStr(v) && v ? v : null);
  const numN = (v: unknown) => (isNum(v) ? v : null);
  const origin = ['kauf', 'booster', 'tausch', 'geschenk'].includes(r.origin as string)
    ? (r.origin as CollectionItem['origin'])
    : null;
  return {
    id: r.id as string,
    list: r.list as CollectionItem['list'],
    cardId: r.cardId as string,
    setId: r.setId as string,
    localId: r.localId as string,
    region: r.region as CollectionItem['region'],
    lang: r.lang as string,
    name: (r.name as string).slice(0, 200),
    setName: str(r.setName).slice(0, 200),
    setDate: strN(r.setDate),
    official: numN(r.official),
    image: strN(r.image),
    photoId: strN(r.photoId),
    variantKey: str(r.variantKey) || 'normal',
    variantLabel: str(r.variantLabel).slice(0, 100),
    condition: r.condition as number,
    qty: r.qty as number,
    pricePaidCents: numN(r.pricePaidCents),
    paidAt: numN(r.paidAt),
    origin,
    note: str(r.note).slice(0, 500),
    idProduct: numN(r.idProduct),
    priceCents: numN(r.priceCents),
    priceUpdated: strN(r.priceUpdated),
    addedPriceCents: numN(r.addedPriceCents),
    targetCents: numN(r.targetCents),
    alarmedAt: numN(r.alarmedAt),
    createdAt: r.createdAt as number,
    updatedAt: numN(r.updatedAt) ?? Date.now(),
    checkedAt: numN(r.checkedAt),
    rarity: strN(r.rarity),
  };
}

export interface ImportPlan {
  items: CollectionItem[];
  photos: Photo[];
  prices: Array<{ key: string; points: Array<{ d: string; c: number }> }>;
  skipped: number;
  legacy: boolean;
}

/** Datei lesen und prüfen (schreibt noch nichts). */
export function planImport(text: string): ImportPlan {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Die Datei ist kein gültiges JSON-Backup.');
  }
  const d = data as Partial<BackupFile> & { items?: unknown };
  if (!d || typeof d !== 'object' || !Array.isArray(d.items)) throw new Error('Kein HoloScan-Backup gefunden.');
  const legacy = d.v === 1 || d.v == null;
  const plan: ImportPlan = { items: [], photos: [], prices: [], skipped: 0, legacy };
  for (const raw of d.items) {
    if (legacy) {
      const r = raw && typeof raw === 'object' ? itemFromLegacy(raw as unknown as Record<string, unknown>) : null;
      const item = r ? validItem(r.item) : null;
      if (!item) {
        plan.skipped++;
        continue;
      }
      plan.items.push(item);
      if (r?.photo) plan.photos.push(r.photo);
    } else {
      const item = validItem(raw);
      if (item) plan.items.push(item);
      else plan.skipped++;
    }
  }
  if (!legacy) {
    const wanted = new Set(plan.items.map((i) => i.photoId).filter(Boolean));
    for (const p of Array.isArray(d.photos) ? d.photos : []) {
      if (!p || !isStr(p.id) || !wanted.has(p.id) || !isStr(p.dataUrl) || !/^data:image\//.test(p.dataUrl)) continue;
      const blob = dataUrlToBlob(p.dataUrl);
      if (blob) plan.photos.push({ id: p.id, blob });
    }
    for (const h of Array.isArray(d.priceHistory) ? d.priceHistory : []) {
      if (!h || !isStr(h.key) || !Array.isArray(h.points)) continue;
      const points = h.points.filter((x) => x && isStr(x.d) && isCents(x.c)).slice(-365);
      if (points.length) plan.prices.push({ key: h.key, points });
    }
    // Fotos, die fehlen, nicht verlinkt lassen
    const have = new Set(plan.photos.map((p) => p.id));
    for (const i of plan.items) if (i.photoId && !have.has(i.photoId)) i.photoId = null;
  }
  return plan;
}

/** Plan anwenden. 'merge' ergänzt (gleiche ID wird übersprungen), 'replace' ersetzt die Sammlung. */
export async function applyImport(plan: ImportPlan, mode: 'merge' | 'replace') {
  if (mode === 'replace' && plan.items.length === 0)
    throw new Error('Das Backup enthält keine gültigen Karten – die Sammlung bleibt unverändert.');
  let added = 0;
  await db.transaction('rw', [db.collection_items, db.photos, db.price_points], async () => {
    if (mode === 'replace') await db.collection_items.clear();
    const existing = await db.collection_items.bulkGet(plan.items.map((i) => i.id));
    const fresh = plan.items.filter((_, i) => !existing[i]);
    await db.collection_items.bulkAdd(fresh);
    added = fresh.length;
    await db.photos.bulkPut(plan.photos);
    for (const p of plan.prices) if (!(await db.price_points.get(p.key))) await db.price_points.add(p);
  });
  return { added, skipped: plan.skipped + (plan.items.length - added) };
}

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const eur = (c: number | null) => (c == null ? '' : (c / 100).toFixed(2).replace('.', ','));

export async function exportCsv(): Promise<string> {
  const items = await db.collection_items.toArray();
  const head = [
    'Liste',
    'Name',
    'Set',
    'Nummer',
    'Sprache',
    'Variante',
    'Zustand',
    'Menge',
    'Preis NM (€)',
    'Wert pro Stück (€)',
    'Kaufpreis pro Stück (€)',
    'Herkunft',
    'Kaufdatum',
    'Notiz',
    'Hinzugefügt',
  ];
  const rows = items.map((i) => [
    i.list === 'wish' ? 'Merkliste' : 'Sammlung',
    i.name,
    i.setName,
    i.official ? `${i.localId}/${i.official}` : i.localId,
    langInfo(i.lang).label,
    i.variantLabel,
    conditionInfo(i.condition).short,
    i.qty,
    eur(i.priceCents),
    eur(unitValueCents(i)),
    eur(i.pricePaidCents),
    i.origin || '',
    i.paidAt ? new Date(i.paidAt).toISOString().slice(0, 10) : '',
    i.note,
    new Date(i.createdAt).toISOString().slice(0, 10),
  ]);
  return '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n');
}
