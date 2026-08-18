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
const { KANJI_COURSES, kanjiInfo } = await import('../src/kanji.js');
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
      runTimers(); // short pause after landing on the correct answer
      await settle();
    } else {
      revealDone = true;
      revealKana = kana;
      const secondWrong = choices.find((c) => c !== wrongTarget && c.textContent !== answer && !c.disabled);
      check('a different wrong option is available for the second try', !!secondWrong);
      fire(secondWrong, 'click');
      await settle();
      check('a second miss reveals the answer', el('quiz-feedback').textContent === answer,
        `"${el('quiz-feedback').textContent}"`);
      check('a second miss highlights the correct option',
        choices.some((c) => c.textContent === answer && c.classList.contains('is-right')));
      check('the app waits for a tap after the final reveal',
        visible() === 'screen-quiz' && el('quiz-kana').textContent === kana);
      fire(el('screen-quiz'), 'click'); // a tap anywhere on the quiz screen moves on
      await settle();
      check('acknowledging the reveal cancels the auto-advance timer', timers.size === 0);
    }
  } else {
    const target = choices.find((c) => c.textContent === answer);
    check(`question ${i + 1} offers a tappable answer`, !!target);
    if (!target) break;
    fire(target, 'click');
    await settle();
    runTimers();
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
check('summary "learn more" is labelled with a count',
  /\d/.test(el('summary-learn').innerHTML), `"${el('summary-learn').innerHTML}"`);

const saved = [...rows.values()][0];
const records = Object.entries(saved.progress);
check('progress was written to storage', records.length > 0, `${records.length} records`);
check('progress is keyed by mode', records.every(([k]) => k.startsWith('recognition:')));
check('every record has a history', records.every(([, r]) => r.history.length > 0));
check('correct answers advanced past box 0', records.some(([, r]) => r.box > 0));

const recoveryRecord = saved.progress[`recognition:${recoveryKana}`];
check('a miss recovered on the second try still counts as a lapse',
  !!recoveryRecord && recoveryRecord.lapses >= 1, JSON.stringify(recoveryRecord));
check('the recovered character was re-drilled later in the session',
  recoveryRecord && recoveryRecord.history.length > 1);

const revealRecord = saved.progress[`recognition:${revealKana}`];
check('a miss wrong both times counts as a lapse', !!revealRecord && revealRecord.lapses >= 1);
check('it too was re-drilled later in the session',
  revealRecord && revealRecord.history.length > 1);

// --- Kanji reading quiz -----------------------------------------------
// Same "give another chance, but the record is locked to the first
// attempt" contract as kana, but multi-select: tick every reading that
// applies, then press OK. Exercises all three outcomes.

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'go-home' } }) } });
await settle();
check('back on the home screen after the kana session', visible() === 'screen-home', `showing ${visible()}`);

const kanjiCard = el('course-list')._children
  .find((card) => (card.innerHTML || '').includes('小学'));
check('the kanji course card is on the home screen', !!kanjiCard);

const kanjiButtons = kanjiCard._children.flatMap((n) => (n._children.length ? n._children : [n]));
const kanjiLearnButton = kanjiButtons.find((b) => (b.innerHTML || '').includes('more'));
check('the kanji course offers an "add more" button', !!kanjiLearnButton);

fire(kanjiLearnButton, 'click');
await settle();
check('a kanji session opens the lesson screen first', visible() === 'screen-lesson', `showing ${visible()}`);
check('a kanji lesson shows readings instead of romaji',
  el('lesson-readings').hidden === false && el('lesson-romaji').hidden === true);
check('a kanji lesson shows a meaning', el('lesson-meanings').textContent.length > 0);

for (let i = 0; i < 10 && visible() === 'screen-lesson'; i += 1) {
  fire(el('lesson-next'), 'click');
  await settle();
}
check('the kanji lesson hands over to the quiz', visible() === 'screen-quiz', `showing ${visible()}`);

const kanjiCourse = KANJI_COURSES.find((c) => c.id === 'kanji-grade-1');
let kAnswered = 0;
let firstTryDone = false;
let firstTryKanji = null;
let kRecoveryDone = false;
let kRecoveryKanji = null;
let kRevealDone = false;
let kRevealKanji = null;

