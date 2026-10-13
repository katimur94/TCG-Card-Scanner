// Start: Speicher dauerhaft anfordern, Daten der alten Version übernehmen, Einstellungen laden,
// Service Worker registrieren, Preise im Hintergrund auffrischen.

import { db } from './db/schema';
import { migrateFromLegacy } from './db/migrate';
import { useSettings } from './state/settings';
import { toast, useUi, type InstallPrompt } from './state/ui';
import { refreshPrices } from './domain/collection';
import { cents } from './lib/util';
import { loadSets } from './lib/api';
import { nameDirectory } from './lib/identify';

let started: Promise<void> | null = null;

/** Einmal pro Seitenaufruf (React StrictMode ruft Effekte im Entwicklungsmodus doppelt auf). */
export function boot() {
  started ||= start();
  return started;
}

async function start() {
  // Persistenter Speicher: schützt die Sammlung davor, vom Browser bei Platzmangel geräumt zu werden
  navigator.storage?.persist?.().catch(() => {});

  try {
    const report = await migrateFromLegacy(db);
    if (report?.found && report.items + report.history > 0) {
      setTimeout(
        () =>
          toast({
            text: `Willkommen im neuen HoloScan! ${report.items} Karte(n) aus deiner Sammlung wurden übernommen.`,
            tone: 'gain',
            ms: 7000,
          }),
        600,
      );
    }
  } catch (err) {
    // Die alte Datenbank bleibt unberührt; der nächste Start versucht es erneut.
    console.error('[HoloScan] Übernahme der alten Daten fehlgeschlagen', err);
    setTimeout(
      () =>
        toast({
          text: 'Alte Sammlung konnte noch nicht übernommen werden – nächster Versuch beim nächsten Start.',
          tone: 'loss',
          ms: 7000,
        }),
      600,
    );
  }

  await useSettings.getState().load();
  loadSets().catch(() => {});
  // Kartenindexe der Sammel-Sprachen im Hintergrund vorladen (Suche und Erkennung offline bereit)
  setTimeout(() => {
    for (const l of new Set(['en', ...useSettings.getState().settings.collectLangs])) void nameDirectory(l).catch(() => {});
  }, 1500);
  registerSW();
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    useUi.getState().setInstall(e as unknown as InstallPrompt);
  });
  window.addEventListener('appinstalled', () => {
    useUi.getState().setInstall(null);
    toast({ text: 'HoloScan ist installiert', tone: 'gain' });
  });
  window.addEventListener('offline', () => toast({ text: 'Offline – Scannen geht weiter, Preise folgen später.' }));
  setTimeout(() => void backgroundRefresh(), 2500);
  setTimeout(() => backupReminder(), 4000);
}

async function backgroundRefresh() {
  if (!navigator.onLine) return;
  try {
    const r = await refreshPrices();
    for (const a of r.alarms.slice(0, 3)) {
      const text = `Preisalarm: ${a.name} für ${cents(a.priceCents)}`;
      toast({ text, tone: 'gain', ms: 8000 });
      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification('HoloScan', { body: text, icon: 'assets/icons/icon-192.png' });
        } catch {
          /* z. B. Android ohne Service-Worker-Notification */
        }
      }
    }
  } catch (err) {
    console.warn('[HoloScan] Preise nicht aktualisiert', err);
  }
}

function backupReminder() {
  const s = useSettings.getState().settings;
  if (!s.backupReminderDays) return;
  const due = !s.lastBackupAt || Date.now() - s.lastBackupAt > s.backupReminderDays * 86400000;
  if (due)
    toast({
      text: 'Zeit für ein Backup deiner Sammlung',
      ms: 8000,
      action: { label: 'Öffnen', run: () => useUi.getState().openSheet('settings') },
    });
}

function registerSW() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  // Eine neuere Version hat übernommen: nicht mitten in der Bedienung neu laden, sondern anbieten.
  // (Beim allerersten Besuch gibt es keine ältere Version – dann nichts tun.)
  const hadController = !!navigator.serviceWorker.controller;
  let offered = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (offered || !hadController) return;
    offered = true;
    toast({
      text: 'Neue Version von HoloScan ist da',
      ms: 15000,
      action: { label: 'Neu laden', run: () => location.reload() },
    });
  });
  navigator.serviceWorker
    .register('sw.js', { scope: './' })
    .then((reg) => setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000))
    .catch((err) => console.warn('Service Worker nicht registriert', err));
}
