// "Mehr": Installation, Einstellungen, Daten und Infos.

import { settings, saveSettings, clearHistory, wipeAll } from '../store.js';
import { LANGS } from '../lang.js';
import { CONDITIONS } from '../pricing.js';
import { indexInfo, loadCardIndex, loadSets } from '../api.js';
import { warmup } from '../ocr.js';
import { $, esc, date, haptic } from '../util.js';
import { importJSON } from './collection.js';
import { openSheet, closeSheet } from './sheet.js';
import { toast } from './toast.js';

export const APP_VERSION = '1.0.0';

let installPrompt = null;
export function setInstallPrompt(e) {
  installPrompt = e;
  if (document.getElementById('app').dataset.view === 'more') renderMore();
}

const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const I = {
  globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  flag: '<svg viewBox="0 0 24 24"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
  store: '<svg viewBox="0 0 24 24"><path d="M3 9l1.5-5h15L21 9M3 9h18v11H3zM9 20v-6h6v6"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>',
  dollar: '<svg viewBox="0 0 24 24"><path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
  vibe: '<svg viewBox="0 0 24 24"><rect x="7" y="3" width="10" height="18" rx="2"/><path d="M3 8v8M21 8v8"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M12 21V9M7 14l5-5 5 5"/><path d="M5 3h14"/></svg>',
  cloud: '<svg viewBox="0 0 24 24"><path d="M7 18a5 5 0 1 1 .9-9.9A6 6 0 0 1 19 10a4 4 0 0 1 0 8z"/><path d="m9 13 3 3 3-3M12 16V9"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>',
};

