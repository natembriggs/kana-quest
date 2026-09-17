// Service-worker isolation and fallback tests.
//
//   /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc \
//       -m test/service-worker.js

const workerEvents = {};
// The "current" entry is filled in below, after load('sw.js') — hardcoding
// a version string here would silently go stale on every VERSION bump in
// sw.js (exactly what happened the first time: this used to read
// 'kana-quest-2026-08-24b', which stopped being the current cache the next
// time sw.js's VERSION was bumped, and the test below started failing).
let cacheNames = ['kana-quest-old', 'other-app-v4'];
const deletedCaches = [];
const cacheEntries = new Map();
let cachePutBlocker = null;
let cachePutCalls = 0;

const currentCache = {
  async put(request, response) {
    cachePutCalls += 1;
    if (cachePutBlocker) await cachePutBlocker;
    cacheEntries.set(typeof request === 'string' ? request : request.url, response);
  },
  async match(request) {
    return cacheEntries.get(typeof request === 'string' ? request : request.url);
  },
};

globalThis.self = {
  location: { origin: 'https://example.test' },
  registration: { scope: 'https://example.test/kana-quest/' },
  clients: { claimed: false, async claim() { this.claimed = true; } },
  async skipWaiting() {},
  addEventListener(type, handler) { workerEvents[type] = handler; },
};
// JavaScriptCore's command-line shell lacks the browser URL global used by
// sw.js's same-origin and versioned-art guards.
globalThis.URL = class {
  constructor(value) {
    const parts = String(value).match(/^(https?:\/\/[^/]+)([^?#]*)(\?[^#]*)?/);
    this.origin = parts[1]; this.pathname = parts[2] || '/'; this.search = parts[3] || '';
  }
};

globalThis.caches = {
  async keys() { return [...cacheNames]; },
  async delete(key) { deletedCaches.push(key); return true; },
  async open() { return currentCache; },
};

load('sw.js');
// VERSION is sw.js's own top-level const, and load() shares its lexical
// scope with the rest of this file — so this is the real, current cache
// name, not a copy that can drift from it.
cacheNames = ['kana-quest-old', `kana-quest-${VERSION}`, 'other-app-v4'];

let failures = 0;
function check(name, condition, detail) {
  if (condition) { print(`ok    ${name}`); return; }
  failures += 1;
  print(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
}

function dispatchWait(type, extra = {}) {
  let promise;
  workerEvents[type]({ ...extra, waitUntil(value) { promise = value; } });
  return promise;
}

function dispatchFetch(request) {
  let promise;
  workerEvents.fetch({ request, respondWith(value) { promise = value; } });
  return promise;
}

await dispatchWait('activate');
check('activation removes an obsolete Kana Quest cache', deletedCaches.includes('kana-quest-old'));
check('activation retains the current Kana Quest cache', !deletedCaches.includes(`kana-quest-${VERSION}`));
check('activation leaves a sibling app cache untouched', !deletedCaches.includes('other-app-v4'));
check('activation claims existing clients', self.clients.claimed);

// The fetch event must remain pending until cache.put() completes. Otherwise
// a browser may terminate the worker before the response is stored.
let releasePut;
cachePutBlocker = new Promise((resolve) => { releasePut = resolve; });
const freshResponse = { ok: true, clone() { return { cachedCopy: true }; } };
globalThis.fetch = async () => freshResponse;
const freshRequest = { method: 'GET', mode: 'cors', url: 'https://example.test/src/app.js' };
let freshSettled = false;
const freshPromise = dispatchFetch(freshRequest).then((response) => {
  freshSettled = true;
  return response;
});
await Promise.resolve();
await Promise.resolve();
check('a successful fetch waits for its runtime cache write', !freshSettled && cachePutCalls === 1);
releasePut();
check('the network response is returned after caching', await freshPromise === freshResponse);
cachePutBlocker = null;

const shellResponse = { shell: true };
cacheEntries.set('index.html', shellResponse);
globalThis.fetch = async () => { throw new Error('offline'); };

const navigationRequest = { method: 'GET', mode: 'navigate', url: 'https://example.test/course' };
check('an offline navigation falls back to the app shell',
  await dispatchFetch(navigationRequest) === shellResponse);

const scriptRequest = { method: 'GET', mode: 'cors', url: 'https://example.test/src/missing.js' };
let scriptRejected = false;
try { await dispatchFetch(scriptRequest); } catch { scriptRejected = true; }
check('a missing non-navigation resource never receives HTML', scriptRejected);

let imageFetches = 0;
globalThis.fetch = async () => { imageFetches += 1; return freshResponse; };
const imageRequest = { method: 'GET', mode: 'cors', url: 'https://example.test/kana-quest/assets/stories/kasa-jizou/01.webp?v=1234567890abcdef' };
await dispatchFetch(imageRequest);
check('a first visit fetches the versioned painting', imageFetches === 1);
check('a repeat visit reuses the painting without a network request',
  (await dispatchFetch(imageRequest)).cachedCopy && imageFetches === 1);
await dispatchFetch({ ...imageRequest, url: imageRequest.url.replace('1234567890abcdef', 'abcdef1234567890') });
check('changed image bytes get a fresh download', imageFetches === 2);
const coverRequest = { ...imageRequest, url: 'https://example.test/kana-quest/assets/stories/kasa-jizou/cover.webp' };
await dispatchFetch(coverRequest); await dispatchFetch(coverRequest);
check('unversioned covers remain network-first', imageFetches === 4);
const siblingRequest = { ...imageRequest, url: imageRequest.url.replace('/kana-quest/', '/other-app/') };
await dispatchFetch(siblingRequest); await dispatchFetch(siblingRequest);
check('the painting cache shortcut does not apply to a sibling app', imageFetches === 6);
globalThis.fetch = async () => { throw new Error('offline'); };
check('previously viewed paintings work offline', (await dispatchFetch(imageRequest)).cachedCopy);
let imageRejected = false;
try { await dispatchFetch({ ...imageRequest, url: imageRequest.url.replace('01.webp', 'missing.webp') }); } catch { imageRejected = true; }
check('an unseen offline painting never receives the HTML shell', imageRejected);

print('');
if (failures) throw new Error(`${failures} failure(s)`);
print('all service-worker tests passed');
