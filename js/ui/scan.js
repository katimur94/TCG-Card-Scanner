// Scanner-Ansicht: Kamera, Auslöser, Galerie, Serienscan, Auto-Scan und Verlauf.

import { Camera, AutoTrigger } from '../camera.js';
import { PhotoAligner } from './align.js';
import { warmup } from '../ocr.js';
import { recognize } from '../recognize.js';
import { warmupVision, warpCard } from '../vision.js';
import { LANGS, langInfo } from '../lang.js';
import { conditionInfo, conditionValue, conditionFactor } from '../pricing.js';
import { findSet, guessImage } from '../api.js';
import { settings, saveSettings, addHistory, allHistory, clearHistory, addItem } from '../store.js';
import { $, esc, money, haptic, relTime } from '../util.js';
import { showCard, loadCardData, bestValue, candidateFromItem, cardNumber, imgTag, imageFields, thumbOf } from './result.js';
import { openSheet, closeSheet } from './sheet.js';
import { toast } from './toast.js';

let camera;
let auto;
let aligner;
let busy = false;
let wantCamera = false;
const batch = [];

const stage = () => $('#stage');

function setStatus(text, sub = '') {
  const box = $('#stage-status');
  if (!text) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  $('#status-text').textContent = text;
  $('#status-sub').textContent = sub;
}

function updateLangChip() {
  const code = settings.scanLang;
  const l = code === 'auto' ? null : langInfo(code);
  $('#scan-lang-flag').textContent = l ? l.flag : '🌐';
  $('#scan-lang-label').textContent = l ? l.short : 'Auto';
}

function updateToggles() {
  $('#btn-batch').setAttribute('aria-pressed', String(!!settings.batch));
  $('#btn-auto').setAttribute('aria-pressed', String(!!settings.autoScan));
  $('#batch-tray').hidden = !settings.batch;
  stage().classList.toggle('is-auto', !!settings.autoScan && camera?.active);
  if (settings.autoScan && camera?.active) auto?.start();
  else auto?.stop();
}

// ---------- Kamera ----------

export async function startCamera() {
  wantCamera = true;
  const intro = $('#camera-intro');
  const errEl = $('#camera-error');
  try {
    await camera.start();
    intro.hidden = true;
    errEl.hidden = true;
    stage().classList.add('is-ready');
    $('#btn-torch').disabled = !camera.hasTorch;
    updateToggles();
    // OCR-Engine und Bilderkennung schon vorladen, damit der erste Scan schnell ist
    setTimeout(() => warmup().then(() => settings.vision && warmupVision()), 400);
  } catch (err) {
    console.warn(err);
    wantCamera = false;
    intro.hidden = false;
    errEl.hidden = false;
    errEl.textContent =
      err?.name === 'NotAllowedError'
        ? 'Kein Kamerazugriff. Bitte erlaube die Kamera in den Browser-Einstellungen – oder wähle ein Foto aus.'
        : err?.name === 'NotFoundError'
          ? 'Keine Kamera gefunden. Du kannst stattdessen ein Foto auswählen.'
          : 'Die Kamera konnte nicht gestartet werden. Wähle alternativ ein Foto aus.';
  }
}

export function pauseCamera() {
  auto?.stop();
  if (camera?.active) {
    camera.stop();
    stage().classList.remove('is-ready', 'is-auto');
    $('#btn-torch').setAttribute('aria-pressed', 'false');
  }
}

export async function resumeCamera() {
  if (!wantCamera || camera?.active || aligner?.active) return;
  try {
    const perm = await navigator.permissions?.query({ name: 'camera' }).catch(() => null);
    if (perm && perm.state === 'denied') return;
  } catch {
    /* egal */
  }
  await startCamera();
}

async function autoStartIfGranted() {
  try {
    const perm = await navigator.permissions?.query({ name: 'camera' });
    if (perm?.state === 'granted') await startCamera();
  } catch {
    /* Permissions-API nicht verfügbar (z. B. ältere Safari-Versionen) */
  }
}

// ---------- Erkennung ----------

/** Kamerabild während der Auswertung einfrieren. */
function freezeCamera() {
  camera.snapshot($('#freeze'));
  stage().classList.add('is-frozen');
}

let aiErrorShown = false;

