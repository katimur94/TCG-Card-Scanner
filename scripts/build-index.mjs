#!/usr/bin/env node
// Erzeugt den Offline-Kartenindex in data/ aus der TCGdex-API.
//
//   node scripts/build-index.mjs
//
// data/sets.json        – alle Sets (international + japanisch) mit Kartenanzahl,
//                         offiziellem Kürzel (z. B. "MEW"), Erscheinungsdatum, Serie
// data/cards-<lang>.json – Kartennamen pro Sprache, gruppiert nach Set
//
// Die App nutzt den Index, um OCR-Ergebnisse (Nummer, Set-Kürzel, Name) ohne
// Netzwerk auf Kandidaten abzubilden. Preise werden immer live geladen.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://api.tcgdex.net/v2';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data');

// Sprachen mit gemeinsamen (internationalen) Set-IDs
const INTL_LANGS = ['en', 'de', 'fr', 'es', 'it', 'pt'];
// Sprachen mit eigenen Sets
const ASIA_LANGS = ['ja'];
// Digitale Karten (Pokémon TCG Pocket) gibt es nicht auf Cardmarket
const SKIP_SERIES = new Set(['tcgp']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(path, tries = 7) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(API + path, { headers: { accept: 'application/json' } });
      if (res.ok) return await res.json();
      if (res.status === 404) return null;
      lastErr = new Error(`${res.status} ${path}`);
    } catch (err) {
      lastErr = err;
    }
    await sleep(800 * 2 ** i);
  }
  throw lastErr;
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: size }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

async function buildSets() {
  const groups = [
    { group: 'intl', lang: 'en' },
    ...ASIA_LANGS.map((lang) => ({ group: lang, lang })),
  ];
  const sets = [];
  for (const { group, lang } of groups) {
    const list = await getJSON(`/${lang}/sets`);
    console.log(`[sets] ${lang}: ${list.length}`);
    const details = await pool(list, 6, async (s) => {
      const d = await getJSON(`/${lang}/sets/${encodeURIComponent(s.id)}`);
      return d;
    });
    list.forEach((s, i) => {
      const d = details[i] || {};
      if (SKIP_SERIES.has(d.serie?.id)) return;
      const entry = {
        id: s.id,
        g: group,
        n: s.name,
        o: s.cardCount?.official ?? 0,
        t: s.cardCount?.total ?? 0,
      };
      if (d.abbreviation?.official) entry.a = d.abbreviation.official;
      if (d.releaseDate) entry.d = d.releaseDate;
      if (d.serie?.id) entry.s = d.serie.id;
      if (d.serie?.name) entry.sn = d.serie.name;
      if (s.symbol || d.symbol) entry.sy = 1;
      if (s.logo || d.logo) entry.lo = 1;
      sets.push(entry);
    });
  }

  // Lokalisierte Set-Namen für internationale Sets
  const intl = new Map(sets.filter((s) => s.g === 'intl').map((s) => [s.id, s]));
  for (const lang of INTL_LANGS.filter((l) => l !== 'en')) {
    const list = await getJSON(`/${lang}/sets`);
    for (const s of list || []) {
      const e = intl.get(s.id);
      if (e && s.name && s.name !== e.n) (e.nl ||= {})[lang] = s.name;
    }
  }
  return sets;
}

async function buildCards(lang, knownSets) {
  const list = await getJSON(`/${lang}/cards`);
  const bySet = {};
  for (const c of list) {
    const setId = c.id.slice(0, c.id.length - c.localId.length - 1);
    if (!knownSets.has(setId)) continue;
    const row = [c.localId, c.name];
    if (!c.image) row.push(0);
    (bySet[setId] ||= []).push(row);
  }
  console.log(`[cards] ${lang}: ${list.length} Karten in ${Object.keys(bySet).length} Sets`);
  return bySet;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const generated = new Date().toISOString();

  const sets = await buildSets();
  await writeFile(join(OUT, 'sets.json'), JSON.stringify({ v: 1, generated, sets }));

  const manifest = { v: 1, generated, langs: {} };
  for (const lang of [...INTL_LANGS, ...ASIA_LANGS]) {
    const group = ASIA_LANGS.includes(lang) ? lang : 'intl';
    const known = new Set(sets.filter((s) => s.g === group).map((s) => s.id));
    const bySet = await buildCards(lang, known);
    const count = Object.values(bySet).reduce((n, a) => n + a.length, 0);
    manifest.langs[lang] = count;
    await writeFile(join(OUT, `cards-${lang}.json`), JSON.stringify({ v: 1, generated, lang, sets: bySet }));
  }
  await writeFile(join(OUT, 'index.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log('Fertig:', manifest);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
