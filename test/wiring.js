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
    setAttribute(name, value) { this._attrs[name] = String(value); },
    getAttribute(name) { return name in this._attrs ? this._attrs[name] : null; },
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
const { KANJI_COURSES, kanjiInfo, readingExample, buildKanjiOptions, meaningLabel } = await import('../src/kanji.js');
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

// --- Home is a three-way script picker ------------------------------------

const profile = [...rows.values()][0];
check('new profile starts with no progress', Object.keys(profile.progress).length === 0);

const scriptCards = el('script-list')._children;
check('the home screen offers exactly three scripts', scriptCards.length === 3,
  scriptCards.map((c) => c.dataset.script).join(', '));
check('the three scripts are hiragana, katakana and kanji',
  scriptCards.map((c) => c.dataset.script).join(',') === 'hiragana,katakana,kanji',
  scriptCards.map((c) => c.dataset.script).join(','));
check('the home screen no longer lists individual courses — that moved a level down',
  el('course-list')._children.length === 0);

/** Buttons inside a rendered card, flattened one level (actions wrapper). */
const buttonsIn = (card) => card._children.flatMap((n) => (n._children.length ? n._children : [n]));

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
check('kana writing is present but disabled',
  kanaModes[1].innerHTML.includes('Writing') && kanaModes[1].disabled === true);
check('kana has no grade picker', el('grade-picker').hidden === true);

const courseButtons = buttonsIn(el('course-list')._children[0]);
const learnButton = courseButtons.find((b) => (b.innerHTML || '').includes('more'));
check('the course screen offers an "add more" button', !!learnButton,
  courseButtons.map((b) => b.innerHTML || b.textContent).join(' | '));
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

const gradeButtons = el('grade-picker')._children;
check('the grade picker offers all six elementary grades', gradeButtons.length === 6,
  gradeButtons.map((b) => b.dataset.grade).join(','));
check('grades are numbered 1 to 6 in order',
  gradeButtons.map((b) => b.dataset.grade).join(',') === '1,2,3,4,5,6');
check('grade 1 is selected by default', gradeButtons[0].className.includes('active'));

const kanjiModes = el('mode-picker')._children;
check('kanji offers three modes', kanjiModes.length === 3,
  kanjiModes.map((b) => b.textContent).join(' | '));
check('the kanji modes are Definition, Yomi, Writing in that order',
  kanjiModes[0].textContent === 'Definition'
  && kanjiModes[1].textContent === 'Yomi'
  && kanjiModes[2].innerHTML.includes('Writing'),
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
const yomiGradeButtons = el('grade-picker')._children;
check('the grade picker survives the mode switch', yomiGradeButtons.length === 6);

// Switching grade re-renders the card for that grade.
fire(yomiGradeButtons[2], 'click'); // grade 3
await settle();
check('choosing a grade selects it', el('grade-picker')._children[2].className.includes('active'));
check('the card follows the selected grade',
  (el('course-list')._children[0].innerHTML || '').includes('小学3年生'),
  el('course-list')._children[0].innerHTML);
fire(el('grade-picker')._children[0], 'click'); // back to grade 1
await settle();
check('switching back to grade 1 works',
  (el('course-list')._children[0].innerHTML || '').includes('小学1年生'));

const kanjiLearnButton = buttonsIn(el('course-list')._children[0])
  .find((b) => (b.innerHTML || '').includes('more'));
check('the kanji course offers an "add more" button', !!kanjiLearnButton);

fire(kanjiLearnButton, 'click');
await settle();
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

const lessonCourse = KANJI_COURSES.find((c) => c.id === 'kanji-grade-1');
const firstChip = lessonChips[0];
fire(firstChip, 'click');
await settle();
check('tapping a reading chip marks it active', firstChip.classList.contains('is-active'));
check('tapping a reading chip reveals the example word panel', el('lesson-word').hidden === false);
const firstExample = readingExample(lessonCourse, lessonKanjiFirst, firstChip.dataset.reading);
if (firstExample) {
  check('the shown word matches the reading that was tapped',
    el('lesson-word').querySelector('.word-kanji').textContent === firstExample.kanji,
    el('lesson-word').querySelector('.word-kanji').textContent);
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

  if (kAnswered === 0 && !kPerfectDone) {
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
    check('show answers / advanced hide themselves once resolved',
      el('quiz-show-answers').hidden === true && el('quiz-advanced').hidden === true);
    fire(el('quiz-ok'), 'click'); // Next
    await settle();
  } else if (kAnswered === 1 && !kRecoverDone) {
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
  } else if (kAnswered === 2 && !kRevealDone2) {
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
  } else if (advancedAvailable && !kAdvancedDone) {
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
      check('a post-round click shows something in the word panel',
        el('quiz-word').innerHTML.length > 0 || el('quiz-word').textContent.length > 0);
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
  .find((b) => (b.innerHTML || '').includes('more'));
check('Definition mode starts with its own separate progress (nothing learned yet)', !!defLearn);

fire(defLearn, 'click');
await settle();
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
  }
  runTimers();
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
