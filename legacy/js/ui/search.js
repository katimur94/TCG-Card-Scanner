// Manuelle Suche nach Name, Nummer oder Set-Kürzel – offline über den Kartenindex.

import { searchCards } from '../identify.js';
import { guessImage } from '../api.js';
import { LANGS, langInfo } from '../lang.js';
import { settings, saveSettings } from '../store.js';
import { $, esc, debounce, haptic } from '../util.js';
import { showCard, cardNumber, imgTag } from './result.js';
import { openSheet, closeSheet } from './sheet.js';

let results = [];
let shown = 0;
let seq = 0;
const PAGE = 40;

function setName(set, lang) {
  return set?.nl?.[lang] || set?.n || '';
}

function tile(r, i) {
  const lang = r.group === 'ja' ? 'ja' : settings.searchLang;
  const img = r.hasImage === false ? null : guessImage(lang, r.set, r.localId, 'low');
  const fb = r.group === 'ja' ? null : guessImage('en', r.set, r.localId, 'low');
  return `
    <button class="tile" data-r="${i}" style="animation-delay:${Math.min(i % PAGE, 12) * 25}ms">
      <div class="thumb">${imgTag(img || fb, fb)}</div>
      <div class="tile-name">${esc(r.name)}</div>
      <div class="tile-set">${esc(setName(r.set, lang))}</div>
      <div class="tile-set">${esc(cardNumber(r.localId, r.set?.o))}${r.set?.d ? ` · ${esc(r.set.d.slice(0, 4))}` : ''}</div>
    </button>`;
}

function renderMore() {
  const box = $('#search-results');
  const next = results.slice(shown, shown + PAGE);
  box.querySelector('[data-more]')?.remove();
  box.insertAdjacentHTML('beforeend', next.map((r, k) => tile(r, shown + k)).join(''));
  shown += next.length;
  if (shown < results.length) {
    box.insertAdjacentHTML('beforeend', `<button class="btn btn-outline btn-block" data-more style="grid-column:1/-1">Weitere ${Math.min(PAGE, results.length - shown)} anzeigen</button>`);
  }
}

async function run(q) {
  const my = ++seq;
  const box = $('#search-results');
  const query = q.trim();
  $('#search-hints').hidden = !!query;
  if (query.length < 2) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = '<div class="search-status">Suche läuft …</div>';
  try {
    const list = await searchCards(query, settings.searchLang);
    if (my !== seq) return;
    results = list;
    shown = 0;
    if (!list.length) {
      box.innerHTML = `<div class="empty"><h3>Nichts gefunden</h3><p>Prüfe die Schreibweise oder wechsle die Sprache (${langInfo(settings.searchLang).flag}). Tipp: Nummern wie „25/165“ oder „MEW 25“ funktionieren auch.</p></div>`;
      return;
    }
    box.innerHTML = `<div class="search-status">${list.length >= 120 ? 'Über 100' : list.length} Treffer · ${langInfo(settings.searchLang).flag} ${esc(langInfo(settings.searchLang).label)}</div>`;
    renderMore();
  } catch (err) {
    if (my !== seq) return;
    console.error(err);
    box.innerHTML = '<div class="empty"><h3>Kartenindex nicht verfügbar</h3><p>Bitte prüfe deine Internetverbindung – der Index wird beim ersten Mal geladen und danach offline gespeichert.</p></div>';
  }
}

const runDebounced = debounce(run, 220);

function updateLangBtn() {
  const l = langInfo(settings.searchLang);
  $('#btn-search-lang').innerHTML = `<span class="flag">${l.flag}</span><span>${esc(l.short)}</span>`;
}

function pickLang() {
  const root = openSheet(`
    <h3 class="sheet-title">Suchsprache</h3>
    <p class="row-sub" style="margin:-6px 0 14px">Kartennamen werden in dieser Sprache gesucht (z. B. „Glurak“ auf Deutsch, „Charizard“ auf Englisch).</p>
    <div class="lang-grid">${LANGS.map((l) => `<button class="lang-opt ${settings.searchLang === l.code ? 'is-active' : ''}" data-code="${l.code}"><span class="flag">${l.flag}</span>${esc(l.label)}</button>`).join('')}</div>`);
  root.querySelectorAll('[data-code]').forEach((b) =>
    b.addEventListener('click', async () => {
      await saveSettings({ searchLang: b.dataset.code });
      updateLangBtn();
      closeSheet();
      run($('#search-input').value);
    }),
  );
}

export function focusSearch(q) {
  const input = $('#search-input');
  if (q != null) {
    input.value = q;
    run(q);
  }
  setTimeout(() => input.focus(), 250);
}

export function initSearch() {
  updateLangBtn();
  const input = $('#search-input');
  input.addEventListener('input', () => runDebounced(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      input.blur();
      run(input.value);
    }
  });
  $('#btn-search-lang').addEventListener('click', pickLang);
  $('#search-hints').addEventListener('click', (e) => {
    const b = e.target.closest('[data-q]');
    if (!b) return;
    input.value = b.dataset.q;
    run(b.dataset.q);
  });
  $('#search-results').addEventListener('click', (e) => {
    if (e.target.closest('[data-more]')) {
      renderMore();
      return;
    }
    const t = e.target.closest('[data-r]');
    if (!t) return;
    const r = results[Number(t.dataset.r)];
    if (!r) return;
    haptic(8);
    const lang = r.group === 'ja' ? 'ja' : settings.searchLang;
    const cand = { ...r, key: `${r.group}:${r.setId}:${r.localId}` };
    showCard({ candidate: cand, lang, langSource: 'aus der Suche', alternatives: [] });
  });
}
