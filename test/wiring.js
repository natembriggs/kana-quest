// Boots the real app against a stub DOM and a stub IndexedDB, then plays a
// whole session through. This is not a browser, so it proves nothing about
// layout or styling — what it does catch is the class of bug that shows up
// on a phone as a blank white screen and no way to read the console:
// element ids in app.js that do not exist in index.html, data-action values
// with no handler, bad module paths, and typos in imported names.
//
//   /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc \
//       -m test/wiring.js

load('vendor/wanakana.min.js');

const html = readFile('index.html');

const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const htmlActions = new Set([...html.matchAll(/\bdata-action="([^"]+)"/g)].map((m) => m[1]));
const screenIds = [...htmlIds].filter((id) => id.startsWith('screen-'));

let failures = 0;
function check(name, condition, detail) {
  if (condition) return;
  failures += 1;
  print(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
}

// --- Stub DOM -------------------------------------------------------------

const elements = new Map();

function makeElement(id = '') {
  const el = {
    id,
    hidden: false,
    disabled: false,
    value: '',
    textContent: '',
    innerHTML: '',
    className: '',
    style: {},
    dataset: {},
    files: null,
    _listeners: {},
    classList: {
      _set: new Set(),
      add(...c) { c.forEach((x) => this._set.add(x)); },
      remove(...c) { c.forEach((x) => this._set.delete(x)); },
      contains(c) { return this._set.has(c); },
    },
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); },
    appendChild(child) { this._children.push(child); return child; },
    remove() {},
    focus() {},
    click() {},
    // Nodes written via innerHTML are not really parsed here, so hand back a
    // stable placeholder per selector rather than null — enough for code that
    // sets .textContent on a child it just created.
    querySelector(selector) {
      if (!this._found.has(selector)) this._found.set(selector, makeElement());
      return this._found.get(selector);
    },
    querySelectorAll() { return []; },
    closest() { return null; },
    _children: [],
    _found: new Map(),
  };
  return el;
}

function el(id) {
  if (!elements.has(id)) elements.set(id, makeElement(id));
  return elements.get(id);
}

function fire(element, type, event = {}) {
  (element._listeners[type] || []).forEach((fn) => fn({ preventDefault() {}, ...event }));
}

const missingIds = new Set();

globalThis.document = {
  _listeners: {},
  getElementById(id) {
    if (!htmlIds.has(id)) missingIds.add(id);
    return el(id);
  },
  querySelectorAll(selector) {
    if (selector === '.screen') return screenIds.map(el);
    return [];
  },
  createElement() { return makeElement(); },
  addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); },
  body: makeElement('body'),
};

globalThis.window = { wanakana: globalThis.wanakana, scrollTo() {} };
globalThis.navigator = {};
globalThis.confirm = () => true;
globalThis.setTimeout = (fn) => { fn(); return 0; };

// --- Stub IndexedDB (just enough for store.js) ----------------------------

const rows = new Map();

function request(resultFn) {
  const req = { result: undefined, onsuccess: null, onerror: null, _run: resultFn };
  return req;
}

globalThis.indexedDB = {
  open() {
    const req = { result: null, onupgradeneeded: null, onsuccess: null, onerror: null };
    const db = {
      objectStoreNames: { contains: () => true },
      createObjectStore: () => {},
      transaction(_name, _mode) {
        const tx = { oncomplete: null, onerror: null, onabort: null, _reqs: [] };
        tx.objectStore = () => ({
          getAll: () => { const r = request(); r.result = [...rows.values()].map(clone); tx._reqs.push(r); return r; },
          get: (id) => { const r = request(); r.result = rows.has(id) ? clone(rows.get(id)) : undefined; tx._reqs.push(r); return r; },
          put: (doc) => { rows.set(doc.id, clone(doc)); const r = request(); tx._reqs.push(r); return r; },
          delete: (id) => { rows.delete(id); const r = request(); tx._reqs.push(r); return r; },
        });
        // Complete on a microtask so callers see async behaviour.
        Promise.resolve().then(() => { if (tx.oncomplete) tx.oncomplete(); });
        return tx;
      },
    };
    req.result = db;
    Promise.resolve().then(() => { if (req.onsuccess) req.onsuccess(); });
    return req;
  },
};

