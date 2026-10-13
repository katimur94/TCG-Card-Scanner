// HoloScan – Einstieg: Navigation, Service Worker, Installation.

import { loadSettings } from './store.js';
import { loadSets } from './api.js';
import { $, $$, haptic } from './util.js';
import { initSheet, closeSheet, isOpen } from './ui/sheet.js';
import { initScan, pauseCamera, resumeCamera } from './ui/scan.js';
import { initCollection, renderCollection, maybeAutoRefresh } from './ui/collection.js';
import { initSearch, focusSearch } from './ui/search.js';
import { renderMore, setInstallPrompt } from './ui/more.js';
import { toast } from './ui/toast.js';

const VIEWS = ['scan', 'collection', 'search', 'more'];

function setView(view) {
  if (!VIEWS.includes(view)) view = 'scan';
  const app = $('#app');
  const prev = app.dataset.view;
  if (isOpen()) closeSheet();
  app.dataset.view = view;
  $$('.tab').forEach((t) => {
    const on = t.dataset.view === view;
    t.classList.toggle('is-active', on);
    t.setAttribute('aria-current', on ? 'page' : 'false');
  });
  if (view === 'scan') resumeCamera();
  else if (prev === 'scan') pauseCamera();
  if (view === 'collection') renderCollection();
  if (view === 'more') renderMore();
}

function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker
    .register('sw.js')
    .then((reg) => {
      const offer = (worker) =>
        toast('Neue Version verfügbar', {
          ms: 15000,
          action: { label: 'Aktualisieren', fn: () => worker.postMessage('SKIP_WAITING') },
        });
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) offer(nw);
        });
      });
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    })
    .catch((err) => console.warn('Service Worker nicht registriert', err));
}

async function main() {
  await loadSettings();
  initSheet();
  initScan();
  initCollection();
  initSearch();

  $('.tabbar').addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (!t) return;
    haptic(6);
    setView(t.dataset.view);
  });
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-goto]');
    if (g) setView(g.dataset.goto);
  });
  document.addEventListener('holoscan:search', (e) => {
    setView('search');
    focusSearch(e.detail || '');
  });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    setInstallPrompt(e);
  });
  window.addEventListener('appinstalled', () => toast('HoloScan ist installiert ✨', { type: 'success' }));
  window.addEventListener('offline', () => toast('Offline – gespeicherte Daten werden genutzt.'));
  window.addEventListener('online', () => toast('Wieder online', { type: 'success', ms: 1800 }));

  const params = new URLSearchParams(location.search);
  setView(params.get('view') || 'scan');

  loadSets().catch(() => {});
  registerSW();
  setTimeout(() => maybeAutoRefresh(), 3000);
}

main().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', '<p style="position:fixed;bottom:90px;left:16px;right:16px;color:#ff6b81;text-align:center">HoloScan konnte nicht gestartet werden. Bitte Seite neu laden.</p>');
});