for (let i = 0; i < 40 && visible() === 'screen-quiz'; i += 1) {
  const kanji = el('quiz-kana').textContent;
  if (!kanji) break;
  const correctSet = new Set(kanjiInfo(kanjiCourse, kanji).quizReadings);
  const choices = el('quiz-choices')._children;
  check(`kanji question ${i + 1} offers ten options`, choices.length === 10);
  const correctButtons = choices.filter((c) => correctSet.has(c.textContent));
  const wrongButtons = choices.filter((c) => !correctSet.has(c.textContent));

  if (kAnswered === 0 && !firstTryDone) {
    firstTryDone = true;
    firstTryKanji = kanji;
    correctButtons.forEach((b) => fire(b, 'click'));
    fire(el('quiz-ok'), 'click');
    await settle();
    check('ticking exactly the correct set finalizes on the first try',
      el('quiz-ok').textContent === 'Next');
    check('a first-try match reveals the meaning/word panel', el('quiz-info').hidden === false);
    check('a first-try match marks every correct option right',
      correctButtons.every((b) => b.classList.contains('is-right')));
    fire(el('quiz-ok'), 'click'); // Next
    await settle();
  } else if (kAnswered === 1 && !kRecoveryDone) {
    kRecoveryDone = true;
    kRecoveryKanji = kanji;
    fire(wrongButtons[0], 'click');
    fire(el('quiz-ok'), 'click');
    await settle();
    check('a wrong tick does not finalize the question', el('quiz-ok').textContent === 'OK');
    check('a wrong tick does not reveal the info panel yet', el('quiz-info').hidden === true);
    check('a wrong tick turns red and locks', wrongButtons[0].classList.contains('is-wrong') && wrongButtons[0].disabled);
    check('a wrong tick does not reveal which options were correct',
      !choices.some((c) => c.classList.contains('is-missed')));
    correctButtons.forEach((b) => fire(b, 'click'));
    fire(el('quiz-ok'), 'click');
    await settle();
    check('ticking the full correct set on the second try finalizes it',
      el('quiz-ok').textContent === 'Next');
    check('the info panel is shown once the retry succeeds', el('quiz-info').hidden === false);
    fire(el('quiz-ok'), 'click');
    await settle();
  } else if (kAnswered === 2 && !kRevealDone) {
    kRevealDone = true;
    kRevealKanji = kanji;
    fire(wrongButtons[0], 'click');
    fire(el('quiz-ok'), 'click');
    await settle();
    fire(wrongButtons[1], 'click'); // a different wrong option for the second try
    fire(el('quiz-ok'), 'click');
    await settle();
    check('being wrong twice reveals the correct options as missed',
      correctButtons.every((b) => b.classList.contains('is-missed')));
    check('being wrong twice shows the info panel', el('quiz-info').hidden === false);
    fire(el('quiz-ok'), 'click');
    await settle();
  } else {
    correctButtons.forEach((b) => fire(b, 'click'));
    fire(el('quiz-ok'), 'click');
    await settle();
    fire(el('quiz-ok'), 'click');
    await settle();
  }
  kAnswered += 1;
}

check('the kanji first-try path was exercised', firstTryDone);
check('the kanji recover-on-second-try path was exercised', kRecoveryDone);
check('the kanji wrong-both-times path was exercised', kRevealDone);
check('the kanji quiz ends at the summary', visible() === 'screen-summary', `showing ${visible()}`);

const afterKanji = [...rows.values()][0];
const firstTryRecord = afterKanji.progress[`recognition:${firstTryKanji}`];
check('an exact first-try kanji answer has zero lapses',
  !!firstTryRecord && firstTryRecord.lapses === 0, JSON.stringify(firstTryRecord));

const kanjiRecoveryRecord = afterKanji.progress[`recognition:${kRecoveryKanji}`];
check('a kanji miss recovered on the second try still counts as a lapse',
  !!kanjiRecoveryRecord && kanjiRecoveryRecord.lapses >= 1, JSON.stringify(kanjiRecoveryRecord));

const kanjiRevealRecord = afterKanji.progress[`recognition:${kRevealKanji}`];
check('a kanji miss wrong both times counts as a lapse',
  !!kanjiRevealRecord && kanjiRevealRecord.lapses >= 1);

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
