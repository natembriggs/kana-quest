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

function makeCanvasContext() {
  return {
    scale() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    closePath() {}, save() {}, restore() {}, translate() {}, setTransform() {},
    strokeStyle: '', fillStyle: '', lineWidth: 0, lineCap: '', lineJoin: '',
  };
}

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
      toggle(c, force) {
        const on = force === undefined ? !this._set.has(c) : !!force;
        if (on) this._set.add(c); else this._set.delete(c);
        return on;
      },
    },
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); },
    appendChild(child) { this._children.push(child); return child; },
    setAttribute(name, value) { this._attrs[name] = String(value); },
    getAttribute(name) { return name in this._attrs ? this._attrs[name] : null; },
    removeAttribute(name) { delete this._attrs[name]; },
    remove() {},
    focus() {},
    // Dispatches for real, unlike the other no-ops here: app.js's Enter-key
    // shortcut works by calling .click() on whichever forward button is on
    // screen, so a no-op stub would let that shortcut "pass" while doing
    // nothing at all.
    click() { fire(this, 'click'); },
    // Real SVG elements always have this; strokes.js calls it unconditionally
    // (not inside its try/catch, unlike the stroke-geometry calls) to force a
    // layout flush before starting the draw-in animation.
    getBoundingClientRect() { return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }; },
    // No real canvas geometry here, same non-implementation as SVG geometry
    // above — writing.js's setupCanvas()/redrawInk() are written to tolerate
    // a context whose drawing calls are all no-ops.
    getContext(type) { return type === '2d' ? makeCanvasContext() : null; },
    setPointerCapture() {},
    releasePointerCapture() {},
    // Records that it was called rather than doing anything — enough to
    // verify the overview scrolls to the right tile without a real layout
    // engine to actually measure a scroll position against.
    scrollIntoView() { this._scrolledIntoView = true; },
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
    _attrs: {},
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
  // This stub never simulates real DOM bubbling (each fire() call only ever
  // invokes the target element's own listeners) — preventDefault is a
  // harmless no-op here: real app code calls it, so the stub event needs to
  // have it, without needing to model what it does.
  //
  // stopPropagation IS modelled, as "no listener registered after this one
  // runs", which is the one thing about it this stub can meaningfully
  // reproduce. app.js's ghost-click guard (bindTap in app.js) is a
  // capture-phase listener on `document` that swallows a click before the
  // delegated [data-action] handler — also on `document`, but in the bubble
  // phase — ever sees it. In a real DOM those are two separate steps of the
  // same event's traversal, so the stop-propagation flag set by the first
  // does suppress the second; here they are simply two entries in one array,
  // in registration order, which puts them in the same relative order.
  let stopped = false;
  const listeners = [...(element._listeners[type] || [])];
  listeners.forEach((fn) => {
    if (stopped) return;
    fn({ preventDefault() {}, stopPropagation() { stopped = true; }, ...event });
  });
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
  // A text node is not an element, but everything the app does with one
  // (append it, read it back through the parent's children) works the same
  // way against the generic stub element — textContent is the whole of it.
  createTextNode(text) {
    const node = makeElement();
    node.textContent = String(text);
    return node;
  },
  // Namespace is irrelevant to the stub — same generic element either way.
  // strokes.js's getPointAtLength/getTotalLength calls are already wrapped
  // in try/catch expecting a non-browser environment, so this stub
  // deliberately does not implement real SVG geometry: it exercises that
  // fallback path rather than papering over it.
  createElementNS(_ns, _tag) { return makeElement(); },
  addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); },
  body: makeElement('body'),
  // applyAccentColor() (app.js) sets data-accent here — just enough of a
  // real element for that assignment to land somewhere inspectable, not a
  // full makeElement() (this is never looked up by id/selector).
  documentElement: { dataset: {} },
};

globalThis.window = { wanakana: globalThis.wanakana, scrollTo() {} };
let clipboardText = null;
globalThis.navigator = { clipboard: { async writeText(text) { clipboardText = text; } } };
globalThis.confirm = () => true;
// A real sessionStorage is not part of JavaScriptCore — just enough of the
// Storage interface for renderInstallBanner()'s per-session dismiss to work.
globalThis.sessionStorage = {
  _data: new Map(),
  getItem(key) { return this._data.has(key) ? this._data.get(key) : null; },
  setItem(key, value) { this._data.set(key, String(value)); },
};
// Fired synchronously — the app defers scrollIntoView by a frame purely to
// let a just-unhidden screen's layout settle, which the stub has no layout
// engine to need waiting for.
globalThis.requestAnimationFrame = (fn) => { fn(); return 0; };

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

// Two real object stores now (store.js: 'profiles' keyed by id, 'sync' keyed
// by profileId) — one shared Map per store name, each respecting its own
// keyPath, rather than one Map for everything. A single shared Map used to
// be enough when there was only one store; sync's pairing-state store would
// silently collide with it (both writing key `undefined`, since sync rows
// have no `.id`) if that were still true.
const storeRows = new Map(); // store name -> Map(key -> doc)
const storeKeyPaths = { profiles: 'id', sync: 'profileId', rememberedCode: 'profileId' };

function rowsFor(name) {
  if (!storeRows.has(name)) storeRows.set(name, new Map());
  return storeRows.get(name);
}

// Every existing check below reaches into `rows` expecting the one profile
// this test file creates and drives — keep that working unchanged by
// binding it straight to the 'profiles' store specifically.
const rows = rowsFor('profiles');

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
      transaction(name, _mode) {
        const rows = rowsFor(name);
        const keyPath = storeKeyPaths[name] || 'id';
        const tx = { oncomplete: null, onerror: null, onabort: null, _reqs: [] };
        tx.objectStore = () => ({
          getAll: () => { const r = request(); r.result = [...rows.values()].map(clone); tx._reqs.push(r); return r; },
          get: (key) => { const r = request(); r.result = rows.has(key) ? clone(rows.get(key)) : undefined; tx._reqs.push(r); return r; },
          put: (doc) => { rows.set(doc[keyPath], clone(doc)); const r = request(); tx._reqs.push(r); return r; },
          delete: (key) => { rows.delete(key); const r = request(); tx._reqs.push(r); return r; },
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

const { romajiFor, getCourse } = await import('../src/kana.js');
const {
  KANJI_COURSES, kanjiInfo, readingExample, buildKanjiOptions, meaningLabel, unitLabel, kanjiUnitFor,
} = await import('../src/kanji.js');
const {
  courseStats, studiedKanji, isStudying, neverSeenItems, MAX_BOX, THINK_KNOWN_BOX,
} = await import('../src/srs.js');
const {
  vocabIdForWord, vocabInfo, VOCAB_COURSES, wordMeaningLabel,
  unitLabel: vocabUnitLabel, unitGroupLabel: vocabUnitGroupLabel, unitBadge: vocabUnitBadge,
} = await import('../src/vocab.js');
// strokesFor() reads live from strokes.js's lazily-populated store, not a
// frozen snapshot — kanji stroke data for a given grade only exists once
// that grade has actually been loaded (kanji-expansion-plan.md §4), which
// for every char used below happens naturally as the flow reaches it (a
// writing session gates on it before rendering — see startSession() in
// app.js).
const { strokesFor } = await import('../src/strokes.js');
const { flattenPath, resample } = await import('../src/stroke-geometry.js');
const { CHANGELOG } = await import('../src/changelog.js');
const store = await import('../src/store.js');
const appModule = await import('../src/app.js');
for (let i = 0; i < 10; i += 1) await settle();

check('every id app.js asks for exists in index.html', missingIds.size === 0,
  [...missingIds].join(', '));
check('index.html opts into standards mode and declares its document language',
  /^<!doctype html>\s*<html\s+lang="en">/i.test(html));
check('the viewport permits user zoom',
  /name="viewport"[^>]*content="[^"]*width=device-width/.test(html)
  && !/maximum-scale|user-scalable\s*=\s*no/i.test(html));
const workerVersion = readFile('sw.js').match(/const VERSION = '([^']+)'/)?.[1];
check('the app and service-worker versions stay in step',
  appModule.APP_VERSION === workerVersion,
  `${appModule.APP_VERSION} / ${workerVersion}`);

const visible = () => screenIds.find((id) => !el(id).hidden);
check('boots to the profile screen', visible() === 'screen-profiles', `showing ${visible()}`);

// --- Create a learner -----------------------------------------------------

el('new-profile-name').value = 'Test Kid';
fire(el('new-profile-form'), 'submit');
for (let i = 0; i < 10; i += 1) await settle();

check('a profile was persisted', rows.size === 1, `${rows.size} rows`);
check('lands on the home screen', visible() === 'screen-home', `showing ${visible()}`);

// --- Home is a four-way script picker --------------------------------------

const profile = [...rows.values()][0];
check('new profile starts with no progress', Object.keys(profile.progress).length === 0);

const scriptCards = el('script-list')._children;
check('the home screen offers exactly four scripts', scriptCards.length === 4,
  scriptCards.map((c) => c.dataset.script).join(', '));
check('the four scripts are hiragana, katakana, kanji and vocab',
  scriptCards.map((c) => c.dataset.script).join(',') === 'hiragana,katakana,kanji,vocab',
  scriptCards.map((c) => c.dataset.script).join(','));
check('the home screen no longer lists individual courses — that moved a level down',
  el('course-list')._children.length === 0);

/** Every button inside a rendered card, at any nesting depth — the course
 * card wraps each study action in its own subtitle-carrying container (see
 * renderCourse() in app.js), so a shallow one-level flatten no longer finds
 * them all. Buttons are the only nodes app.js ever sets .type = 'button' on. */
const buttonsIn = (card) => {
  const found = [];
  const walk = (node) => {
    if (node.type === 'button') found.push(node);
    node._children.forEach(walk);
  };
  card._children.forEach(walk);
  return found;
};

// --- Hiragana: modes across the top, no grade picker ----------------------

fire(scriptCards.find((c) => c.dataset.script === 'hiragana'), 'click');
await settle();
check('picking a script opens the course screen', visible() === 'screen-course', `showing ${visible()}`);
check('the course screen is titled for the script', el('course-title').textContent === 'Hiragana',
  el('course-title').textContent);

const kanaModes = el('mode-picker')._children;
check('kana offers two modes, not three', kanaModes.length === 2,
  kanaModes.map((b) => b.textContent).join(' | '));
check('the kana middle mode is called Reading, not Yomi',
  kanaModes[0].textContent === 'Reading', kanaModes.map((b) => b.textContent).join(' | '));
// Kana writing (Trace mode) shipped; kanji writing hasn't (see below) — the
// "soon" badge is set via innerHTML, an enabled button only ever gets
// .textContent, so an enabled Writing button has an empty innerHTML.
check('kana writing is enabled — Trace mode is live',
  kanaModes[1].textContent === 'Writing' && kanaModes[1].disabled === false
  && !kanaModes[1].innerHTML.includes('soon'));
check('kana has no grade picker', el('grade-picker').hidden === true);

const courseButtons = buttonsIn(el('course-list')._children[0]);
const learnButton = courseButtons.find((b) => (b.innerHTML || '').includes('Learn <b>'));
check('the course screen offers an "add more" button', !!learnButton,
  courseButtons.map((b) => b.innerHTML || b.textContent).join(' | '));
// A countdown, not "set N of M" — meaningless once a unit runs to hundreds
// of sets (kanji-expansion-plan.md §8). A brand-new course has nothing
// introduced yet, so this is trivially in teaching order and shown.
check('the course card counts down sets left in the unit, not "N of M"',
  (el('course-list')._children[0].innerHTML || '').includes(`${getCourse('hiragana').chunks.length} sets left`),
  el('course-list')._children[0].innerHTML);
const reviewButton = courseButtons.find((b) => (b.textContent || '') === 'Nothing to review');
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

// --- Answer the quiz --------------------------------------------------
// Exercises both wrong-answer paths: a miss recovered on the second try, and
// a miss that stays wrong through both tries. Per the app's rule, the SRS
// record is locked to the *first* attempt either way — a recovery must not
// erase the lapse, and it must not require a second recordResult() call.

let answered = 0;
let recoveryDone = false;
let recoveryKana = null;
let revealDone = false;
let revealKana = null;
let sawTenOptions = true;

for (let i = 0; i < 40 && visible() === 'screen-quiz'; i += 1) {
  const kana = el('quiz-kana').textContent;
  if (!kana) break;
  const choices = el('quiz-choices')._children;
  if (choices.length !== 10) sawTenOptions = false;
  const answer = romajiFor(kana);

  const doRecovery = answered === 1 && !recoveryDone;
  const doReveal = answered === 2 && !revealDone;

  if (doRecovery || doReveal) {
    const wrongTarget = choices.find((c) => c.textContent !== answer);
    check(`question ${i + 1} offers a wrong option to tap first`, !!wrongTarget);
    fire(wrongTarget, 'click');
    await settle();
    check('a first miss does not reveal the answer',
      el('quiz-feedback').textContent === 'Try once more',
      `"${el('quiz-feedback').textContent}"`);
    check('a first miss disables the option that was tapped', wrongTarget.disabled);
    check('a first miss does not move on', visible() === 'screen-quiz' && el('quiz-kana').textContent === kana);
    check('a first miss does not reveal which option was correct',
      !choices.some((c) => c.classList.contains('is-right')));

    if (doRecovery) {
      recoveryDone = true;
      recoveryKana = kana;
      const correctTarget = choices.find((c) => c.textContent === answer);
      fire(correctTarget, 'click');
      await settle();
      check('finding it on the second try still marks it right',
        correctTarget.classList.contains('is-right'));
      // The card's own colour is the verdict now — there is no ✓ under the
      // character, and the empty line collapses (see .feedback:empty) so it
      // costs no height on a short phone.
      check('a right answer says so with the card, not a tick',
        el('quiz-feedback').textContent === '' && el('quiz-card').className.includes('is-correct'),
        `"${el('quiz-feedback').textContent}" / ${el('quiz-card').className}`);
      check('a resolved question does not auto-advance on its own — no timer is even scheduled',
        visible() === 'screen-quiz' && el('quiz-kana').textContent === kana && timers.size === 0);
      check('Next is offered once the question resolves', el('quiz-ok').hidden === false);
      fire(el('quiz-ok'), 'click'); // the learner taps Next themselves
      await settle();
    } else {
      revealDone = true;
      revealKana = kana;
      // A second (or third, or...) miss no longer auto-reveals the correct
      // option for the learner — it behaves exactly like the first miss,
      // over and over, until they actually find and tap the right one
      // themselves. Eliminating every other option is not itself an answer.
      const secondWrong = choices.find((c) => c !== wrongTarget && c.textContent !== answer && !c.disabled);
      check('a different wrong option is available for the second try', !!secondWrong);
      fire(secondWrong, 'click');
      await settle();
      check('a second miss still says "Try once more", not the answer',
        el('quiz-feedback').textContent === 'Try once more',
        `"${el('quiz-feedback').textContent}"`);
      check('a second miss disables the option that was tapped', secondWrong.disabled);
      check('a second miss does not highlight the correct option either',
        !choices.some((c) => c.classList.contains('is-right')));
      check('a second miss still does not move on', visible() === 'screen-quiz' && el('quiz-kana').textContent === kana);
      check('Next is not offered until the correct option is actually tapped', el('quiz-ok').hidden === true);

      const correctTarget = choices.find((c) => c.textContent === answer);
      fire(correctTarget, 'click');
      await settle();
      check('tapping the actual right answer after two misses still marks it right',
        correctTarget.classList.contains('is-right'));
      check('Next is offered once the learner\'s own tap resolves it', el('quiz-ok').hidden === false);
      fire(el('quiz-ok'), 'click');
      await settle();
    }
  } else {
    const target = choices.find((c) => c.textContent === answer);
    check(`question ${i + 1} offers a tappable answer`, !!target);
    if (!target) break;
    fire(target, 'click');
    await settle();
    check('a correct first-try answer does not auto-advance either — Next is offered instead',
      visible() === 'screen-quiz' && el('quiz-kana').textContent === kana
      && el('quiz-ok').hidden === false && timers.size === 0);
    fire(el('quiz-ok'), 'click');
    await settle();
  }
  answered += 1;
}
check('every question offered ten options', sawTenOptions);
check('the recover-on-second-try path was exercised', recoveryDone);
check('the wrong-both-times path was exercised', revealDone);

check('the quiz ends at the summary', visible() === 'screen-summary', `showing ${visible()}`);
check('summary reports a score', el('summary-score').textContent.length > 0,
  `"${el('summary-score').textContent}"`);
check('summary offers more new characters', el('summary-learn').hidden === false);
check('summary "learn new" is labelled with a count',
  /\d/.test(el('summary-learn').innerHTML), `"${el('summary-learn').innerHTML}"`);
check('summary "learn new" says "new", not the old "more" wording',
  el('summary-learn').innerHTML.includes('new'), el('summary-learn').innerHTML);

// Two misses happened above (recovery + reveal) — the summary should offer
// to go practise exactly those, as the PRIMARY action (outranking "Learn
// new"), and NOT via a lesson step (kind: 'practice', not 'new') since both
// characters were already taught earlier in this same session.
// summary-study-missed is btn-primary unconditionally in the static HTML —
// the stub DOM doesn't parse that (classList here only reflects JS-driven
// changes), so the only DYNAMIC part to check is that summary-learn stops
// being primary once something was missed, ceding the highlighted spot.
check('the summary offers to practise exactly what was missed, as the primary action',
  el('summary-study-missed').hidden === false
  && el('summary-study-missed').innerHTML === 'Practise <b>2</b> missed'
  && !el('summary-learn').classList.contains('btn-primary'),
  el('summary-study-missed').innerHTML);

const saved = [...rows.values()][0];
const records = Object.entries(saved.progress);
check('progress was written to storage', records.length > 0, `${records.length} records`);
check('progress is keyed by mode', records.every(([k]) => k.startsWith('recognition:')));
check('every record has a history', records.every(([, r]) => r.history.length > 0));
check('correct answers advanced past box 0', records.some(([, r]) => r.box > 0));

const recoveryRecord = saved.progress[`recognition:${recoveryKana}`];
check('a miss recovered on the second try still counts as a lapse',
  !!recoveryRecord && recoveryRecord.lapses >= 1, JSON.stringify(recoveryRecord));
check('a miss no longer comes back later in the same session — one history entry, not re-drilled',
  recoveryRecord && recoveryRecord.history.length === 1, JSON.stringify(recoveryRecord));

const revealRecord = saved.progress[`recognition:${revealKana}`];
check('a miss wrong both times counts as a lapse', !!revealRecord && revealRecord.lapses >= 1);
check('it too is not re-drilled later in the same session',
  revealRecord && revealRecord.history.length === 1, JSON.stringify(revealRecord));

// Now actually go practise those 2 — answering both correctly this time —
// and confirm the resulting summary shows the FULL original 5, not just
// these 2 in isolation: state.summaryAllResults, carried into the new
// session as session.carriedResults and merged back in by finishSession(),
// is what makes "got 3 of 5, then fixed the other 2" read as an improved
// score instead of a fresh, context-free "2 of 2".
fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'study-missed' } }) } });
await settle();
check('"Practise missed" goes straight to the quiz — no lesson step, both characters were already taught',
  visible() === 'screen-quiz', visible());

for (let i = 0; i < 5 && visible() === 'screen-quiz'; i += 1) {
  const kana = el('quiz-kana').textContent;
  if (!kana) break;
  const answer = romajiFor(kana);
  const right = el('quiz-choices')._children.find((c) => c.textContent === answer);
  fire(right, 'click');
  await settle();
  fire(el('quiz-ok'), 'click');
  await settle();
}
check('practising the misses ends at a summary too', visible() === 'screen-summary', visible());
check('the merged summary shows the full original set of 5, not just the 2 just practised',
  el('summary-list')._children.length === 5, el('summary-list')._children.length);
check('every chip reads right now — both misses were fixed on this pass',
  el('summary-list')._children.every((c) => c.className.includes('chip-ok')),
  el('summary-list')._children.map((c) => c.className).join(' | '));
check('the merged score reads 5 of 5, without "first time" — some of these are second attempts',
  el('summary-score').textContent === '5 of 5 right', el('summary-score').textContent);
check('nothing is missed anymore, so "Practise missed" is gone and "Learn new" is primary again',
  el('summary-study-missed').hidden === true && el('summary-learn').classList.contains('btn-primary'),
  `study-missed hidden=${el('summary-study-missed').hidden}`);

// --- Writing (Trace mode) -----------------------------------------------
// Drives real pointer events through app.js's actual handlers — not a
// shortcut — proving the whole pipeline: pointerdown/move/up -> local pixel
// coordinates -> the model's 0-109 coordinate space -> stroke-grader.js ->
// the writing screen's UI. Each stroke is traced from a real model stroke's
// own points (via strokesFor + flattenPath/resample, the same modules
// stroke-grader.js itself uses), not hard-coded per character, so this
// works for whichever character the session actually lands on.
//
// The generic DOM stub reports every element's bounding box as zero-sized
// (see getBoundingClientRect above), which pointer-to-model-space division
// can't work with — writing-canvas's box is pinned to a known size below,
// the one deliberate stub customisation this test needs.

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'go-course' } }) } });
await settle();
check('back on the course screen after the kana Reading quiz', visible() === 'screen-course');

const WRITING_BOX = 300;
const writingCanvas = el('writing-canvas');
writingCanvas.getBoundingClientRect = () => (
  { x: 0, y: 0, width: WRITING_BOX, height: WRITING_BOX, top: 0, left: 0, right: WRITING_BOX, bottom: WRITING_BOX }
);

const writingModeButton = el('mode-picker')._children.find((b) => b.dataset.mode === 'writing');
check('the writing mode button is enabled', !!writingModeButton && writingModeButton.disabled === false);
fire(writingModeButton, 'click');
await settle();

const writingCourseButtons = buttonsIn(el('course-list')._children[0]);
const writingLearnButton = writingCourseButtons.find((b) => (b.innerHTML || '').includes('Learn <b>'));
check('writing mode offers an "add more" button too', !!writingLearnButton);
fire(writingLearnButton, 'click');
for (let i = 0; i < 10; i += 1) await settle();

check('a writing session opens the lesson screen first', visible() === 'screen-lesson', `showing ${visible()}`);
check('the writing lesson animates the stroke order',
  el('lesson-stroke-wrap').hidden === false && el('lesson-stroke')._children.length > 0);

// The lesson card's stroke animation loops like a gif rather than drawing in
// once and stopping — see animateStrokes({ loop: true }) in strokes.js. This
// harness's fake setTimeout ignores delay and just queues (see runTimers()
// above), which is exactly what's needed to prove it actually repeats
// without waiting on real wall-clock time.
const lessonSvg1 = el('lesson-stroke')._children[0];
const lessonPaths1 = lessonSvg1 ? lessonSvg1._children : [];
check('the lesson card has at least one stroke path to animate', lessonPaths1.length > 0);
runTimers();
check('the first pass reveals every stroke',
  lessonPaths1.every((p) => p.style.strokeDashoffset === '0'),
  lessonPaths1.map((p) => p.style.strokeDashoffset).join(','));
check("finishing one pass schedules the next — this is what makes it loop, not draw in once and stop",
  timers.size > 0, `${timers.size} pending timers`);
runTimers(); // a second pass — proves it keeps going, not just twice
check('a second pass runs too, and schedules a third', timers.size > 0, `${timers.size} pending timers`);

// Advancing to the next card must CANCEL that pending loop, not merely leave
// it running underneath the new one — otherwise its timers keep firing
// forever against stroke paths no longer on screen (see stopLessonStrokeLoop
// in app.js). Checked precisely: right after advancing, the only timers
// queued should be exactly the new card's own first batch.
const pendingBeforeAdvance = timers.size;
fire(el('lesson-next'), 'click');
await settle();
if (visible() === 'screen-lesson') {
  const secondLessonChar = el('lesson-kana').textContent;
  const expectedBatch = strokesFor(secondLessonChar).strokes.length + 1; // N stroke reveals + 1 loop-restart
  check("advancing cancels the previous card's pending loop instead of leaking it — only the new card's batch is queued",
    timers.size === expectedBatch,
    `${timers.size} pending, expected ${expectedBatch} for the new card (previous card had ${pendingBeforeAdvance} queued)`);
}

