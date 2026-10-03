// Sammlung & Merkliste: Gesamtwert, Wertentwicklung, Preise aktualisieren, Preisalarm, Export.

import { allItems, on, settings, updateItem, recordPortfolio, portfolioHistory, recordPrice, priceKey, replaceAllItems, addItem } from '../store.js';
import { getCard, findSet } from '../api.js';
import { variantsOf, conditionInfo, cardmarketUrl, conditionValue, conditionFactor } from '../pricing.js';
import { LANGS, langInfo } from '../lang.js';
import { $, esc, money, percent, date, haptic, download } from '../util.js';
import { showCard, candidateFromItem, cardNumber, thumbOf } from './result.js';
import { historyChart } from './charts.js';
import { toast } from './toast.js';
import { openSheet, closeSheet } from './sheet.js';
import { db } from '../db.js';

let list = 'collection';
let refreshing = false;

// Wert je Karte im gespeicherten Zustand (Richtwert aus dem Preistrend)
const unit = (i) => conditionValue(i.price, i.condition) || 0;
const value = (i) => unit(i) * (i.qty || 1);

function sortItems(items, mode) {
  const by = {
    value: (a, b) => value(b) - value(a),
    added: (a, b) => (b.addedAt || 0) - (a.addedAt || 0),
    name: (a, b) => a.name.localeCompare(b.name, 'de'),
    set: (a, b) => (b.setDate || '').localeCompare(a.setDate || '') || String(a.localId).localeCompare(String(b.localId), 'de', { numeric: true }),
    change: (a, b) => change(b) - change(a),
  }[mode];
  return items.sort(by || (() => 0));
}

function change(i) {
  if (!i.addedPrice || !i.price) return 0;
  return (i.price - i.addedPrice) / i.addedPrice;
}

async function renderPortfolio(items) {
  const coll = items.filter((i) => i.list === 'collection');
  const total = coll.reduce((s, i) => s + value(i), 0);
  const count = coll.reduce((s, i) => s + (i.qty || 1), 0);
  const base = coll.reduce((s, i) => s + (i.addedPrice != null && i.price != null ? (conditionValue(i.addedPrice, i.condition) || 0) * (i.qty || 1) : 0), 0);
  const cur = coll.reduce((s, i) => s + (i.addedPrice != null && i.price != null ? value(i) : 0), 0);
  const delta = cur - base;
  const buy = coll.reduce((s, i) => s + (i.buyPrice != null ? i.buyPrice * (i.qty || 1) : 0), 0);
  const buyCur = coll.reduce((s, i) => s + (i.buyPrice != null ? value(i) : 0), 0);
  const estimated = coll.some((i) => conditionFactor(i.condition) !== 1);
  const hist = coll.length ? await recordPortfolio(Math.round(total * 100) / 100, count) : await portfolioHistory();
  const top = [...coll].sort((a, b) => value(b) - value(a))[0];
  const last = coll.reduce((m, i) => Math.max(m, i.checkedAt || 0), 0);

  $('#portfolio').innerHTML = `
    <div class="portfolio-k">Sammlungswert</div>
    <div class="portfolio-v"><span class="text-gold">${money(total)}</span></div>
    <div class="portfolio-row">
      <span>${count} ${count === 1 ? 'Karte' : 'Karten'}</span>
      ${base ? `<span class="delta ${delta > 0.005 ? 'up' : delta < -0.005 ? 'down' : 'flat'}">${delta >= 0 ? '▲' : '▼'} ${money(Math.abs(delta))} (${percent(base ? delta / base : 0)})</span><span>seit Hinzufügen</span>` : ''}
    </div>
    ${buy ? `<div class="portfolio-row" style="margin-top:6px"><span>Einkauf ${money(buy)} → Gewinn <b style="color:${buyCur - buy >= 0 ? 'var(--green)' : 'var(--red)'}">${money(buyCur - buy)}</b></span></div>` : ''}
    ${hist.length >= 2 ? `<div class="portfolio-chart">${historyChart(hist)}</div>` : ''}
    ${top ? `<div class="portfolio-row" style="margin-top:10px"><span>Wertvollste Karte: <b style="color:var(--text)">${esc(top.name)}</b> · ${money(unit(top))}</span></div>` : ''}
    ${estimated ? '<div class="portfolio-row" style="margin-top:6px;font-size:12px;color:var(--text-3)">Werte nach Zustand jeder Karte – unter NM als Richtwert geschätzt.</div>' : ''}
    <div class="portfolio-actions">
      <button class="btn btn-small" data-action="refresh-prices">↻ Preise aktualisieren</button>
      <button class="btn btn-small" data-action="export">Exportieren</button>
    </div>
    ${last ? `<div class="portfolio-row" style="margin-top:8px;font-size:12px;color:var(--text-3)">Preise zuletzt geprüft: ${esc(date(last, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))}</div>` : ''}`;
}

