// Offline support.
//
// Deliberately network-first: during development a cache-first worker serves
// stale files after every edit, which is maddening. This fetches fresh when
// online and falls back to the cache only when the network fails.

// Bump whenever SHELL changes, so a stale install doesn't sit on an old list.
const CACHE = 'kana-quest-v2';

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
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match('index.html'))),
  );
});