for (let i = 0; i < 10 && visible() === 'screen-lesson'; i += 1) {
  fire(el('lesson-next'), 'click');
  await settle();
}
check('the writing lesson hands over to the writing screen', visible() === 'screen-writing', `showing ${visible()}`);
check('the writing screen never displays the glyph itself',
  !el('writing-romaji').textContent.includes(el('screen-writing').dataset.char));
check('Trace already shows the whole guide, so the peek/switch-easier hint row stays hidden',
  el('writing-hints').hidden === true);

function traceModelStroke(char, index) {
  const d = strokesFor(char).strokes[index];
  const { points } = resample(flattenPath(d), 30); // dense enough to hug curved strokes
  const local = points.map(([mx, my]) => [(mx / 109) * WRITING_BOX, (my / 109) * WRITING_BOX]);
  fire(writingCanvas, 'pointerdown', { pointerId: 1, clientX: local[0][0], clientY: local[0][1] });
  for (let i = 1; i < local.length; i += 1) {
    fire(writingCanvas, 'pointermove', { pointerId: 1, clientX: local[i][0], clientY: local[i][1] });
  }
  fire(writingCanvas, 'pointerup', { pointerId: 1, clientX: local[local.length - 1][0], clientY: local[local.length - 1][1] });
}

// A stroke far too short to be anything real — a couple of pixels — used
// below to prove a genuinely bad attempt is rejected, regardless of which
// character or stroke it lands on (see the length gate in
// stroke-grader.js: the floor scales with the model stroke's own length,
// so a ~1-pixel stroke fails it no matter what).
function traceBadStroke() {
  // Needs a real pointermove in between: a down+up with no move in between
  // is exactly what app.js's own "that's a tap, not a stroke" filter is
  // there to discard (points.length < 2), before grading ever runs.
  fire(writingCanvas, 'pointerdown', { pointerId: 1, clientX: 4, clientY: 4 });
  fire(writingCanvas, 'pointermove', { pointerId: 1, clientX: 5, clientY: 5 });
  fire(writingCanvas, 'pointerup', { pointerId: 1, clientX: 5, clientY: 5 });
}

const firstWritingChar = el('screen-writing').dataset.char;
const firstWritingStrokeCount = strokesFor(firstWritingChar).strokes.length;

// Palm rejection: a second touch landing on the canvas mid-stroke — a palm
// brushing the glass while drawing with an Apple Pencil, reported from real
// use — must not hijack the stroke already in progress (see
// writingPointerDown() in app.js). Traces the character's very first stroke
// by hand rather than via traceModelStroke(), with an interloping
// pointerdown from a different pointerId injected partway through; if the
// interloper were allowed to take over, the rest of THIS pointer's moves
// would be silently dropped (the existing pointerId-mismatch guard in
// writingPointerMove), leaving a stroke far too short/wrong-shaped to pass
// grading.
{
  const d = strokesFor(firstWritingChar).strokes[0];
  const { points } = resample(flattenPath(d), 30);
  const local = points.map(([mx, my]) => [(mx / 109) * WRITING_BOX, (my / 109) * WRITING_BOX]);
  fire(writingCanvas, 'pointerdown', { pointerId: 1, clientX: local[0][0], clientY: local[0][1] });
  fire(writingCanvas, 'pointermove', { pointerId: 1, clientX: local[1][0], clientY: local[1][1] });
  fire(writingCanvas, 'pointerdown', { pointerId: 2, clientX: 1, clientY: 1 }); // the interloping palm
  for (let i = 2; i < local.length; i += 1) {
    fire(writingCanvas, 'pointermove', { pointerId: 1, clientX: local[i][0], clientY: local[i][1] });
  }
  fire(writingCanvas, 'pointerup', { pointerId: 1, clientX: local[local.length - 1][0], clientY: local[local.length - 1][1] });
}
await settle();

for (let i = 1; i < firstWritingStrokeCount; i += 1) {
  traceModelStroke(firstWritingChar, i);
  await settle();
}
check('a perfectly traced character is accepted with no rejection message',
  el('writing-feedback').textContent === '', `"${el('writing-feedback').textContent}"`);
check('the result panel appears without auto-advancing — the learner has to press Next',
  el('writing-result').hidden === false, `showing ${visible()}`);
// The message replaces the prompt/stroke-count above the canvas, in the
// same slot, rather than adding new space below — see index.html.
check('finishing hides the prompt and stroke count, replaced by the result message',
  el('writing-prompt').hidden === true && el('writing-stroke-counter').hidden === true
  && el('writing-result-message').hidden === false);
check('a correct attempt is praised', el('writing-result-message').textContent === 'Nicely done!');
check('"Try again" is always offered once finished', el('writing-retry').hidden === false);
check('a clean Trace pass offers trying one level harder',
  el('writing-switch-mode').hidden === false && el('writing-switch-mode').textContent === 'Try harder mode');
check('the hint row has nothing left to do once finished, so it is hidden too — Trace never showed it anyway',
  el('writing-hints').hidden === true);

// Enter reaches writing's Next too, and is gated on the result card rather
// than on the button (which is never hidden itself — the card around it is
// what appears). Mid-character, there is nothing for Enter to press, so a
// stray Enter can never skip a character that has not been drawn yet.
check('the writing Next button lives inside the result card, not hidden on its own',
  el('writing-next').hidden === false && el('writing-result').hidden === false);

// bindTap() (see app.js): a touch pointerup should fire the handler
// immediately, without waiting for the click the browser would ordinarily
// synthesize from it — that's the whole fix for taps needing to land twice
// on a phone right after a canvas gesture. A mouse pointerup is ignored,
// leaving mouse users on the ordinary click listener, unaffected. Exercised
// here on "Try again", which is also the very next real interaction in this
// flow — this both tests bindTap AND drives the redo below via touch
// instead of click, proving touch alone is enough, with no click needed.
//
// "Try again" redraws the same character. This is a pure redo — it does
// not touch the record on its own (checked against storage at the end of
// this section: without clicking "Mark this attempt as bad" below, the
// original record would stand untouched). The stroke counter resetting to
// 1 (and the prompt reappearing) is proof the redo actually cleared the
// in-progress attempt rather than silently no-op'ing.
fire(el('writing-retry'), 'pointerup', { pointerType: 'mouse' });
await settle();
check('a mouse pointerup is ignored by bindTap — "Try again" must not have fired from it',
  el('writing-result').hidden === false); // still showing the finished result, untouched
fire(el('writing-retry'), 'pointerup', { pointerType: 'touch' });
await settle();
check('"Try again" hides the result message, brings the prompt back, and resets the stroke count',
  el('writing-result').hidden === true
  && el('writing-prompt').hidden === false && el('writing-result-message').hidden === true
  && el('writing-stroke-counter').textContent === `Stroke 1 of ${firstWritingStrokeCount}`);

for (let i = 0; i < firstWritingStrokeCount; i += 1) {
  traceModelStroke(firstWritingChar, i);
  await settle();
}
check('a clean redo of an already-recorded character offers "Mark this attempt as bad" instead of praise text, in the same slot',
  el('writing-result').hidden === false
  && el('writing-result-message').hidden === true && el('writing-mark-bad').hidden === false);

// Exercise the explicit override itself — this is what used to happen
// automatically on every redo, and now only happens if the learner asks
// for it.
fire(el('writing-mark-bad'), 'click');
await settle();
check('clicking it swaps back to text confirming the correction, without a second grading event',
  el('writing-mark-bad').hidden === true
  && el('writing-result-message').hidden === false
  && el('writing-result-message').textContent === 'Okay — marked for more practice.');

const finishedWritingChar = el('screen-writing').dataset.char;
fire(document, 'keydown', { key: 'Enter' });
await settle();
check('Enter moves past a finished character, same as pressing Next',
  el('screen-writing').dataset.char !== finishedWritingChar || visible() !== 'screen-writing',
  `still on ${el('screen-writing').dataset.char}`);
check('the fresh character has no result card for Enter to press next',
  visible() !== 'screen-writing' || el('writing-result').hidden === true);

// Second character: get one stroke deliberately wrong before completing the
// rest correctly — proves everyStrokeFirstTry locks correctness to false
// even though Trace mode lets the character be finished regardless.
let secondWritingChar = null;
if (visible() === 'screen-writing') {
  secondWritingChar = el('screen-writing').dataset.char;
  const secondStrokeCount = strokesFor(secondWritingChar).strokes.length;

  traceBadStroke();
  await settle();
  check('the second character also rejects a bad first stroke',
    el('writing-feedback').textContent.length > 0);

  for (let i = 0; i < secondStrokeCount; i += 1) {
    traceModelStroke(secondWritingChar, i);
    await settle();
  }
  check('a character finished after a retry still reaches a result — Trace mode never blocks progress',
    el('writing-result').hidden === false);
  // The MESSAGE still praises finishing it — a kid who got there in the end
  // shouldn't be told "good try" as if they failed. Only the RECORD (below,
  // after quitting the session) is allowed to quietly reflect the retry.
  check('a retry-tainted attempt still gets the same positive completion message as a clean pass',
    el('writing-result-message').textContent === 'Nicely done!');
  check('"Try again" is offered even on a retry-tainted attempt — it is always offered once finished',
    el('writing-retry').hidden === false);
  check('Trace has no easier level to switch down to, so the switch-mode offer never appears',
    el('writing-switch-mode').hidden === true);

  fire(el('writing-next'), 'click');
  await settle();
}

// --- Guided mode -----------------------------------------------------------
// Same live grading as Trace — switching to it and tracing perfectly should
// behave identically from the learner's perspective. What's different (the
// guide staying invisible until each stroke is accepted) is a CSS-only
// distinction the stub can't see rendered, but it CAN see the mode class
// actually landing on the guide container, which is what that CSS keys off.
let guidedChar = null;
if (visible() === 'screen-writing') {
  fire(el('writing-mode-guided'), 'click');
  await settle();
  check('switching to Guided puts the guide in guided mode',
    el('writing-guide').className.includes('mode-guided'));
  check('the Guided toggle button is marked active, Trace is not',
    el('writing-mode-guided').className.includes('active')
    && !el('writing-mode-trace').className.includes('active'));
  check('the hint row (peek buttons) is shown once Trace is left',
    el('writing-hints').hidden === false);

  // Hold to peek: shown only while held, gone the instant it's released —
  // exercised here mid-attempt, before anything is graded, since peeking is
  // meant to be available any time the learner is stuck.
  fire(el('writing-peek-full'), 'pointerdown');
  await settle();
  check('holding "Show full character" reveals the whole guide',
    el('writing-guide').classList.contains('peek-full'));
  fire(el('writing-peek-full'), 'pointerup');
  await settle();
  check('releasing it hides the guide again',
    !el('writing-guide').classList.contains('peek-full'));

  const guideSvg = el('writing-guide')._children[0];
  const strokePath = (index) => guideSvg._children[index];

  fire(el('writing-peek-next'), 'pointerdown');
  await settle();
  check('holding "Show next stroke" reveals the model\'s stroke 0 before anything has been drawn',
    strokePath(0).classList.contains('stroke-path-peek'));
  fire(el('writing-peek-next'), 'pointerleave'); // dragging off the button also releases it
  await settle();
  check('a pointer dragged off the button releases the peek just like pointerup',
    !strokePath(0).classList.contains('stroke-path-peek'));

  guidedChar = el('screen-writing').dataset.char;
  const guidedStrokeCount = strokesFor(guidedChar).strokes.length;

  // "Show next stroke" moves on as strokes are accepted — not stuck showing
  // stroke 0 forever — checked here after the first stroke, but only on a
  // character with a second stroke to distinguish it from (the queue order
  // is shuffled, so this is guarded rather than assumed).
  traceModelStroke(guidedChar, 0);
  await settle();
  if (guidedStrokeCount > 1) {
    fire(el('writing-peek-next'), 'pointerdown');
    await settle();
    check('after accepting stroke 1, "Show next stroke" reveals stroke 2, not stroke 1 again',
      strokePath(1).classList.contains('stroke-path-peek') && !strokePath(0).classList.contains('stroke-path-peek'));
    fire(el('writing-peek-next'), 'pointerup');
    await settle();
  }

  for (let i = 1; i < guidedStrokeCount; i += 1) {
    traceModelStroke(guidedChar, i);
    await settle();
  }
  check('a clean Guided-mode trace is praised just like a clean Trace-mode one',
    el('writing-result-message').textContent === 'Nicely done!');
  check('a clean Guided pass offers trying one level harder',
    el('writing-switch-mode').hidden === false && el('writing-switch-mode').textContent === 'Try harder mode');
  check('the hint row is hidden again once finished — nothing left to peek at',
    el('writing-hints').hidden === true);

  // Bonus round: take the suggestion, on the SAME character, rather than
  // pressing Next — proves the original Guided pass's record isn't
  // clobbered by voluntary extra practice at a harder level (checked
  // against storage at the end of this section).
  fire(el('writing-switch-mode'), 'click');
  await settle();
  check('"Try harder mode" re-renders the SAME character in Free mode, not a new one',
    el('screen-writing').dataset.char === guidedChar
    && el('writing-guide').className.includes('mode-free')
    && el('writing-mode-free').className.includes('active'));

  for (let i = 0; i < guidedStrokeCount; i += 1) {
    traceModelStroke(guidedChar, i);
    await settle();
  }
  fire(el('writing-done'), 'click');
  await settle();
  fire(el('writing-self-grade-yes'), 'click');
  await settle();

  fire(el('writing-next'), 'click');
  await settle();
}

// --- Free mode ---------------------------------------------------------
// No guide, no live rejection: every stroke is captured as drawn, right or
// wrong, and nothing is graded until Done. The automatic verdict is only
// ever a suggestion (see writing-mode-plan.md) — the learner's own yes/no
// is what actually gets recorded, which this exercises both ways.
let freeCharNo = null;
if (visible() === 'screen-writing') {
  fire(el('writing-mode-free'), 'click');
  await settle();
  check('switching to Free puts the guide in free mode',
    el('writing-guide').className.includes('mode-free'));
  check('the Done/Undo row stays hidden until a stroke is drawn', el('writing-free-actions').hidden === true);

  freeCharNo = el('screen-writing').dataset.char;
  const freeStrokeCount = strokesFor(freeCharNo).strokes.length;

  // A bad first stroke — Free mode must NOT reject or block it the way
  // Trace/Guided would; it's just captured as "stroke 1", right or wrong.
  traceBadStroke();
  await settle();
  check('a bad stroke in Free mode is captured with no rejection message',
    el('writing-feedback').textContent === '');
  check('the Done/Undo row appears once there is a first stroke to review',
    el('writing-free-actions').hidden === false);

  // Undo the only stroke drawn so far: the row should hide again, exactly
  // as it does before the first stroke — then redraw the same bad stroke so
  // the mismatch/self-grade checks below are unaffected by this detour.
  fire(el('writing-undo'), 'click');
  await settle();
  check('undoing the only drawn stroke hides the Done/Undo row again',
    el('writing-free-actions').hidden === true);
  traceBadStroke();
  await settle();

  for (let i = 1; i < freeStrokeCount; i += 1) {
    traceModelStroke(freeCharNo, i);
    await settle();
  }
  check('Free mode never auto-completes — it always waits for Done',
    el('writing-result').hidden === true && el('writing-self-grade').hidden === true);

  // Undo mid-attempt: removes just the last stroke, not the whole thing —
  // the row stays visible since earlier strokes remain — then redraw it so
  // the character below is complete again.
  fire(el('writing-undo'), 'click');
  await settle();
  check('undoing mid-attempt removes only the last stroke; earlier strokes keep the row visible',
    el('writing-free-actions').hidden === false);
  traceModelStroke(freeCharNo, freeStrokeCount - 1);
  await settle();

  fire(el('writing-done'), 'click');
  await settle();
  check('Done reveals the self-grade step, noting the mismatch from the bad first stroke',
    el('writing-self-grade').hidden === false && el('writing-self-grade-hint').textContent.includes('off'));

  // The learner's own "No" is what commits — even though nothing here
  // touched the automatic per-stroke grader's usual leniency.
  fire(el('writing-self-grade-no'), 'click');
  await settle();
  check('a "No" self-grade is not praised', el('writing-result-message').textContent !== 'Nicely done!');
  check('"Try again" is offered even on a "No" self-grade — it is always offered once finished',
    el('writing-retry').hidden === false);
  check('a miss in Free mode offers switching one level easier',
    el('writing-switch-mode').hidden === false && el('writing-switch-mode').textContent === 'Switch to easier mode');
  check('the hint row is hidden again once finished',
    el('writing-hints').hidden === true);

  fire(el('writing-next'), 'click');
  await settle();
}

// A second Free-mode character, traced perfectly this time, to exercise the
// "Yes" side of the self-grade override.
let freeCharYes = null;
if (visible() === 'screen-writing') {
  freeCharYes = el('screen-writing').dataset.char;
  const strokeCount = strokesFor(freeCharYes).strokes.length;
  for (let i = 0; i < strokeCount; i += 1) {
    traceModelStroke(freeCharYes, i);
    await settle();
  }
  fire(el('writing-done'), 'click');
  await settle();
  check('a clean Free-mode attempt suggests it looks right',
    el('writing-self-grade-hint').textContent.includes('well'));

  fire(el('writing-self-grade-yes'), 'click');
  await settle();
  check('a "Yes" self-grade is praised and offered "Try again", same as any other clean pass',
    el('writing-result-message').textContent === 'Nicely done!' && el('writing-retry').hidden === false);
  check('Free is already the hardest level, so a clean pass there offers no switch-mode button',
    el('writing-switch-mode').hidden === true);

  fire(el('writing-next'), 'click');
  await settle();
}

// The ghost-click guard (see bindTap in app.js). iOS still synthesizes a
// click after a touch pointerup that was preventDefault()ed, and hit-tests
// it afresh — so when the pointerup handler changes screens, the click can
// land on a button that wasn't there when the finger went down. Reported
// from real use: finishing the last character of a writing session showed
// the summary for an instant, then started a whole new session with no
// second tap, because the ghost click hit the summary's own bottom bar.
// A tap through bindTap must therefore swallow the very next click that
// arrives with no pointerdown of its own behind it.
const quitClick = { target: { closest: () => ({ dataset: { action: 'quit-session' } }) } };
const screenBeforeGhost = visible(); // wherever the writing session left off
fire(el('writing-retry'), 'pointerup', { pointerType: 'touch' }); // arms the guard
await settle();
fire(document, 'click', quitClick);
await settle();
check('a click with no press of its own behind it is swallowed right after a touch tap',
  visible() === screenBeforeGhost, `left ${screenBeforeGhost} for ${visible()}`);

// ...and only that one. A real follow-up tap starts with its own
// pointerdown, which disarms the guard again.
fire(document, 'pointerdown', {});
fire(document, 'click', quitClick);
await settle();
check('quitting a writing session returns to the course screen', visible() === 'screen-course');

const writingSaved = [...rows.values()][0];
const writingRecords = Object.entries(writingSaved.progress).filter(([k]) => k.startsWith('writing:'));
check('writing progress was written to storage, keyed by mode', writingRecords.length >= 2,
  `${writingRecords.length} records`);
check('every writing record has a history', writingRecords.every(([, r]) => r.history.length > 0));

const firstWritingRecord = writingSaved.progress[`writing:${firstWritingChar}`];
check('"Mark this attempt as bad" after a redo applied the not-known override, without a second grading event',
  !!firstWritingRecord && firstWritingRecord.box === 0 && firstWritingRecord.seen === 1,
  JSON.stringify(firstWritingRecord));

const secondWritingRecord = writingSaved.progress[`writing:${secondWritingChar}`];
check('the retry-tainted character\'s RECORD still reflects the retry, even though its MESSAGE praised it',
  !!secondWritingRecord && secondWritingRecord.box === 0 && secondWritingRecord.lapses >= 1,
  JSON.stringify(secondWritingRecord));

const guidedRecord = writingSaved.progress[`writing:${guidedChar}`];
check('"Try Free" bonus practice on an already-passed character did not write a second, conflicting record',
  !!guidedRecord && guidedRecord.seen === 1 && guidedRecord.box > 0,
  JSON.stringify(guidedRecord));

// --- Kanji reading quiz -----------------------------------------------
// Same "give another chance, but the record is locked to the first
// attempt" contract as kana, but multi-select: tick every reading that
// applies, then press OK. Exercises all three outcomes.

// Back out to the course screen, then up to the script picker, then into
// kanji — the same route a learner takes.
fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'go-course' } }) } });
await settle();
check('leaving a session returns to the course screen, not the top level',
  visible() === 'screen-course', `showing ${visible()}`);

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'go-home' } }) } });
await settle();
check('backing out of the course screen reaches the script picker',
  visible() === 'screen-home', `showing ${visible()}`);

fire(el('script-list')._children.find((c) => c.dataset.script === 'kanji'), 'click');
await settle();
check('picking kanji opens the course screen', visible() === 'screen-course', `showing ${visible()}`);
check('kanji shows a grade picker', el('grade-picker').hidden === false);

// The unit picker no longer lists every unit at once: it shows the units of
// whichever GROUP holds the selected one, with the groups themselves in
// their own row above (see renderGradePicker in app.js). Eighteen kanji
// units — and thirty-odd vocab ones — as a single wrapped grid pushed the
// screen's actual buttons off the bottom of a phone.
const gradePickerButtons = () => el('grade-picker')._children.filter((c) => c.dataset.grade !== undefined);
const unitGroupChips = () => el('unit-groups')._children;
const openUnitGroup = async (label) => {
  fire(unitGroupChips().find((c) => c.dataset.group === label), 'click');
  await settle();
};
const gradeButtons = gradePickerButtons();
check('the open group\'s units are the six elementary grades, and only those',
  gradeButtons.map((b) => b.dataset.grade).join(',') === '1,2,3,4,5,6',
  gradeButtons.map((b) => b.dataset.grade).join(','));
check('grade 1 is selected by default', gradeButtons[0].className.includes('active'));
check('the three kanji unit groups are offered, primary first and open',
  unitGroupChips().map((c) => c.dataset.group).join(' | ')
    === 'Primary school grade | Secondary school | Names & places'
  && unitGroupChips()[0].className.includes('active'),
  unitGroupChips().map((c) => `${c.dataset.group}${c.className.includes('active') ? '*' : ''}`).join(' | '));

// A secondary sub-unit is a real, independently-loadable unit, not just a
// picker label — select one, open its overview, and open a character on it,
// proving the lazy load actually resolves to real per-kanji/stroke data the
// same way an elementary grade's does (see kanji-expansion-plan.md §4.1/§8).
await openUnitGroup('Secondary school');
check('opening the secondary group swaps the unit row over to its own sub-units, none of them elementary',
  gradePickerButtons().map((b) => b.dataset.grade).join(',') === '8-1,8-2,8-3,8-4,8-5,8-6',
  gradePickerButtons().map((b) => b.dataset.grade).join(','));
check('opening a group also selects a unit inside it, so the card below always matches the row',
  gradePickerButtons()[0].className.includes('active'));
const secondaryButton = gradePickerButtons().find((b) => b.dataset.grade === '8-3');
fire(secondaryButton, 'click');
await settle();
check('selecting a secondary sub-unit shows its own course card',
  (el('course-list')._children[0].innerHTML || '').includes('中学以降 3'),
  el('course-list')._children[0].innerHTML);

const secondaryViewSetButton = buttonsIn(el('course-list')._children[0])
  .find((b) => (b.innerHTML || '').includes('View set overview'));
fire(secondaryViewSetButton, 'click');
for (let i = 0; i < 10; i += 1) await settle(); // first-ever load of this sub-unit's manifest-listed characters
check('a secondary sub-unit\'s overview opens and lists its own kanji, not another unit\'s',
  visible() === 'screen-overview' && el('overview-grid')._children.length > 0,
  `showing ${visible()}, ${el('overview-grid')._children.length} tiles`);