async function process(canvas, { fitToText = false } = {}) {
  if (busy) return;
  busy = true;
  auto?.pause(true);
  stage().classList.add('is-busy');
  haptic(15);
  setStatus('Karte wird analysiert …');
  try {
    const result = await recognize(canvas, {
      fitToText,
      scanLang: settings.scanLang,
      fallback: settings.fallbackLang,
      useVision: settings.vision,
      ai: settings.aiKey ? { key: settings.aiKey, model: settings.aiModel, mode: settings.aiMode } : null,
      onStatus: (text, p) => text && setStatus(text, p != null && p < 1 && p > 0 ? `${Math.round(p * 100)} %` : ''),
    });
    window.__holoscanLast = result;
    if (result.aiError && !aiErrorShown) {
      aiErrorShown = true;
      toast(`KI-Leser: ${result.aiError}`, { type: 'info', ms: 4000 });
    }
    console.debug('[HoloScan]', result);
    const { cands, best, cardLang, langSource, parsed } = result;
    // eigenes Foto der Karte – wird gezeigt, wenn es in der Datenbank kein Bild gibt
    const scanImage = scanThumb(canvas, result.vision?.quad);

    if (!best) {
      haptic([30, 60, 30]);
      const guess = parsed.nameLines[0]?.text || '';
      toast('Karte nicht erkannt – besseres Licht, Karte ganz in den Rahmen.', {
        type: 'error',
        ms: 5000,
        action: { label: 'Suchen', fn: () => document.dispatchEvent(new CustomEvent('holoscan:search', { detail: guess })) },
      });
      return;
    }

    const unsure = best.confidence < 0.45 && cands.length > 1;
    if (settings.batch) {
      setStatus('Preis wird geladen …');
      await addToBatch(best, cardLang, unsure, scanImage);
    } else if (unsure) {
      haptic([12, 40, 12]);
      pickCandidate(cands, cardLang, langSource, scanImage);
    } else {
      haptic([12, 40, 12]);
      openScanResult(best, cands.filter((c) => c !== best), cardLang, langSource, best.confidence, scanImage);
    }
  } catch (err) {
    console.error(err);
    toast(navigator.onLine ? 'Scan fehlgeschlagen. Bitte noch einmal versuchen.' : 'Offline: Texterkennung benötigt beim ersten Mal Internet.', { type: 'error' });
  } finally {
    busy = false;
    setStatus(null);
    stage().classList.remove('is-busy', 'is-frozen', 'is-locked');
    setTimeout(() => auto?.pause(false), settings.batch ? 600 : 1500);
  }
}

/**
 * Kleines JPEG der gescannten Karte: gerade gerückt, wenn die Kanten gefunden wurden,
 * sonst der Ausschnitt ohne den 4-%-Rand für die Texterkennung.
 * @returns {string|null} Data-URL
 */
function scanThumb(canvas, quad = null, width = 360, margin = 0.04) {
  try {
    if (quad) return warpCard(canvas, quad, width, Math.round((width * 88) / 63)).toDataURL('image/jpeg', 0.82);
    const f = margin / (1 + 2 * margin);
    const sx = canvas.width * f;
    const sy = canvas.height * f;
    const sw = canvas.width - 2 * sx;
    const sh = canvas.height - 2 * sy;
    const w = Math.round(Math.min(width, sw));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = Math.round((sh * w) / sw);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.82);
  } catch {
    return null;
  }
}

function openScanResult(cand, alternatives, lang, langSource, confidence = null, scanImage = null) {
  showCard({
    scanImage,
    candidate: cand,
    alternatives,
    lang,
    langSource,
    confidence,
    source: 'scan',
    onLoaded: (data, st) => {
      const { variant, value } = bestValue(data, st.variantKey);
      addHistory({ ...candidateFromCand(cand), lang: st.lang, name: data.display.name, setName: data.display.set?.name || cand.set?.n, ...imageFields(data, st.scanImage), price: value, variantLabel: variant?.label });
    },
  });
}

