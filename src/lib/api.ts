// TCGdex-Client (Kartendaten + Cardmarket-Preise) und Offline-Index.

import { sleep } from './util';
import type { CardsBySet, SetIndex, SetInfo, TcgdexCard } from './types';

const API = 'https://api.tcgdex.net/v2';
const ASSETS = 'https://assets.tcgdex.net';
const BASE = import.meta.env.BASE_URL;
export const dataUrl = (path: string) => new URL(`${BASE}${path}`, location.href).href;

const memo = new Map<string, { t: number; p: Promise<unknown> }>();
const MEMO_TTL = 10 * 60 * 1000;

export async function fetchJSON<T>(
  url: string,
  { tries = 4, signal }: { tries?: number; signal?: AbortSignal } = {},
): Promise<T | null> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { signal, headers: { accept: 'application/json' } });
      if (res.ok) return (await res.json()) as T;
      if (res.status === 404) return null;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      lastErr = err;
    }
    // TCGdex antwortet gelegentlich kurz mit 503 – mit Backoff erneut versuchen
    if (i < tries - 1) await sleep(400 * 2 ** i);
  }
  throw lastErr;
}

function cached<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.t < MEMO_TTL) return hit.p as Promise<T>;
  const p = loader().catch((err) => {
    memo.delete(key);
    throw err;
  });
  memo.set(key, { t: Date.now(), p });
  return p;
}

/** Vollständige Kartendaten in einer Sprache (null, wenn es die Karte dort nicht gibt). */
export function getCard(lang: string, id: string, { fresh = false } = {}): Promise<TcgdexCard | null> {
  const key = `card:${lang}:${id}`;
  if (fresh) memo.delete(key);
  return cached(key, () => fetchJSON<TcgdexCard>(`${API}/${lang}/cards/${encodeURIComponent(id)}`));
}

/** Serverseitig gefilterte Kartenliste, z. B. findCards('en', 'dexId=448'). */
export function findCards(lang: string, query: string) {
  return cached(`find:${lang}:${query}`, () =>
    fetchJSON<Array<{ id: string; localId: string; name: string; image?: string }>>(`${API}/${lang}/cards?${query}`),
  );
}

/** Bild-URL einer Karte. quality: 'low' (~250px) oder 'high' (~600px). */
export function imageUrl(base: string | null | undefined, quality: 'low' | 'high' = 'high') {
  return base ? `${base}/${quality}.webp` : null;
}

/** Bildbasis aus Index-Daten konstruieren (ohne API-Aufruf). */
export function guessImageBase(lang: string, set: SetInfo | undefined, localId: string) {
  if (!set?.s) return null;
  return `${ASSETS}/${lang}/${set.s}/${set.id}/${localId}`;
}

// ---------- Offline-Index ----------

let setsPromise: Promise<SetIndex> | null = null;
const cardIndex = new Map<string, Promise<CardsBySet>>();

export function loadSets(): Promise<SetIndex> {
  setsPromise ||= fetchJSON<{ sets: SetInfo[]; generated?: string }>(dataUrl('data/sets.json'))
    .then((data) => {
      const sets = data?.sets || [];
      const byId = new Map(sets.map((s) => [`${s.g}:${s.id}`, s]));
      const byAbbr = new Map<string, SetInfo[]>();
      for (const s of sets) {
        if (!s.a) continue;
        for (const code of s.a.split(/[:/]/)) {
          if (!byAbbr.has(code)) byAbbr.set(code, []);
          byAbbr.get(code)!.push(s);
        }
      }
      return { sets, byId, byAbbr, generated: data?.generated };
    })
    .catch((err) => {
      setsPromise = null;
      throw err;
    });
  return setsPromise;
}

export async function findSet(group: string, id: string) {
  const { byId } = await loadSets();
  return byId.get(`${group}:${id}`);
}

/** Kartennamen einer Sprache: setId -> [[localId, name, hasImage?], ...] */
export function loadCardIndex(lang: string): Promise<CardsBySet> {
  if (!cardIndex.has(lang)) {
    cardIndex.set(
      lang,
      fetchJSON<{ sets: CardsBySet }>(dataUrl(`data/cards-${lang}.json`))
        .then((d) => d?.sets || {})
        .catch((err) => {
          cardIndex.delete(lang);
          throw err;
        }),
    );
  }
  return cardIndex.get(lang)!;
}

export async function indexInfo() {
  try {
    return await fetchJSON<{ generated: string; langs: Record<string, number> }>(dataUrl('data/index.json'), {
      tries: 1,
    });
  } catch {
    return null;
  }
}
