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

// Every network fetch the worker makes, precache and runtime alike, has to
// revalidate with the server ('no-cache') rather than skip the HTTP cache
// ('no-store', which re-downloads the whole app on every launch) or trust
// it (the default, which lets Safari serve a stale file) — see note 1 at
// the top of sw.js.
const fetchModes = [];
globalThis.fetch = async (url, init) => {
  fetchModes.push(init && init.cache);
  return { ok: true, clone() { return {}; } };
};
cachePutBlocker = null;
await dispatchWait('install');
const precacheFetches = fetchModes.length;
await dispatchFetch({ method: 'GET', mode: 'navigate', url: 'https://example.test/kana-quest/' });
check('install precaches the shell', precacheFetches === SHELL.length, `${precacheFetches} of ${SHELL.length}`);
check('every worker fetch revalidates instead of skipping the HTTP cache',
  fetchModes.length === SHELL.length + 1 && fetchModes.every((mode) => mode === 'no-cache'),
  [...new Set(fetchModes)].join(', '));

// --- SHELL completeness & modulepreload consistency (review-2026-09-24.md
// --- S4) --------------------------------------------------------------
//
// Every module app.js needs has to be precached, whether it reaches app.js
// through a static `import`/`export ... from` or through a plain
// `import('./literal-path.js')` (S4 moved five modules — changelog.js,
// feedback.js, sync-protocol.js, sync-transport.js, reader.js — from the
// first kind to the second, precisely so they leave the STATIC graph
// without leaving the OFFLINE one: the activate handler above deletes the
// previous version's cache on every release, so a module missing from
// SHELL is gone from the cache until the next online launch, and one
// missing module can be enough to stop that screen working at all offline).
// A per-grade/per-story data file (src/data/*, always reached through a
// TEMPLATE-literal import — `import(`./data/story-${id}.js`)` — never a
// plain string) is excluded on purpose: see sw.js's header comment on why
// those stay lazy in the cache too, never precached.

function resolveImport(fromPath, spec) {
  const dir = fromPath.slice(0, fromPath.lastIndexOf('/') + 1);
  const parts = `${dir}${spec}`.split('/');
  const resolved = [];
  parts.forEach((part) => {
    if (part === '..') resolved.pop();
    else if (part !== '.') resolved.push(part);
  });
  return resolved.join('/');
}

function staticImports(path, seen = new Set()) {
  if (seen.has(path)) return seen;
  seen.add(path);
  const source = readFile(path);
  const pattern = /(?:^|\n)\s*(?:import|export)\s[^'"`;]*?from\s*['"](\.[^'"]+)['"]|(?:^|\n)\s*import\s*['"](\.[^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) {
    staticImports(resolveImport(path, match[1] || match[2]), seen);
  }
  return seen;
}

/** Plain string-literal `import(...)` calls only — a template literal is a
 * per-grade/per-story data load, deliberately not walked or required here
 * (see the comment above). Recurses into whatever it finds, so a lazy
 * module that itself lazily imports another app-code module is still
 * caught, not just the ones app.js reaches directly. */
function dynamicAppCodeImports(path, seen = new Set()) {
  const source = readFile(path);
  const pattern = /import\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  for (const match of source.matchAll(pattern)) {
    const target = resolveImport(path, match[1]);
    if (target.startsWith('src/data/')) continue; // heavy per-unit/per-story data — see above
    if (!seen.has(target)) { seen.add(target); dynamicAppCodeImports(target, seen); }
  }
  return seen;
}

const staticGraph = [...staticImports('src/app.js')];
const lazyAppCode = new Set();
staticGraph.forEach((path) => dynamicAppCodeImports(path, lazyAppCode));

const bootModules = [...new Set([...staticGraph, ...lazyAppCode])];
const missingFromShell = bootModules.filter((path) => !SHELL.includes(path));
check('every module app.js needs at boot — statically, or through a lazy import() of app code — is precached',
  bootModules.length > 25 && missingFromShell.length === 0,
  missingFromShell.join(', ') || `only ${bootModules.length} modules found`);

const indexHtml = readFile('index.html');
const indexScripts = [...indexHtml.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]);
check('every script index.html loads is precached',
  indexScripts.length >= 1 && indexScripts.every((src) => SHELL.includes(src)),
  indexScripts.filter((src) => !SHELL.includes(src)).join(', '));

// The <link rel="modulepreload"> list in index.html's <head> is a pure
// fetch-priority hint over whatever is left on the STATIC graph (app.js
// itself is fetched by its own <script type="module">, never preloaded,
// and the five now-lazy modules above are deliberately not preloaded
// either — preloading them would just move their fetch back to boot time,
// undoing S4). Checked both ways so it cannot silently drift out of step
// with a future import added to, or removed from, app.js.
const preloadHrefs = new Set(
  [...indexHtml.matchAll(/rel="modulepreload"\s+href="([^"]+)"/g)].map((m) => m[1]),
);
const preloadable = staticGraph.filter((path) => path !== 'src/app.js');
const missingPreload = preloadable.filter((path) => !preloadHrefs.has(path));
const extraPreload = [...preloadHrefs].filter((path) => !preloadable.includes(path));
check('every static-graph module (other than app.js itself) has a matching <link rel="modulepreload">',
  missingPreload.length === 0, missingPreload.join(', '));
check('every <link rel="modulepreload"> names a real static-graph module',
  extraPreload.length === 0, extraPreload.join(', '));

print('');
if (failures) throw new Error(`${failures} failure(s)`);
print('all service-worker tests passed');