/** Mehrere Karten kommen infrage (z. B. nur der Name war lesbar): Auswahl anzeigen. */
function pickCandidate(cands, lang, langSource, scanImage = null) {
  const list = cands.slice(0, 12);
  const root = openSheet(`
    <h3 class="sheet-title">Welche Karte ist es?</h3>
    <p class="row-sub" style="margin:-6px 0 14px">Die Kartennummer war nicht eindeutig lesbar. Tippe auf die passende Karte – oder scanne erneut, mit der Nummer unten links gut im Licht.</p>
    <div class="coll-grid">${list
      .map((c, i) => {
        const l = c.group === 'ja' ? 'ja' : lang;
        const img = c.hasImage === false ? null : guessImage(l, c.set, c.localId, 'low');
        const fb = c.group === 'ja' ? null : guessImage('en', c.set, c.localId, 'low');
        return `<button class="tile" data-c="${i}" style="animation-delay:${i * 25}ms">
          <div class="thumb">${imgTag(img || fb, fb)}</div>
          <div class="tile-name">${esc(c.name)}</div>
          <div class="tile-set">${esc(c.set?.nl?.[l] || c.set?.n || c.setId)}</div>
          <div class="tile-set">${esc(cardNumber(c.localId, c.set?.o))}${c.set?.d ? ` · ${esc(c.set.d.slice(0, 4))}` : ''}</div>
        </button>`;
      })
      .join('')}</div>
    <div class="actions"><button class="btn btn-outline btn-span" data-action="pick-search">Alle „${esc(list[0].name)}“-Karten durchsuchen</button></div>`);
  root.querySelector('[data-action="pick-search"]').addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('holoscan:search', { detail: list[0].name }));
  });
  root.querySelectorAll('[data-c]').forEach((b) =>
    b.addEventListener('click', () => {
      const c = list[Number(b.dataset.c)];
      haptic(8);
      openScanResult(c, list.filter((x) => x !== c), c.group === 'ja' ? 'ja' : lang, langSource, null, scanImage);
    }),
  );
}

function candidateFromCand(c) {
  return { id: c.id, group: c.group, setId: c.setId, localId: c.localId, official: c.set?.o, setDate: c.set?.d };
}

async function capture() {
  if (busy) return;
  if (aligner?.active) {
    await scanAligned();
    return;
  }
  if (!camera?.active) {
    await startCamera();
    return;
  }
  const canvas = camera.grab($('#guide'));
  if (!canvas) return;
  freezeCamera();
  await process(canvas);
}

// ---------- Foto aus der Galerie ausrichten ----------

const HINT_CAMERA = 'Karte im Rahmen ausrichten';
const HINT_ALIGN = 'Karte in den Rahmen schieben & zoomen';

async function fromFile(file) {
  if (!file) return;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file));
    // sehr große Fotos verkleinern (Speicher), Details für die Texterkennung bleiben erhalten
    const max = 3200;
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    enterAlign(c);
  } catch (err) {
    console.error(err);
    toast('Das Bild konnte nicht gelesen werden.', { type: 'error' });
  }
}

function enterAlign(img) {
  pauseCamera();
  $('#camera-intro').hidden = true;
  stage().classList.add('is-aligning', 'is-ready');
  $('#stage-hint').textContent = HINT_ALIGN;
  aligner.open(img);
  haptic(8);
}

function exitAlign() {
  aligner.close();
  stage().classList.remove('is-aligning', 'is-ready');
  $('#stage-hint').textContent = HINT_CAMERA;
  if (wantCamera) resumeCamera();
  else $('#camera-intro').hidden = false;
}

async function scanAligned() {
  aligner.locked = true;
  try {
    await process(aligner.crop(), { fitToText: false });
  } finally {
    aligner.locked = false;
  }
}

// ---------- Serienscan ----------

async function addToBatch(cand, lang, unsure = false, scanImage = null) {
  let data = null;
  try {
    data = await loadCardData(cand, lang);
  } catch {
    /* Preis später */
  }
  const { variant, value } = data ? bestValue(data) : { variant: null, value: null };
  const entry = {
    cand,
    lang,
    name: data?.display?.name || cand.name,
    setName: data?.display?.set?.name || cand.set?.n || '',
    ...(data ? imageFields(data, scanImage) : { image: null, scanImage }),
    variantKey: variant?.key,
    variantLabel: variant?.label,
    value,
    priceUpdated: variant?.cm?.updated || null,
    idProduct: variant?.cm?.idProduct || null,
  };
  batch.push(entry);
  addHistory({ ...candidateFromCand(cand), lang, name: entry.name, setName: entry.setName, image: entry.image, scanImage: entry.scanImage, price: value, variantLabel: entry.variantLabel });
  renderBatch(true);
  haptic([10, 30, 10]);
  const shown = conditionValue(value, settings.condition);
  toast(`${unsure ? 'Unsicher: ' : ''}${entry.name} · ${langInfo(lang).short}`, { type: unsure ? 'info' : 'success', image: thumbOf(entry) || undefined, price: shown ? money(shown) : '–', ms: unsure ? 3500 : 2200 });
}

function batchTotal() {
  return batch.reduce((s, e) => s + (conditionValue(e.value, settings.condition) || 0), 0);
}

