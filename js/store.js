// App-Daten: Einstellungen, Sammlung/Merkliste, Scan-Verlauf und Preisverläufe.

import { db } from './db.js';
import { uid, today } from './util.js';

const DEFAULTS = {
  scanLang: 'auto', // Kartensprache beim Scannen: 'auto' oder Sprachcode
  fallbackLang: 'de', // falls die Sprache nicht erkannt wird
  searchLang: 'de',
  siteLang: 'de', // Sprache der Cardmarket-Website
  condition: 2, // Mindestzustand für Cardmarket-Links (2 = Near Mint)
  haptics: true,
  autoScan: false,
  batch: false,
  showUSD: true,
  conditionFactors: null, // eigene Abschläge je Zustand {id: Faktor}, sonst Standard
};

export const settings = { ...DEFAULTS };

const listeners = new Map();
export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return () => listeners.get(evt).delete(fn);
}
export function emit(evt, data) {
  listeners.get(evt)?.forEach((fn) => {
    try {
      fn(data);
    } catch (err) {
      console.error(err);
    }
  });
}

export async function loadSettings() {
  try {
    Object.assign(settings, (await db.get('kv', 'settings')) || {});
  } catch {
    /* Standardwerte */
  }
  document.documentElement.dataset.haptics = settings.haptics ? 'on' : 'off';
  return settings;
}

export async function saveSettings(patch) {
  Object.assign(settings, patch);
  document.documentElement.dataset.haptics = settings.haptics ? 'on' : 'off';
  await db.put('kv', { ...settings }, 'settings');
  emit('settings', settings);
}

// ---------- Sammlung & Merkliste ----------

export async function allItems(list) {
  const items = (await db.all('items')) || [];
  return list ? items.filter((i) => i.list === list) : items;
}

const sameSlot = (a, b) =>
  a.list === b.list && a.id === b.id && a.group === b.group && a.lang === b.lang && a.variantKey === b.variantKey && Number(a.condition) === Number(b.condition);

/** Fügt eine Karte hinzu; gleiche Karte/Variante/Sprache/Zustand erhöht die Anzahl. */
export async function addItem(data) {
  const items = await allItems();
  const existing = items.find((i) => sameSlot(i, data));
  if (existing) {
    existing.qty = (existing.qty || 1) + (data.qty || 1);
    if (data.price != null) {
      existing.price = data.price;
      existing.priceUpdated = data.priceUpdated;
      existing.checkedAt = Date.now();
    }
    await db.put('items', existing);
    emit('items');
    return { item: existing, merged: true };
  }
  const item = {
    uid: uid(),
    list: 'collection',
    qty: 1,
    condition: 2,
    addedAt: Date.now(),
    checkedAt: Date.now(),
    addedPrice: data.price ?? null,
    ...data,
  };
  await db.put('items', item);
  emit('items');
  return { item, merged: false };
}

export async function updateItem(id, patch) {
  const item = await db.get('items', id);
  if (!item) return null;
  Object.assign(item, patch);
  await db.put('items', item);
  emit('items');
  return item;
}

export async function removeItem(id) {
  await db.del('items', id);
  emit('items');
}

export async function replaceAllItems(items) {
  await db.clear('items');
  await db.putMany('items', items);
  emit('items');
}

// ---------- Scan-Verlauf ----------

const HISTORY_MAX = 150;

export async function addHistory(entry) {
  const rec = { uid: uid(), at: Date.now(), ...entry };
  await db.put('history', rec);
  const all = await db.all('history');
  if (all.length > HISTORY_MAX) {
    all.sort((a, b) => a.at - b.at);
    for (const old of all.slice(0, all.length - HISTORY_MAX)) await db.del('history', old.uid);
  }
  emit('history');
  return rec;
}

export async function allHistory() {
  const all = (await db.all('history')) || [];
  return all.sort((a, b) => b.at - a.at);
}

export async function clearHistory() {
  await db.clear('history');
  emit('history');
}

// ---------- Preisverläufe (eigene Abrufe, ein Punkt pro Tag) ----------

export const priceKey = (group, id, variantKey) => `${group}:${id}:${variantKey}`;

export async function recordPrice(key, value) {
  if (!value) return;
  const points = (await db.get('prices', key)) || [];
  const d = today();
  const last = points[points.length - 1];
  if (last?.d === d) last.v = value;
  else points.push({ d, v: value });
  await db.put('prices', points.slice(-365), key);
}

export async function priceHistory(key) {
  return (await db.get('prices', key)) || [];
}

export async function recordPortfolio(value, count) {
  const points = (await db.get('kv', 'portfolio')) || [];
  const d = today();
  const last = points[points.length - 1];
  if (last?.d === d) Object.assign(last, { v: value, n: count });
  else points.push({ d, v: value, n: count });
  await db.put('kv', points.slice(-730), 'portfolio');
  return points;
}

export async function portfolioHistory() {
  return (await db.get('kv', 'portfolio')) || [];
}

export async function wipeAll() {
  await Promise.all(['items', 'history', 'prices', 'kv'].map((s) => db.clear(s)));
  Object.assign(settings, DEFAULTS);
  emit('items');
  emit('history');
  emit('settings', settings);
}
