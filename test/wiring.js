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
    querySelectorAll(selector) {
      // Only class selectors are used on generated nodes.
      const wanted = selector.replace(/^\./, '');
      return this._children.filter((c) => c.className.split(/\s+/).includes(wanted));
    },
    closest() { return null; },
    _children: [],
    _found: new Map(),
  };
  // innerHTML = '' is how the app clears a container before rebuilding it, so
  // the stub has to drop the recorded children when that happens.
  let markup = '';
  Object.defineProperty(el, 'innerHTML', {
    get() { return markup; },
    set(value) { markup = value; if (value === '') el._children.length = 0; },
  });
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

// Timers are queued rather than fired immediately, so the test can inspect the
// screen during the pause after an answer is revealed — which is the whole
// point of that pause.
const timers = new Map();
let nextTimerId = 1;
globalThis.setTimeout = (fn) => { const id = nextTimerId += 1; timers.set(id, fn); return id; };
globalThis.clearTimeout = (id) => { timers.delete(id); };
function runTimers() {
  const pending = [...timers.values()];
  timers.clear();
  pending.forEach((fn) => fn());
}

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

const profile = [...rows.values()][0];
check('new profile starts with no progress', Object.keys(profile.progress).length === 0);

// The home screen offers "Learn N new" and "Review N" as separate buttons,
// built by renderHome. Find the learn button among the generated nodes and
// press it, the same way a learner would.
const homeButtons = el('course-list')._children
  .flatMap((card) => card._children)
  .flatMap((node) => (node._children.length ? node._children : [node]));
const learnButton = homeButtons.find((b) => (b.innerHTML || '').includes('more'));
check('the home screen offers an "add more" button', !!learnButton,
  homeButtons.map((b) => b.innerHTML || b.textContent).join(' | '));
const reviewButton = homeButtons.find((b) => (b.textContent || '') === 'Nothing to review');
check('a brand-new learner has nothing to review yet', !!reviewButton);

fire(learnButton, 'click');
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
let sawTenOptions = true;
for (let i = 0; i < 60 && visible() === 'screen-quiz'; i += 1) {
  const kana = el('quiz-kana').textContent;
  if (!kana) break;
  const choices = el('quiz-choices')._children;
  if (choices.length !== 10) sawTenOptions = false;

  const answer = romajiFor(kana);
  // Get the third question wrong on purpose, to exercise the miss path.
  const deliberateMiss = answered === 2 && !missedOnce;
  const target = deliberateMiss
    ? choices.find((c) => c.textContent !== answer)
    : choices.find((c) => c.textContent === answer);
  check(`question ${i + 1} offers a tappable answer`, !!target);
  if (!target) break;

  fire(target, 'click');
  await settle();

  if (deliberateMiss) {
    missedOnce = true;
    check('a miss shows the right answer', el('quiz-feedback').textContent === answer,
      `"${el('quiz-feedback').textContent}"`);
    check('a miss marks the tapped option wrong', target.classList.contains('is-wrong'));
    check('a miss highlights the correct option',
      choices.some((c) => c.textContent === answer && c.classList.contains('is-right')));
    check('the app waits rather than skipping straight past a miss',
      visible() === 'screen-quiz' && el('quiz-kana').textContent === kana);
    // A tap anywhere on the quiz screen moves on.
    fire(el('screen-quiz'), 'click');
    await settle();
    check('acknowledging a miss cancels the auto-advance timer', timers.size === 0);
  } else {
    runTimers(); // the short pause after a correct answer
    await settle();
  }
  answered += 1;
}
check('every question offered ten options', sawTenOptions);

check('the quiz ends at the summary', visible() === 'screen-summary', `showing ${visible()}`);
check('summary reports a score', el('summary-score').textContent.length > 0,
  `"${el('summary-score').textContent}"`);
check('a deliberate miss happened', missedOnce);
check('summary offers more new characters', el('summary-learn').hidden === false);
check('summary "learn more" is labelled with a count',
  /\d/.test(el('summary-learn').innerHTML), `"${el('summary-learn').innerHTML}"`);

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
