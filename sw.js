// Offline support.
//
// Deliberately network-first: during development a cache-first worker serves
// stale files after every edit, which is maddening. This fetches fresh when
// online and falls back to the cache only when the network fails.
//
// Two things bite specifically on an iOS home-screen app, and both are
// handled below:
//
//   1. `fetch()` inside a worker still consults the browser's own HTTP cache.
//      python3 -m http.server sends Last-Modified but no Cache-Control, so
//      Safari applies *heuristic* freshness and can serve a stale file
//      without revalidating — network-first isn't enough on its own. Every
//      request here is therefore made with cache: 'no-store'.
//
//   2. If install fails, the new worker never activates and the old one keeps
//      serving the old files forever. cache.addAll() is atomic, so one slow
//      or failed file (kanji-data.js is ~1.2MB) would sink the whole update.
//      Files are cached individually here and a failure is tolerated —
//      precaching is an optimisation, not a correctness requirement, since
//      the fetch handler populates the cache as pages are used anyway.

const VERSION = '2026-08-19a';
const CACHE = `kana-quest-${VERSION}`;

const SHELL = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'vendor/wanakana.min.js',
  'src/app.js',
  'src/kana.js',
  'src/kanji.js',
  'src/kanji-data.js',
  'src/srs.js',
  'src/store.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map(async (path) => {
      try {
        const response = await fetch(path, { cache: 'no-store' });
        if (response.ok) await cache.put(path, response);
      } catch {
        // Tolerated on purpose — see note 2 above.
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      // By URL rather than by Request: a navigate-mode Request cannot be
      // rebuilt with different cache options, and this app sends no headers
      // or credentials worth preserving.
      const fresh = await fetch(request.url, { cache: 'no-store' });
      if (fresh.ok) {
        const cache = await caches.open(CACHE);
        cache.put(request, fresh.clone());
      }
      return fresh;
    } catch {
      const cached = await caches.match(request);
      if (cached) return cached;
      const shell = await caches.match('index.html');
      if (shell) return shell;
      throw new Error('offline and nothing cached');
    }
  })());
});

// Lets the page force an update without waiting for a navigation.
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