const secondaryTile = el('overview-grid')._children[0];
const secondaryChar = secondaryTile.textContent;
fire(secondaryTile, 'click');
for (let i = 0; i < 10; i += 1) await settle(); // lazy-loads 8-3's real kanji/stroke data
check('opening a secondary-unit kanji renders its real readings, not a blank/fallback screen',
  el('detail-glyph').textContent === secondaryChar
  && el('detail-readings').hidden === false
  && el('detail-meanings').textContent.length > 0,
  `glyph "${el('detail-glyph').textContent}", meanings "${el('detail-meanings').textContent}"`);
check('the secondary-unit kanji also has a real stroke diagram, not the text fallback',
  el('detail-stroke')._children.length > 0);

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'detail-back' } }) } });
await settle();
fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'go-course' } }) } });
await settle();
await openUnitGroup('Primary school grade');
check('returning to the primary group lands back on the grade last selected there, not on a reset',
  gradePickerButtons().find((b) => b.className.includes('active')).dataset.grade === '1',
  gradePickerButtons().find((b) => b.className.includes('active')).dataset.grade);
fire(el('grade-picker')._children.find((b) => b.dataset.grade === '1'), 'click'); // back to grade 1
await settle();

const kanjiModes = el('mode-picker')._children;
check('kanji offers three modes', kanjiModes.length === 3,
  kanjiModes.map((b) => b.textContent).join(' | '));
check('the kanji modes are Definition, Yomi, Writing in that order — all three enabled now that kanji writing has its prompt panel',
  kanjiModes[0].textContent === 'Definition'
  && kanjiModes[1].textContent === 'Yomi'
  && kanjiModes[2].textContent === 'Writing' && kanjiModes[2].disabled === false,
  kanjiModes.map((b) => b.textContent || b.innerHTML).join(' | '));
check('the kana Reading mode is called Yomi here — same activity, per-script label',
  kanjiModes[1].dataset.mode === 'recognition');
// Entering kanji from a different script kind (kana) resets to kanji's own
// default — Definition — rather than carrying "Reading" over as "Yomi".
// Mode carry-over only applies within the same kind (hiragana <-> katakana,
// checked earlier).
check('opening kanji from kana defaults to Definition, not a carried-over Yomi',
  kanjiModes[0].className.includes('active') && kanjiModes[0].dataset.mode === 'definition',
  kanjiModes.map((b) => `${b.dataset.mode}:${b.className.includes('active')}`).join(' | '));

// Switch into Yomi explicitly for the rest of this section, which exercises
// the multi-select yomi quiz.
fire(kanjiModes[1], 'click');
await settle();
check('switching to Yomi selects it', el('mode-picker')._children[1].className.includes('active'));

// Switching to Yomi re-rendered the grade picker with fresh nodes.
const yomiGradeButtons = gradePickerButtons();
check('the grade picker survives the mode switch', yomiGradeButtons.length === 6,
  yomiGradeButtons.map((b) => b.dataset.grade).join(','));

// Switching grade re-renders the card for that grade.
fire(yomiGradeButtons[2], 'click'); // grade 3
await settle();
check('choosing a grade selects it', gradePickerButtons()[2].className.includes('active'));
check('the card follows the selected grade',
  (el('course-list')._children[0].innerHTML || '').includes('小学3年生'),
  el('course-list')._children[0].innerHTML);
fire(gradePickerButtons()[0], 'click'); // back to grade 1
await settle();
check('switching back to grade 1 works',
  (el('course-list')._children[0].innerHTML || '').includes('小学1年生'));

const kanjiLearnButton = buttonsIn(el('course-list')._children[0])
  .find((b) => (b.innerHTML || '').includes('Learn <b>'));
check('the kanji course offers an "add more" button', !!kanjiLearnButton);

fire(kanjiLearnButton, 'click');
// Starting a kanji session now lazily loads that grade's real data first
// (kanji-expansion-plan.md §4) — a real dynamic import, so it needs more
// than a couple of microtask hops to resolve, same as the canvas-touching
// waits elsewhere in this file.
for (let i = 0; i < 10; i += 1) await settle();
check('a kanji session opens the lesson screen first', visible() === 'screen-lesson', `showing ${visible()}`);
check('a kanji lesson shows readings instead of romaji',
  el('lesson-readings').hidden === false && el('lesson-romaji').hidden === true);
check('a kanji lesson shows a meaning', el('lesson-meanings').textContent.length > 0);

// Readings are tappable during the lesson too, not just after answering a
// Yomi question — seeing the word a reading comes from on first encounter
// is the point, not only at review time.
const lessonKanjiFirst = el('lesson-kana').textContent;
const lessonChips = el('lesson-readings')._children;
check('the lesson shows one chip per quizzed reading',
  lessonChips.length === kanjiInfo(KANJI_COURSES.find((c) => c.id === 'kanji-grade-1'), lessonKanjiFirst).quizReadings.length,
  `${lessonChips.length} chips`);
check('the example word is hidden until a reading is tapped', el('lesson-word').hidden === true);

// A word is now a drillable row (buildWordRow() in app.js), not a bare
// .kanji-word: #<slot> > .word-row > .word-line > .word-main, with the tray
// of kanji chips as the row's second child. The stub's querySelector()
// fabricates a placeholder per selector rather than walking _children (see
// its own comment above), so the nesting has to be stepped through by hand —
// only the innermost .word-kanji/.word-kana/.word-en spans, which renderWord
// writes via innerHTML + querySelector, can be read by selector.
const wordRowIn = (slot) => slot._children[0];
const wordLineOf = (row) => row._children[0];
const wordMainOf = (row) => wordLineOf(row)._children[0];
const wordTrayOf = (row) => row._children[1] || null;
const wordSurfaceOf = (row) => wordMainOf(row).querySelector('.word-kanji').textContent;
const addBadgeOf = (row) => wordLineOf(row).querySelectorAll('.word-add-badge')[0] || null;
const hasClick = (node) => !!(node && node._listeners.click && node._listeners.click.length > 0);

const lessonCourse = KANJI_COURSES.find((c) => c.id === 'kanji-grade-1');
const firstChip = lessonChips[0];
fire(firstChip, 'click');
await settle();
check('tapping a reading chip marks it active', firstChip.classList.contains('is-active'));
check('tapping a reading chip reveals the example word panel', el('lesson-word').hidden === false);
const firstExample = readingExample(lessonCourse, lessonKanjiFirst, firstChip.dataset.reading);
if (firstExample) {
  check('the shown word matches the reading that was tapped',
    wordSurfaceOf(wordRowIn(el('lesson-word'))) === firstExample.kanji,
    wordSurfaceOf(wordRowIn(el('lesson-word'))));
}

// The example word on a LESSON card is drillable too — teaching is not
// testing, and a word shown to be learned from is exactly where wanting to
// look closer at one of its kanji is reasonable. The session is left
// untouched and Back re-shows this very card (openFromLesson in app.js),
// the same trick the quiz's own "Full details" already uses.
if (firstExample) {
  const lessonRow = wordRowIn(el('lesson-word'));
  const lessonChipsInTray = wordTrayOf(lessonRow).querySelectorAll('.reading-chip');
  if (lessonChipsInTray.length > 0) {
    check('the lesson\'s example word starts with its tray closed',
      wordTrayOf(lessonRow).hidden === true);
    fire(wordMainOf(lessonRow), 'click');
    await settle();
    check('tapping the lesson\'s example word opens its tray of kanji',
      wordTrayOf(lessonRow).hidden === false);

    const drilled = lessonChipsInTray[0].textContent;
    fire(lessonChipsInTray[0], 'click');
    for (let i = 0; i < 10; i += 1) await settle();
    check('a kanji from the lesson\'s example word opens its own detail screen',
      visible() === 'screen-character-detail' && el('detail-glyph').textContent === drilled,
      `showing ${visible()}, glyph "${el('detail-glyph').textContent}"`);

    fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'detail-back' } }) } });
    await settle();
    check('Back returns to the lesson card, with the session still running',
      visible() === 'screen-lesson' && el('lesson-kana').textContent === lessonKanjiFirst,
      `showing ${visible()}, lesson kanji "${el('lesson-kana').textContent}"`);
  }
}

if (lessonChips.length > 1) {
  const secondChip = lessonChips[1];
  fire(secondChip, 'click');
  await settle();
  check('tapping a second reading moves the active mark, not adds to it',
    secondChip.classList.contains('is-active') && !firstChip.classList.contains('is-active'));
}

for (let i = 0; i < 10 && visible() === 'screen-lesson'; i += 1) {
  fire(el('lesson-next'), 'click');
  await settle();
}
check('the kanji lesson hands over to the quiz', visible() === 'screen-quiz', `showing ${visible()}`);

const kanjiCourse = KANJI_COURSES.find((c) => c.id === 'kanji-grade-1');
const currentProgress = () => [...rows.values()][0].progress;

let kAnswered = 0;
let kPerfectDone = false; let kPerfectKanji = null;
let kRecoverDone = false; let kRecoverKanji = null;
let kRevealDone2 = false; let kRevealKanji = null;
let kAdvancedDone = false;
let kExampleDone = false;

for (let i = 0; i < 40 && visible() === 'screen-quiz'; i += 1) {
  const kanji = el('quiz-kana').textContent;
  if (!kanji) break;
  const { correct } = buildKanjiOptions(kanjiCourse, kanji, 'recognition', currentProgress());
  const choices = el('quiz-choices')._children;
  check(`kanji question ${i + 1} offers ten options`, choices.length === 10);
  const correctButtons = choices.filter((c) => correct.has(c.dataset.reading));
  const wrongButtons = choices.filter((c) => !correct.has(c.dataset.reading));
  check(`kanji question ${i + 1} has both a correct and a wrong option to test with`,
    correctButtons.length > 0 && wrongButtons.length > 0);
  const advancedAvailable = kanjiInfo(kanjiCourse, kanji).quizReadings.length > correct.size;

  // Which scripted behaviour applies to THIS kanji is decided by what it
  // actually is, not by queue position: the quiz order is shuffled (see
  // buildSession's 'new' kind), and without the old in-session requeue on a
  // miss (see chooseAnswer()/markKanjiError() in app.js) there is no second
  // chance for a kanji that lands in the "wrong" slot — a fixed newPerSession
  // batch of 5 has to reliably exercise all four paths (advanced/perfect/
  // recover/reveal) in whatever order they happen to come in. advancedAvailable
  // is checked first because it can only be satisfied by specific kanji (the
  // ones with more readings than the base view shows); the other three don't
  // care which kanji they land on, so they just claim whichever is still
  // unclaimed.
  if (advancedAvailable && !kAdvancedDone) {
    // Growing the grid in place: existing buttons must not be replaced.
    kAdvancedDone = true;
    const before = [...choices];
    fire(el('quiz-advanced'), 'click');
    await settle();
    const grown = el('quiz-choices')._children;
    check('advanced adds buttons rather than rebuilding the grid',
      grown.length > before.length && before.every((b, idx) => grown[idx] === b));
    check('advanced hides itself once used', el('quiz-advanced').hidden === true);

    const { correct: advancedCorrect } = buildKanjiOptions(
      kanjiCourse, kanji, 'recognition', currentProgress(), { advanced: true },
    );
    check('advanced offers strictly more correct readings than the base view',
      advancedCorrect.size > correct.size);
    grown.filter((b) => advancedCorrect.has(b.dataset.reading)).forEach((b) => fire(b, 'click'));
    await settle();
    check('finding every reading including the newly-added ones unlocks Next',
      el('quiz-ok').hidden === false);
    fire(el('quiz-ok'), 'click');
    await settle();
  } else if (!kPerfectDone) {
    // Perfect run: click only the correct readings. Every one turns green
    // the instant it's clicked, and finding the last one unlocks Next with
    // no extra step — no submit button in this model.
    kPerfectDone = true; kPerfectKanji = kanji;
    correctButtons.forEach((b) => fire(b, 'click'));
    await settle();
    check('a perfect run marks every correct option right immediately',
      correctButtons.every((b) => b.classList.contains('is-right')));
    check('a perfect run unlocks Next without a separate submit step',
      el('quiz-ok').hidden === false);
    check('a perfect run reveals the meaning/word panel', el('quiz-info').hidden === false);
    check('a perfect yomi round is marked by the card alone, with no tick over it',
      el('quiz-feedback').textContent === '' && el('quiz-card').className.includes('is-correct'),
      `"${el('quiz-feedback').textContent}"`);
    check('show answers / advanced hide themselves once resolved',
      el('quiz-show-answers').hidden === true && el('quiz-advanced').hidden === true);
    fire(el('quiz-ok'), 'click'); // Next
    await settle();
  } else if (!kRecoverDone) {
    // One wrong click, then find everything else by exploring — recovering
    // still unlocks Next, but the record must already be sealed as a miss.
    kRecoverDone = true; kRecoverKanji = kanji;
    fire(wrongButtons[0], 'click');
    await settle();
    check('a wrong click turns red on the spot', wrongButtons[0].classList.contains('is-wrong'));
    check('a wrong click does not reveal any correct option',
      !correctButtons.some((b) => b.classList.contains('is-right')));
    check('a wrong click alone does not unlock Next', el('quiz-ok').hidden === true);
    check('show answers stays offered so exploring is optional', el('quiz-show-answers').hidden === false);

    correctButtons.forEach((b) => fire(b, 'click')); // "learning" — discovered after the miss
    await settle();
    check('finding everything after a miss still unlocks Next', el('quiz-ok').hidden === false);
    check('everything discovered through learning is still shown green',
      correctButtons.every((b) => b.classList.contains('is-right')));
    fire(el('quiz-ok'), 'click');
    await settle();
  } else if (!kRevealDone2) {
    // A wrong click, then give up via Show answers instead of exploring.
    kRevealDone2 = true; kRevealKanji = kanji;
    fire(wrongButtons[0], 'click');
    await settle();
    fire(el('quiz-show-answers'), 'click');
    await settle();
    check('show answers reveals every remaining correct reading',
      correctButtons.every((b) => b.classList.contains('is-right')));
    check('show answers unlocks Next', el('quiz-ok').hidden === false);
    fire(el('quiz-ok'), 'click');
    await settle();
  } else {
    correctButtons.forEach((b) => fire(b, 'click'));
    await settle();
    check(`question ${i + 1} resolves once every correct reading is found`,
      el('quiz-ok').hidden === false);

    if (!kExampleDone) {
      // Post-round: clicking a (now green) reading shows its example word
      // instead of doing anything to the grade — the round is already over.
      kExampleDone = true;
      const target = correctButtons[0];
      fire(target, 'click');
      await settle();
      check('a post-round click marks that reading active',
        target.classList.contains('is-active'));
      // A drillable row (buildWordRow()), same as the lesson card's own
      // example word above — appended via appendChild, which the stub's
      // innerHTML/textContent getters don't reflect (see the comment on
      // wordRowIn above), so _children is what actually proves it landed.
      check('a post-round click shows something in the word panel',
        el('quiz-word')._children.length > 0);
    }
    fire(el('quiz-ok'), 'click');
    await settle();
  }
  kAnswered += 1;
}

check('the perfect-first-try path was exercised', kPerfectDone);
check('the miss-then-recover-by-exploring path was exercised', kRecoverDone);
check('the miss-then-show-answers path was exercised', kRevealDone2);
check('the advanced-expansion path was exercised', kAdvancedDone);
check('the post-round example-word click was exercised', kExampleDone);
check('the kanji quiz ends at the summary', visible() === 'screen-summary', `showing ${visible()}`);

// --- Per-reading (yomi) records, and the kanji-level rollup ---------------

const afterKanji = [...rows.values()][0];
const yomiRecords = Object.entries(afterKanji.progress).filter(([k]) => k.split(':').length === 3);
check('kanji questions write per-reading records, not one record per kanji',
  yomiRecords.length > 0, `${yomiRecords.length} yomi records`);
check('every yomi record is keyed under recognition mode',
  yomiRecords.every(([k]) => k.startsWith('recognition:')));
check('every yomi record has correct/incorrect/streak fields',
  yomiRecords.every(([, r]) => 'correct' in r && 'incorrect' in r && 'streak' in r));

const perfectRollup = afterKanji.progress[`recognition:${kPerfectKanji}`];
check('a perfect-first-try kanji has a rollup record with zero lapses',
  !!perfectRollup && perfectRollup.lapses === 0, JSON.stringify(perfectRollup));

const recoverRollup = afterKanji.progress[`recognition:${kRecoverKanji}`];
check('a recovered miss still shows up as a lapse in the kanji rollup — recovering does not launder the record',
  !!recoverRollup && recoverRollup.lapses >= 1, JSON.stringify(recoverRollup));

const revealRollup = afterKanji.progress[`recognition:${kRevealKanji}`];
check('a shown-answers miss also counts as a lapse in the rollup',
  !!revealRollup && revealRollup.lapses >= 1);

// --- Definition mode ---------------------------------------------------
// Definition is single-answer (tap the English meaning) and kanji-only, so
// it appears in the kanji mode picker but not the kana one.

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'go-course' } }) } });
await settle();
check('back on the kanji course screen', visible() === 'screen-course', `showing ${visible()}`);

const defModeButton = el('mode-picker')._children.find((b) => b.dataset.mode === 'definition');
check('Definition is offered for kanji', !!defModeButton);
fire(defModeButton, 'click');
await settle();
check('switching mode stays on the course screen', visible() === 'screen-course');
check('Definition is now the active mode',
  el('mode-picker')._children.find((b) => b.dataset.mode === 'definition').className.includes('active'));
check('the grade picker is still available under Definition', el('grade-picker').hidden === false);

// Kana must not offer Definition at all — check by going back and in again.
fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'go-home' } }) } });
await settle();
fire(el('script-list')._children.find((c) => c.dataset.script === 'katakana'), 'click');
await settle();
check('kana has no Definition mode — there is no English meaning to quiz',
  !el('mode-picker')._children.some((b) => b.dataset.mode === 'definition'),
  el('mode-picker')._children.map((b) => b.dataset.mode).join(','));
check('an inapplicable mode falls back rather than leaving a blank screen',
  el('mode-picker')._children.some((b) => b.className.includes('active')));
check('katakana still shows its course card',
  (el('course-list')._children[0].innerHTML || '').includes('カタカナ'));

// Back to kanji Definition to actually run a session.
fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'go-home' } }) } });
await settle();
fire(el('script-list')._children.find((c) => c.dataset.script === 'kanji'), 'click');
await settle();
fire(el('mode-picker')._children.find((b) => b.dataset.mode === 'definition'), 'click');
await settle();

const defLearn = buttonsIn(el('course-list')._children[0])
  .find((b) => (b.innerHTML || '').includes('Learn <b>'));
check('Definition mode starts with its own separate progress (nothing learned yet)', !!defLearn);

fire(defLearn, 'click');
for (let i = 0; i < 10; i += 1) await settle(); // lazy grade load — see the earlier kanji session start
check('a definition session opens the lesson screen', visible() === 'screen-lesson', `showing ${visible()}`);
check('the definition lesson shows the meaning', el('lesson-meanings').textContent.length > 0);
for (let i = 0; i < 10 && visible() === 'screen-lesson'; i += 1) {
  fire(el('lesson-next'), 'click');
  await settle();
}
check('the definition lesson hands over to the quiz', visible() === 'screen-quiz', `showing ${visible()}`);
check('definition options use the roomier text grid, not the 5-across kana grid',
  el('quiz-choices').className.includes('choice-grid-text'), el('quiz-choices').className);

const kanjiGrade1 = KANJI_COURSES.find((c) => c.id === 'kanji-grade-1');
let defAnswered = 0;
let defMissDone = false;
let defMissKanji = null;
for (let i = 0; i < 30 && visible() === 'screen-quiz'; i += 1) {
  const kanji = el('quiz-kana').textContent;
  if (!kanji) break;
  const answer = meaningLabel(kanjiInfo(kanjiGrade1, kanji));
  const choices = el('quiz-choices')._children;
  check(`definition question ${i + 1} offers four options (two rows of two)`, choices.length === 4,
    `got ${choices.length}`);
  check(`definition question ${i + 1} offers English prose, not readings`,
    choices.every((c) => /[a-z]/i.test(c.textContent)),
    choices.map((c) => c.textContent).join(' | '));
  const right = choices.find((c) => c.textContent === answer);
  check(`definition question ${i + 1} offers its correct meaning`, !!right, `want "${answer}"`);
  if (!right) break;

  if (defAnswered === 1 && !defMissDone) {
    defMissDone = true;
    defMissKanji = kanji;
    const wrong = choices.find((c) => c.textContent !== answer);
    fire(wrong, 'click');
    await settle();
    check('a wrong definition gets one more try, same as kana',
      el('quiz-feedback').textContent === 'Try once more', `"${el('quiz-feedback').textContent}"`);
    fire(right, 'click');
    await settle();
    check('recovering on the second try marks it right', right.classList.contains('is-right'));
  } else {
    fire(right, 'click');
    await settle();
    check('a correct definition shows the readings as follow-up context',
      el('quiz-info').hidden === false && el('quiz-meanings').textContent.length > 0);
    check('a correct definition leaves the feedback line empty — the green card says it',
      el('quiz-feedback').textContent === '' && el('quiz-card').className.includes('is-correct'),
      `"${el('quiz-feedback').textContent}"`);
  }
  check('a resolved definition question waits for Next instead of auto-advancing',
    el('quiz-ok').hidden === false && timers.size === 0);
  fire(el('quiz-ok'), 'click');
  await settle();
  defAnswered += 1;
}
check('the definition miss-then-recover path was exercised', defMissDone);
check('the definition quiz ends at the summary', visible() === 'screen-summary', `showing ${visible()}`);

const afterDefinition = [...rows.values()][0];
const defRecords = Object.entries(afterDefinition.progress).filter(([k]) => k.startsWith('definition:'));
check('definition mode writes its own records, separate from yomi',
  defRecords.length > 0, `${defRecords.length} definition records`);
check('definition records are plain Leitner records, not per-reading ones',
  defRecords.every(([k]) => k.split(':').length === 2));
check('a definition miss recovered on the second try still counts as a lapse',
  afterDefinition.progress[`definition:${defMissKanji}`].lapses >= 1,
  JSON.stringify(afterDefinition.progress[`definition:${defMissKanji}`]));
check('yomi progress is untouched by definition practice — the modes are independent',
  Object.keys(afterDefinition.progress).some((k) => k.startsWith('recognition:')));

// The study list (kanji-expansion-plan.md §1) is maintained by real sessions,
// not only by the enrollment UI: "Add more" enrolls what it is about to teach,
// so the list stays an accurate description of what is being worked on without
// anyone curating it by hand.
check('a new profile starts with an empty study list, not an absent one — absent means un-migrated',
  afterDefinition.study && typeof afterDefinition.study === 'object',
  JSON.stringify(afterDefinition.study));
const studiedDefinition = Object.keys(afterDefinition.study)
  .filter((k) => 'definition' in afterDefinition.study[k]);
check('every kanji taught in a definition session was enrolled in the study list for that mode',
  studiedDefinition.length > 0
  && Object.keys(afterDefinition.progress)
    .filter((k) => k.startsWith('definition:'))
    .every((k) => studiedDefinition.includes(k.split(':')[1])),
  `${studiedDefinition.length} enrolled`);
check('kana practice never touches the study list — it is kanji-only',
  Object.keys(afterDefinition.study).every((k) => /[㐀-䶿一-鿿]/.test(k)),
  Object.keys(afterDefinition.study).join(''));

// --- Yomi after Definition: the answer grid must not inherit the other -----
// --- mode's layout ---------------------------------------------------------
// #quiz-choices is one element reused by every session. renderSingleChoice()
// leaves 'choice-grid-text' on it — a literal two-column CSS Grid sized for
// English definitions — and renderKanjiChoices() used not to set the class at
// all, so a Yomi session started any time after a Definition session laid its
// ten readings out as two columns of five on a phone with room for four
// across. Reported from a real device; invisible to this stub except as the
// class name itself, which is exactly what is asserted here.

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'go-home' } }) } });
await settle();
fire(el('script-list')._children.find((c) => c.dataset.script === 'kanji'), 'click');
await settle();
check('the definition session left the text grid class behind on the shared element',
  el('quiz-choices').className.includes('choice-grid-text'), el('quiz-choices').className);
