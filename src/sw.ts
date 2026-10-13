/// <reference lib="webworker" />
// HoloScan Service Worker. Liegt (wie der alte) unter ./sw.js und ersetzt ihn beim Update.
//
// Übergang von der alten App: Der neue Worker aktiviert sich sofort (skipWaiting + clients.claim).
// Die alte Seite lädt sich bei "controllerchange" selbst neu und startet so direkt die neue App.
// Die alten Caches für Bildmodell, Bibliotheken und API werden weiterverwendet (gleiche Namen),
// damit das ~30-MB-Bildmodell nicht erneut geladen werden muss.

import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope;

const DATA_CACHE = 'holoscan-data-v1';
const API_CACHE = 'holoscan-api-v1';
const LIB_CACHE = 'holoscan-lib-v1';
const VISION_CACHE = 'holoscan-vision-v1';
const MAX_API_ENTRIES = 500;
const MAX_VISION_ENTRIES = 4;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // App-Shell-Caches der alten Version entfernen (Daten-, Modell- und API-Caches bleiben)
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('holoscan-shell-')).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  // Die alte App schickt den String 'SKIP_WAITING', Workbox-Clients ein Objekt.
  const d = event.data;
  if (d === 'SKIP_WAITING' || d?.type === 'SKIP_WAITING') self.skipWaiting();
});

// Seitenaufrufe: immer die (vorgeladene) App-Shell
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

const sameOrigin = (url: URL) => url.origin === self.location.origin;

// Bildmodell und Vektor-Index: versionierte URLs (?v=Modell-Hash)
registerRoute(
  ({ url }) =>
    sameOrigin(url) &&
    url.search.startsWith('?v=') &&
    (url.pathname.includes('/models/') || url.pathname.endsWith('/data/vision/index.bin')),
  ({ request }) => versioned(request),
);
// Kartenindex, Preise usw.: sofort aus dem Cache, im Hintergrund aktualisieren
registerRoute(
  ({ url }) => sameOrigin(url) && url.pathname.includes('/data/'),
  ({ request }) => staleWhileRevalidate(request, DATA_CACHE),
);
registerRoute(
  ({ url }) => url.hostname === 'api.tcgdex.net',
  ({ request }) => networkFirst(request, API_CACHE, 8000, MAX_API_ENTRIES),
);
// OCR-Kern, ONNX Runtime (versionierte URLs, ändern sich nie)
registerRoute(
  ({ url }) => url.hostname === 'cdn.jsdelivr.net',
  ({ request }) => cacheFirst(request, LIB_CACHE),
);
// Kartenbilder (assets.tcgdex.net) nutzen den HTTP-Cache des Browsers.

async function cacheFirst(req: Request, cacheName: string) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) await cache.put(req, res.clone());
  return res;
}

/** Versionierte Dateien: exakt (mit ?v=) cachen, alte Versionen derselben Datei entfernen. */
async function versioned(req: Request) {
  const cache = await caches.open(VISION_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    const path = new URL(req.url).pathname;
    for (const k of await cache.keys()) if (new URL(k.url).pathname === path) await cache.delete(k);
    await cache.put(req, res.clone());
    await trim(cache, MAX_VISION_ENTRIES);
  }
  return res;
}

async function networkFirst(req: Request, cacheName: string, timeoutMs: number, maxEntries: number) {
  const cache = await caches.open(cacheName);
  const network = fetch(req);
  network.catch(() => {});
  const store = (res: Response) => cache.put(req, res.clone()).then(() => trim(cache, maxEntries));
  try {
    const res = await withTimeout(network, timeoutMs);
    if (res.ok) {
      store(res);
      return res;
    }
    return (await cache.match(req)) || res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    // Langsames Netz ohne Cache: weiter auf die Antwort warten
    if ((err as Error)?.message === 'timeout') {
      const res = await network;
      if (res.ok) store(res);
      return res;
    }
    throw err;
  }
}

async function staleWhileRevalidate(req: Request, cacheName: string) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreSearch: true });
  const update = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  if (hit) return hit;
  return (await update) || new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } });
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

async function trim(cache: Cache, max: number) {
  const keys = await cache.keys();
  if (keys.length > max) await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k)));
}
