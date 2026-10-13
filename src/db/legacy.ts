// Liest die Datenbank der alten App ("holoscan", Version 1) – ausschließlich lesend.
// Existiert sie nicht, wird sie auch nicht angelegt.

export const LEGACY_DB = 'holoscan';
const STORES = ['kv', 'items', 'history', 'prices'] as const;

export interface LegacyDump {
  settings: Record<string, unknown> | null;
  portfolio: Array<{ d: string; v: number; n?: number }>;
  items: Array<Record<string, unknown>>;
  history: Array<Record<string, unknown>>;
  prices: Array<{ key: string; points: Array<{ d: string; v: number }> }>;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** Öffnet die alte Datenbank, ohne sie anzulegen. null, wenn es sie nicht gibt. */
function openExisting(idb: IDBFactory): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let r: IDBOpenDBRequest;
    try {
      r = idb.open(LEGACY_DB);
    } catch {
      resolve(null);
      return;
    }
    r.onupgradeneeded = (e) => {
      // oldVersion 0: Die Datenbank gab es nicht – Anlegen abbrechen, nichts hinterlassen.
      if ((e as IDBVersionChangeEvent).oldVersion === 0) r.transaction?.abort();
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => resolve(null);
    r.onblocked = () => resolve(null);
  });
}

export async function readLegacy(idb: IDBFactory = indexedDB): Promise<LegacyDump | null> {
  const conn = await openExisting(idb);
  if (!conn) return null;
  try {
    const names = STORES.filter((s) => conn.objectStoreNames.contains(s));
    if (!names.length) return null;
    const tx = conn.transaction(names, 'readonly');
    const has = (s: string) => (names as readonly string[]).includes(s);
    // Alle Anfragen sofort stellen (eine Transaktion), danach gemeinsam abwarten.
    const none = Promise.resolve(undefined);
    const [settings, portfolio, items, history, priceKeys, priceValues] = await Promise.all([
      has('kv') ? req(tx.objectStore('kv').get('settings')) : none,
      has('kv') ? req(tx.objectStore('kv').get('portfolio')) : none,
      has('items') ? req(tx.objectStore('items').getAll()) : none,
      has('history') ? req(tx.objectStore('history').getAll()) : none,
      has('prices') ? req(tx.objectStore('prices').getAllKeys()) : none,
      has('prices') ? req(tx.objectStore('prices').getAll()) : none,
    ]);
    return {
      settings: isObj(settings) ? settings : null,
      portfolio: Array.isArray(portfolio) ? portfolio : [],
      items: (Array.isArray(items) ? items : []).filter(isObj),
      history: (Array.isArray(history) ? history : []).filter(isObj),
      prices: (Array.isArray(priceKeys) ? priceKeys : []).map((k, i) => ({
        key: String(k),
        points: Array.isArray(priceValues?.[i]) ? priceValues[i] : [],
      })),
    };
  } finally {
    conn.close();
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';