fire(el('mode-picker')._children.find((b) => b.dataset.mode === 'recognition'), 'click');
await settle();
const yomiAgain = buttonsIn(el('course-list')._children[0])
  .find((b) => (b.innerHTML || '').includes('Review <b>'))
  || buttonsIn(el('course-list')._children[0]).find((b) => (b.innerHTML || '').includes('Learn <b>'));
check('a yomi session can be started again after a definition session', !!yomiAgain);
fire(yomiAgain, 'click');
for (let i = 0; i < 10; i += 1) await settle();
for (let i = 0; i < 10 && visible() === 'screen-lesson'; i += 1) {
  fire(el('lesson-next'), 'click');
  await settle();
}
check('a yomi quiz opened after a definition quiz is back on the adaptive reading grid',
  visible() === 'screen-quiz' && el('quiz-choices').className === 'choice-grid',
  `${visible()} / "${el('quiz-choices').className}"`);

// --- "Full details" out of a graded question, and back into it -------------
// The info panel that appears once a kanji question resolves can expand to
// the whole character detail screen without ending the session: the quiz
// screen is left standing, fully graded, and the back button (relabelled
// "← Back to test") just un-hides it again rather than re-rendering it.

const yomiDetailKanji = el('quiz-kana').textContent;
const yomiDetailInfo = kanjiInfo(KANJI_COURSES.find((c) => c.id === 'kanji-grade-1'), yomiDetailKanji);
el('quiz-choices')._children
  .filter((c) => yomiDetailInfo.quizReadings.includes(c.dataset.reading))
  .forEach((c) => fire(c, 'click'));
await settle();
check('finding every reading resolves the round and offers the info panel',
  el('quiz-ok').hidden === false && el('quiz-info').hidden === false);

fire(el('quiz-info-more'), 'click');
for (let i = 0; i < 10; i += 1) await settle();
check('"Full details" opens the character detail screen mid-question',
  visible() === 'screen-character-detail', `showing ${visible()}`);
check('detail shows the character that was just answered',
  el('detail-glyph').textContent === yomiDetailKanji);
check('the back button says where it goes when a test is waiting behind it',
  el('detail-back').textContent === '← Back to test'
  && el('detail-back').getAttribute('aria-label') === 'Back to test',
  `"${el('detail-back').textContent}"`);
check('"Study it now" is withheld mid-question — it would start a new session over this one',
  el('detail-study-now').hidden === true);

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'detail-back' } }) } });
await settle();
check('back returns to the very same graded question, not a fresh one',
  visible() === 'screen-quiz' && el('quiz-kana').textContent === yomiDetailKanji
  && el('quiz-ok').hidden === false && el('quiz-info').hidden === false,
  `showing ${visible()}`);

// Enter is the keyboard equivalent of the Next button — mouse in one hand,
// keyboard in the other. It can only ever press a button already on screen,
// so it can never answer a question, only move past one already answered.
fire(document, 'keydown', { key: 'Enter' });
await settle();
check('Enter presses Next on a resolved question',
  visible() !== 'screen-quiz' || el('quiz-kana').textContent !== yomiDetailKanji,
  `still on ${el('quiz-kana').textContent}`);
if (visible() === 'screen-quiz') {
  const unresolvedKanji = el('quiz-kana').textContent;
  check('Next is not offered on a fresh question', el('quiz-ok').hidden === true);
  fire(document, 'keydown', { key: 'Enter' });
  await settle();
  check('Enter does nothing while a question is still unanswered',
    visible() === 'screen-quiz' && el('quiz-kana').textContent === unresolvedKanji);
}

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'quit-session' } }) } });
await settle();

// --- Kanji writing (phase 4 of writing-mode-plan.md) -----------------------
// Kana writing is prompted by its romaji, an unambiguous single clue. A
// kanji has no equivalent single glyph to prompt with, so writing mode
// needed its own panel: the readings and meaning actually taught (same data
// as Yomi/Definition), plus an example word — masked, since it's spelled
// using the target kanji drawn in its correct form, which would hand over
// the answer before a single stroke is drawn. Reuses the exact same canvas/
// grading pipeline already proven above for kana.

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'go-home' } }) } });
await settle();
fire(el('script-list')._children.find((c) => c.dataset.script === 'kanji'), 'click');
await settle();
const kanjiWritingModeButton = el('mode-picker')._children.find((b) => b.dataset.mode === 'writing');
check('kanji writing is enabled now that it has its prompt panel', !!kanjiWritingModeButton && kanjiWritingModeButton.disabled === false);
fire(kanjiWritingModeButton, 'click');
await settle();

const kanjiWritingLearn = buttonsIn(el('course-list')._children[0])
  .find((b) => (b.innerHTML || '').includes('Learn <b>'));
check('kanji writing starts with its own separate progress', !!kanjiWritingLearn);
fire(kanjiWritingLearn, 'click');
for (let i = 0; i < 10; i += 1) await settle();

check('a kanji writing session opens the lesson screen', visible() === 'screen-lesson', `showing ${visible()}`);
check('the kanji writing lesson also animates the stroke order',
  el('lesson-stroke-wrap').hidden === false && el('lesson-stroke')._children.length > 0);
for (let i = 0; i < 10 && visible() === 'screen-lesson'; i += 1) {
  fire(el('lesson-next'), 'click');
  await settle();
}
check('the kanji writing lesson hands over to the writing screen', visible() === 'screen-writing', `showing ${visible()}`);

const kanjiWritingChar = el('screen-writing').dataset.char;
const kanjiWritingInfo = kanjiInfo(kanjiGrade1, kanjiWritingChar);
check('the kanji prompt panel replaces the romaji prompt',
  el('writing-romaji').hidden === true && el('writing-kanji-info').hidden === false);
check('the kanji prompt shows the on/kun readings actually taught',
  el('writing-kanji-readings').textContent.length > 0, el('writing-kanji-readings').textContent);
check('the kanji prompt shows the English meaning',
  el('writing-kanji-meanings').textContent === kanjiWritingInfo.meanings.join(', '));
const writingWordKanji = el('writing-kanji-word').querySelector('.word-kanji').textContent;
check("the prompt's example word is masked — it never shows the target kanji itself",
  !writingWordKanji.includes(kanjiWritingChar), writingWordKanji);

const kanjiWritingStrokeCount = strokesFor(kanjiWritingChar).strokes.length;
for (let i = 0; i < kanjiWritingStrokeCount; i += 1) {
  traceModelStroke(kanjiWritingChar, i);
  await settle();
}
check('a perfectly traced kanji is accepted, same grading pipeline as kana',
  el('writing-result').hidden === false && el('writing-result-message').textContent === 'Nicely done!');
check('every character in a brand-new writing session defaults to Trace — none has a mastery record yet',
  el('writing-hints').hidden === true); // Trace never shows the peek/switch-easier row

fire(el('writing-next'), 'click');
await settle();

// Every other mode's quiz is driven all the way to the summary screen and
// checked there (see the recognition/Yomi/Definition sections above) —
// writing mode never had been, so this is also the first proof that
// finishSession()/the summary chips work correctly for it, not just that a
// single question does.
for (let i = 0; i < 10 && visible() === 'screen-writing'; i += 1) {
  const char = el('screen-writing').dataset.char;
  const strokeCount = strokesFor(char).strokes.length;
  for (let s = 0; s < strokeCount; s += 1) {
    traceModelStroke(char, s);
    await settle();
  }
  fire(el('writing-next'), 'click');
  await settle();
}
check('a completed kanji writing session reaches the summary, same as every other mode',
  visible() === 'screen-summary', `showing ${visible()}`);
check('the writing summary reports a score', el('summary-score').textContent.length > 0,
  `"${el('summary-score').textContent}"`);
const writingSummaryChips = el('summary-list')._children;
check('the writing summary shows one chip per character, each with a non-blank reading label',
  writingSummaryChips.length > 0
  && writingSummaryChips.every((c) => c.querySelector('.chip-romaji').textContent.length > 0),
  writingSummaryChips.map((c) => c.querySelector('.chip-romaji').textContent).join(' | '));

// Summary chips are tappable now (kanji-expansion-plan.md §2.3) — exactly
// where seeing a miss makes you want to look closer, or seeing a pass makes
// you want to add writing practice for it. Back returns to the summary
// itself, not the course screen, since that is genuinely where this was
// opened from — see openCharacterDetail()'s `returnTo` and the 'detail-back'
// action in app.js.
const summaryChipChar = writingSummaryChips[0].querySelector('.chip-kana').textContent;
fire(writingSummaryChips[0], 'click');
for (let i = 0; i < 10; i += 1) await settle(); // opening detail lazily (re-)loads the grade's data
check('tapping a summary chip opens the detail screen for that character',
  visible() === 'screen-character-detail' && el('detail-glyph').textContent === summaryChipChar,
  `showing ${visible()}, glyph "${el('detail-glyph').textContent}"`);

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'detail-back' } }) } });
await settle();
check('backing out of a detail screen opened from the summary returns to the summary, not the overview',
  visible() === 'screen-summary', `showing ${visible()}`);

// The overview/detail screens are driven entirely by state.mode, with no
// writing-specific branch of their own (see writing-mode-plan.md §1: "the
// Leitner grade() is mode-agnostic — progress storage needs no changes at
// all"). This is the first check that actually proves it for writing mode,
// rather than just relying on that being true by construction.
fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'go-course' } }) } });
await settle();
check('back on the kanji course screen after the writing session', visible() === 'screen-course', `showing ${visible()}`);

const kanjiWritingViewSetButton = buttonsIn(el('course-list')._children[0])
  .find((b) => (b.innerHTML || '').includes('View set overview'));
fire(kanjiWritingViewSetButton, 'click');
await settle();
check('the overview opens under writing mode too', visible() === 'screen-overview', `showing ${visible()}`);

const kanjiWritingOverviewTiles = el('overview-grid')._children;
const practicedTile = kanjiWritingOverviewTiles.find((t) => t.textContent === kanjiWritingChar);
check('the character just practiced in writing mode shows progress in the writing overview, not tier-0',
  !!practicedTile && !practicedTile.className.includes('tier-0'),
  practicedTile && practicedTile.className);

fire(practicedTile, 'click');
for (let i = 0; i < 10; i += 1) await settle(); // opening detail lazily (re-)loads the grade's data
check('the writing-mode detail screen shows a mastery tier beyond "Not started"',
  el('detail-mastery').textContent !== 'Not started', el('detail-mastery').textContent);
check('the writing-mode detail screen still renders the stroke diagram',
  el('detail-stroke')._children.length > 0);
check('a kanji detail screen under writing mode still shows readings and a meaning, same as any other kanji mode',
  el('detail-readings').hidden === false && el('detail-meanings').textContent.length > 0);

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'detail-back' } }) } });
await settle();

// --- Writing practice mode: fixed vs Dynamic, chosen before starting ------
// A choice on the course screen, made BEFORE a session starts, so a fixed
// mode applies from the very first character too — without this, the first
// character of every session is brand new and Dynamic would always start it
// in Trace, one question too late for a learner who wants Guided from the
// very start. Uses grade 2, untouched by any earlier section, so its first
// character is guaranteed to have no mastery record at all.

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'go-course' } }) } });
await settle();
check('back on the kanji course screen', visible() === 'screen-course', `showing ${visible()}`);

fire(el('grade-picker')._children.find((b) => b.dataset.grade === '2'), 'click');
await settle();

const modePrefButtons = el('writing-mode-picker')._children;
check('the writing practice-mode picker offers Dynamic, Trace, Guided, Free, in that order',
  modePrefButtons.map((b) => b.textContent).join(',') === 'Dynamic,Trace,Guided,Free',
  modePrefButtons.map((b) => b.textContent).join(','));
check('it defaults to Dynamic', modePrefButtons[0].className.includes('active'));

fire(modePrefButtons.find((b) => b.textContent === 'Guided'), 'click');
await settle();
const modePrefButtonsAfter = el('writing-mode-picker')._children;
check('choosing Guided marks it active and Dynamic no longer active',
  modePrefButtonsAfter.find((b) => b.textContent === 'Guided').className.includes('active')
  && !modePrefButtonsAfter.find((b) => b.textContent === 'Dynamic').className.includes('active'));

const gradeTwoSaved = [...rows.values()][0];
check('the choice is persisted to the profile immediately, before any session has started',
  gradeTwoSaved.settings.writingModePreference === 'guided', JSON.stringify(gradeTwoSaved.settings));

const gradeTwoLearn = buttonsIn(el('course-list')._children[0])
  .find((b) => (b.innerHTML || '').includes('Learn <b>'));
fire(gradeTwoLearn, 'click');
for (let i = 0; i < 10; i += 1) await settle();
for (let i = 0; i < 10 && visible() === 'screen-lesson'; i += 1) {
  fire(el('lesson-next'), 'click');
  await settle();
}
check('the fixed-preference session reaches the writing screen', visible() === 'screen-writing', `showing ${visible()}`);
check('a Guided preference applies from the very first character, even though it is brand new — Dynamic would have picked Trace for it',
  el('writing-guide').className.includes('mode-guided')
  && el('writing-mode-guided').className.includes('active')
  && el('writing-hints').hidden === false,
  el('writing-guide').className);

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'quit-session' } }) } });
await settle();
// Grade 1 is what every later section assumes is selected.
fire(el('grade-picker')._children.find((b) => b.dataset.grade === '1'), 'click');
await settle();

// --- Set overview and character detail -------------------------------------
// Reached from the course screen's "View set overview" button — a plain
// clickable-looking text line was not obviously tappable, so this is now a
// real bordered button. The overview shows the WHOLE course at once (up to
// 200 characters for the biggest kanji grade), not one 5-character set with
// prev/next paging between them. Uses katakana specifically: no session has
// touched it anywhere above, so every tile should show as tier-0
// ("not started") — a clean baseline for the colour-coding check.

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'go-home' } }) } });
await settle();
fire(el('script-list')._children.find((c) => c.dataset.script === 'katakana'), 'click');
await settle();

const viewSetButton = buttonsIn(el('course-list')._children[0])
  .find((b) => (b.innerHTML || '').includes('View set overview'));
check('the course card has an obvious "View set overview" button', !!viewSetButton,
  buttonsIn(el('course-list')._children[0]).map((b) => b.innerHTML).join(' | '));

fire(viewSetButton, 'click');
await settle();
check('opening the overview shows the overview screen', visible() === 'screen-overview', `showing ${visible()}`);

const katakanaCourse = getCourse('katakana');
const katakanaChars = katakanaCourse.chunks.flatMap((c) => c.items);
const tiles = el('overview-grid')._children;
check('the overview shows every character in the whole course, not one 5-character set',
  tiles.length === katakanaChars.length, `${tiles.length} tiles, expected ${katakanaChars.length}`);
check('every tile in an untouched course shows as not-started (tier-0)',
  tiles.every((t) => t.className.includes('tier-0')), tiles.map((t) => t.className).join(' | '));
check('the overview counter shows the total character count',
  el('overview-counter').textContent === `${katakanaChars.length} characters`,
  el('overview-counter').textContent);
check('opening the overview scrolls to the current set (tile 0 — nothing learned yet)',
  tiles[0]._scrolledIntoView === true);

// Tap a tile well into the list, not the first one, so returning from detail
// can prove it scrolls back to where you were rather than snapping to the
// top of a 104-tile list.
const deepIndex = 40;
const deepTile = tiles[deepIndex];
const deepTileChar = deepTile.textContent;
fire(deepTile, 'click');
await settle();
check('tapping a tile opens the character detail screen',
  visible() === 'screen-character-detail', `showing ${visible()}`);
check('the detail screen shows the tapped character', el('detail-glyph').textContent === deepTileChar);
check('a kana detail screen shows romaji, not readings',
  el('detail-romaji').hidden === false && el('detail-readings').hidden === true);
check('the detail screen renders a stroke diagram', el('detail-stroke')._children.length > 0);
check('an untouched character is labelled "Not started"',
  el('detail-mastery').textContent === 'Not started', el('detail-mastery').textContent);

fire(el('detail-play-strokes'), 'click'); // must not throw without real SVG geometry
await settle();

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'detail-back' } }) } });
await settle();
check('backing out of detail returns to the overview, not the course screen',
  visible() === 'screen-overview', `showing ${visible()}`);
const rebuiltTiles = el('overview-grid')._children;
check('the overview is rebuilt with the same full character set on return',
  rebuiltTiles.length === katakanaChars.length);
check('returning from detail scrolls back to that character, not the top of the list',
  rebuiltTiles[deepIndex]._scrolledIntoView === true,
  `tile ${deepIndex} (${rebuiltTiles[deepIndex].textContent})`);

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'go-course' } }) } });
await settle();
check('backing out of the overview returns to the course screen',
  visible() === 'screen-course', `showing ${visible()}`);

// Kanji detail: readings should be tappable, same mechanism as the lesson
// card and the post-quiz reveal.
fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'go-home' } }) } });
await settle();
fire(el('script-list')._children.find((c) => c.dataset.script === 'kanji'), 'click');
await settle();
const kanjiViewSetButton = buttonsIn(el('course-list')._children[0])
  .find((b) => (b.innerHTML || '').includes('View set overview'));
fire(kanjiViewSetButton, 'click');
await settle();
check('opening a kanji overview shows the overview screen', visible() === 'screen-overview');

const kanjiGrade1Course = KANJI_COURSES.find((c) => c.id === 'kanji-grade-1');
check('the kanji overview shows the whole grade (80 kanji), not one set',
  el('overview-grid')._children.length === kanjiGrade1Course.chunks.flatMap((c) => c.items).length);

const kanjiTile = el('overview-grid')._children[0];
fire(kanjiTile, 'click');
for (let i = 0; i < 10; i += 1) await settle(); // opening detail lazily (re-)loads the grade's data
check('a kanji detail screen shows readings instead of romaji',
  el('detail-romaji').hidden === true && el('detail-readings').hidden === false);
check('a kanji detail screen shows a meaning', el('detail-meanings').textContent.length > 0);

const detailChips = el('detail-readings')._children;
check('the kanji detail screen offers reading chips', detailChips.length > 0);
if (detailChips.length > 0) {
  fire(detailChips[0], 'click');
  await settle();
  check('tapping a reading chip on the detail screen reveals the word panel',
    el('detail-word').hidden === false);
  check('tapping the chip marks it active', detailChips[0].classList.contains('is-active'));
}

// --- Kanji search ------------------------------------------------------
// Phase 4 of kanji-expansion-plan.md §2.2. Finds a kanji by character,
// meaning, or reading (kana or romaji), across every grade at once, without
// needing to know which one it's in. 一 (grade 1: on イチ/イツ, kun ひと,
// meaning "one") is used throughout, since its data is simple and fixed.

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'go-course' } }) } });
await settle();
check('the kanji search box is offered', el('kanji-search-wrap').hidden === false);
check('with no query, the grade-scoped course card is shown as normal',
  el('grade-picker').hidden === false && el('course-list')._children.length > 0);

function typeKanjiSearch(query) {
  el('kanji-search').value = query;
  fire(el('kanji-search'), 'input', { target: el('kanji-search') });
}

typeKanjiSearch('一');
// The first non-empty query kicks off a real, one-time load of every
// grade's kanji data (search doesn't know which grade to look in ahead of
// time — see renderKanjiSearchResults() in app.js) — a real dynamic import,
// same as the lazy grade loads above.
for (let i = 0; i < 10; i += 1) await settle();
check('searching by the character itself finds it, and the grade-scoped card steps aside',
  el('kanji-search-results')._children.some((t) => t.textContent === '一')
  && el('grade-picker').hidden === true && el('course-list')._children.length === 0,
  el('kanji-search-results')._children.map((t) => t.textContent).join(''));

typeKanjiSearch('one');
await settle();
check('searching by an English meaning also finds it',
  el('kanji-search-results')._children.some((t) => t.textContent === '一'),
  el('kanji-search-results')._children.map((t) => t.textContent).join(''));

typeKanjiSearch('ichi');
await settle();
check('searching by a romaji reading also finds it',
  el('kanji-search-results')._children.some((t) => t.textContent === '一'),
  el('kanji-search-results')._children.map((t) => t.textContent).join(''));

typeKanjiSearch('ひと');
await settle();
check('searching by a kana reading also finds it',
  el('kanji-search-results')._children.some((t) => t.textContent === '一'),
  el('kanji-search-results')._children.map((t) => t.textContent).join(''));

typeKanjiSearch('zzz-not-a-real-reading');
await settle();
check('a query with no matches shows the empty message, not a blank grid',
  el('kanji-search-empty').hidden === false && el('kanji-search-results')._children.length === 0);

typeKanjiSearch('一');
await settle();
const searchTile = el('kanji-search-results')._children.find((t) => t.textContent === '一');
fire(searchTile, 'click');
for (let i = 0; i < 10; i += 1) await settle(); // opening detail lazily (re-)loads the grade's data
check('tapping a search result opens the detail screen for that character',
  visible() === 'screen-character-detail' && el('detail-glyph').textContent === '一');

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'detail-back' } }) } });
await settle();
check('backing out of a detail screen opened from search returns to the course screen, search intact',
  visible() === 'screen-course' && el('kanji-search').value === '一'
  && el('kanji-search-results')._children.some((t) => t.textContent === '一'));

typeKanjiSearch('');
await settle();
check('clearing the search brings the grade-scoped card back',
  el('grade-picker').hidden === false && el('kanji-search-results')._children.length === 0);

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'go-home' } }) } });
await settle();
fire(el('script-list')._children.find((c) => c.dataset.script === 'hiragana'), 'click');
await settle();
check('kana has no study list to search, so the search box never appears there',
  el('kanji-search-wrap').hidden === true);

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'go-home' } }) } });
await settle();
fire(el('script-list')._children.find((c) => c.dataset.script === 'kanji'), 'click');
await settle();

// --- Study-list enrollment from the detail screen --------------------------
// Phase 2 of kanji-expansion-plan.md. Grade 6 is untouched by everything
// above, so its first kanji is guaranteed never-studied — a clean slate to
// prove the three-state model (kanji-expansion-plan.md §1.2) and both levels
// of the enrollment UI: the headline bulk toggle and the three independent
// per-mode ones underneath it.

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'go-course' } }) } });
await settle();
// Definition, specifically: state.mode carried over as 'writing' from the
// section above (kind stayed 'kanji' throughout, so it was never reset),
// and "Study it now" below needs a mode where finishing the one-item session
// it starts is a plain multiple-choice tap, not a canvas trace.
fire(el('mode-picker')._children.find((b) => b.dataset.mode === 'definition'), 'click');
await settle();
fire(el('grade-picker')._children.find((b) => b.dataset.grade === '6'), 'click');
await settle();
const grade6ViewSetButton = buttonsIn(el('course-list')._children[0])
  .find((b) => (b.innerHTML || '').includes('View set overview'));
fire(grade6ViewSetButton, 'click');
await settle();

const grade6Tile = el('overview-grid')._children[0];
const grade6Char = grade6Tile.textContent;
fire(grade6Tile, 'click');
for (let i = 0; i < 10; i += 1) await settle(); // opening detail lazily loads grade 6's data (first time)

const modeToggleIds = ['detail-mode-definition', 'detail-mode-recognition', 'detail-mode-writing'];
check('a never-studied kanji shows "Not started" on its detail screen',
  el('detail-study').hidden === false && el('detail-study-toggle').textContent.includes('Not started'),
  el('detail-study-toggle').textContent);
check('kanji folds mastery into that one button rather than a separate line',
  el('detail-mastery').hidden === true);
check('its per-mode toggles all start inactive',
  modeToggleIds.every((id) => !el(id).className.includes('active')),
  modeToggleIds.map((id) => el(id).className).join(' | '));