function tile(i, idx) {
  const li = langInfo(i.lang);
  const ch = change(i);
  const hit = i.list === 'wish' && i.target && unit(i) && unit(i) <= i.target;
  const cond = conditionInfo(i.condition);
  const img = thumbOf(i);
  return `
    <button class="tile ${hit ? 'is-hit' : ''}" data-uid="${esc(i.uid)}" style="animation-delay:${Math.min(idx, 12) * 30}ms">
      <div class="thumb">
        ${img ? `<img src="${esc(img)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
        ${i.qty > 1 ? `<span class="qty">${i.qty}×</span>` : ''}
        ${i.list === 'wish' && i.target ? '<span class="alarm" title="Preisalarm"><svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/></svg></span>' : ''}
        <span class="lang-badge">${li.flag} ${esc(li.short)} <span class="cond-mini" style="--c:${cond.color}">${esc(cond.short)}</span></span>
      </div>
      <div class="tile-name">${esc(i.name)}</div>
      <div class="tile-set">${esc(i.setName || '')} · ${esc(cardNumber(i.localId, i.official))}</div>
      <div class="tile-price">
        <b>${conditionFactor(i.condition) !== 1 && unit(i) ? '≈ ' : ''}${money(unit(i) || null)}</b>
        ${i.list === 'wish' && i.target ? `<small class="${hit ? 'up' : ''}">Ziel ${money(i.target)}</small>` : ch ? `<small class="${ch > 0 ? 'up' : 'down'}">${percent(ch)}</small>` : ''}
      </div>
    </button>`;
}

export async function renderCollection() {
  const items = await allItems();
  await renderPortfolio(items);
  const langSel = $('#coll-lang');
  const used = [...new Set(items.map((i) => i.lang))];
  const current = langSel.value;
  langSel.innerHTML = `<option value="">Alle Sprachen</option>${LANGS.filter((l) => used.includes(l.code))
    .map((l) => `<option value="${l.code}">${l.flag} ${esc(l.label)}</option>`)
    .join('')}`;
  langSel.value = used.includes(current) ? current : '';

  let shown = items.filter((i) => i.list === list && (!langSel.value || i.lang === langSel.value));
  shown = sortItems(shown, $('#coll-sort').value);
  const grid = $('#coll-grid');
  if (!shown.length) {
    grid.innerHTML =
      list === 'wish'
        ? `<div class="empty"><div class="empty-art">♡</div><h3>Merkliste ist leer</h3><p>Setze Karten aus dem Scan oder der Suche auf die Merkliste und lege einen Preisalarm fest.</p></div>`
        : `<div class="empty"><div class="empty-art">＋</div><h3>Deine Sammlung wartet</h3><p>Scanne deine erste Karte und tippe auf „Sammlung“. Der Gesamtwert wird automatisch berechnet.</p><button class="btn btn-gold" data-goto="scan">Jetzt scannen</button></div>`;
    return;
  }
  grid.innerHTML = shown.map(tile).join('');
}

/** Preise aller Einträge neu laden (max. 4 gleichzeitig). */
export async function refreshPrices({ silent = false } = {}) {
  if (refreshing) return;
  const items = await allItems();
  if (!items.length) {
    if (!silent) toast('Noch keine Karten gespeichert.');
    return;
  }
  refreshing = true;
  const btns = document.querySelectorAll('[data-action="refresh-prices"]');
  btns.forEach((b) => b.classList.add('is-spinning'));
  const groups = new Map();
  for (const i of items) {
    const k = `${i.group}:${i.id}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i);
  }
  const keys = [...groups.keys()];
  let done = 0;
  let failed = 0;
  const alarms = [];
  const worker = async () => {
    while (keys.length) {
      const k = keys.shift();
      const its = groups.get(k);
      const { group, id } = its[0];
      try {
        const card = await getCard(group === 'ja' ? 'ja' : 'en', id, { fresh: true });
        const variants = variantsOf(card);
        for (const it of its) {
          const v = variants.find((x) => x.key === it.variantKey) || variants[0];
          const price = v?.cm?.value ?? it.price;
          await updateItem(it.uid, { price, priceUpdated: v?.cm?.updated || it.priceUpdated, checkedAt: Date.now(), idProduct: v?.cm?.idProduct || it.idProduct });
          if (price) await recordPrice(priceKey(it.group, it.id, v?.key || it.variantKey), price);
          const condPrice = conditionValue(price, it.condition);
          if (it.list === 'wish' && it.target && condPrice && condPrice <= it.target && !(it.alarmedAt && it.alarmedPrice === price)) {
            alarms.push({ ...it, price, condPrice });
            await updateItem(it.uid, { alarmedAt: Date.now(), alarmedPrice: price });
          }
        }
        done++;
      } catch {
        failed++;
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  refreshing = false;
  btns.forEach((b) => b.classList.remove('is-spinning'));
  await db.put('kv', Date.now(), 'lastRefresh');
  if (!silent) {
    haptic([10, 30, 10]);
    toast(failed ? `${done} aktualisiert, ${failed} fehlgeschlagen` : `${done} ${done === 1 ? 'Preis' : 'Preise'} aktualisiert`, { type: failed ? 'error' : 'success' });
  }
  for (const a of alarms.slice(0, 3)) {
    toast(`Preisalarm: ${a.name} (${conditionInfo(a.condition).short}) jetzt ${money(a.condPrice)}`, { type: 'success', ms: 6000, image: thumbOf(a) || undefined });
  }
  if (alarms.length && 'Notification' in window && Notification.permission === 'granted') {
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      const body = alarms.map((a) => `${a.name} (${conditionInfo(a.condition).short}): ${money(a.condPrice)} (Ziel ${money(a.target)})`).join('\n');
      if (reg) reg.showNotification('HoloScan Preisalarm', { body, icon: 'assets/icons/icon-192.png', badge: 'assets/icons/favicon-32.png' });
    } catch {
      /* optional */
    }
  }
}

export async function maybeAutoRefresh() {
  const last = (await db.get('kv', 'lastRefresh')) || 0;
  if (navigator.onLine && Date.now() - last > 12 * 3600 * 1000) refreshPrices({ silent: true });
}

// ---------- Export / Import ----------

function csvCell(v) {
  const s = String(v ?? '');
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function exportCSV() {
  const items = await allItems();
  const head = ['Liste', 'Name', 'Set', 'Nummer', 'Sprache', 'Variante', 'Zustand', 'Anzahl', 'Preistrend (EUR)', 'Preis im Zustand (EUR, Richtwert)', 'Gesamt (EUR)', 'Einkaufspreis (EUR)', 'Preisalarm (EUR)', 'Hinzugefügt', 'Cardmarket'];
  const num = (v) => (v == null ? '' : String(Math.round(v * 100) / 100).replace('.', ','));
  const rows = items.map((i) => [
    i.list === 'wish' ? 'Merkliste' : 'Sammlung',
    i.name,
    i.setName,
    cardNumber(i.localId, i.official),
    langInfo(i.lang).label,
    i.variantLabel || '',
    conditionInfo(i.condition).short,
    i.qty || 1,
    num(i.price),
    num(unit(i) || null),
    num(value(i)),
    num(i.buyPrice),
    num(i.target),
    date(i.addedAt),
    cardmarketUrl({ idProduct: i.idProduct, siteLang: settings.siteLang, cmLang: langInfo(i.lang).cm, minCondition: i.condition, search: i.name }),
  ]);
  const csv = '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n');
  download(`holoscan-sammlung-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv;charset=utf-8');
}

export async function exportJSON() {
  const items = await allItems();
  const data = { app: 'HoloScan', v: 1, exported: new Date().toISOString(), items };
  download(`holoscan-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 1), 'application/json');
}