function clone(value) { return JSON.parse(JSON.stringify(value)); }
const settle = () => new Promise((resolve) => Promise.resolve().then(() => Promise.resolve().then(resolve)));

// --- Boot -----------------------------------------------------------------

const { romajiFor } = await import('../src/kana.js');
await import('../src/app.js');
for (let i = 0; i < 10; i += 1) await settle();

check('every id app.js asks for exists in index.html', missingIds.size === 0,
  [...missingIds].join(', '));

const visible = () => screenIds.find((id) => !el(id).hidden);
check('boots to the profile screen', visible() === 'screen-profiles', `showing ${visible()}`);

// --- Create a learner -----------------------------------------------------

el('new-profile-name').value = 'Test Kid';
fire(el('new-profile-form'), 'submit');
for (let i = 0; i < 10; i += 1) await settle();

check('a profile was persisted', rows.size === 1, `${rows.size} rows`);
check('lands on the home screen', visible() === 'screen-home', `showing ${visible()}`);

// --- Start a session ------------------------------------------------------
// The Start button is built in renderHome via createElement, so it is not
// reachable through the stub. Drive the exported flow the same way the
// button does, by firing the document-level action handler instead.

const profile = [...rows.values()][0];
check('new profile starts with no progress', Object.keys(profile.progress).length === 0);

// "Practise again" on the summary screen routes through the same entry point
// as Start, so it exercises startSession without needing the generated node.
fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'again' } }) } });
for (let i = 0; i < 10; i += 1) await settle();

check('a session opens the lesson screen first', visible() === 'screen-lesson', `showing ${visible()}`);
check('lesson shows a kana', el('lesson-kana').textContent.length > 0);
check('lesson shows its romaji', el('lesson-romaji').textContent.length > 0);

// Step through the lesson cards.
for (let i = 0; i < 10 && visible() === 'screen-lesson'; i += 1) {
  fire(el('lesson-next'), 'click');
  await settle();
}
check('lesson hands over to the quiz', visible() === 'screen-quiz', `showing ${visible()}`);

// --- Answer the quiz ------------------------------------------------------

let answered = 0;
let missedOnce = false;
for (let i = 0; i < 60 && visible() === 'screen-quiz'; i += 1) {
  const kana = el('quiz-kana').textContent;
  if (!kana) break;
  // Get the third question wrong on purpose, to exercise the miss path.
  const deliberateMiss = answered === 2 && !missedOnce;
  el('quiz-answer').value = deliberateMiss ? 'zzz' : romajiFor(kana);
  fire(el('quiz-form'), 'submit');
  await settle();
  if (deliberateMiss) {
    missedOnce = true;
    check('a miss shows the right answer', el('quiz-feedback').textContent.length > 0);
    check('a miss switches the button to acknowledge', el('quiz-submit').textContent === 'Got it');
    fire(el('quiz-form'), 'submit'); // acknowledge
    await settle();
  }
  answered += 1;
}

check('the quiz ends at the summary', visible() === 'screen-summary', `showing ${visible()}`);
check('summary reports a score', el('summary-score').textContent.length > 0,
  `"${el('summary-score').textContent}"`);
check('a deliberate miss happened', missedOnce);

const saved = [...rows.values()][0];
const records = Object.entries(saved.progress);
check('progress was written to storage', records.length > 0, `${records.length} records`);
check('progress is keyed by mode', records.every(([k]) => k.startsWith('recognition:')));
check('every record has a history', records.every(([, r]) => r.history.length > 0));
check('correct answers advanced past box 0', records.some(([, r]) => r.box > 0));
check('the missed character was re-drilled',
  records.some(([, r]) => r.history.length > 1),
  'expected the missed item to be asked again in the same session');

// --- data-action coverage -------------------------------------------------

const appSource = readFile('src/app.js');
const handled = new Set([...appSource.matchAll(/case '([a-z-]+)':/g)].map((m) => m[1]));
for (const action of htmlActions) {
  check(`data-action="${action}" has a handler`, handled.has(action));
}

print('');
if (failures) {
  print(`${failures} failure(s)`);
  throw new Error(`${failures} wiring failure(s)`);
}
print(`all wiring checks passed (${answered} questions answered, ${records.length} records saved)`);