fire(el('detail-study-toggle'), 'click');
await settle();
check('tapping the headline button enrolls it in every applicable mode at once',
  el('detail-study-toggle').textContent.includes('Waiting to learn')
  && modeToggleIds.every((id) => el(id).hidden || el(id).className.includes('active')),
  modeToggleIds.map((id) => `${id}:${el(id).className}`).join(' | '));

const grade6Saved = [...rows.values()][0];
check('enrolling is persisted to the profile immediately, before any session has taught it',
  typeof grade6Saved.study[grade6Char] === 'object' && !Array.isArray(grade6Saved.study[grade6Char])
  && Object.keys(grade6Saved.study[grade6Char]).length >= 1,
  JSON.stringify(grade6Saved.study[grade6Char]));

// Bug fix: masteryTier alone can't tell "enrolled, not yet taught" apart
// from "never enrolled" — both have no progress record, so both were tier-0
// with nothing to distinguish them on the overview.
fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'detail-back' } }) } });
await settle();
const grade6TileAfterEnroll = el('overview-grid')._children.find((t) => t.textContent === grade6Char);
check('an enrolled-but-not-taught kanji gets a distinct "pending" marker on the overview',
  grade6TileAfterEnroll.className.includes('is-pending') && grade6TileAfterEnroll.className.includes('tier-0'),
  grade6TileAfterEnroll.className);

fire(grade6TileAfterEnroll, 'click');
for (let i = 0; i < 10; i += 1) await settle(); // opening detail lazily loads grade 6's data (first time)

// "Study it now": jump straight to a lesson-then-quiz session for just this
// one kanji rather than waiting for "Add more" to reach it through whatever
// else happens to be pending ahead of it in grade order.
check('"Study it now" is offered for a kanji waiting to learn in the current mode',
  el('detail-study-now').hidden === false);

fire(el('detail-study-now'), 'click');
for (let i = 0; i < 10; i += 1) await settle();
check('"Study it now" jumps straight into a lesson for just this one kanji',
  visible() === 'screen-lesson', `showing ${visible()}`);
fire(el('lesson-next'), 'click');
await settle();
check('"Study it now" then quizzes exactly that one kanji, not a whole set',
  visible() === 'screen-quiz', `showing ${visible()}`);

const grade6Course = KANJI_COURSES.find((c) => c.id === 'kanji-grade-6');
const studyNowAnswer = meaningLabel(kanjiInfo(grade6Course, grade6Char));
const studyNowRight = el('quiz-choices')._children.find((c) => c.textContent === studyNowAnswer);
fire(studyNowRight, 'click');
await settle();
fire(el('quiz-ok'), 'click'); // resolved questions wait for Next, not a timer, now
await settle();
check('answering the one question ends the session at the summary',
  visible() === 'screen-summary', `showing ${visible()}`);

// Back to the detail screen via the now-tappable summary chip, to confirm
// teaching it moved it out of "waiting".
fire(el('summary-list')._children[0], 'click');
for (let i = 0; i < 10; i += 1) await settle(); // opening detail lazily (re-)loads the grade's data
check('the detail screen names which unit the kanji is taught in',
  el('detail-unit').textContent === unitLabel('6'), el('detail-unit').textContent);
check('after being taught in one mode, the kanji is past "Waiting to learn" overall',
  !el('detail-study-toggle').textContent.includes('Waiting to learn')
  && !el('detail-study-toggle').textContent.includes('Not started'),
  el('detail-study-toggle').textContent);
// It was enrolled in every applicable mode via the headline toggle but only
// actually taught in Definition just now — Recognition and Writing are
// still untaught, so "Study it now" must keep offering to teach those,
// not disappear just because the ONE mode it happened to run in is done.
check('"Study it now" stays offered while other enrolled modes are still untaught',
  el('detail-study-now').hidden === false);

// --- Review scope: "This set" vs "Everything I'm studying" -----------------
// Phase 3, kanji-expansion-plan.md §2.4. grade6Char was just taught in
// 'definition' mode above (still enrolled — the un-enroll test is further
// down). Needs a genuinely DUE grade-1 kanji to prove the wider scope
// actually pulls from more than one grade — deliberately created here rather
// than reused from defMissKanji earlier: grading always reflects the latest
// attempt, not "ever having lapsed", and defMissKanji was re-queued and
// answered correctly later in that same section, so by now it is not due.

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'go-home' } }) } });
await settle();
fire(el('script-list')._children.find((c) => c.dataset.script === 'kanji'), 'click');
await settle();
fire(el('mode-picker')._children.find((b) => b.dataset.mode === 'definition'), 'click');
await settle();
fire(el('grade-picker')._children.find((b) => b.dataset.grade === '1'), 'click');
await settle();

const profileBeforeMiss = [...rows.values()][0];
const grade1Untouched = kanjiGrade1.chunks.flatMap((c) => c.items)
  .find((k) => !profileBeforeMiss.progress[`definition:${k}`]);

fire(buttonsIn(el('course-list')._children[0]).find((b) => (b.innerHTML || '').includes('View set overview')), 'click');
await settle();
fire(el('overview-grid')._children.find((t) => t.textContent === grade1Untouched), 'click');
await settle();
fire(el('detail-study-toggle'), 'click'); // enrolls it in every applicable mode
await settle();
fire(el('detail-study-now'), 'click');
for (let i = 0; i < 10; i += 1) await settle();
fire(el('lesson-next'), 'click');
await settle();

const grade1UntouchedAnswer = meaningLabel(kanjiInfo(kanjiGrade1, grade1Untouched));
const grade1WrongChoice = el('quiz-choices')._children.find((c) => c.textContent !== grade1UntouchedAnswer);
fire(grade1WrongChoice, 'click');
await settle();
// Quit right after the first (recorded) miss, before it can be re-queued
// and answered correctly — see the comment above.
fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'quit-session' } }) } });
await settle();

fire(el('grade-picker')._children.find((b) => b.dataset.grade === '6'), 'click');
await settle();
check('the quick-actions row is offered for kanji', el('quick-actions').hidden === false);

const profileForScope = [...rows.values()][0];
const grade6OnlyStats = courseStats(grade6Course, 'definition', profileForScope);
const studyingPool = {
  chunks: [{ items: studiedKanji(profileForScope.study, 'definition') }], excludeForMode: {},
};
const studyingStats = courseStats(studyingPool, 'definition', profileForScope);
check('"Review all due" spans every grade — more started kanji than grade 6 alone',
  studyingStats.started > grade6OnlyStats.started,
  `grade 6 alone: ${grade6OnlyStats.started}, everything: ${studyingStats.started}`);
check('grade 6 alone has nothing due yet, so its own card offers Practise rather than Review',
  buttonsIn(el('course-list')._children[0]).some((b) => b.textContent === 'Practise'),
  buttonsIn(el('course-list')._children[0]).map((b) => b.textContent).join(' | '));
check('the quick "Review all due" button still surfaces the still-due grade-1 miss while browsing grade 6',
  (el('quick-review-due').innerHTML || '').includes('Review'), el('quick-review-due').innerHTML);

fire(el('quick-review-due'), 'click');
for (let i = 0; i < 10; i += 1) await settle();
check('reviewing from the quick action actually pulls in a kanji from grade 1, not just grade 6',
  visible() === 'screen-quiz' && kanjiGrade1.chunks.flatMap((c) => c.items).includes(el('quiz-kana').textContent),
  `showing ${visible()}, kanji "${el('quiz-kana').textContent}"`);

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'quit-session' } }) } });
await settle();

// "Learn next" must be just as grade-picker-agnostic as "Review all due" —
// grade 6 is still selected below, but grade 1 (only one of its 80 kanji
// ever touched, up above) is nowhere near exhausted, so the next few
// characters in curriculum order still come from grade 1, not grade 6.
check('the quick "Learn next" button is offered while browsing grade 6', !el('quick-learn-next').disabled);
fire(el('quick-learn-next'), 'click');
for (let i = 0; i < 10; i += 1) await settle();
check('"Learn next" teaches from the start of the curriculum (grade 1), not whichever grade the picker has selected (grade 6)',
  visible() === 'screen-lesson' && kanjiGrade1.chunks.flatMap((c) => c.items).includes(el('lesson-kana').textContent),
  `showing ${visible()}, lesson kanji "${el('lesson-kana').textContent}"`);

// Walk the lesson cards through to the quiz, deliberately missing the very
// first question — to prove a miss no longer gets a second, in-session
// chance (the counter just advances normally, no held-back state to check
// for), and to prove the end-of-session summary's chips still open the
// detail screen even though this session's course is the synthetic
// all-kanji pool, not a single real grade.
for (let i = 0; i < 10 && visible() === 'screen-lesson'; i += 1) {
  fire(el('lesson-next'), 'click');
  await settle();
}
check('the "Learn next" lesson hands over to the quiz', visible() === 'screen-quiz', visible());

const learnNextCounterAtQ1 = el('quiz-counter').textContent;
check('the counter starts at 1 of the taught batch', learnNextCounterAtQ1 === '1/5', learnNextCounterAtQ1);

const missedLearnNextKanji = el('quiz-kana').textContent;
const missedLearnNextAnswer = meaningLabel(kanjiInfo(kanjiGrade1, missedLearnNextKanji));
const missedLearnNextChoices = el('quiz-choices')._children;
const missedLearnNextWrong = missedLearnNextChoices.find((c) => c.textContent !== missedLearnNextAnswer);
const missedLearnNextRight = missedLearnNextChoices.find((c) => c.textContent === missedLearnNextAnswer);
fire(missedLearnNextWrong, 'click');
await settle();
fire(missedLearnNextRight, 'click'); // recover on the second try — still counts as a miss for the record either way
await settle();
fire(el('quiz-ok'), 'click'); // resolved questions wait for Next, not a timer, now
await settle();

check('a miss just advances the counter like any other resolved question — no in-session requeue to hold it back',
  el('quiz-counter').textContent === '2/5', el('quiz-counter').textContent);

// Answer the rest correctly through to the summary — exactly 4 more, since
// the missed kanji above does not come back for a repeat.
for (let i = 0; i < 10 && visible() === 'screen-quiz'; i += 1) {
  const kanji = el('quiz-kana').textContent;
  if (!kanji) break;
  const answer = meaningLabel(kanjiInfo(kanjiGrade1, kanji));
  const right = el('quiz-choices')._children.find((c) => c.textContent === answer);
  fire(right, 'click');
  await settle();
  fire(el('quiz-ok'), 'click');
  await settle();
}
check('the "Learn next" session completes at the summary', visible() === 'screen-summary', visible());
check('the counter reached the full batch by the end',
  el('quiz-counter').textContent === '5/5', el('quiz-counter').textContent);
check('the one miss surfaces on the summary as something to go practise, over the all-kanji pool',
  el('summary-study-missed').hidden === false
  && el('summary-study-missed').innerHTML === 'Practise <b>1</b> missed',
  el('summary-study-missed').innerHTML);

fire(el('summary-list')._children[0], 'click');
for (let i = 0; i < 10; i += 1) await settle();
check('a summary chip from the all-kanji pool session opens the detail screen too, not a dead tap',
  visible() === 'screen-character-detail', visible());
check('the detail screen still names the right unit even though the session course was the synthetic pool',
  el('detail-unit').textContent === unitLabel('1'), el('detail-unit').textContent);

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'detail-back' } }) } });
await settle();

// Back to the detail screen for the rest of this section's checks.
fire(el('grade-picker')._children.find((b) => b.dataset.grade === '6'), 'click');
await settle();
fire(buttonsIn(el('course-list')._children[0]).find((b) => (b.innerHTML || '').includes('View set overview')), 'click');
await settle();
fire(el('overview-grid')._children.find((t) => t.textContent === grade6Char), 'click');
await settle();

fire(el('detail-mode-writing'), 'click');
await settle();
check('a per-mode toggle turns off just that mode, independent of the others — still counted as started overall',
  !el('detail-mode-writing').className.includes('active')
  && el('detail-mode-definition').className.includes('active')
  && el('detail-study-toggle').textContent.includes('tap to stop studying'));

fire(el('detail-study-toggle'), 'click');
await settle();
check('tapping the headline button again un-enrolls every mode at once',
  el('detail-study-toggle').textContent.includes('Not started')
  && modeToggleIds.every((id) => !el(id).className.includes('active')));

const grade6SavedAfter = [...rows.values()][0];
check('un-enrolling removes the study-list entry entirely, not just clears its modes',
  !(grade6Char in grade6SavedAfter.study), JSON.stringify(grade6SavedAfter.study[grade6Char]));
check('un-enrolling never deletes the progress record already earned',
  !!grade6SavedAfter.progress[`definition:${grade6Char}`],
  JSON.stringify(grade6SavedAfter.progress[`definition:${grade6Char}`]));

// --- Placement test: "Test unlearned" ---------------------------------------
// A button next to "View set overview" lets an already-capable learner test
// every not-yet-started item in the current unit, unlimited, with no lesson
// step first — a correct answer jumps straight to the top box instead of the
// normal one-box-at-a-time climb. Enrollment happens lazily, one kanji at a
// time, only once actually attempted — quitting after one kanji must NOT
// leave the rest of the unit marked "waiting to learn" (the reported bug: it
// used to enroll the whole batch upfront). Still grade 6, Definition mode,
// but the course screen itself was last rendered several steps ago (before
// the un-enroll above) — re-visit it so the card reflects current state.

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'go-course' } }) } });
await settle();

const profileBeforePlacement = [...rows.values()][0];
const grade6Untested = neverSeenItems(grade6Course, 'definition', profileBeforePlacement);
check('there is at least one untested grade-6 kanji to placement-test against',
  grade6Untested.length > 0, grade6Untested.length);
check('none of them are enrolled yet — the button has not been touched',
  grade6Untested.every((k) => !isStudying(profileBeforePlacement.study, k, 'definition')));

const placementButtonsBefore = buttonsIn(el('course-list')._children[0]);
const placementButton = placementButtonsBefore
  .find((b) => (b.innerHTML || '').includes('Test') && (b.innerHTML || '').includes('unlearned'));
check('the course card offers a placement-test button, right of View set overview',
  !!placementButton, placementButtonsBefore.map((b) => b.innerHTML || b.textContent).join(' | '));
check('the button carries no count — nothing has been attempted yet to honestly count',
  placementButton.innerHTML === '🎯 Test unlearned', placementButton.innerHTML);

fire(placementButton, 'click');
for (let i = 0; i < 10; i += 1) await settle();
check('a placement test skips the lesson screen entirely — nothing is shown before being asked',
  visible() === 'screen-quiz', visible());

const placementProfileAfterOpen = [...rows.values()][0];
check('merely opening the placement test enrolls nothing at all — not even the whole batch',
  grade6Untested.every((k) => !isStudying(placementProfileAfterOpen.study, k, 'definition')));

const placementKanji = el('quiz-kana').textContent;
check('the placement quiz is drawn from the untested set',
  grade6Untested.includes(placementKanji), placementKanji);

const placementAnswer = meaningLabel(kanjiInfo(grade6Course, placementKanji));
const placementRightChoice = el('quiz-choices')._children.find((c) => c.textContent === placementAnswer);
fire(placementRightChoice, 'click');
await settle();

const placementProfileAfterAnswer = [...rows.values()][0];
const placementRecord = placementProfileAfterAnswer.progress[`definition:${placementKanji}`];
check('a correct placement answer jumps straight to the top box, not box 1',
  !!placementRecord && placementRecord.box === MAX_BOX, JSON.stringify(placementRecord));
check('answering it enrolled that ONE kanji',
  isStudying(placementProfileAfterAnswer.study, placementKanji, 'definition'));
check('every kanji not yet reached in the quiz is still completely untouched — no study entry at all',
  grade6Untested.filter((k) => k !== placementKanji)
    .every((k) => !isStudying(placementProfileAfterAnswer.study, k, 'definition')
      && !placementProfileAfterAnswer.progress[`definition:${k}`]));

// The actual reported bug: quit right after that one answer, before reaching
// anything else in the (potentially large) queue.
fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'quit-session' } }) } });
await settle();

const placementProfileAfterQuit = [...rows.values()][0];
check('quitting after one kanji leaves every OTHER kanji in the unit exactly as untouched as before the test started',
  grade6Untested.filter((k) => k !== placementKanji)
    .every((k) => !isStudying(placementProfileAfterQuit.study, k, 'definition')
      && !placementProfileAfterQuit.progress[`definition:${k}`]));
check('the one kanji actually answered keeps its record after quitting',
  !!placementProfileAfterQuit.progress[`definition:${placementKanji}`]
  && placementProfileAfterQuit.progress[`definition:${placementKanji}`].box === MAX_BOX);

// A miss during a placement test must NOT come back later in the same
// session — repeating what's already known to be wrong is review, not
// testing (kanji-expansion-plan.md §2.9.2). Run a fresh placement test over
// what's left (placementKanji above is now excluded, having a record) and
// walk every question exactly once, missing the first one on purpose.
fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'go-course' } }) } });
await settle();
const placementButtonAgain = buttonsIn(el('course-list')._children[0])
  .find((b) => (b.innerHTML || '').includes('Test') && (b.innerHTML || '').includes('unlearned'));
fire(placementButtonAgain, 'click');
for (let i = 0; i < 10; i += 1) await settle();

const secondRoundUntested = grade6Untested.filter((k) => k !== placementKanji);
check('enough grade-6 kanji are still untested to exercise a second placement round',
  secondRoundUntested.length >= 2, secondRoundUntested.length);

const seenThisRound = [];
let missedPlacementKanji = null;
for (let i = 0; i < secondRoundUntested.length && visible() === 'screen-quiz'; i += 1) {
  const kanji = el('quiz-kana').textContent;
  if (!kanji) break;
  check(`placement round-2 question ${i + 1} is not a repeat of one already seen this session`,
    !seenThisRound.includes(kanji), `${kanji} seen twice — ${seenThisRound.join(',')}`);
  seenThisRound.push(kanji);

  const answer = meaningLabel(kanjiInfo(grade6Course, kanji));
  const choices = el('quiz-choices')._children;
  const right = choices.find((c) => c.textContent === answer);
  const wrong = choices.find((c) => c.textContent !== answer);
  if (missedPlacementKanji === null) {
    // Miss it on purpose, then recover on the second try — recordResult only
    // locks in the FIRST attempt, so this still counts as a miss for the
    // summary regardless of the recovery (see recordResult() in app.js).
    missedPlacementKanji = kanji;
    fire(wrong, 'click');
    await settle();
    check('a wrong placement answer still gets an immediate second try, same as any other quiz',
      el('quiz-feedback').textContent === 'Try once more', `"${el('quiz-feedback').textContent}"`);
    fire(right, 'click');
  } else {
    fire(right, 'click');
  }
  await settle();
  fire(el('quiz-ok'), 'click'); // resolved questions wait for Next, not a timer, now
  await settle();
}
check('the second placement round asked each untested kanji exactly once, not more',
  seenThisRound.length === secondRoundUntested.length, `${seenThisRound.length} of ${secondRoundUntested.length}`);
check('the second placement round ends at the summary', visible() === 'screen-summary', visible());

const studyMissedButton = el('summary-study-missed');
check('the summary offers to study exactly the one kanji missed this placement round',
  studyMissedButton.hidden === false
  && studyMissedButton.innerHTML.includes('1')
  && studyMissedButton.innerHTML.toLowerCase().includes('missed'),
  studyMissedButton.innerHTML);

// summary-study-missed is a static data-action button (like go-course/
// quit-session above), routed through the document-level delegated click
// handler — not its own addEventListener — so it's fired the same way.
fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'study-missed' } }) } });
for (let i = 0; i < 10; i += 1) await settle();
check('"Study missed" opens the ordinary lesson screen for the missed kanji, not another quiz',
  visible() === 'screen-lesson', visible());
check('the lesson is for the kanji actually missed, not some other one',
  el('lesson-kana').textContent === missedPlacementKanji, el('lesson-kana').textContent);

const beforeStudyMissedAnswer = [...rows.values()][0];
check('studying the missed kanji enrolled it (an ordinary "new" session, not a placement test)',
  isStudying(beforeStudyMissedAnswer.study, missedPlacementKanji, 'definition'));

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'quit-session' } }) } });
await settle();

// Placement testing is not kanji-only — kana gets the same button, drawing
// on neverSeenItems/recordResult exactly as kanji does (kana just has no
// study list to lazily enroll into, so only the box-jump behaviour applies).
fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'go-home' } }) } });
await settle();
fire(el('script-list')._children.find((c) => c.dataset.script === 'hiragana'), 'click');
await settle();

const profileBeforeKanaPlacement = [...rows.values()][0];
const hiraganaUntested = neverSeenItems(getCourse('hiragana'), 'recognition', profileBeforeKanaPlacement);
check('there is at least one untested hiragana character to placement-test against',
  hiraganaUntested.length > 0, hiraganaUntested.length);

const kanaPlacementButton = buttonsIn(el('course-list')._children[0])
  .find((b) => (b.innerHTML || '').includes('Test') && (b.innerHTML || '').includes('unlearned'));
check('kana gets the same placement-test button as kanji', !!kanaPlacementButton);

fire(kanaPlacementButton, 'click');
for (let i = 0; i < 10; i += 1) await settle();
check('a kana placement test also skips straight to the quiz, no lesson screen',
  visible() === 'screen-quiz', visible());

const kanaPlacementChar = el('quiz-kana').textContent;
check('the kana placement quiz is drawn from the untested set',
  hiraganaUntested.includes(kanaPlacementChar), kanaPlacementChar);

const kanaPlacementAnswer = romajiFor(kanaPlacementChar);
const kanaPlacementRightChoice = el('quiz-choices')._children.find((c) => c.textContent === kanaPlacementAnswer);
fire(kanaPlacementRightChoice, 'click');
await settle();

const profileAfterKanaPlacement = [...rows.values()][0];
const kanaPlacementRecord = profileAfterKanaPlacement.progress[`recognition:${kanaPlacementChar}`];
check('a correct kana placement answer jumps straight to the top box too',
  !!kanaPlacementRecord && kanaPlacementRecord.box === MAX_BOX, JSON.stringify(kanaPlacementRecord));

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'quit-session' } }) } });
await settle();

// --- Settings: writing strictness ------------------------------------------
// Phase 5 of writing-mode-plan.md — a per-profile slider, same pattern as
// the existing "new characters per session" one, that feeds the strictness
// multiplier already proven in test/smoke.js's grading tests.

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'open-settings' } }) } });
await settle();
check('opening settings shows the settings screen', visible() === 'screen-settings', `showing ${visible()}`);

// --- Settings: theme colour --------------------------------------------------
// ACCENT_COLORS (app.js) isn't exported — same as EMOJI_CHOICES, an
// internal detail of the picker it drives — so this checks structure and
// behaviour (a default, a change, persistence, and the reset when no
// profile is open) rather than the exact palette.

const colorSwatches = el('color-picker')._children;
check('the theme colour picker offers more than one option', colorSwatches.length > 1,
  colorSwatches.length);
check('exactly one colour starts selected, and it\'s coral (the documented default)',
  colorSwatches.filter((b) => b.classList.contains('selected')).length === 1
  && colorSwatches.find((b) => b.classList.contains('selected')).dataset.color === 'coral',
  colorSwatches.map((b) => `${b.dataset.color}:${b.classList.contains('selected')}`).join(' | '));
check('the accent colour actually applied to the page matches — coral, to start',
  document.documentElement.dataset.accent === 'coral', document.documentElement.dataset.accent);

const otherSwatch = colorSwatches.find((b) => b.dataset.color !== 'coral');
check('a second, different colour is available to switch to', !!otherSwatch);
fire(otherSwatch, 'click');
await settle();
check('clicking a different colour selects it and deselects coral',
  otherSwatch.classList.contains('selected')
  && colorSwatches.filter((b) => b.classList.contains('selected')).length === 1,
  colorSwatches.map((b) => `${b.dataset.color}:${b.classList.contains('selected')}`).join(' | '));
check('the change applies to the page immediately, not just on next visit',
  document.documentElement.dataset.accent === otherSwatch.dataset.color,
  document.documentElement.dataset.accent);