export async function importJSON(file) {
  const text = await file.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    toast('Die Datei ist kein gültiges HoloScan-Backup.', { type: 'error' });
    return;
  }
  const items = Array.isArray(data) ? data : data.items;
  if (!Array.isArray(items) || !items.every((i) => i && i.uid && i.id && i.name)) {
    toast('Die Datei ist kein gültiges HoloScan-Backup.', { type: 'error' });
    return;
  }
  const root = openSheet(`
    <h3 class="sheet-title">Backup importieren</h3>
    <p class="row-sub" style="margin:-4px 0 16px">${items.length} Einträge gefunden. Wie sollen sie übernommen werden?</p>
    <div class="actions" style="margin-top:0">
      <button class="btn btn-gold btn-span" data-mode="merge">Zur Sammlung hinzufügen</button>
      <button class="btn btn-danger btn-span" data-mode="replace">Sammlung ersetzen</button>
    </div>`);
  root.querySelectorAll('[data-mode]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (b.dataset.mode === 'replace') await replaceAllItems(items);
      else {
        for (const i of items) {
          const { uid: _ignored, ...rest } = i;
          await addItem({ ...rest, qty: rest.qty || 1 });
        }
      }
      closeSheet();
      toast(`${items.length} Einträge importiert`, { type: 'success' });
    }),
  );
}