function renderBatch(pulse = false) {
  $('#batch-total').textContent = money(batchTotal());
  $('#batch-count').textContent = `${batch.length} ${batch.length === 1 ? 'Karte' : 'Karten'}`;
  const strip = $('#batch-strip');
  strip.innerHTML = batch
    .slice(-14)
    .reverse()
    .map((e) => (thumbOf(e) ? `<img src="${esc(thumbOf(e))}" alt="${esc(e.name)}" onerror="this.style.visibility='hidden'">` : '<img alt="">'))
    .join('');
  if (pulse) {
    const t = $('#batch-total');
    t.animate([{ transform: 'scale(1.12)', color: '#f5c451' }, { transform: 'scale(1)' }], { duration: 450, easing: 'ease-out' });
  }
}

function reviewBatch() {
  const html = () => `
    <h3 class="sheet-title">Serienscan</h3>
    <div class="price-hero" style="margin-top:0">
      <div class="price-label"><span class="cm-logo"><i></i>Gesamtwert (Cardmarket)</span><span>${batch.length} Karten</span></div>
      <div class="price-main"><span class="price-value">${money(batchTotal())}</span></div>
      <div class="price-caption">Zustand ${esc(conditionInfo(settings.condition).short)}${conditionFactor(settings.condition) !== 1 ? ' (Richtwert)' : ''} · Basis: Preistrend der ersten Variante.</div>
    </div>
    <div class="hist-list" style="margin-top:14px">
      ${
        batch.length
          ? batch
              .map(
                (e, i) => `
        <div class="hist-item">
          ${thumbOf(e) ? `<img src="${esc(thumbOf(e))}" alt="" loading="lazy">` : '<div class="ph"></div>'}
          <button class="row-main" data-open="${i}" style="text-align:left">
            <div class="row-title">${esc(e.name)}</div>
            <div class="row-sub">${esc(e.setName)} · ${esc(e.cand.localId)} · ${langInfo(e.lang).flag} ${esc(e.variantLabel || '')}</div>
          </button>
          <div class="hist-price">${money(conditionValue(e.value, settings.condition))}</div>
          <button class="icon-btn" data-del="${i}" aria-label="Entfernen" style="width:36px;height:36px"><svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
        </div>`,
              )
              .join('')
          : '<div class="empty"><p>Noch keine Karten gescannt. Halte einfach nacheinander Karten in den Rahmen.</p></div>'
      }
    </div>
    ${
      batch.length
        ? `<div class="actions">
            <button class="btn btn-gold btn-span" data-action="batch-save">Alle zur Sammlung hinzufügen</button>
            <button class="btn btn-danger btn-span" data-action="batch-clear">Liste leeren</button>
          </div>`
        : ''
    }`;
  const root = openSheet(`<div data-batch>${html()}</div>`);
  const box = root.querySelector('[data-batch]');
  const rebind = () => {
    box.innerHTML = html();
    box.querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', () => {
        batch.splice(Number(b.dataset.del), 1);
        renderBatch();
        rebind();
      }),
    );
    box.querySelectorAll('[data-open]').forEach((b) =>
      b.addEventListener('click', () => {
        const e = batch[Number(b.dataset.open)];
        showCard({ candidate: e.cand, lang: e.lang, langSource: 'Serienscan', scanImage: e.scanImage });
      }),
    );
    box.querySelector('[data-action="batch-save"]')?.addEventListener('click', async () => {
      for (const e of batch) {
        await addItem({
          list: 'collection',
          id: e.cand.id,
          group: e.cand.group,
          setId: e.cand.setId,
          localId: e.cand.localId,
          lang: e.lang,
          name: e.name,
          setName: e.setName,
          setDate: e.cand.set?.d || null,
          official: e.cand.set?.o || null,
          image: e.image,
          ...(e.scanImage ? { scanImage: e.scanImage } : {}),
          variantKey: e.variantKey,
          variantLabel: e.variantLabel,
          condition: settings.condition,
          qty: 1,
          price: e.value,
          priceUpdated: e.priceUpdated,
          idProduct: e.idProduct,
        });
      }
      const n = batch.length;
      batch.length = 0;
      renderBatch();
      closeSheet();
      haptic([10, 40, 10, 40, 10]);
      toast(`${n} Karten zur Sammlung hinzugefügt`, { type: 'success' });
    });
    box.querySelector('[data-action="batch-clear"]')?.addEventListener('click', () => {
      batch.length = 0;
      renderBatch();
      rebind();
    });
  };
  rebind();
}

// ---------- Auswahl & Verlauf ----------