const afterColorChange = [...rows.values()][0];
check('the chosen colour is saved to the profile, same as the other settings sliders',
  afterColorChange.settings.accentColor === otherSwatch.dataset.color,
  JSON.stringify(afterColorChange.settings));

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'close-settings' } }) } });
await settle();
fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'open-settings' } }) } });
await settle();
check('reopening settings remembers the chosen colour, not just coral again',
  el('color-picker')._children.find((b) => b.classList.contains('selected')).dataset.color
    === otherSwatch.dataset.color,
  el('color-picker')._children.find((b) => b.classList.contains('selected')).dataset.color);

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'close-settings' } }) } });
await settle();
fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'switch-profile' } }) } });
for (let i = 0; i < 10; i += 1) await settle(); // renderProfiles() awaits store.listProfiles()
check('leaving to the profile picker resets to the neutral default, not the last profile\'s colour',
  document.documentElement.dataset.accent === 'coral', document.documentElement.dataset.accent);
check('the profile card is there to click back into', el('profile-list')._children.length > 0,
  el('profile-list')._children.length);

// Back into the same profile for the rest of this section's checks.
fire(el('profile-list')._children[0], 'click');
await settle();
check('reopening the profile re-applies its own chosen colour',
  document.documentElement.dataset.accent === otherSwatch.dataset.color,
  document.documentElement.dataset.accent);
fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'open-settings' } }) } });
await settle();

// --- Settings: changelog ---------------------------------------------------
// CHANGELOG[0] (src/changelog.js) is always shown; everything older is
// built into #changelog-history, collapsed, behind a toggle — see
// renderChangelog()/toggleChangelogHistory() in app.js.

check('the current changelog date is shown', el('changelog-current-date').textContent === CHANGELOG[0].date,
  el('changelog-current-date').textContent);
check('the current changelog entry lists every one of its changes, in order',
  el('changelog-current-list')._children.map((li) => li.textContent).join('\n')
    === CHANGELOG[0].changes.join('\n'),
  el('changelog-current-list')._children.map((li) => li.textContent).join(' | '));
check('older changelog entries start collapsed', el('changelog-history').hidden === true);
check('the toggle offers to show them', el('changelog-toggle').textContent === 'Show previous updates',
  el('changelog-toggle').textContent);

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'toggle-changelog' } }) } });
await settle();
check('tapping the toggle reveals the history', el('changelog-history').hidden === false);
check('the toggle now offers to hide it', el('changelog-toggle').textContent === 'Hide previous updates',
  el('changelog-toggle').textContent);
check('the history holds every older entry, oldest changes still grouped under their own date',
  el('changelog-history')._children.length === CHANGELOG.length - 1,
  el('changelog-history')._children.length);

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'toggle-changelog' } }) } });
await settle();
check('tapping it again re-collapses the history', el('changelog-history').hidden === true);

// Leaving and reopening Settings must not leave yesterday's "expanded" state
// stuck open, or the toggle out of sync with it.
fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'toggle-changelog' } }) } });
await settle();
fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'close-settings' } }) } });
await settle();
fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'open-settings' } }) } });
await settle();
check('reopening settings starts the changelog collapsed again, regardless of how it was left',
  el('changelog-history').hidden === true && el('changelog-toggle').textContent === 'Show previous updates',
  `hidden=${el('changelog-history').hidden}, toggle="${el('changelog-toggle').textContent}"`);

check('writing strictness defaults to Normal (level 3)',
  Number(el('writing-strictness').value) === 3 && el('writing-strictness-value').textContent === 'Normal',
  `${el('writing-strictness').value} / "${el('writing-strictness-value').textContent}"`);

el('writing-strictness').value = '5';
fire(el('writing-strictness'), 'input', { target: el('writing-strictness') });
await settle();
check('moving the slider updates its label immediately', el('writing-strictness-value').textContent === 'Strict',
  el('writing-strictness-value').textContent);

const afterStrictness = [...rows.values()][0];
check('the chosen strictness level is saved to the profile, same as new-per-session',
  afterStrictness.settings.strictness === 5, JSON.stringify(afterStrictness.settings));

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'close-settings' } }) } });
await settle();
check('closing settings leaves the settings screen', visible() !== 'screen-settings', `showing ${visible()}`);

// --- Sync across devices (sync-plan.md §5) ---------------------------------
// Real key derivation and network calls need crypto.subtle/fetch, which
// this stub environment has neither of — that side is covered directly in
// test/sync.js, against a scripted fake transport. What's exercised here is
// everything the DOM actually depends on: element ids, panel toggling, and
// the status line, seeding pairing state straight through store.js the way
// a real sync would leave it, rather than via a real network round trip.

const syncProfileId = [...rows.values()][0].id;

// renderSyncCard() is fired-and-forgotten by renderSettings() (an IndexedDB
// read shouldn't delay the screen itself appearing — see app.js), and
// fire() here doesn't await a click listener's returned promise either, so
// each step below drains several ticks rather than one: just enough to be
// sure the async chain it just kicked off (open → read sync state → touch
// the DOM) has actually finished before the next click or check runs.
async function drain(times = 5) { for (let i = 0; i < times; i += 1) await settle(); }

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'open-settings' } }) } });
await drain();
check('a profile with no sync state shows the "not yet syncing" panel',
  el('sync-not-configured').hidden === false && el('sync-configured').hidden === true);
// NOT a regression check for the bug fixed alongside this comment
// (renderSyncCard() calling syncStatusText(undefined) on a never-paired
// profile, since renderSettings() calls it with no override on every
// settings open): a bare assertion on sync-status.textContent here cannot
// tell "ran correctly and produced ''" apart from "threw before reaching
// that assignment, leaving the static HTML's empty default" — both look
// identical from here. JavaScriptCore has no console and no
// unhandled-rejection reporting (checked directly: a fire-and-forget async
// throw is completely silent, exit code 0), so a throw inside
// renderSyncCard() — called unawaited by design, so opening Settings never
// waits on an IndexedDB read — is structurally invisible to this harness.
// That fix was verified against a real browser instead.

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'sync-show-code-entry' } }) } });
await drain();
check('"Enter a code" reveals the code-entry form', el('sync-code-entry').hidden === false);

await store.saveSyncState({
  profileId: syncProfileId,
  code: 'K7QM-3XR9-P2FT',
  docId: 'deadbeef',
  version: '3',
  lastPulledAt: Date.now() - 5 * 60 * 1000,
  lastPushedAt: Date.now() - 5 * 60 * 1000,
});
fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'close-settings' } }) } });
await drain();
fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'open-settings' } }) } });
await drain();
check('a paired profile shows the code and the "syncing" panel',
  el('sync-configured').hidden === false && el('sync-not-configured').hidden === true
  && el('sync-code-value').textContent === 'K7QM-3XR9-P2FT');
check('the status line reports how long ago it last synced',
  /\d+ minutes? ago/.test(el('sync-status').textContent), el('sync-status').textContent);

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'sync-copy-code' } }) } });
await drain();
check('"Copy code" actually copies the code', clipboardText === 'K7QM-3XR9-P2FT', clipboardText);
check('the confirmation replaces the button\'s own label, not just a line below it',
  el('sync-copy-code').textContent === 'Copied!' && el('sync-copy-code').classList.contains('copied'));

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'sync-turn-off' } }) } });
await drain();
check('turning off sync reverts to the "not yet syncing" panel',
  el('sync-not-configured').hidden === false && el('sync-configured').hidden === true);
const syncStateAfterTurnOff = await store.getSyncState(syncProfileId);
check('turning off sync removes the local pairing record — the profile and remote copy are untouched',
  syncStateAfterTurnOff === undefined);

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'close-settings' } }) } });
await settle();

// --- Force refresh isolation ---------------------------------------------
// GitHub Pages project sites share an origin. Force refresh must clear only
// this app's worker/cache state, leaving sibling PWAs untouched.

let requestedRegistrationUrl = null;
let ownWorkerUnregistered = false;
let replacedUrl = null;
const forceDeletedCaches = [];
navigator.serviceWorker = {
  async getRegistration(url) {
    requestedRegistrationUrl = url;
    return { async unregister() { ownWorkerUnregistered = true; } };
  },
};
globalThis.caches = {
  async keys() { return ['kana-quest-old', 'kana-quest-current', 'other-app-v4']; },
  async delete(key) { forceDeletedCaches.push(key); return true; },
};
window.caches = globalThis.caches;
window.location = {
  pathname: '/kana-quest/index.html',
  replace(url) { replacedUrl = url; },
};

await appModule.forceRefresh();
check('force refresh requests only the worker registration for this app directory',
  requestedRegistrationUrl === './' && ownWorkerUnregistered,
  String(requestedRegistrationUrl));
check('force refresh deletes only Kana Quest caches',
  forceDeletedCaches.length === 2
  && forceDeletedCaches.includes('kana-quest-old')
  && forceDeletedCaches.includes('kana-quest-current')
  && !forceDeletedCaches.includes('other-app-v4'),
  forceDeletedCaches.join(', '));
check('force refresh still performs a cache-busted navigation',
  /^\/kana-quest\/index\.html\?fresh=\d+$/.test(replacedUrl), replacedUrl);

// --- Install banner ---------------------------------------------------------
// Nudges a phone browser that is NOT running installed (standalone) to add
// the app to its home screen, since that is what actually makes storage
// persist reliably — see renderInstallBanner() in app.js. The
// beforeinstallprompt capture itself can't be exercised in a stubbed
// (non-browser) DOM, so this covers the device/standalone/dismissed gates
// directly instead.

const iosUserAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
const desktopUserAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';

navigator.userAgent = iosUserAgent;
navigator.standalone = true;
appModule.renderInstallBanner();
check('an already-installed (standalone) iOS app is never offered the banner',
  el('install-banner').hidden === true);

navigator.standalone = false;
appModule.renderInstallBanner();
check('an iOS browser tab (not installed) IS offered the banner',
  el('install-banner').hidden === false);
check('the iOS message is instructional, with no action button — no programmatic install API exists there',
  el('install-banner-text').textContent.includes('Add to Home Screen')
  && el('install-banner-action').hidden === true,
  el('install-banner-text').textContent);

// The banner is fixed to the bottom of the viewport, same as the quiz/
// summary Next bar — left up, it sits on top of that bar and eats the tap
// meant for it. It should disappear entirely (not just visually) while a
// lesson, a quiz/writing question, or the summary is on screen, and come
// back the moment none of those is — see updateInstallBannerVisibility()
// in app.js, driven by every show() call.
fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'go-home' } }) } });
await settle();
check('the banner is back once nothing at the bottom of the screen needs the room',
  el('install-banner').hidden === false);

fire(el('script-list')._children.find((c) => c.dataset.script === 'hiragana'), 'click');
await settle();
const installBannerLearn = buttonsIn(el('course-list')._children[0])
  .find((b) => (b.innerHTML || '').includes('Learn <b>'));
fire(installBannerLearn, 'click');
await settle();
check('a lesson hides the install banner', visible() === 'screen-lesson' && el('install-banner').hidden === true,
  `showing ${visible()}, banner hidden=${el('install-banner').hidden}`);

for (let i = 0; i < 10 && visible() === 'screen-lesson'; i += 1) {
  fire(el('lesson-next'), 'click');
  await settle();
}
check('the quiz that follows keeps it hidden too — its Next bar is fixed to the same spot',
  visible() === 'screen-quiz' && el('install-banner').hidden === true);

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'quit-session' } }) } });
await settle();
check('quitting back to the course screen brings the banner back',
  el('install-banner').hidden === false);

fire(el('install-banner-dismiss'), 'click');
await settle();
check('dismissing hides the banner immediately', el('install-banner').hidden === true);
appModule.renderInstallBanner();
check('re-rendering within the same session honours the dismissal — it does not reappear unasked',
  el('install-banner').hidden === true);

sessionStorage._data.clear(); // undo the dismissal above so the check below tests the device gate, not a leftover dismiss
navigator.userAgent = desktopUserAgent;
appModule.renderInstallBanner();
check('a desktop browser is never offered the banner — this is a phone-specific nudge',
  el('install-banner').hidden === true);

// --- Vocabulary word detail: kanji chips into the kanji detail screen -----
// (vocab-plan.md §7 phase 5) — a themed unit (not Core's mostly-kana spine)
// so there's a real kanji word to chip through.

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'go-home' } }) } });
await settle();
fire(el('script-list')._children.find((c) => c.dataset.script === 'vocab'), 'click');
await settle();

// Vocabulary now opens in the "By commonness" progression by default (see
// vocabProgression in store.js) — its units are frequency tiers, not themes.
// This block is specifically about a THEMED unit, so switch axes first,
// which also covers the picker actually rebuilding the unit row.
const progressionSegments = () => el('vocab-progression-picker')._children;
check('the vocabulary screen offers both progressions, commonness first',
  progressionSegments().map((b) => b.textContent).join(' | ') === 'By commonness | By topic',
  progressionSegments().map((b) => b.textContent).join(' | '));
check('commonness is the selected progression by default',
  progressionSegments()[0].className.includes('active'));
fire(progressionSegments().find((b) => b.textContent === 'By topic'), 'click');
await settle();
check('switching to By topic rebuilds the unit row from the syllabus axis',
  unitGroupChips().some((c) => c.dataset.group === 'Identity and culture'),
  unitGroupChips().map((c) => c.dataset.group).join(' | '));

await openUnitGroup('Identity and culture');
fire(el('grade-picker')._children.find((b) => b.dataset.grade === '1.1'), 'click');
await settle();

const vocabViewSetButton = buttonsIn(el('course-list')._children[0])
  .find((b) => (b.innerHTML || '').includes('View set overview'));
fire(vocabViewSetButton, 'click');
for (let i = 0; i < 10; i += 1) await settle(); // ensureVocabUnitLoaded is async
check('opening a vocab unit\'s overview shows the overview screen',
  visible() === 'screen-overview', `showing ${visible()}`);

const vocabTiles = el('overview-grid')._children;
check('vocab overview tiles are labelled with the word itself, not left blank',
  vocabTiles.length > 0 && vocabTiles.every((t) => t.textContent.length > 0),
  `${vocabTiles.length} tiles`);

const KANJI_RE = /[㐀-䶿一-鿿]/;
const kanjiWordTile = vocabTiles.find((t) => KANJI_RE.test(t.textContent));
check('at least one word in this unit has kanji worth chipping through to', !!kanjiWordTile);

fire(kanjiWordTile, 'click');
for (let i = 0; i < 10; i += 1) await settle();
check('tapping a vocab tile opens the character detail screen',
  visible() === 'screen-character-detail', `showing ${visible()}`);
check('a vocab detail screen shows the word\'s glosses',
  el('detail-meanings').hidden === false && el('detail-meanings').textContent.length > 0);
check('a vocab detail screen has no stroke diagram — nothing here is one character',
  el('detail-stroke-wrap').hidden === true);
check('a vocab detail screen has its own study toggle, Meaning/Recall not Definition/Yomi/Writing',
  el('detail-study').hidden === false
  && el('detail-mode-vmeaning').hidden === false && el('detail-mode-vrecall').hidden === false
  && el('detail-mode-definition').hidden === true,
  `vmeaning hidden=${el('detail-mode-vmeaning').hidden}, definition hidden=${el('detail-mode-definition').hidden}`);
check('a vocab detail screen offers its own kanji as tappable chips',
  el('detail-word-kanji').hidden === false && el('detail-word-kanji')._children.length > 0,
  `hidden=${el('detail-word-kanji').hidden}, chips=${el('detail-word-kanji')._children.length}`);

// The example sentences (`ex` in the vocab data): shown exactly when the
// word has them — about one word in six appears in no corpus sentence at
// all, and those correctly show nothing rather than an empty heading.
const vocabCourse = VOCAB_COURSES.find((c) => c.unit === '1.1');
const tileId = [...vocabCourse.index.keys()].find((id) => vocabInfo(vocabCourse, id).w === kanjiWordTile.textContent);
const tileExamples = vocabInfo(vocabCourse, tileId).ex || [];
check('a vocab detail screen shows example sentences exactly when the word has them',
  el('detail-example').hidden === (tileExamples.length === 0),
  `hidden=${el('detail-example').hidden}, examples=${tileExamples.length}`);
if (tileExamples.length) {
  const blocks = el('detail-example-list')._children;
  check('every example sentence the word has is rendered, not just the first',
    blocks.length === tileExamples.length, `${blocks.length} of ${tileExamples.length}`);
  check('an example sentence is translated whole',
    blocks[0]._children.some((c) => c.className === 'example-en'
      && c.textContent === tileExamples[0].en));
  check('every furigana span in an example sentence covers real characters of it',
    tileExamples.every((ex) => ex.r.every(([start, length, kana]) => start >= 0 && length >= 1
      && start + length <= ex.j.length && kana.length > 0)),
    JSON.stringify(tileExamples[0].r));
  check('every tappable word in an example sentence covers real characters of it',
    tileExamples.every((ex) => ex.w.every(([start, length]) => start >= 0 && length >= 1
      && start + length <= ex.j.length)),
    JSON.stringify(tileExamples[0].w));

  // Tapping any word in a sentence — not just the word being studied — says
  // what it means. The glossary is a separate lazily-loaded file, so the
  // first tap of a session is async.
  const wordButtons = [];
  const collect = (node) => {
    if ((node.className || '').split(' ').includes('example-word')) wordButtons.push(node);
    (node._children || []).forEach(collect);
  };
  blocks.forEach(collect);
  check('every word of an example sentence is its own tap target',
    wordButtons.length >= tileExamples[0].w.length,
    `${wordButtons.length} tappable words across ${blocks.length} sentences`);
  fire(wordButtons[0], 'click');
  for (let i = 0; i < 10; i += 1) await settle(); // ensureExampleWordsLoaded is async
  const panel = blocks[0]._children.find((c) => c.className === 'example-word-panel');
  check('tapping a word in an example sentence opens a panel about that word',
    panel.hidden === false && panel._children.length > 0,
    `hidden=${panel.hidden}, children=${panel._children.length}`);
  check('the panel says what the tapped word means',
    panel._children.some((c) => c.className === 'example-word-meaning' && c.textContent.length > 0),
    panel._children.map((c) => `${c.className}:${c.textContent}`).join(' | '));
  fire(wordButtons[0], 'click');
  await settle();
  check('tapping the same word again closes the panel', panel.hidden === true);
}

const kanjiChip = el('detail-word-kanji')._children[0];
const chippedKanji = kanjiChip.textContent;

fire(kanjiChip, 'click');
for (let i = 0; i < 10; i += 1) await settle();
check('tapping a kanji chip opens THAT kanji\'s own detail screen',
  visible() === 'screen-character-detail' && el('detail-glyph').textContent === chippedKanji,
  `glyph now "${el('detail-glyph').textContent}", expected "${chippedKanji}"`);
check('the kanji reached from a word has its own reading chips and stroke diagram, unlike the word screen',
  el('detail-readings').hidden === false && el('detail-stroke-wrap').hidden === false);

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'detail-back' } }) } });
await settle();
check('backing out of a chipped kanji returns to the WORD\'s own detail screen, not the overview',
  visible() === 'screen-character-detail' && el('detail-word-kanji').hidden === false,
  `showing ${visible()}, word-kanji hidden=${el('detail-word-kanji').hidden}`);

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'detail-back' } }) } });
await settle();
check('backing out of the word returns to the vocab overview',
  visible() === 'screen-overview', `showing ${visible()}`);

// --- Vocabulary's quick actions: review/learn across every unit at once ----
// The same unit-agnostic pair kanji has had (studyListPool/allKanjiPool);
// vocabulary needs it more, not less, with thirty-odd units to browse. Both
// buttons must ignore whichever unit tile is selected below them.

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'go-home' } }) } });
await settle();
fire(el('script-list')._children.find((c) => c.dataset.script === 'vocab'), 'click');
await settle();
check('the quick-actions row is offered for vocabulary too, not just kanji',
  el('quick-actions').hidden === false);

// Deliberately browse a themed unit a long way from the Core spine, so
// "Learn next" teaching from Core proves it ignores the selection.
await openUnitGroup('Local area, holiday and travel');
const travelUnit = el('grade-picker')._children[0].dataset.grade;
await settle();
const coreVocabCourse = VOCAB_COURSES[0];
check('vocabulary opens its unit row on the Core spine, and Core is first in the curriculum',
  coreVocabCourse.unit.startsWith('C'), coreVocabCourse.unit);

check('the quick "Learn next" button is offered while browsing a themed unit',
  !el('quick-learn-next').disabled, el('quick-learn-next').innerHTML || el('quick-learn-next').textContent);
fire(el('quick-learn-next'), 'click');
for (let i = 0; i < 10; i += 1) await settle(); // ensureVocabUnitLoaded is a real dynamic import
check('"Learn next" teaches from the start of the vocab curriculum (Core), not the selected themed unit',
  visible() === 'screen-lesson'
  && coreVocabCourse.chunks.flatMap((c) => c.items).some((id) => id.split('|')[0] === el('lesson-kana').textContent),
  `showing ${visible()}, lesson word "${el('lesson-kana').textContent}" while browsing ${travelUnit}`);

for (let i = 0; i < 10 && visible() === 'screen-lesson'; i += 1) {
  fire(el('lesson-next'), 'click');
  await settle();
}
check('the vocab "Learn next" lesson hands over to the quiz', visible() === 'screen-quiz', visible());
check('the quiz asks about a Core word, drawn from the cross-unit pool rather than one course',
  el('quiz-choices')._children.length > 0, `${el('quiz-choices')._children.length} choices`);

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'quit-session' } }) } });
await settle();

// The enrollment "Learn next" did lands in the same study map kanji use,
// keyed by word id under a vocab mode — which is exactly what the "Review
// due" pool reads back, across every unit at once.
const vocabProfile = [...rows.values()][0];
const vocabPool = {
  kind: 'vocab',
  chunks: [{ items: studiedKanji(vocabProfile.study, 'vmeaning') }],
  excludeForMode: {},
};
const vocabPoolStats = courseStats(vocabPool, 'vmeaning', vocabProfile);
const travelOnlyStats = courseStats(
  VOCAB_COURSES.find((c) => c.unit === travelUnit), 'vmeaning', vocabProfile,
);
check('"Review due" spans every vocab unit — the themed unit still selected below has nothing enrolled at all',
  vocabPoolStats.total > 0 && travelOnlyStats.unenrolled === travelOnlyStats.total,
  `pool holds ${vocabPoolStats.total}, ${travelUnit} has ${travelOnlyStats.total - travelOnlyStats.unenrolled} enrolled`);
check('browsing a themed unit did not change what "Learn next" enrolled — every enrolled word is a Core one',
  studiedKanji(vocabProfile.study, 'vmeaning')
    .every((id) => coreVocabCourse.chunks.flatMap((c) => c.items).includes(id)),
  studiedKanji(vocabProfile.study, 'vmeaning').join(','));

// --- Vocabulary's Higher tier: a theme's harder words get their own tile --
// vocab-plan.md §2.1/phase 6: a theme's 'h'-tagged words must not silently
// merge into their theme's existing (now implicitly Foundation) unit — they
// get their own unit id ("<theme>h") and browse together as one "Common
// words 2" group at the end of the unit-group row, the same shape kanji's
// secondary-school units already use rather than sitting inside each
// theme's own group next to its Foundation tile.

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'go-home' } }) } });
await settle();
fire(el('script-list')._children.find((c) => c.dataset.script === 'vocab'), 'click');
await settle();

const higherUnits = VOCAB_COURSES.map((c) => c.unit).filter((u) => u.endsWith('h'));
check('at least one theme produced a Higher-tier unit', higherUnits.length > 0, higherUnits.length);

const vocabGroupChips = () => el('unit-groups')._children;
// The four non-curriculum groups trail the five themes, in this order:
// Common words 2 (the Higher tier of each theme), A level, then the two
// bonus pools — kanji-page words, and the rest of the common-word list that
// no theme quota reached ("Other common words", see build_vocab_data.py).
const groupTail = () => vocabGroupChips().slice(-4).map((c) => c.dataset.group).join(' | ');
check('the syllabus axis trails its five themes with the two tiers then the two bonus pools',
  groupTail() === 'Common words 2 | A level | From kanji pages | Other common words',
  groupTail());