function select(id, options, value) {
  return `<label class="select"><select id="${id}">${options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
}

function sw(id, checked) {
  return `<label class="switch"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''}><span></span></label>`;
}

function installCard() {
  if (isStandalone()) return '';
  if (installPrompt) {
    return `<div class="install-card">
      <img src="assets/icons/icon-192.png" alt="">
      <div style="flex:1;min-width:0"><h3>App installieren</h3><p>Startet im Vollbild, schneller und auch offline.</p></div>
      <button class="btn btn-gold btn-small" data-action="install">Installieren</button>
    </div>`;
  }
  if (isIOS()) {
    return `<div class="install-card" style="display:block">
      <div style="display:flex;gap:14px;align-items:center"><img src="assets/icons/icon-192.png" alt=""><div><h3>Auf den Home-Bildschirm</h3><p>So installierst du HoloScan auf dem iPhone:</p></div></div>
      <ol class="ios-steps"><li>Unten in Safari auf <b>Teilen</b> <svg viewBox="0 0 24 24" style="width:16px;height:16px;vertical-align:-3px"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/></svg> tippen</li><li><b>„Zum Home-Bildschirm“</b> wählen</li><li>Mit <b>„Hinzufügen“</b> bestätigen</li></ol>
    </div>`;
  }
  return `<div class="install-card">
    <img src="assets/icons/icon-192.png" alt="">
    <div><h3>Als App nutzen</h3><p>Im Browser-Menü „App installieren“ bzw. „Zum Startbildschirm hinzufügen“ wählen.</p></div>
  </div>`;
}

export async function renderMore() {
  const info = await indexInfo();
  const notif = 'Notification' in window ? Notification.permission : 'unsupported';
  $('#more-root').innerHTML = `
    <h2 class="view-title">Mehr</h2>
    ${installCard()}

    <div class="group">
      <div class="group-title">Scannen & Preise</div>
      <div class="list">
        <div class="row"><span class="row-icon">${I.globe}</span><span class="row-main"><span class="row-title">Kartensprache</span><div class="row-sub">Beim Scannen</div></span>
          ${select('set-scanLang', [['auto', '🌐 Auto'], ...LANGS.map((l) => [l.code, `${l.flag} ${l.label}`])], settings.scanLang)}</div>
        <div class="row"><span class="row-icon">${I.flag}</span><span class="row-main"><span class="row-title">Standardsprache</span><div class="row-sub">Falls nicht erkannt</div></span>
          ${select('set-fallbackLang', LANGS.filter((l) => l.group === 'intl').map((l) => [l.code, `${l.flag} ${l.label}`]), settings.fallbackLang)}</div>
        <div class="row"><span class="row-icon">${I.store}</span><span class="row-main"><span class="row-title">Cardmarket</span><div class="row-sub">Sprache der Website</div></span>
          ${select('set-siteLang', [['de', 'Deutsch'], ['en', 'English'], ['fr', 'Français'], ['es', 'Español'], ['it', 'Italiano']], settings.siteLang)}</div>
        <div class="row"><span class="row-icon">${I.star}</span><span class="row-main"><span class="row-title">Mindestzustand</span><div class="row-sub">Für Cardmarket-Angebote (NM = Near Mint)</div></span>
          ${select('set-condition', CONDITIONS.map((c) => [c.id, `ab ${c.short}`]), settings.condition)}</div>
        <div class="row"><span class="row-icon">${I.dollar}</span><span class="row-main"><span class="row-title">TCGplayer-Preis zeigen</span><div class="row-sub">US-Marktpreis in Dollar als Vergleich</div></span>${sw('set-showUSD', settings.showUSD)}</div>
        <div class="row"><span class="row-icon">${I.vibe}</span><span class="row-main"><span class="row-title">Vibration</span><div class="row-sub">Haptisches Feedback beim Scannen</div></span>${sw('set-haptics', settings.haptics)}</div>
        ${
          notif !== 'unsupported'
            ? `<button class="row" data-action="notif"><span class="row-icon">${I.bell}</span><span class="row-main"><span class="row-title">Preisalarm-Benachrichtigungen</span><div class="row-sub">${notif === 'granted' ? 'Aktiv – Alarme der Merkliste werden beim Öffnen geprüft' : notif === 'denied' ? 'Im Browser blockiert' : 'Tippen zum Aktivieren'}</div></span></button>`
            : ''
        }
      </div>
    </div>

    <div class="group">
      <div class="group-title">Daten</div>
      <div class="list">
        <button class="row" data-action="export"><span class="row-icon">${I.down}</span><span class="row-main"><span class="row-title">Sammlung exportieren</span><div class="row-sub">CSV für Excel oder JSON-Backup</div></span></button>
        <button class="row" data-action="import"><span class="row-icon">${I.up}</span><span class="row-main"><span class="row-title">Backup importieren</span><div class="row-sub">JSON-Datei aus HoloScan</div></span></button>
        <button class="row" data-action="offline"><span class="row-icon">${I.cloud}</span><span class="row-main"><span class="row-title">Offline-Paket laden</span><div class="row-sub">Kartenindex aller Sprachen und Texterkennung vorab speichern</div></span></button>
        <button class="row" data-action="clear-hist"><span class="row-icon">${I.clock}</span><span class="row-main"><span class="row-title">Scan-Verlauf löschen</span></span></button>
        <button class="row" data-action="wipe"><span class="row-icon" style="color:var(--red)">${I.trash}</span><span class="row-main"><span class="row-title" style="color:var(--red)">Alle Daten löschen</span><div class="row-sub">Sammlung, Merkliste, Verlauf und Einstellungen</div></span></button>
      </div>
      <input type="file" id="import-input" accept="application/json,.json" hidden>
    </div>

    <div class="group">
      <div class="group-title">So funktioniert's</div>
      <div class="note">
        <b>Erkennung:</b> Die Texterkennung läuft direkt auf deinem Gerät. HoloScan liest Kartennummer (z. B. 025/165), Set-Kürzel, Namen und typische Begriffe wie „Schwäche“, „Weakness“ oder „KP/HP“ und bestimmt daraus Karte und Sprache.<br><br>
        <b>Preise:</b> Angezeigt wird der Cardmarket-Preisguide (Trend, Durchschnitte, Ab-Preis), täglich aktualisiert über TCGdex. Europäische Sprachversionen teilen sich bei Cardmarket ein Produkt – über den Link siehst du gezielt Angebote in der Sprache deiner Karte. Japanische Karten haben eigene Produkte und eigene Preise.
      </div>
    </div>

    <div class="about">
      <img src="assets/icons/icon.svg" alt="">
      <div><b style="color:var(--text)">HoloScan</b> · Version ${APP_VERSION}</div>
      ${info?.generated ? `<div>Kartenindex vom ${esc(date(info.generated))} · ${Object.values(info.langs || {}).reduce((a, b) => Math.max(a, b), 0).toLocaleString('de-DE')} Karten</div>` : ''}
      <div>Kartendaten & Preise: <a href="https://tcgdex.dev" target="_blank" rel="noopener">TCGdex</a> (Cardmarket-Preisguide) · Texterkennung: Tesseract.js</div>
      <div style="margin-top:8px">Inoffizielles Fanprojekt. Pokémon und alle zugehörigen Namen sind Marken von Nintendo, Creatures Inc., GAME FREAK und The Pokémon Company. Nicht verbunden mit Cardmarket. Preise ohne Gewähr.</div>
    </div>`;
  bind();
}

function bind() {
  const root = $('#more-root');
  const onChange = (id, key, map = (v) => v) =>
    root.querySelector(`#${id}`)?.addEventListener('change', async (e) => {
      const el = e.target;
      await saveSettings({ [key]: map(el.type === 'checkbox' ? el.checked : el.value) });
      haptic(6);
    });
  onChange('set-scanLang', 'scanLang');
  onChange('set-fallbackLang', 'fallbackLang');
  onChange('set-siteLang', 'siteLang');
  onChange('set-condition', 'condition', Number);
  onChange('set-showUSD', 'showUSD');
  onChange('set-haptics', 'haptics');

  const act = (name, fn) => root.querySelector(`[data-action="${name}"]`)?.addEventListener('click', fn);
  act('install', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice.catch(() => ({}));
    installPrompt = null;
    if (outcome === 'accepted') toast('HoloScan wird installiert ✨', { type: 'success' });
    renderMore();
  });
  act('notif', async () => {
    try {
      const p = await Notification.requestPermission();
      toast(p === 'granted' ? 'Benachrichtigungen aktiviert' : 'Benachrichtigungen nicht erlaubt', { type: p === 'granted' ? 'success' : 'error' });
    } catch {
      /* egal */
    }
    renderMore();
  });
  act('import', () => root.querySelector('#import-input').click());
  root.querySelector('#import-input').addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) importJSON(f);
  });
  act('offline', async (e) => {
    const row = e.currentTarget;
    const sub = row.querySelector('.row-sub');
    sub.textContent = 'Wird geladen …';
    try {
      await loadSets();
      let n = 0;
      for (const l of LANGS) {
        await loadCardIndex(l.code);
        sub.textContent = `Kartenindex ${++n}/${LANGS.length} …`;
      }
      sub.textContent = 'Texterkennung wird geladen …';
      const ok = await warmup();
      sub.textContent = ok ? 'Fertig – Suche und Erkennung funktionieren jetzt offline.' : 'Index gespeichert, Texterkennung fehlgeschlagen.';
      toast('Offline-Paket gespeichert', { type: 'success' });
    } catch {
      sub.textContent = 'Fehlgeschlagen – bitte mit Internet erneut versuchen.';
    }
  });
  act('clear-hist', async () => {
    await clearHistory();
    toast('Verlauf gelöscht');
  });
  act('wipe', () => {
    const s = openSheet(`
      <h3 class="sheet-title">Alle Daten löschen?</h3>
      <p class="row-sub" style="margin:-4px 0 16px">Sammlung, Merkliste, Verlauf, Preisverläufe und Einstellungen werden auf diesem Gerät gelöscht. Exportiere vorher ein Backup, wenn du sie behalten willst.</p>
      <div class="actions" style="margin-top:0">
        <button class="btn btn-danger btn-span" data-confirm>Endgültig löschen</button>
        <button class="btn btn-ghost btn-span" data-cancel>Abbrechen</button>
      </div>`);
    s.querySelector('[data-confirm]').addEventListener('click', async () => {
      await wipeAll();
      closeSheet();
      renderMore();
      toast('Alle Daten gelöscht');
    });
    s.querySelector('[data-cancel]').addEventListener('click', () => closeSheet());
  });
}

