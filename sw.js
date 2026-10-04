/* HoloScan Service Worker – Offline-Cache und Updates */

// Wird beim Deployment durch die Commit-ID ersetzt (siehe .github/workflows/pages.yml).
const VERSION = '__BUILD_ID__';
const DEV = VERSION.startsWith('__');

const SHELL_CACHE = `holoscan-shell-${VERSION}`;
const DATA_CACHE = 'holoscan-data-v1';
const API_CACHE = 'holoscan-api-v1';
const LIB_CACHE = 'holoscan-lib-v1';
// Bilderkennung: Modell und Vektor-Index (URLs tragen den Modell-Hash, z. B. ?v=…)
const VISION_CACHE = 'holoscan-vision-v1';
const MAX_VISION_ENTRIES = 4;

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/util.js',
  'js/db.js',
  'js/store.js',
  'js/api.js',
  'js/lang.js',
  'js/ocr.js',
  'js/parse.js',
  'js/identify.js',
  'js/recognize.js',
  'js/vision.js',
  'js/deal.js',
  'js/pricing.js',
  'js/camera.js',
  'js/ui/sheet.js',
  'js/ui/toast.js',
  'js/ui/holo.js',
  'js/ui/align.js',
  'js/ui/charts.js',
  'js/ui/result.js',
  'js/ui/scan.js',
  'js/ui/collection.js',
  'js/ui/search.js',
  'js/ui/more.js',
  'vendor/tesseract/tesseract.esm.min.js',
  'vendor/tesseract/worker.min.js',
  'assets/fonts/outfit-latin.woff2',
  'assets/fonts/outfit-latin-ext.woff2',
  'assets/icons/icon.svg',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/apple-touch-icon.png',
  'assets/icons/favicon-32.png',
  'data/index.json',
  'data/sets.json',
];

const MAX_API_ENTRIES = 500;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith('holoscan-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') {
      event.respondWith(networkFirst(req, SHELL_CACHE, 4000, 'index.html'));
    } else if (url.search.startsWith('?v=') && (url.pathname.includes('/models/') || url.pathname.endsWith('/data/vision/index.bin'))) {
      event.respondWith(versioned(req));
    } else if (url.pathname.includes('/data/')) {
      event.respondWith(staleWhileRevalidate(req, DATA_CACHE));
    } else {
      event.respondWith(DEV ? networkFirst(req, SHELL_CACHE, 4000) : cacheFirst(req, SHELL_CACHE));
    }
    return;
  }

  if (url.hostname === 'api.tcgdex.net') {
    event.respondWith(networkFirst(req, API_CACHE, 8000, null, MAX_API_ENTRIES));
    return;
  }

  // OCR-Kern und Sprachmodelle (versionierte URLs, ändern sich nie)
  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(cacheFirst(req, LIB_CACHE));
  }
  // Kartenbilder (assets.tcgdex.net) nutzen den HTTP-Cache des Browsers (1 Jahr, immutable).
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreSearch: req.url.startsWith(self.location.origin) });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

/** Versionierte Dateien: exakt (mit ?v=) cachen, alte Versionen derselben Datei entfernen. */
async function versioned(req) {
  const cache = await caches.open(VISION_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    const path = new URL(req.url).pathname;
    for (const k of await cache.keys()) if (new URL(k.url).pathname === path) await cache.delete(k);
    await cache.put(req, res.clone());
    trim(cache, MAX_VISION_ENTRIES);
  }
  return res;
}

async function networkFirst(req, cacheName, timeoutMs, fallbackUrl, maxEntries) {
  const cache = await caches.open(cacheName);
  try {
    const res = await withTimeout(fetch(req), timeoutMs);
    if (res.ok) {
      cache.put(req, res.clone()).then(() => maxEntries && trim(cache, maxEntries));
      return res;
    }
    const hit = await cache.match(req);
    return hit || res;
  } catch (err) {
    const hit = (await cache.match(req, { ignoreSearch: !!fallbackUrl })) || (fallbackUrl && (await cache.match(fallbackUrl)));
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreSearch: true });
  const update = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  if (hit) return hit;
  const res = await update;
  if (res) return res;
  const shell = await caches.open(SHELL_CACHE);
  return (await shell.match(req, { ignoreSearch: true })) || new Response('{}', { status: 503 });
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function trim(cache, max) {
  const keys = await cache.keys();
  if (keys.length <= max) return;
  await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k)));
}
