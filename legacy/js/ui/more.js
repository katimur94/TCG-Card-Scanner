// "Mehr": Installation, Einstellungen, Daten und Infos.

import { settings, saveSettings, clearHistory, wipeAll } from '../store.js';
import { LANGS } from '../lang.js';
import { CONDITIONS, DEFAULT_CONDITION_FACTORS, conditionFactor } from '../pricing.js';
import { indexInfo, loadCardIndex, loadSets } from '../api.js';
import { warmup } from '../ocr.js';
import { warmupVision } from '../vision.js';
import { readCardAI, DEFAULT_AI_MODEL } from '../ai.js';
import { BUILTIN_AI_KEY } from '../ai-config.js';
import { $, esc, date, haptic } from '../util.js';
import { importJSON } from './collection.js';
import { openSheet, closeSheet } from './sheet.js';
import { toast } from './toast.js';

export const APP_VERSION = '1.1.0';

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
  percent: '<svg viewBox="0 0 24 24"><path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>',
  spark: '<svg viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
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
        <div class="row"><span class="row-icon">${I.star}</span><span class="row-main"><span class="row-title">Zustand</span><div class="row-sub">Standard für neue Karten, Serienscan und Angebote</div></span>
          ${select('set-condition', CONDITIONS.map((c) => [c.id, c.label]), settings.condition)}</div>
        <button class="row" data-action="cond-factors"><span class="row-icon">${I.percent}</span><span class="row-main"><span class="row-title">Preise je Zustand</span><div class="row-sub">${esc(CONDITIONS.filter((c) => c.id > 2).map((c) => `${c.short} ${Math.round(conditionFactor(c.id) * 100)} %`).join(' · '))}</div></span></button>
        <div class="row"><span class="row-icon">${I.eye}</span><span class="row-main"><span class="row-title">Bilderkennung</span><div class="row-sub">Erkennt Karte und Sprache am Bild, auch wenn Text unleserlich ist – lädt einmalig ca. 30 MB</div></span>${sw('set-vision', settings.vision)}</div>
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
      <div class="group-title">KI-Leser (Gemma)</div>
      <div class="note ai-box">
        <p style="margin:0 0 10px">Ein Bild-Sprachmodell liest Name, Nummer und Sprache der Karte – hilft bei Spiegelungen, Toploadern und unklarer Sprache. Kostenlos mit eigenem <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">OpenRouter-Schlüssel</a>.</p>
        <div class="field">
          <label for="set-aiKey">API-Schlüssel</label>
          <div class="key-row">
            <input id="set-aiKey" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${BUILTIN_AI_KEY ? 'optional – eingebauter Schlüssel aktiv' : 'sk-or-v1-…'}" value="${esc(settings.aiKey || '')}">
            <button class="btn btn-small" data-action="ai-show" type="button" aria-label="Schlüssel anzeigen">${I.eye}</button>
          </div>
        </div>
        <div class="field" style="margin-top:10px">
          <label for="set-aiModel">Modell</label>
          <input id="set-aiModel" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(settings.aiModel || DEFAULT_AI_MODEL)}">
        </div>
        <div class="key-row" style="margin-top:10px">
          ${select('set-aiMode', [['auto', 'Nur wenn unsicher'], ['always', 'Bei jedem Scan']], settings.aiMode)}
          <button class="btn btn-gold btn-small" data-action="ai-test" type="button">Testen</button>
        </div>
        <p class="ai-status" style="margin:10px 0 0">${settings.aiKey ? '✓ Eigener Schlüssel gespeichert – der KI-Leser ist aktiv.' : BUILTIN_AI_KEY ? '✓ Eingebauter Schlüssel aktiv – du musst nichts eintragen.' : 'Ohne Schlüssel ist der KI-Leser aus.'}</p>
        <p style="margin:8px 0 0;color:var(--text-3);font-size:12px">Der Schlüssel bleibt nur auf diesem Gerät. Beim Einsatz wird das Bild der Karte an OpenRouter und den Modellanbieter gesendet. Kostenlose Modelle haben ein Tageslimit.</p>
      </div>
    </div>

    <div class="group">
      <div class="group-title">Daten</div>
      <div class="list">
        <button class="row" data-action="export"><span class="row-icon">${I.down}</span><span class="row-main"><span class="row-title">Sammlung exportieren</span><div class="row-sub">CSV für Excel oder JSON-Backup</div></span></button>
        <button class="row" data-action="import"><span class="row-icon">${I.up}</span><span class="row-main"><span class="row-title">Backup importieren</span><div class="row-sub">JSON-Datei aus HoloScan</div></span></button>
        <button class="row" data-action="offline"><span class="row-icon">${I.cloud}</span><span class="row-main"><span class="row-title">Offline-Paket laden</span><div class="row-sub">Kartenindex aller Sprachen, Text- und Bilderkennung vorab speichern</div></span></button>
        <button class="row" data-action="clear-hist"><span class="row-icon">${I.clock}</span><span class="row-main"><span class="row-title">Scan-Verlauf löschen</span></span></button>
        <button class="row" data-action="wipe"><span class="row-icon" style="color:var(--red)">${I.trash}</span><span class="row-main"><span class="row-title" style="color:var(--red)">Alle Daten löschen</span><div class="row-sub">Sammlung, Merkliste, Verlauf und Einstellungen</div></span></button>
      </div>
      <input type="file" id="import-input" accept="application/json,.json" hidden>
    </div>

    <div class="group">
      <div class="group-title">So funktioniert's</div>
      <div class="note">
        <b>Erkennung:</b> Alles läuft direkt auf deinem Gerät, es werden keine Fotos hochgeladen. HoloScan findet die Kanten der Karte, rückt sie gerade und vergleicht das Bild mit rund 24.000 Kartenbildern. Gleichzeitig liest die Texterkennung Kartennummer (z. B. 025/165), Set-Kürzel, Namen und Begriffe wie „Schwäche“ oder „KP/HP“ – das unterscheidet Nachdrucke mit gleichem Motiv. Die Sprache erkennt HoloScan am Text und, wenn der unleserlich ist, an der Form der Textzeilen im Vergleich zu allen Sprachausgaben der Karte.<br><br>
        <b>Preise:</b> Angezeigt wird der Cardmarket-Preisguide (Trend, Durchschnitte, Ab-Preis), täglich aktualisiert über TCGdex. Europäische Sprachversionen teilen sich bei Cardmarket ein Produkt – über den Link siehst du gezielt Angebote in der Sprache deiner Karte. Japanische Karten haben eigene Produkte und eigene Preise.
      </div>
    </div>

    <div class="about">
      <img src="assets/icons/icon.svg" alt="">
      <div><b style="color:var(--text)">HoloScan</b> · Version ${APP_VERSION}</div>
      ${info?.generated ? `<div>Kartenindex vom ${esc(date(info.generated))} · ${Object.values(info.langs || {}).reduce((a, b) => Math.max(a, b), 0).toLocaleString('de-DE')} Karten</div>` : ''}
      <div>Kartendaten & Preise: <a href="https://tcgdex.dev" target="_blank" rel="noopener">TCGdex</a> (Cardmarket-Preisguide) · Texterkennung: Tesseract.js · Bilderkennung: DINOv2 (Meta), ONNX Runtime</div>
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
  onChange('set-vision', 'vision');
  onChange('set-aiMode', 'aiMode');
  const aiStatus = (t) => {
    const el = root.querySelector('.ai-status');
    if (el) el.textContent = t;
  };
  root.querySelector('#set-aiKey')?.addEventListener('change', async (e) => {
    const key = e.target.value.trim();
    await saveSettings({ aiKey: key });
    aiStatus(key ? '✓ Eigener Schlüssel gespeichert – der KI-Leser ist aktiv.' : BUILTIN_AI_KEY ? '✓ Eingebauter Schlüssel aktiv.' : 'Ohne Schlüssel ist der KI-Leser aus.');
    haptic(6);
  });
  root.querySelector('#set-aiModel')?.addEventListener('change', async (e) => {
    await saveSettings({ aiModel: e.target.value.trim() || DEFAULT_AI_MODEL });
  });

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
  act('cond-factors', openConditionFactors);
  act('ai-show', () => {
    const el = root.querySelector('#set-aiKey');
    el.type = el.type === 'password' ? 'text' : 'password';
  });
  act('ai-test', async (e) => {
    const btn = e.currentTarget;
    const key = root.querySelector('#set-aiKey').value.trim() || BUILTIN_AI_KEY;
    if (!key) return aiStatus('Bitte zuerst einen Schlüssel eintragen.');
    await saveSettings({ aiKey: root.querySelector('#set-aiKey').value.trim(), aiModel: root.querySelector('#set-aiModel').value.trim() || DEFAULT_AI_MODEL });
    btn.disabled = true;
    aiStatus('Teste Verbindung …');
    try {
      // Testbild: HoloScan-Icon (ohne fremde Bilder, daher ohne CORS-Probleme)
      const img = new Image();
      img.src = 'assets/icons/icon-192.png';
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      c.getContext('2d').drawImage(img, 0, 0);
      const r = await readCardAI(c, { key, model: settings.aiModel });
      aiStatus(`✓ Funktioniert (${r.model}, ${(r.ms / 1000).toFixed(1)} s) – der KI-Leser ist aktiv.`);
    } catch (err) {
      aiStatus(`✗ ${err.message}`);
    } finally {
      btn.disabled = false;
    }
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
      let ok = await warmup();
      if (ok && settings.vision) {
        sub.textContent = 'Bilderkennung wird geladen (ca. 30 MB) …';
        ok = await warmupVision();
      }
      sub.textContent = ok ? 'Fertig – Suche und Erkennung funktionieren jetzt offline.' : 'Index gespeichert, Erkennung fehlgeschlagen – bitte erneut versuchen.';
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


/** Abschläge je Zustand bearbeiten (Prozent vom Cardmarket-Preistrend). */
function openConditionFactors() {
  const rows = CONDITIONS.map(
    (c) => `
      <div class="row">
        <span class="cond-badge" style="--c:${c.color}">${esc(c.short)}</span>
        <span class="row-main"><span class="row-title">${esc(c.label)}</span>${c.id === 2 ? '<div class="row-sub">Basis = Cardmarket-Preistrend</div>' : ''}</span>
        <label class="pct-input"><input type="number" inputmode="numeric" min="5" max="150" step="1" data-f="${c.id}" value="${Math.round(conditionFactor(c.id) * 100)}"><span>%</span></label>
      </div>`,
  ).join('');
  const root = openSheet(`
    <h3 class="sheet-title">Preise je Zustand</h3>
    <p class="row-sub" style="margin:-6px 0 14px">Cardmarket veröffentlicht keine Preise je Zustand. HoloScan rechnet deshalb mit diesen Anteilen vom Preistrend. Passe sie an deine Erfahrung an – die echten Angebote siehst du über „Angebote“ in jeder Karte.</p>
    <div class="list">${rows}</div>
    <div class="actions">
      <button class="btn btn-gold btn-span" data-save>Speichern</button>
      <button class="btn btn-ghost btn-span" data-reset>Standardwerte</button>
    </div>`);
  root.querySelector('[data-save]').addEventListener('click', async () => {
    const factors = {};
    root.querySelectorAll('[data-f]').forEach((inp) => {
      const v = Math.min(150, Math.max(5, parseFloat(String(inp.value).replace(',', '.')) || 0));
      factors[inp.dataset.f] = Math.round(v) / 100;
    });
    const same = Object.entries(DEFAULT_CONDITION_FACTORS).every(([k, v]) => factors[k] === v);
    await saveSettings({ conditionFactors: same ? null : factors });
    haptic([10, 30, 10]);
    closeSheet();
    renderMore();
    toast('Zustands-Anteile gespeichert', { type: 'success' });
  });
  root.querySelector('[data-reset]').addEventListener('click', () => {
    root.querySelectorAll('[data-f]').forEach((inp) => {
      inp.value = Math.round(DEFAULT_CONDITION_FACTORS[inp.dataset.f] * 100);
    });
    haptic(6);
  });
}
