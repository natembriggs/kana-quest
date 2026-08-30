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
//      or failed file would sink the whole update. Files are cached
//      individually here and a failure is tolerated — precaching is an
//      optimisation, not a correctness requirement, since the fetch handler
//      populates the cache as pages are used anyway.
//
// The heavy per-kanji data (kanji-expansion-plan.md §4) is deliberately NOT
// listed below: src/data/kanji-grade-*.js and stroke-grade-*.js (well over
// 1MB apiece once every jōyō grade is loaded) are fetched lazily, on demand,
// per grade — precaching all of them here would defeat the whole point.
// They still end up cached, just opportunistically, the first time the
// fetch handler actually sees a request for one. Only the always-needed
// manifest and kana stroke data are small enough to be worth precaching.

const VERSION = '2026-08-30l';
const CACHE_PREFIX = 'kana-quest-';
const CACHE = `${CACHE_PREFIX}${VERSION}`;

const SHELL = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'vendor/wanakana.min.js',
  'src/app.js',
  'src/kana.js',
  'src/kanji.js',
  'src/data/kanji-manifest.js',
  'src/srs.js',
  'src/store.js',
  'src/merge.js',
  'src/sync-protocol.js',
  'src/sync-transport.js',
  'src/strokes.js',
  'src/data/stroke-kana.js',
  'src/stroke-geometry.js',
  'src/stroke-grader.js',
  'src/writing.js',
  'src/changelog.js',
  'src/reader.js',
  'src/data/story-manifest.js',
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
    // Multiple project PWAs can share one origin (notably on GitHub Pages).
    // Remove only superseded Kana Quest caches, never a sibling app's data.
    await Promise.all(keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
      .map((key) => caches.delete(key)));
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
        // Keep the worker alive until the runtime response is safely cached.
        await cache.put(request, fresh.clone());
      }
      return fresh;
    } catch {
      // Search only Kana Quest's current cache. A same-origin sibling PWA
      // must never become an accidental fallback source for this app.
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      // The app shell is a valid fallback for SPA navigations only. Returning
      // HTML for a missing script/image/data chunk hides the real failure and
      // produces confusing parse or decode errors.
      if (request.mode === 'navigate') {
        const shell = await cache.match('index.html');
        if (shell) return shell;
      }
      throw new Error('offline and nothing cached');
    }
  })());
});

// Lets the page force an update without waiting for a navigation.
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
