// Service-worker isolation and fallback tests.
//
//   /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc \
//       -m test/service-worker.js

const workerEvents = {};
const cacheNames = ['kana-quest-old', 'kana-quest-2026-08-24a', 'other-app-v4'];
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
  clients: { claimed: false, async claim() { this.claimed = true; } },
  async skipWaiting() {},
  addEventListener(type, handler) { workerEvents[type] = handler; },
};
// JavaScriptCore's command-line shell lacks the browser URL global used by
// sw.js's same-origin guard. The worker only reads `.origin` from it.
globalThis.URL = class {
  constructor(value) { this.origin = String(value).match(/^https?:\/\/[^/]+/)[0]; }
};

globalThis.caches = {
  async keys() { return [...cacheNames]; },
  async delete(key) { deletedCaches.push(key); return true; },
  async open() { return currentCache; },
};

load('sw.js');

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
check('activation retains the current Kana Quest cache', !deletedCaches.includes('kana-quest-2026-08-24a'));
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

print('');
if (failures) throw new Error(`${failures} failure(s)`);
print('all service-worker tests passed');