await openUnitGroup('Common words 2');
const higherGradeButtons = gradePickerButtons();
check('every tile in the Common words 2 group is a Higher-tier unit, none of its Foundation siblings',
  higherGradeButtons.length > 0 && higherGradeButtons.every((b) => b.dataset.grade.endsWith('h')),
  higherGradeButtons.map((b) => b.dataset.grade).join(','));
check('a Higher-tier tile\'s badge is the bare theme number — no "h" clutter once the group already says so',
  higherGradeButtons.every((b) => b.querySelector('.grade-number').textContent === vocabUnitBadge(b.dataset.grade))
  && higherGradeButtons.every((b) => !b.querySelector('.grade-number').textContent.endsWith('h')),
  higherGradeButtons.map((b) => b.querySelector('.grade-number').textContent).join(','));

const firstHigherUnit = higherGradeButtons[0].dataset.grade;
const firstHigherCourse = VOCAB_COURSES.find((c) => c.unit === firstHigherUnit);
check('the Higher tile\'s course card names the SAME theme as its Foundation sibling, not "undefined" or the raw id',
  (el('course-list')._children[0].innerHTML || '').includes(vocabUnitLabel(firstHigherUnit)),
  el('course-list')._children[0].innerHTML);
check('vocabUnitLabel strips the trailing h — the theme label matches its Foundation sibling exactly',
  vocabUnitLabel(firstHigherUnit) === vocabUnitLabel(firstHigherUnit.slice(0, -1)),
  `"${vocabUnitLabel(firstHigherUnit)}" vs "${vocabUnitLabel(firstHigherUnit.slice(0, -1))}"`);
check('vocabUnitGroupLabel resolves a Higher unit to "Common words 2" regardless of its own theme',
  vocabUnitGroupLabel(firstHigherUnit) === 'Common words 2', vocabUnitGroupLabel(firstHigherUnit));

const higherViewSetButton = buttonsIn(el('course-list')._children[0])
  .find((b) => (b.innerHTML || '').includes('View set overview'));
fire(higherViewSetButton, 'click');
for (let i = 0; i < 10; i += 1) await settle(); // ensureVocabUnitLoaded is a real dynamic import
check('the Higher unit\'s overview loads its own real words, not an empty/fallback grid',
  visible() === 'screen-overview' && el('overview-grid')._children.length === firstHigherCourse.chunks.flatMap((c) => c.items).length,
  `showing ${visible()}, ${el('overview-grid')._children.length} tiles for ${firstHigherCourse.chunks.flatMap((c) => c.items).length} words`);

fire(el('overview-grid')._children[0], 'click');
for (let i = 0; i < 10; i += 1) await settle(); // openCharacterDetail is async for vocab
check('a Higher-tier word\'s detail screen names its group as "Common words 2", crumbed with its real theme',
  el('detail-unit').textContent === `Common words 2 · ${vocabUnitLabel(firstHigherUnit)}`,
  el('detail-unit').textContent);

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'detail-back' } }) } });
await settle();
fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'overview-back' } }) } });
await settle();
await openUnitGroup('Core');
fire(el('grade-picker')._children.find((b) => b.dataset.grade === 'C1'), 'click');
await settle();

// --- Vocabulary quiz: the definition/reading and word/spelling follow-ups
// pause and announce themselves rather than swapping instantly -------------
//
// A real user complaint: getting the definition right used to jump straight
// into the reading follow-up on the SAME click that graded the definition —
// the choices changed out from under the tap that had just landed, with
// nothing on screen explaining why. Both of vocabulary's two-part questions
// (Meaning's definition -> reading, Recall's word -> spelling) now pause on
// the first part's own green card, offering "Next" — and say what pressing
// it will do on the button itself — before a SEPARATE press actually shows
// the second part, itself announced too. See finishVocabDefinitionStage/
// finishVocabProdStage and nextQuestion()'s vocabNextStage gate in app.js.
//
// 質問 (Core/C1) is the word: to reach the reading follow-up at all needs a
// kanji the learner already has SOME claim on (vocab-plan.md §5.2 hides a
// known kanji's furigana by default, which is what makes it "askable" per
// §5.4) — so 問 is enrolled in kanji study first, exactly the state a real
// learner would be in by the time this question is actually worth asking.

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'go-home' } }) } });
await settle();
fire(el('script-list')._children.find((c) => c.dataset.script === 'kanji'), 'click');
await settle();
const monUnit = kanjiUnitFor('問');
await openUnitGroup(monUnit.startsWith('9-') ? 'Names & places' : monUnit.startsWith('8-') ? 'Secondary school' : 'Primary school grade');
fire(el('grade-picker')._children.find((b) => b.dataset.grade === monUnit), 'click');
await settle();
fire(buttonsIn(el('course-list')._children[0]).find((b) => (b.innerHTML || '').includes('View set overview')), 'click');
for (let i = 0; i < 10; i += 1) await settle();
fire(el('overview-grid')._children.find((t) => t.textContent === '問'), 'click');
for (let i = 0; i < 10; i += 1) await settle();
fire(el('detail-study-toggle'), 'click'); // enrolls 問 in every applicable kanji mode
await settle();
check('問 is now known, which is what makes its word\'s reading askable below',
  isStudying([...rows.values()][0].study, '問', 'definition'));
fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'detail-back' } }) } });
await settle();

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'go-home' } }) } });
await settle();
fire(el('script-list')._children.find((c) => c.dataset.script === 'vocab'), 'click');
await settle();
fire(buttonsIn(el('course-list')._children[0]).find((b) => (b.innerHTML || '').includes('View set overview')), 'click');
for (let i = 0; i < 10; i += 1) await settle();

// --- Word detail: pronunciation, alongside romaji, when it actually differs
// こんにちは spells letter-for-letter as "konnichiha" but is SAID
// "konnichiwa" — the exact case the reveal ladder's pronunciationFor()
// (vocab.js) exists for, now shown openly on the word's own detail screen
// too (no reveal ladder here to protect). See renderCharacterDetail() in
// app.js.
fire(el('overview-grid')._children.find((t) => t.textContent === 'こんにちは'), 'click');
for (let i = 0; i < 10; i += 1) await settle();
check('the word detail screen shows the plain romaji spelling',
  el('detail-romaji').hidden === false && el('detail-romaji').textContent === 'konnichiha',
  el('detail-romaji').textContent);
check('...and, since it differs, how it\'s actually said',
  el('detail-pronunciation').hidden === false && el('detail-pronunciation').textContent === 'said: konnichiwa',
  el('detail-pronunciation').textContent);

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'detail-back' } }) } });
await settle();
fire(el('overview-grid')._children.find((t) => t.textContent === 'はい'), 'click');
for (let i = 0; i < 10; i += 1) await settle();
check('a word whose pronunciation matches its romaji shows no second line',
  el('detail-romaji').hidden === false && el('detail-pronunciation').hidden === true,
  `romaji="${el('detail-romaji').textContent}", pronunciation hidden=${el('detail-pronunciation').hidden}`);

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'detail-back' } }) } });
await settle();
fire(el('overview-grid')._children.find((t) => t.textContent === '質問'), 'click');
for (let i = 0; i < 10; i += 1) await settle();
check('reached 質問\'s own detail screen', el('detail-glyph').textContent === '質問');
fire(el('detail-study-toggle'), 'click'); // enrolls 質問 in both vmeaning and vrecall
await settle();

// --- Meaning: definition -> (pause) -> reading -----------------------------

fire(el('detail-study-now'), 'click'); // studyDetailCharNow() picks vmeaning: it's pending, state.mode isn't
for (let i = 0; i < 10; i += 1) await settle();
for (let i = 0; i < 10 && visible() === 'screen-lesson'; i += 1) {
  fire(el('lesson-next'), 'click');
  await settle();
}
check('the single-word "Study it now" session reaches the quiz', visible() === 'screen-quiz', visible());
check('it opens on the definition stage: four English options, no Next yet',
  el('quiz-choices')._children.length === 4 && el('quiz-ok').hidden === true,
  `${el('quiz-choices')._children.length} choices, quiz-ok hidden=${el('quiz-ok').hidden}`);

const vocabCore = VOCAB_COURSES.find((c) => c.unit === 'C1');
const shitsumonInfo = vocabInfo(vocabCore, '質問');
// The label carries every sense the word has now, not just en[0]
// (vocab-plan.md §5.6) — 質問 is single-sense, so this is the same
// string either way, but reading it the way the app does keeps the
// assertion honest if a future rebuild gives it a second sense.
const defAnswer = wordMeaningLabel(shitsumonInfo);
const defChoicesBefore = el('quiz-choices')._children.map((b) => b.textContent);
const defRight = el('quiz-choices')._children.find((b) => b.textContent === defAnswer);
check('the correct definition is among the four options', !!defRight, defChoicesBefore.join(' | '));
fire(defRight, 'click');
await settle();

check('a correct definition turns the card green immediately',
  el('quiz-card').className.includes('is-correct'));
check('...but does NOT swap the choices out — this is the bug: it must wait for Next',
  el('quiz-choices')._children.map((b) => b.textContent).join('|') === defChoicesBefore.join('|'),
  el('quiz-choices')._children.map((b) => b.textContent).join('|'));
check('"Next" appears and says what it will do, rather than a bare "Next"',
  el('quiz-ok').hidden === false && el('quiz-ok').textContent === 'Next: the reading →',
  el('quiz-ok').textContent);
check('the feedback line explains what just happened',
  el('quiz-feedback').textContent === 'Correct! Next, its reading.', el('quiz-feedback').textContent);

fire(el('quiz-ok'), 'click'); // nextQuestion() -> vocabNextStage -> beginVocabYomiStage
await settle();

check('pressing Next reveals the reading stage — same word, new choices',
  el('quiz-kana').textContent === '質問' && el('quiz-ok').hidden === true,
  `glyph "${el('quiz-kana').textContent}", quiz-ok hidden=${el('quiz-ok').hidden}`);
check('the reading stage announces itself too',
  el('quiz-feedback').textContent === "Now choose how it's read.", el('quiz-feedback').textContent);
check('the reading stage\'s card is plain again — the definition\'s green does not bleed into it',
  el('quiz-card').className === 'quiz-card', el('quiz-card').className);
check('the reading choices are a different set from the definition\'s (kana, not English)',
  el('quiz-choices')._children.length > 0
  && el('quiz-choices')._children.map((b) => b.textContent).join('|') !== defChoicesBefore.join('|'));

const yomiAnswer = shitsumonInfo.r;
const yomiRight = el('quiz-choices')._children.find((b) => b.textContent === yomiAnswer);
check('the correct reading is among the reading stage\'s options', !!yomiRight,
  el('quiz-choices')._children.map((b) => b.textContent).join('|'));
fire(yomiRight, 'click');
await settle();

check('grading the reading clears the "now choose" hint — it is not a lingering banner',
  el('quiz-feedback').textContent === '', el('quiz-feedback').textContent);
check('a bare "Next" this time — there is no third stage to announce',
  el('quiz-ok').hidden === false && el('quiz-ok').textContent === 'Next', el('quiz-ok').textContent);

fire(el('quiz-ok'), 'click');
for (let i = 0; i < 10; i += 1) await settle();
check('this single-word session is now finished — Next actually advanced, not just re-announced',
  visible() === 'screen-summary', visible());

// --- Recall: word -> (pause) -> spelling ------------------------------------
// vrecall is still pending for 質問 (only vmeaning was studied above), so
// "Study it now" reaches it next automatically — see studyDetailCharNow()'s
// own pending-mode selection in app.js.

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'go-home' } }) } });
await settle();
fire(el('script-list')._children.find((c) => c.dataset.script === 'vocab'), 'click');
await settle();
fire(buttonsIn(el('course-list')._children[0]).find((b) => (b.innerHTML || '').includes('View set overview')), 'click');
for (let i = 0; i < 10; i += 1) await settle();
fire(el('overview-grid')._children.find((t) => t.textContent === '質問'), 'click');
for (let i = 0; i < 10; i += 1) await settle();
fire(el('detail-study-now'), 'click');
for (let i = 0; i < 10; i += 1) await settle();
for (let i = 0; i < 10 && visible() === 'screen-lesson'; i += 1) {
  fire(el('lesson-next'), 'click');
  await settle();
}
check('the second "Study it now" run opens on Recall, not Meaning again',
  visible() === 'screen-quiz' && el('quiz-kana').lang === 'en', `showing ${visible()}, lang=${el('quiz-kana').lang}`);

const prodAnswer = shitsumonInfo.r;
const prodChoicesBefore = el('quiz-choices')._children.map((b) => b.textContent);
const prodRight = el('quiz-choices')._children.find((b) => b.textContent === prodAnswer);
check('the correct kana reading is among Recall stage 1\'s options', !!prodRight, prodChoicesBefore.join('|'));
fire(prodRight, 'click');
await settle();

const prodQualifies = el('quiz-ok').textContent === 'Next: pick the kanji →';
check('Recall stage 1 pauses green with an explanatory Next, same as Meaning did',
  el('quiz-card').className.includes('is-correct') && el('quiz-ok').hidden === false,
  `card="${el('quiz-card').className}", ok hidden=${el('quiz-ok').hidden}, text="${el('quiz-ok').textContent}"`);
check('...and does not swap the choices out from under the click that just landed',
  el('quiz-choices')._children.map((b) => b.textContent).join('|') === prodChoicesBefore.join('|'));

fire(el('quiz-ok'), 'click');
await settle();

if (prodQualifies) {
  check('the spelling stage announces itself, same pattern as the reading stage did',
    el('quiz-feedback').textContent === 'Now choose the correct kanji.' && el('quiz-ok').hidden === true,
    `feedback="${el('quiz-feedback').textContent}", ok hidden=${el('quiz-ok').hidden}`);
  const spellAnswer = shitsumonInfo.w;
  const spellRight = el('quiz-choices')._children.find((b) => b.textContent === spellAnswer);
  check('the correct spelling is among the spelling stage\'s options', !!spellRight,
    el('quiz-choices')._children.map((b) => b.textContent).join('|'));
  fire(spellRight, 'click');
  await settle();
  check('grading the spelling clears the hint and shows a bare Next',
    el('quiz-feedback').textContent === '' && el('quiz-ok').textContent === 'Next');
} else {
  check('no follow-up qualified, so Next is bare and finishes the session directly',
    el('quiz-ok').textContent === 'Next');
}

fire(el('quiz-ok'), 'click');
for (let i = 0; i < 10; i += 1) await settle();
check('the Recall session is finished too', visible() === 'screen-summary', visible());

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'go-home' } }) } });
await settle();
fire(el('script-list')._children.find((c) => c.dataset.script === 'vocab'), 'click');
await settle();
fire(el('grade-picker')._children.find((b) => b.dataset.grade === 'C1'), 'click');
await settle();

// --- Kanji detail: "Common words" offers a one-tap add to the vocab list ---
// A word in a kanji's own common-words list (kanji.js's JMdict-derived list,
// built independently of vocab.js's separate, smaller curriculum) that also
// happens to be taught there gets an "Add" button — clicking it enrolls that
// word in the vocab study list without leaving the kanji page. See
// vocabIdForWord() in vocab.js and renderGeneralWords() in app.js.

function findAddableWord(course) {
  for (const kanji of course.chunks.flatMap((c) => c.items)) {
    const info = kanjiInfo(course, kanji);
    for (const word of info.words) {
      const id = vocabIdForWord(word.kanji, word.kana);
      if (id) return { kanji, word, id };
    }
  }
  return null;
}
const addable = findAddableWord(kanjiGrade1);
check('grade 1 has at least one kanji whose common-words list matches the vocab curriculum',
  !!addable, 'none found — test setup problem, not necessarily an app bug');

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'go-home' } }) } });
await settle();
fire(el('script-list')._children.find((c) => c.dataset.script === 'kanji'), 'click');
await settle();
fire(el('mode-picker')._children.find((b) => b.dataset.mode === 'definition'), 'click');
await settle();
fire(el('grade-picker')._children.find((b) => b.dataset.grade === '1'), 'click');
await settle();
fire(buttonsIn(el('course-list')._children[0]).find((b) => (b.innerHTML || '').includes('View set overview')), 'click');
await settle();
fire(el('overview-grid')._children.find((t) => t.textContent === addable.kanji), 'click');
for (let i = 0; i < 10; i += 1) await settle(); // openCharacterDetail is async
check('this kanji\'s detail screen shows the Common words section',
  el('detail-general-words').hidden === false
  && el('detail-general-words-list')._children.length > 0,
  `hidden=${el('detail-general-words').hidden}, rows=${el('detail-general-words-list')._children.length}`);

const findWordRow = (surface) => el('detail-general-words-list')._children
  .find((row) => wordSurfaceOf(row) === surface);

const wordRow = findWordRow(addable.word.kanji);
// The stub tracks no real tag name (createElement() ignores which tag is
// asked for — see the stub's own comment), so a click listener actually
// being wired is the meaningful, checkable half of "this is a real button".
// The badge carries the add now, NOT the row: tapping the row opens the
// drill-in tray instead, so both have to be wired independently.
check('the matched word\'s row has an "Add" badge with its own click handler',
  !!wordRow && addBadgeOf(wordRow) && addBadgeOf(wordRow).textContent === 'Add'
  && hasClick(addBadgeOf(wordRow)),
  wordRow ? `badge="${addBadgeOf(wordRow) && addBadgeOf(wordRow).textContent}"` : 'row not found');
check('the word itself is separately tappable, for the drill-in tray',
  hasClick(wordMainOf(wordRow)));

const profileBeforeAdd = [...rows.values()][0];
check('the matched word is not already in the study list before tapping it',
  !isStudying(profileBeforeAdd.study, addable.id, 'vmeaning'));

fire(addBadgeOf(wordRow), 'click');
await settle();

const profileAfterAdd = [...rows.values()][0];
check('tapping Add enrolls the word in every applicable vocab mode',
  isStudying(profileAfterAdd.study, addable.id, 'vmeaning')
  && isStudying(profileAfterAdd.study, addable.id, 'vrecall'));

const wordRowAfter = findWordRow(addable.word.kanji);
check('the row re-renders to show it\'s now being studied, and the badge stops being tappable',
  wordRowAfter.className.includes('is-added')
  && addBadgeOf(wordRowAfter) && addBadgeOf(wordRowAfter).textContent === 'Studying'
  && !hasClick(addBadgeOf(wordRowAfter)),
  `class="${wordRowAfter.className}", badge="${addBadgeOf(wordRowAfter) && addBadgeOf(wordRowAfter).textContent}"`);
check('an already-studied word stays drillable — only the Add half goes inert',
  hasClick(wordMainOf(wordRowAfter)));

// --- Drilling in: tap the word, then a kanji inside it --------------------

const trayBefore = wordTrayOf(wordRowAfter);
check('the drill-in tray starts closed', trayBefore.hidden === true);
fire(wordMainOf(wordRowAfter), 'click');
await settle();
check('tapping the word opens its tray', wordTrayOf(wordRowAfter).hidden === false);

const KANJI_RE_WORDS = /[㐀-䶿一-鿿]/;
const expectedChips = [...new Set([...addable.word.kanji])]
  .filter((ch) => KANJI_RE_WORDS.test(ch) && kanjiUnitFor(ch));
const trayChips = trayBefore.querySelectorAll('.reading-chip');
check('the tray offers one chip per taught kanji in the word',
  trayChips.length === expectedChips.length
  && trayChips.every((c, i) => c.textContent === expectedChips[i]),
  `${trayChips.length} chips (${trayChips.map((c) => c.textContent).join('')}) for ${expectedChips.join('')}`);

const moreButton = trayBefore.querySelectorAll('.word-more')[0];
check('a word that IS in the vocab curriculum offers a way through to its own detail screen',
  !!moreButton, trayBefore._children.map((c) => c.className).join(' | '));

fire(trayChips[0], 'click');
for (let i = 0; i < 10; i += 1) await settle();
check('tapping a kanji chip in the tray opens THAT kanji\'s detail screen',
  visible() === 'screen-character-detail' && el('detail-glyph').textContent === expectedChips[0],
  `showing ${visible()}, glyph "${el('detail-glyph').textContent}"`);

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'detail-back' } }) } });
for (let i = 0; i < 10; i += 1) await settle();
check('backing out returns to the kanji whose Common words list the drill started from',
  visible() === 'screen-character-detail' && el('detail-glyph').textContent === addable.kanji,
  `showing ${visible()}, glyph "${el('detail-glyph').textContent}"`);

// The chain that the old single-frame "back to the word" could not unwind:
// kanji -> word -> kanji is three detail screens deep, and each Back must
// step back exactly one of them.
const wordRowAgain = findWordRow(addable.word.kanji);
fire(wordMainOf(wordRowAgain), 'click');
await settle();
fire(wordTrayOf(wordRowAgain).querySelectorAll('.word-more')[0], 'click');
for (let i = 0; i < 10; i += 1) await settle();
check('"Word details" opens the word\'s own detail screen, with its vocab study toggle',
  visible() === 'screen-character-detail'
  && el('detail-mode-vmeaning').hidden === false && el('detail-mode-definition').hidden === true,
  `showing ${visible()}`);

const wordScreenKanjiChip = el('detail-word-kanji')._children[0];
fire(wordScreenKanjiChip, 'click');
for (let i = 0; i < 10; i += 1) await settle();
check('a kanji chip on the word screen goes one level deeper still',
  visible() === 'screen-character-detail' && el('detail-readings').hidden === false,
  `showing ${visible()}`);

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'detail-back' } }) } });
for (let i = 0; i < 10; i += 1) await settle();
check('Back unwinds one level, to the WORD — not straight out of the chain',
  visible() === 'screen-character-detail' && el('detail-word-kanji').hidden === false,
  `showing ${visible()}, word-kanji hidden=${el('detail-word-kanji').hidden}`);

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'detail-back' } }) } });
for (let i = 0; i < 10; i += 1) await settle();
check('Back again unwinds to the kanji the chain started from, not into a loop',
  visible() === 'screen-character-detail' && el('detail-glyph').textContent === addable.kanji,
  `showing ${visible()}, glyph "${el('detail-glyph').textContent}"`);

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'detail-back' } }) } });
for (let i = 0; i < 10; i += 1) await settle();
check('and one more Back finally leaves the detail screens entirely',
  visible() === 'screen-overview', `showing ${visible()}`);

fire(el('overview-grid')._children.find((t) => t.textContent === addable.kanji), 'click');
for (let i = 0; i < 10; i += 1) await settle();

// A common word with no vocab-curriculum match has nothing to add and no
// word screen to open — but its KANJI are still worth drilling into, which
// is the whole point of making every word tappable rather than only the
// ones the vocab course happens to teach.
const unmatchedWord = kanjiInfo(kanjiGrade1, addable.kanji).words
  .find((w) => !vocabIdForWord(w.kanji, w.kana) && KANJI_RE_WORDS.test(w.kanji));
if (unmatchedWord) {
  const unmatchedRow = findWordRow(unmatchedWord.kanji);
  check('a common word with no vocab match has no Add badge and no "Word details"',
    !!unmatchedRow && !addBadgeOf(unmatchedRow)
    && wordTrayOf(unmatchedRow).querySelectorAll('.word-more').length === 0,
    unmatchedRow ? unmatchedRow.className : 'row not found');
  check('...but it still says so, and still offers its kanji',
    wordTrayOf(unmatchedRow).querySelectorAll('.word-note').length === 1
    && wordTrayOf(unmatchedRow).querySelectorAll('.reading-chip').length > 0,
    unmatchedRow ? wordTrayOf(unmatchedRow)._children.map((c) => c.className).join(' | ') : '');
}

