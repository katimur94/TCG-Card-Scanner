// TCGdex-Client (Kartendaten + Cardmarket-Preise) und Offline-Index.

import { sleep } from './util.js';

const API = 'https://api.tcgdex.net/v2';
const ASSETS = 'https://assets.tcgdex.net';
const BASE = new URL('../', import.meta.url);

const memo = new Map();
const MEMO_TTL = 10 * 60 * 1000;

async function fetchJSON(url, { tries = 4, signal } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { signal, headers: { accept: 'application/json' } });
      if (res.ok) return await res.json();
      if (res.status === 404) return null;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      lastErr = err;
    }
    // TCGdex antwortet gelegentlich kurz mit 503 – mit Backoff erneut versuchen
    await sleep(400 * 2 ** i);
  }
  throw lastErr;
}

async function cached(key, loader) {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.t < MEMO_TTL) return hit.p;
  const p = loader().catch((err) => {
    memo.delete(key);
    throw err;
  });
  memo.set(key, { t: Date.now(), p });
  return p;
}

/** Vollständige Kartendaten in einer Sprache (null, wenn es die Karte dort nicht gibt). */
export function getCard(lang, id, { fresh = false } = {}) {
  const key = `card:${lang}:${id}`;
  if (fresh) memo.delete(key);
  return cached(key, () => fetchJSON(`${API}/${lang}/cards/${encodeURIComponent(id)}`));
}

/** Serverseitig gefilterte Kartenliste, z. B. findCards('en', 'dexId=448'). */
export function findCards(lang, query) {
  return cached(`find:${lang}:${query}`, () => fetchJSON(`${API}/${lang}/cards?${query}`));
}

export function getSet(lang, id) {
  return cached(`set:${lang}:${id}`, () => fetchJSON(`${API}/${lang}/sets/${encodeURIComponent(id)}`));
}

/** Bild-URL einer Karte. quality: 'low' (~250px) oder 'high' (~600px). */
export function imageUrl(base, quality = 'high') {
  return base ? `${base}/${quality}.webp` : null;
}

/** Bild-URL aus Index-Daten konstruieren (ohne API-Aufruf). */
export function guessImage(lang, set, localId, quality = 'low') {
  if (!set?.s) return null;
  return `${ASSETS}/${lang}/${set.s}/${set.id}/${localId}/${quality}.webp`;
}

// ---------- Offline-Index ----------

let setsPromise;
const cardIndex = new Map();

export function loadSets() {
  setsPromise ||= fetchJSON(new URL('data/sets.json', BASE).href).then((data) => {
    const sets = data?.sets || [];
    const byId = new Map(sets.map((s) => [`${s.g}:${s.id}`, s]));
    const byAbbr = new Map();
    for (const s of sets) {
      if (!s.a) continue;
      for (const code of s.a.split(/[:/]/)) {
        if (!byAbbr.has(code)) byAbbr.set(code, []);
        byAbbr.get(code).push(s);
      }
    }
    return { sets, byId, byAbbr, generated: data?.generated };
  });
  return setsPromise;
}

export async function findSet(group, id) {
  const { byId } = await loadSets();
  return byId.get(`${group}:${id}`);
}

/** Kartennamen einer Sprache: Map setId -> [[localId, name, hasImage?], ...] */
export function loadCardIndex(lang) {
  if (!cardIndex.has(lang)) {
    cardIndex.set(
      lang,
      fetchJSON(new URL(`data/cards-${lang}.json`, BASE).href)
        .then((d) => d?.sets || {})
        .catch((err) => {
          cardIndex.delete(lang);
          throw err;
        }),
    );
  }
  return cardIndex.get(lang);
}

export async function indexInfo() {
  try {
    return await fetchJSON(new URL('data/index.json', BASE).href, { tries: 1 });
  } catch {
    return null;
  }
}