export function openExport() {
  const root = openSheet(`
    <h3 class="sheet-title">Exportieren</h3>
    <div class="list">
      <button class="row" data-x="csv"><span class="row-icon"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/></svg></span><span class="row-main"><span class="row-title">Tabelle (CSV)</span><div class="row-sub">Für Excel, Numbers oder Google Sheets</div></span></button>
      <button class="row" data-x="json"><span class="row-icon"><svg viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/></svg></span><span class="row-main"><span class="row-title">Backup (JSON)</span><div class="row-sub">Zum Sichern oder Übertragen auf ein anderes Gerät</div></span></button>
    </div>`);
  root.querySelector('[data-x="csv"]').addEventListener('click', () => {
    exportCSV();
    closeSheet();
  });
  root.querySelector('[data-x="json"]').addEventListener('click', () => {
    exportJSON();
    closeSheet();
  });
}

export function initCollection() {
  $('#coll-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-list]');
    if (!b) return;
    list = b.dataset.list;
    $('#coll-tabs')
      .querySelectorAll('.seg-btn')
      .forEach((x) => x.classList.toggle('is-active', x === b));
    haptic(6);
    renderCollection();
  });
  $('#coll-sort').addEventListener('change', renderCollection);
  $('#coll-lang').addEventListener('change', renderCollection);
  $('#coll-grid').addEventListener('click', async (e) => {
    const t = e.target.closest('[data-uid]');
    if (!t) return;
    const item = (await allItems()).find((i) => i.uid === t.dataset.uid);
    if (!item) return;
    haptic(8);
    const set = await findSet(item.group, item.setId);
    showCard({ candidate: candidateFromItem(item, set), lang: item.lang, item, langSource: 'gespeichert' });
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    if (b.dataset.action === 'refresh-prices') refreshPrices();
    if (b.dataset.action === 'export') openExport();
  });
  on('items', () => {
    if (document.getElementById('app').dataset.view === 'collection') renderCollection();
  });
}
