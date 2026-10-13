// Minimaler Promise-Wrapper um IndexedDB (mit Fallback auf Speicher, z. B. im privaten Modus).

const DB_NAME = 'holoscan';
const DB_VERSION = 1;
const STORES = {
  kv: {},
  items: { keyPath: 'uid' },
  history: { keyPath: 'uid' },
  prices: {},
};

let dbPromise;
const memory = Object.fromEntries(Object.keys(STORES).map((k) => [k, new Map()]));
let useMemory = false;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      useMemory = true;
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, opts] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, opts.keyPath ? { keyPath: opts.keyPath } : undefined);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      useMemory = true;
      resolve(null);
    };
    req.onblocked = () => {
      useMemory = true;
      resolve(null);
    };
  });
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await open();
  if (!db || useMemory) return fn(null);
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => {
      result = r;
    }, reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const wrap = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

function keyOf(store, value, key) {
  return STORES[store].keyPath ? value[STORES[store].keyPath] : key;
}

export const db = {
  async get(store, key) {
    return tx(store, 'readonly', (s) => (s ? wrap(s.get(key)) : memory[store].get(key)));
  },
  async put(store, value, key) {
    return tx(store, 'readwrite', (s) => {
      if (!s) return memory[store].set(keyOf(store, value, key), structuredClone(value));
      return wrap(STORES[store].keyPath ? s.put(value) : s.put(value, key));
    });
  },
  async putMany(store, values) {
    return tx(store, 'readwrite', (s) => {
      for (const v of values) {
        if (!s) memory[store].set(keyOf(store, v), structuredClone(v));
        else s.put(v);
      }
    });
  },
  async del(store, key) {
    return tx(store, 'readwrite', (s) => (s ? wrap(s.delete(key)) : memory[store].delete(key)));
  },
  async all(store) {
    return tx(store, 'readonly', (s) => (s ? wrap(s.getAll()) : [...memory[store].values()].map((v) => structuredClone(v))));
  },
  async clear(store) {
    return tx(store, 'readwrite', (s) => (s ? wrap(s.clear()) : memory[store].clear()));
  },
};
