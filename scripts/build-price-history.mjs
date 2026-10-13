#!/usr/bin/env node
// Tägliche Preis-Historie aus Cardmarkets offiziellem Preis-Guide (kein Scraping).
//
//   node scripts/build-price-history.mjs
//
// Liest die vorhandene Historie aus public/data/prices/history/ (im Workflow aus dem Branch "data"
// wiederhergestellt), hängt den heutigen Preistrend an und schreibt sie zurück.
// Werte älter als 90 Tage werden auf einen Wert pro Woche verdichtet.
//
// Format je Datei (spaltenweise, damit sie klein bleibt):
//   { v: 2, updated: "YYYY-MM-DD", days: [20261013, …], t: { [idProduct]: [Cent|null, …] }, h: { [idProduct]: [Cent|null, …] } }
// t = Preistrend, h = Preistrend Reverse Holo. Muss zu src/domain/history.ts passen.

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'data', 'prices', 'history');
const GUIDE = 'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json';
export const SHARDS = 512;
const DAILY_DAYS = 90;

const cents = (v) => (typeof v === 'number' && v > 0 ? Math.round(v * 100) : null);
const dayNum = (d) => Number(d.replace(/-/g, ''));
const dayDate = (n) => new Date(`${String(n).slice(0, 4)}-${String(n).slice(4, 6)}-${String(n).slice(6, 8)}T00:00:00Z`);

async function getGuide(tries = 5) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(GUIDE);
      if (res.ok) return await res.json();
      last = new Error(`HTTP ${res.status}`);
    } catch (err) {
      last = err;
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
  }
  throw last;
}

/** Ab 90 Tagen nur noch der letzte Tag jeder Woche (Montag-basierte Kalenderwoche). */
export function compactDays(days, today) {
  const cutoff = new Date(dayDate(today).getTime() - DAILY_DAYS * 86400000);
  const keep = new Set();
  const lastOfWeek = new Map();
  for (const d of days) {
    const date = dayDate(d);
    if (date >= cutoff) keep.add(d);
    else {
      const monday = new Date(date.getTime() - ((date.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
      const prev = lastOfWeek.get(monday);
      if (!prev || d > prev) lastOfWeek.set(monday, d);
    }
  }
  for (const d of lastOfWeek.values()) keep.add(d);
  return days.filter((d) => keep.has(d));
}

/** Heutigen Stand in eine Datei einfügen (gleicher Tag: überschreiben). Reine Funktion für Tests. */
export function appendDay(file, today, rows) {
  const f = file && file.v === 2 ? file : { v: 2, days: [], t: {}, h: {} };
  let idx = f.days.indexOf(today);
  if (idx < 0) {
    f.days.push(today);
    idx = f.days.length - 1;
    for (const k of ['t', 'h']) for (const id of Object.keys(f[k])) f[k][id].push(null);
  }
  for (const r of rows) {
    for (const [k, v] of [
      ['t', r.t],
      ['h', r.h],
    ]) {
      if (v == null && !f[k][r.id]) continue;
      if (!f[k][r.id]) f[k][r.id] = new Array(f.days.length).fill(null);
      f[k][r.id][idx] = v;
    }
  }
  // verdichten
  const keep = new Set(compactDays(f.days, today));
  const cols = f.days.map((d, i) => (keep.has(d) ? i : -1)).filter((i) => i >= 0);
  if (cols.length !== f.days.length) {
    f.days = cols.map((i) => f.days[i]);
    for (const k of ['t', 'h']) for (const id of Object.keys(f[k])) f[k][id] = cols.map((i) => f[k][id][i]);
  }
  // Produkte ohne einen einzigen Wert entfernen
  for (const k of ['t', 'h']) for (const id of Object.keys(f[k])) if (f[k][id].every((v) => v == null)) delete f[k][id];
  f.updated = `${String(today).slice(0, 4)}-${String(today).slice(4, 6)}-${String(today).slice(6, 8)}`;
  return f;
}

async function main() {
  const guide = await getGuide();
  const today = dayNum((guide.createdAt || new Date().toISOString()).slice(0, 10));
  const byShard = new Map();
  for (const g of guide.priceGuides || []) {
    const t = cents(g.trend);
    const h = cents(g['trend-holo']);
    if (t == null && h == null) continue;
    const s = g.idProduct % SHARDS;
    if (!byShard.has(s)) byShard.set(s, []);
    byShard.get(s).push({ id: String(g.idProduct), t, h });
  }
  await mkdir(OUT, { recursive: true });
  const existing = new Set((await readdir(OUT).catch(() => [])).filter((f) => f.endsWith('.json')));
  let bytes = 0;
  for (let s = 0; s < SHARDS; s++) {
    const name = `${s}.json`;
    const old = existing.has(name) ? JSON.parse(await readFile(join(OUT, name), 'utf8').catch(() => 'null')) : null;
    const out = JSON.stringify(appendDay(old, today, byShard.get(s) || []));
    bytes += out.length;
    await writeFile(join(OUT, name), out);
  }
  console.log(
    `Preis-Historie: ${guide.priceGuides?.length || 0} Produkte, Stand ${today}, ${(bytes / 1024 / 1024).toFixed(1)} MB in ${SHARDS} Dateien`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
