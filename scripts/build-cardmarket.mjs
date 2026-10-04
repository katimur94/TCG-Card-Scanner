#!/usr/bin/env node
// Cardmarket-Preise direkt aus Cardmarkets öffentlichem Preisguide – für Karten, bei denen TCGdex
// keinen Cardmarket-Preis bzw. keine Produkt-ID hat (u. a. ältere Promos, Shiny Vault, Gym, Trainer-Kits).
//
//   node scripts/build-cardmarket.mjs               Preis-Dateien erzeugen (data/cm/p/, täglich)
//   node scripts/build-cardmarket.mjs --expansions  zusätzlich Set-Zuordnung neu ermitteln (data/cm/expansions.json)
//
// Cardmarket-Produkte heißen "Name [Attacke | Attacke]" und enthalten keine Kartennummer. Die App ordnet
// eine Karte deshalb über Name + Attacken zu (js/cardmarket.js). Damit bei Nachdrucken die richtige
// Erweiterung gewählt wird, ordnet --expansions jedem TCGdex-Set die Cardmarket-Erweiterung(en) zu:
// per Produkt-ID (wenn TCGdex sie kennt) oder per Mehrheitsentscheid über Name + Attacken mehrerer Karten.

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'cm');
const API = 'https://api.tcgdex.net/v2';
const CM = 'https://downloads.s3.cardmarket.com/productCatalog';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url, tries = 5) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (res.ok) return await res.json();
      if (res.status === 404) return null;
      last = new Error(`${res.status} ${url}`);
    } catch (err) {
      last = err;
    }
    await sleep(800 * 2 ** i);
  }
  throw last;
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

/** Muss zu js/cardmarket.js passen. */
const normName = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const shardKey = (name) => (normName(name).split(' ')[0] || '_').slice(0, 2).padEnd(2, '_');

/** "Lucario LV.X [Stance | Close Combat]" -> {base: 'lucario lv x', moves: ['stance', 'close combat']} */
function parseProduct(name) {
  const m = String(name).match(/^(.*?)\s*\[(.*)\]\s*$/);
  return { base: normName(m ? m[1] : name), moves: m ? m[2].split('|').map(normName).filter(Boolean) : [] };
}

function movesOf(card) {
  return [...(card.abilities || []), ...(card.attacks || [])].map((a) => normName(a.name)).filter(Boolean);
}

function matches(card, products) {
  const base = normName(card.name);
  const moves = new Set(movesOf(card));
  return products.filter((p) => {
    const pp = parseProduct(p.name);
    if (!(pp.base === base || pp.base.startsWith(`${base} `))) return false;
    if (!moves.size) return !pp.moves.length || pp.base === base;
    const inter = pp.moves.filter((x) => moves.has(x)).length;
    return inter / new Set([...pp.moves, ...moves]).size >= 0.6;
  });
}

async function buildExpansions(products) {
  const sets = JSON.parse(await readFile(join(ROOT, 'data', 'sets.json'), 'utf8')).sets.filter((s) => s.g === 'intl');
  const cards = JSON.parse(await readFile(join(ROOT, 'data', 'cards-en.json'), 'utf8')).sets;
  const byId = new Map(products.map((p) => [p.idProduct, p]));
  const byKey = new Map();
  for (const p of products) {
    const k = shardKey(p.name);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(p);
  }
  const result = {};
  await pool(sets, 4, async (s) => {
    const rows = cards[s.id] || [];
    if (!rows.length) return;
    // bis zu 12 Karten gleichmäßig über das Set verteilt
    const pick = [...new Set(Array.from({ length: Math.min(12, rows.length) }, (_, i) => rows[Math.floor((i * rows.length) / Math.min(12, rows.length))]))];
    const votes = new Map();
    let n = 0;
    for (const [localId] of pick) {
      const card = await getJSON(`${API}/en/cards/${encodeURIComponent(`${s.id}-${localId}`)}`).catch(() => null);
      if (!card) continue;
      const ids = new Set([card.pricing?.cardmarket?.idProduct, ...(card.variants_detailed || []).map((v) => v.pricing?.cardmarket?.idProduct || v.thirdParty?.cardmarket)].filter(Boolean));
      let exps;
      if (ids.size) exps = new Set([...ids].map((id) => byId.get(id)?.idExpansion).filter(Boolean));
      else exps = new Set(matches(card, byKey.get(shardKey(card.name)) || []).map((p) => p.idExpansion));
      if (!exps.size) continue;
      n++;
      const w = ids.size ? 3 : 1 / exps.size;
      for (const e of exps) votes.set(e, (votes.get(e) || 0) + w);
    }
    if (!votes.size) return;
    const max = Math.max(...votes.values());
    result[s.id] = [...votes.entries()].filter(([, v]) => v >= max * 0.5).sort((a, b) => b[1] - a[1]).map(([e]) => e);
    if (n) process.stdout.write('.');
  });
  console.log(`\n[cm] Set-Zuordnung: ${Object.keys(result).length}/${sets.length} Sets`);
  return result;
}

const r2 = (v) => (typeof v === 'number' && v > 0 ? Math.round(v * 100) / 100 : 0);

async function main() {
  await mkdir(OUT, { recursive: true });
  console.log('[cm] Lade Cardmarket-Produktliste und Preisguide …');
  const [plist, guide] = await Promise.all([getJSON(`${CM}/productList/products_singles_6.json`), getJSON(`${CM}/priceGuide/price_guide_6.json`)]);
  const products = plist?.products || [];
  const prices = new Map((guide?.priceGuides || []).map((g) => [g.idProduct, g]));
  if (products.length < 1000 || prices.size < 1000) throw new Error('Cardmarket-Daten unvollständig');
  console.log(`[cm] ${products.length} Produkte, ${prices.size} Preise (Stand ${guide.createdAt})`);

  if (process.argv.includes('--expansions')) {
    const exp = await buildExpansions(products);
    await writeFile(join(OUT, 'expansions.json'), JSON.stringify({ v: 1, sets: exp }));
  }

  // Preis-Dateien je Namensanfang: {Wort: [[idProduct, Name, idExpansion, trend, avg, low, avg1, avg7, avg30, trend-holo, avg-holo, low-holo, avg7-holo, avg30-holo]]}
  const shards = new Map();
  for (const p of products) {
    const g = prices.get(p.idProduct);
    if (!g) continue;
    const k = shardKey(p.name);
    const word = normName(p.name).split(' ')[0];
    if (!shards.has(k)) shards.set(k, {});
    (shards.get(k)[word] ||= []).push([
      p.idProduct, p.name, p.idExpansion,
      r2(g.trend), r2(g.avg), r2(g.low), r2(g.avg1), r2(g.avg7), r2(g.avg30),
      r2(g['trend-holo']), r2(g['avg-holo']), r2(g['low-holo']), r2(g['avg7-holo']), r2(g['avg30-holo']),
    ]);
  }
  await rm(join(OUT, 'p'), { recursive: true, force: true });
  await mkdir(join(OUT, 'p'), { recursive: true });
  // "2026-10-04T02:40:55+0200" -> ISO (Safari kann den Offset ohne Doppelpunkt nicht lesen)
  const updated = new Date(String(guide.createdAt).replace(/([+-]\d{2})(\d{2})$/, '$1:$2')).toISOString();
  for (const [k, data] of shards) await writeFile(join(OUT, 'p', `${k}.json`), JSON.stringify({ v: 1, updated, products: data }));
  console.log(`[cm] ${shards.size} Preis-Dateien geschrieben`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