// --- Summary screen: "Review N due" outranks "Learn N new" -----------------
// A real regression: the button existed and worked, it just never got the
// primary style, so a real due count sat next to a highlighted "Learn new"
// looking like the lesser option — even though "due outranks new" is already
// the rule the home screen's quick actions and the course card both use.
// Reproduced here exactly: one hiragana batch with an unpractised miss (left
// due, on purpose, by moving on instead of fixing it), followed by a second,
// completely clean batch — nothing missed in THIS session, but the earlier
// miss is still due in the same course, so Review must still win.

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'go-home' } }) } });
await settle();
fire(el('script-list')._children.find((c) => c.dataset.script === 'hiragana'), 'click');
await settle();

async function stepThroughLesson() {
  for (let i = 0; i < 10 && visible() === 'screen-lesson'; i += 1) {
    fire(el('lesson-next'), 'click');
    await settle();
  }
}

const dueVsNewLearnButton = buttonsIn(el('course-list')._children[0])
  .find((b) => (b.innerHTML || '').includes('Learn <b>'));
fire(dueVsNewLearnButton, 'click');
for (let i = 0; i < 10; i += 1) await settle();
await stepThroughLesson();
check('the first due-vs-new batch reaches its quiz', visible() === 'screen-quiz', visible());

// Miss the first question on purpose (locks its due date to right now via a
// lapse), answer the rest correctly.
for (let i = 0; i < 10 && visible() === 'screen-quiz'; i += 1) {
  const kana = el('quiz-kana').textContent;
  if (!kana) break;
  const choices = el('quiz-choices')._children;
  const answer = romajiFor(kana);
  const target = i === 0 ? choices.find((c) => c.textContent !== answer) : choices.find((c) => c.textContent === answer);
  fire(target, 'click');
  await settle();
  if (i === 0) {
    fire(choices.find((c) => c.textContent === answer), 'click'); // recover, but the lapse already stuck
    await settle();
  }
  fire(el('quiz-ok'), 'click');
  await settle();
}
check('the first batch\'s summary shows exactly the one deliberate miss',
  visible() === 'screen-summary' && el('summary-study-missed').innerHTML === 'Practise <b>1</b> missed',
  `showing ${visible()}, study-missed says "${el('summary-study-missed').innerHTML}"`);

// Move on to a fresh batch instead of practising that miss — "Learn new" is
// visible (something was missed, so it isn't primary, but it's still a
// legitimate thing to tap) and leaves the miss sitting due, unreviewed.
check('a further new-hiragana batch is on offer to move on to instead',
  el('summary-learn').hidden === false, el('summary-learn').innerHTML);
// summary-learn is a static data-action button, wired through the one
// delegated document-level click listener — not its own addEventListener —
// so it has to be fired the same way study-missed/quit-session/etc. are
// fired elsewhere in this file, not as a direct element click.
fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'learn-more' } }) } });
for (let i = 0; i < 10; i += 1) await settle();
await stepThroughLesson();
check('the second, clean batch reaches its own quiz', visible() === 'screen-quiz', visible());

// Answer this whole batch correctly, first try — nothing missed this time.
for (let i = 0; i < 10 && visible() === 'screen-quiz'; i += 1) {
  const kana = el('quiz-kana').textContent;
  if (!kana) break;
  const answer = romajiFor(kana);
  const target = el('quiz-choices')._children.find((c) => c.textContent === answer);
  fire(target, 'click');
  await settle();
  fire(el('quiz-ok'), 'click');
  await settle();
}
check('the second batch\'s summary shows nothing missed in THIS session',
  visible() === 'screen-summary' && el('summary-study-missed').hidden === true,
  `showing ${visible()}, study-missed hidden=${el('summary-study-missed').hidden}`);

// The earlier, unpractised miss is still due, in the same hiragana course —
// so even with nothing missed in this session, Review must be the
// highlighted action, not Learn.
check('"Review N due" is offered here, carrying over the still-due miss from the earlier batch',
  el('summary-review').hidden === false && /\d/.test(el('summary-review').innerHTML),
  el('summary-review').innerHTML);
check('"Review N due" is the primary action once nothing was missed and something is due',
  el('summary-review').classList.contains('btn-primary'));
check('"Learn N new" cedes the primary spot to Review whenever review is due, even with nothing missed',
  !el('summary-learn').classList.contains('btn-primary'));

// Restore the state every earlier section assumed, in case anything below
// this point is ever added and depends on it.
fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'go-home' } }) } });
await settle();
fire(el('script-list')._children.find((c) => c.dataset.script === 'kanji'), 'click');
await settle();
fire(el('grade-picker')._children.find((b) => b.dataset.grade === '1'), 'click');
await settle();

// --- Mark as known: bulk, no-quiz claims from the set overview -------------
// The quicker alternative to Test unlearned: a row on the course card opens
// the set overview in select mode, tiles tick and untick, "Select all not
// started" grabs the whole untried pool, and a pinned bar applies the claim.
// A recognition mode (kana Reading here) gets one full-mastery action;
// Writing (and Yomi, checked on kanji below) gets the softer "I think I
// know these" — one tier short, double-check reviews spread over weeks —
// with "I'm sure" beside it as the override. Runs last on purpose: the
// hiragana course ends up with nothing left untried in Reading, which the
// sections above could not have tolerated.

const DAY_MS = 24 * 60 * 60 * 1000;
const cardButtons = () => buttonsIn(el('course-list')._children[0]);
const cardLabels = () => cardButtons().map((b) => b.innerHTML || b.textContent);
const markKnownRow = () => cardButtons().find((b) => (b.innerHTML || '').includes('Mark as known'));
const fireAction = (action) => fire(document, 'click', { target: { closest: () => ({ dataset: { action } }) } });

fireAction('go-home');
await settle();
fire(el('script-list')._children.find((c) => c.dataset.script === 'hiragana'), 'click');
await settle();
fire(el('mode-picker')._children.find((b) => b.dataset.mode === 'recognition'), 'click');
await settle();

check('the course card ladder has a "Mark as known…" row', !!markKnownRow(), cardLabels().join(' | '));
{
  const labels = cardLabels();
  const test = labels.findIndex((t) => t.includes('Test unlearned'));
  const mark = labels.findIndex((t) => t.includes('Mark as known'));
  const learn = labels.findIndex((t) => t.startsWith('Learn'));
  check('it sits directly under Test unlearned and above Learn', test >= 0 && mark === test + 1 && learn > mark,
    labels.join(' | '));
}
check('it is never the highlighted action — testing stays the recommended route',
  !markKnownRow().className.includes('btn-primary'), markKnownRow().className);

fire(markKnownRow(), 'click');
await drain(10);
check('the row opens the set overview already in select mode',
  visible() === 'screen-overview' && el('overview-select-hint').hidden === false
  && el('overview-select-shortcuts').hidden === false, `showing ${visible()}`);
check('the select-mode hint names the mode being claimed', el('overview-select-hint').textContent.includes('Reading'),
  el('overview-select-hint').textContent);
check('the overview\'s own toggle now offers to cancel', el('overview-select-toggle').textContent.includes('Cancel'),
  el('overview-select-toggle').textContent);
check('kana Reading is self-assessable: one action, no "I think I know" tier',
  el('overview-mark-think').hidden === true && el('overview-mark-sure').hidden === false);
check('with nothing ticked the action is disabled and the counter says 0',
  el('overview-mark-sure').disabled === true && el('overview-counter').textContent === '0 selected',
  el('overview-counter').textContent);

const hiraganaCourse = getCourse('hiragana');
const profileBeforeMark = [...rows.values()][0];
const readingUntried = neverSeenItems(hiraganaCourse, 'recognition', profileBeforeMark);
check('hiragana still has untried characters in Reading to mark', readingUntried.length > 0, readingUntried.length);
const masteredHiragana = hiraganaCourse.chunks.flatMap((c) => c.items)
  .find((k) => profileBeforeMark.progress[`recognition:${k}`] && profileBeforeMark.progress[`recognition:${k}`].box === MAX_BOX);
check('a hiragana already at the top box exists (from the placement test earlier)', !!masteredHiragana);

check('the overview has its own mode picker, with the current mode active',
  el('overview-mode-picker')._children.length === 2
  && el('overview-mode-picker')._children.find((b) => b.dataset.mode === 'recognition').className.includes('active')
  && !el('overview-mode-picker')._children.find((b) => b.dataset.mode === 'writing').className.includes('active'),
  el('overview-mode-picker')._children.map((b) => `${b.dataset.mode}:${b.className}`).join(' | '));

const selectTiles = el('overview-grid')._children;
const masteredTile = selectTiles.find((t) => t.dataset.item === masteredHiragana);
check('an already well-known tile is not selectable — and keeps exactly its normal colour, no dimming class',
  !masteredTile.classList.contains('is-selectable') && masteredTile.className.includes('tier-4')
  && !masteredTile.classList.contains('is-ineligible') && masteredTile.getAttribute('aria-disabled') === null,
  `${masteredTile.className} / ${[...masteredTile.classList._set].join(' ')}`);
const eligibleTiles = selectTiles.filter((t) => t.classList.contains('is-selectable'));
check('every untried tile is selectable',
  readingUntried.every((k) => selectTiles.find((t) => t.dataset.item === k).classList.contains('is-selectable')));
check('a tile has one click handler that decides at tap time — no rebuild to enter select mode',
  masteredTile._listeners.click.length === 1);

fire(masteredTile, 'click');
check('tapping a well-known tile ticks nothing and explains why on the hint line',
  el('overview-counter').textContent === '0 selected' && visible() === 'screen-overview'
  && el('overview-select-hint').textContent.includes('Already well known'),
  el('overview-select-hint').textContent);
fire(eligibleTiles[0], 'click');
fire(eligibleTiles[1], 'click');
check('tapping tiles ticks them, in place, without leaving the overview',
  eligibleTiles[0].classList.contains('is-selected') && eligibleTiles[1].classList.contains('is-selected')
  && eligibleTiles[0].getAttribute('aria-pressed') === 'true'
  && el('overview-counter').textContent === '2 selected' && visible() === 'screen-overview',
  el('overview-counter').textContent);
check('ticking a tile puts the ordinary instructions back on the hint line',
  el('overview-select-hint').textContent.includes('tap again to untick'), el('overview-select-hint').textContent);
check('the action button counts the selection and names the mode',
  el('overview-mark-sure').textContent === 'Mark 2 as known in Reading' && el('overview-mark-sure').disabled === false,
  el('overview-mark-sure').textContent);
fire(eligibleTiles[0], 'click');
check('tapping a ticked tile unticks it',
  !eligibleTiles[0].classList.contains('is-selected') && eligibleTiles[0].getAttribute('aria-pressed') === 'false'
  && el('overview-counter').textContent === '1 selected');

fireAction('overview-select-all');
const expectedAll = new Set([...readingUntried, eligibleTiles[1].dataset.item]).size;
check('"Select all not started" ticks the whole untried pool, keeping what was already ticked',
  el('overview-counter').textContent === `${expectedAll} selected`
  && readingUntried.every((k) => selectTiles.find((t) => t.dataset.item === k).classList.contains('is-selected')),
  el('overview-counter').textContent);
fireAction('overview-select-none');
check('"Clear" unticks everything', el('overview-counter').textContent === '0 selected'
  && !selectTiles.some((t) => t.classList.contains('is-selected')));
fireAction('overview-select-all');

fireAction('overview-mark-sure');
await drain(10);
const profileAfterSure = [...rows.values()][0];
check('marking as known writes a top-box Reading record for every untried hiragana',
  readingUntried.every((k) => profileAfterSure.progress[`recognition:${k}`]
    && profileAfterSure.progress[`recognition:${k}`].box === MAX_BOX),
  JSON.stringify(profileAfterSure.progress[`recognition:${readingUntried[0]}`]));
check('kana are never enrolled in a study list', readingUntried.every((k) => !(k in (profileAfterSure.study || {}))));
check('the overview stays on screen, out of select mode, with the marked tiles now well known',
  visible() === 'screen-overview' && el('overview-mark-sure').hidden === true
  && el('overview-select-shortcuts').hidden === true
  && readingUntried.every((k) => el('overview-grid')._children.find((t) => t.dataset.item === k).className.includes('tier-4')),
  `showing ${visible()}`);
check('a confirmation line says what happened and when they come back',
  el('overview-select-hint').hidden === false && el('overview-select-hint').textContent.includes('marked as known')
  && el('overview-select-hint').textContent.includes('about a month'), el('overview-select-hint').textContent);
check('the toggle reads "Mark as known" again', el('overview-select-toggle').textContent.includes('Mark as known'));

fireAction('go-course');
await settle();
check('back on the course card, nothing is left to test or to mark',
  cardLabels().some((t) => t === 'Nothing left to test') && cardLabels().some((t) => t === 'Everything here is started'),
  cardLabels().join(' | '));

// Writing: a glance can't verify production, so the softer claim leads.
fire(el('mode-picker')._children.find((b) => b.dataset.mode === 'writing'), 'click');
await settle();
const profileBeforeThink = [...rows.values()][0];
const writingUntried = neverSeenItems(hiraganaCourse, 'writing', profileBeforeThink);
check('hiragana has untried characters in Writing to mark', writingUntried.length > 1, writingUntried.length);
fire(markKnownRow(), 'click');
await drain(10);
check('in Writing, "I think I know these" is the primary action and "I\'m sure" sits beside it',
  visible() === 'screen-overview'
  && el('overview-mark-think').hidden === false && el('overview-mark-think').className.includes('btn-primary')
  && el('overview-mark-sure').hidden === false && !el('overview-mark-sure').className.includes('btn-primary'),
  `${el('overview-mark-think').className} / ${el('overview-mark-sure').className}`);
const yoonChar = [...hiraganaCourse.excludeForMode.writing][0];
const writingListed = hiraganaCourse.chunks.flatMap((c) => c.items).filter((k) => !hiraganaCourse.excludeForMode.writing.has(k));
check('a yōon, which Writing never asks, is not listed on the Writing overview at all',
  !el('overview-grid')._children.some((t) => t.dataset.item === yoonChar)
  && el('overview-grid')._children.length === writingListed.length,
  `${el('overview-grid')._children.length} tiles vs ${writingListed.length} writable`);
check('the counter counts what is listed, not the whole course',
  el('overview-counter').textContent === '0 selected');
fireAction('overview-select-all');
check('the softer button counts the selection',
  el('overview-mark-think').textContent.startsWith(`I think I know these ${writingUntried.length}`),
  el('overview-mark-think').textContent);
const thinkStartedAt = Date.now();
fireAction('overview-mark-think');
await drain(10);
const profileAfterThink = [...rows.values()][0];
const thinkRecords = writingUntried.map((k) => profileAfterThink.progress[`writing:${k}`]);
check('"I think I know these" writes a Writing record one tier short of mastered for each',
  thinkRecords.every((r) => r && r.box === THINK_KNOWN_BOX && r.box < MAX_BOX), JSON.stringify(thinkRecords[0]));
const thinkDues = thinkRecords.map((r) => r.due);
check('a batch of soft claims is staggered — not one review pile on a single day',
  new Set(thinkDues).size > 1, `${new Set(thinkDues).size} distinct due dates for ${thinkDues.length} characters`);
check('none comes due sooner than a week out, none later than four weeks',
  thinkDues.every((d) => d >= thinkStartedAt + 7 * DAY_MS && d <= thinkStartedAt + 28 * DAY_MS + 5000),
  `${Math.min(...thinkDues) - thinkStartedAt} .. ${Math.max(...thinkDues) - thinkStartedAt}`);
check('the yōon got no Writing record', !profileAfterThink.progress[`writing:${yoonChar}`]);
check('the confirmation line explains the double-check and the spread',
  el('overview-select-hint').textContent.includes('double-check') && el('overview-select-hint').textContent.includes('spread'),
  el('overview-select-hint').textContent);

// Kanji Yomi: every quizzable reading gets a record, and the unit's data is
// loaded for the reading list even though the overview itself never needs it.
fireAction('go-home');
await settle();
fire(el('script-list')._children.find((c) => c.dataset.script === 'kanji'), 'click');
await settle();
fire(el('mode-picker')._children.find((b) => b.dataset.mode === 'recognition'), 'click');
await settle();
fire(el('grade-picker')._children.find((b) => b.dataset.grade === '6'), 'click');
await settle();
const profileBeforeYomi = [...rows.values()][0];
const yomiUntried = neverSeenItems(grade6Course, 'recognition', profileBeforeYomi);
check('grade 6 has untried kanji in Yomi to mark', yomiUntried.length > 0, yomiUntried.length);
fire(markKnownRow(), 'click');
await drain(10);
check('Yomi gets the two-tier bar too', el('overview-mark-think').hidden === false && el('overview-mark-sure').hidden === false);
fireAction('overview-select-all');
fireAction('overview-mark-sure');
await drain(20);
const profileAfterYomi = [...rows.values()][0];
const yomiSample = yomiUntried[0];
const sampleReadings = kanjiInfo(grade6Course, yomiSample).quizReadings;
check('the sample kanji has readings to have been recorded', sampleReadings.length > 0);
check('"I\'m sure" in Yomi writes a top-streak record for EVERY reading of each kanji',
  sampleReadings.every((r) => profileAfterYomi.progress[`recognition:${yomiSample}:${r}`]
    && profileAfterYomi.progress[`recognition:${yomiSample}:${r}`].streak === MAX_BOX),
  JSON.stringify(sampleReadings.map((r) => profileAfterYomi.progress[`recognition:${yomiSample}:${r}`])));
check('...and every marked kanji\'s rollup lands on the top box',
  yomiUntried.every((k) => profileAfterYomi.progress[`recognition:${k}`]
    && profileAfterYomi.progress[`recognition:${k}`].box === MAX_BOX));
check('...enrolled in Yomi', yomiUntried.every((k) => isStudying(profileAfterYomi.study, k, 'recognition')));
check('the overview shows them well known', visible() === 'screen-overview'
  && yomiUntried.every((k) => el('overview-grid')._children.find((t) => t.dataset.item === k).className.includes('tier-4')));

// Leaving drops select state; the next overview opens clean, browsing.
fireAction('go-course');
await settle();
fire(cardButtons().find((b) => (b.innerHTML || '').includes('View set overview')), 'click');
await drain(10);
check('an overview opened for browsing is not in select mode',
  visible() === 'screen-overview' && el('overview-select-hint').hidden === true
  && el('overview-mark-sure').hidden === true && el('overview-select-toggle').textContent.includes('Mark as known'));
check('the counter is the plain character count while browsing',
  /^\d+ characters$/.test(el('overview-counter').textContent), el('overview-counter').textContent);
const browsingTiles = el('overview-grid')._children;
fireAction('overview-select-toggle');
check('the overview\'s own toggle enters select mode in place — the grid is not rebuilt',
  el('overview-select-shortcuts').hidden === false && el('overview-select-toggle').textContent.includes('Cancel')
  && el('overview-grid')._children === browsingTiles && el('overview-counter').textContent === '0 selected');
fireAction('overview-select-toggle');
check('...and leaves it again, restoring the count', el('overview-select-shortcuts').hidden === true
  && /^\d+ characters$/.test(el('overview-counter').textContent), el('overview-counter').textContent);

// The pinned mode picker: switching mode on the overview re-lists and
// recolours the grid for the new mode and drops any selection in progress.
fireAction('overview-select-toggle');
const yomiTileToTick = el('overview-grid')._children.find((t) => t.classList.contains('is-selectable'));
if (yomiTileToTick) fire(yomiTileToTick, 'click');
check('grade 6 Yomi is now entirely well known, so nothing is selectable there', !yomiTileToTick);
const kanjiPicker = el('overview-mode-picker')._children;
check('the kanji overview picker offers Definition / Yomi / Writing with Yomi active',
  kanjiPicker.map((b) => b.dataset.mode).join(',') === 'definition,recognition,writing'
  && kanjiPicker[1].className.includes('active'), kanjiPicker.map((b) => `${b.dataset.mode}:${b.className}`).join(' | '));
fire(kanjiPicker.find((b) => b.dataset.mode === 'writing'), 'click');
await drain(5);
check('switching mode on the overview stays on the overview, Writing now active',
  visible() === 'screen-overview'
  && el('overview-mode-picker')._children.find((b) => b.dataset.mode === 'writing').className.includes('active'));
check('...and drops the selection in progress rather than carrying it into the new mode',
  el('overview-mark-sure').hidden === true && el('overview-select-shortcuts').hidden === true);
const grade6WritingTiles = el('overview-grid')._children;
check('...recolouring every tile for the new mode (Writing untouched, so nothing well known)',
  grade6WritingTiles.length > 0 && !grade6WritingTiles.some((t) => t.className.includes('tier-4')),
  grade6WritingTiles.filter((t) => t.className.includes('tier-4')).length);

// Long-press on a tile while browsing: the third way into select mode,
// with that tile already ticked. Routed through the same ghost-click guard
// bindTap uses (see bindLongPress in app.js): the release still produces a
// click, which must not untick what the hold just ticked.
const heldTile = grade6WritingTiles[0];
fire(heldTile, 'pointerdown', { pointerType: 'touch', clientX: 100, clientY: 100, pointerId: 7 });
check('merely pressing does not enter select mode', el('overview-select-shortcuts').hidden === true);
runTimers(); // the hold threshold elapses
check('holding a tile enters select mode with that tile ticked',
  el('overview-select-shortcuts').hidden === false && heldTile.classList.contains('is-selected')
  && el('overview-counter').textContent === '1 selected',
  `${el('overview-select-shortcuts').hidden} / ${el('overview-counter').textContent}`);
check('...in place: the held tile is the very element still on screen',
  el('overview-grid')._children[0] === heldTile);
fire(heldTile, 'pointerup', { pointerType: 'touch', clientX: 100, clientY: 100, pointerId: 7 });
// The click the browser fires for that release (real on desktop, synthesized
// on iOS) is swallowed by the guard's capture-phase listener — modelled here
// as a delegated click that must not get through to its handler.
fireAction('go-course');
check('the click that follows the release is swallowed — the overview is still showing',
  visible() === 'screen-overview' && heldTile.classList.contains('is-selected'), `showing ${visible()}`);
fire(document, 'pointerdown', { pointerType: 'touch' }); // a real next tap begins with its own press…
fireAction('overview-select-none');
check('…which disarms the guard, so the next genuine tap goes through', el('overview-counter').textContent === '0 selected');
fire(heldTile, 'click');
check('a plain tap in select mode still toggles as usual', heldTile.classList.contains('is-selected'));
fireAction('overview-select-toggle');
check('back to browsing', el('overview-select-shortcuts').hidden === true);

// A press that turns into a scroll (moves past the slop) never fires.
fire(heldTile, 'pointerdown', { pointerType: 'touch', clientX: 100, clientY: 100, pointerId: 8 });
fire(heldTile, 'pointermove', { pointerType: 'touch', clientX: 100, clientY: 140, pointerId: 8 });
runTimers();
check('a press that moved on is a scroll, not a hold — select mode is not entered',
  el('overview-select-shortcuts').hidden === true);
fire(heldTile, 'pointerup', { pointerType: 'touch', clientX: 100, clientY: 140, pointerId: 8 });
// A release before the threshold likewise: the ordinary click is left alone.
fire(heldTile, 'pointerdown', { pointerType: 'touch', clientX: 100, clientY: 100, pointerId: 9 });
fire(heldTile, 'pointerup', { pointerType: 'touch', clientX: 100, clientY: 100, pointerId: 9 });
runTimers();
check('a release before the threshold never enters select mode', el('overview-select-shortcuts').hidden === true);
fireAction('go-course');
await settle();
check('...and that quick tap\'s click is not eaten either', visible() === 'screen-course', `showing ${visible()}`);
check('the mode chosen on the overview carries back to the course screen',
  el('mode-picker')._children.find((b) => b.dataset.mode === 'writing').className.includes('active'));

fireAction('go-home');
await settle();
fire(el('script-list')._children.find((c) => c.dataset.script === 'kanji'), 'click');
await settle();
fire(el('grade-picker')._children.find((b) => b.dataset.grade === '1'), 'click');
await settle();

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
print('all wiring checks passed '
  + `(kana ${answered}, yomi ${kAnswered}, definition ${defAnswered} questions answered; `
  + `${Object.keys([...rows.values()][0].progress).length} records saved)`);