function pickScanLang() {
  const opts = [{ code: 'auto', label: 'Automatisch', short: 'Auto', flag: '🌐' }, ...LANGS];
  const root = openSheet(`
    <h3 class="sheet-title">Kartensprache beim Scannen</h3>
    <p class="row-sub" style="margin:-6px 0 14px">„Automatisch“ erkennt die Sprache am Kartentext (z. B. Schwäche/Weakness, KP/HP oder „PAL DE“). Feste Wahl ist ideal für Stapel einer Sprache.</p>
    <div class="lang-grid">${opts
      .map((l) => `<button class="lang-opt ${settings.scanLang === l.code ? 'is-active' : ''}" data-code="${l.code}"><span class="flag">${l.flag}</span>${esc(l.label)}</button>`)
      .join('')}</div>`);
  root.querySelectorAll('[data-code]').forEach((b) =>
    b.addEventListener('click', async () => {
      await saveSettings({ scanLang: b.dataset.code });
      updateLangChip();
      haptic(8);
      closeSheet();
    }),
  );
}

export async function openHistory() {
  const list = await allHistory();
  const root = openSheet(`
    <h3 class="sheet-title">Scan-Verlauf</h3>
    <div class="hist-list">
      ${
        list.length
          ? list
              .map(
                (h, i) => `
        <button class="hist-item" data-i="${i}">
          ${thumbOf(h) ? `<img src="${esc(thumbOf(h))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : '<div class="ph"></div>'}
          <div class="row-main">
            <div class="row-title">${esc(h.name)}</div>
            <div class="row-sub">${esc(h.setName || '')} · ${esc(h.localId)} · ${langInfo(h.lang).flag} · ${esc(relTime(h.at))}</div>
          </div>
          <div class="hist-price">${money(h.price)}</div>
        </button>`,
              )
              .join('')
          : '<div class="empty"><div class="empty-art">⌁</div><h3>Noch keine Scans</h3><p>Gescannte Karten erscheinen hier – inklusive Preis zum Scan-Zeitpunkt.</p></div>'
      }
    </div>
    ${list.length ? '<div class="actions"><button class="btn btn-ghost btn-span" data-action="clear-history">Verlauf löschen</button></div>' : ''}`);
  root.querySelectorAll('[data-i]').forEach((b) =>
    b.addEventListener('click', async () => {
      const h = list[Number(b.dataset.i)];
      const set = await findSet(h.group, h.setId);
      showCard({ candidate: candidateFromItem(h, set), lang: h.lang, langSource: 'aus dem Verlauf', scanImage: h.scanImage });
    }),
  );
  root.querySelector('[data-action="clear-history"]')?.addEventListener('click', async () => {
    await clearHistory();
    closeSheet();
    toast('Verlauf gelöscht');
  });
}

// ---------- Init ----------

export function initScan() {
  camera = new Camera($('#video'));
  aligner = new PhotoAligner($('#align-layer'), $('#align-canvas'), $('#guide'));
  auto = new AutoTrigger(camera, $('#guide'), {
    onProgress: (p) => {
      $('#guide').style.setProperty('--p', p);
      stage().classList.toggle('is-locked', p >= 0.6);
    },
    onFire: () => capture(),
  });
  updateLangChip();
  updateToggles();
  renderBatch();

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    switch (btn.dataset.action) {
      case 'start-camera':
        startCamera();
        break;
      case 'capture':
        capture();
        break;
      case 'pick-photo':
        $('#file-input').click();
        break;
      case 'toggle-torch':
        camera.setTorch(!camera.torchOn).then((on) => btn.setAttribute('aria-pressed', String(on)));
        haptic(8);
        break;
      case 'toggle-batch':
        saveSettings({ batch: !settings.batch }).then(() => {
          updateToggles();
          toast(settings.batch ? 'Serienscan an: Karten nacheinander scannen, Wert summiert sich.' : 'Serienscan aus');
        });
        haptic(8);
        break;
      case 'toggle-auto':
        saveSettings({ autoScan: !settings.autoScan }).then(() => {
          updateToggles();
          toast(settings.autoScan ? 'Auto-Scan an: löst aus, sobald die Karte ruhig im Rahmen liegt.' : 'Auto-Scan aus');
        });
        haptic(8);
        break;
      case 'align-close':
        exitAlign();
        break;
      case 'align-rotate':
        aligner.rotate();
        haptic(6);
        break;
      case 'pick-scan-lang':
        pickScanLang();
        break;
      case 'batch-review':
        reviewBatch();
        break;
      case 'open-history':
        openHistory();
        break;
      default:
    }
  });

  $('#file-input').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    fromFile(file);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseCamera();
    else if (document.getElementById('app').dataset.view === 'scan') resumeCamera();
  });

  autoStartIfGranted();
}
