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
    remove() {},
    focus() {},
    click() {},
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
  // Namespace is irrelevant to the stub — same generic element either way.
  // strokes.js's getPointAtLength/getTotalLength calls are already wrapped
  // in try/catch expecting a non-browser environment, so this stub
  // deliberately does not implement real SVG geometry: it exercises that
  // fallback path rather than papering over it.
  createElementNS(_ns, _tag) { return makeElement(); },
  addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); },
  body: makeElement('body'),
};

globalThis.window = { wanakana: globalThis.wanakana, scrollTo() {} };
globalThis.navigator = {};
globalThis.confirm = () => true;
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

const { romajiFor, getCourse } = await import('../src/kana.js');
const { KANJI_COURSES, kanjiInfo, readingExample, buildKanjiOptions, meaningLabel } = await import('../src/kanji.js');
const { STROKES } = await import('../src/stroke-data.js');
const { flattenPath, resample } = await import('../src/stroke-geometry.js');
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
// Kana writing (Trace mode) shipped; kanji writing hasn't (see below) — the
// "soon" badge is set via innerHTML, an enabled button only ever gets
// .textContent, so an enabled Writing button has an empty innerHTML.
check('kana writing is enabled — Trace mode is live',
  kanaModes[1].textContent === 'Writing' && kanaModes[1].disabled === false
  && !kanaModes[1].innerHTML.includes('soon'));
check('kana has no grade picker', el('grade-picker').hidden === true);

const courseButtons = buttonsIn(el('course-list')._children[0]);
const learnButton = courseButtons.find((b) => (b.innerHTML || '').includes('more'));
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

// --- Writing (Trace mode) -----------------------------------------------
// Drives real pointer events through app.js's actual handlers — not a
// shortcut — proving the whole pipeline: pointerdown/move/up -> local pixel
// coordinates -> the model's 0-109 coordinate space -> stroke-grader.js ->
// the writing screen's UI. Each stroke is traced from a real model stroke's
// own points (via STROKES + flattenPath/resample, the same modules
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
const writingLearnButton = writingCourseButtons.find((b) => (b.innerHTML || '').includes('more'));
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
  const expectedBatch = STROKES[secondLessonChar].strokes.length + 1; // N stroke reveals + 1 loop-restart
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
  const d = STROKES[char].strokes[index];
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
const firstWritingStrokeCount = STROKES[firstWritingChar].strokes.length;

for (let i = 0; i < firstWritingStrokeCount; i += 1) {
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

fire(el('writing-next'), 'click');
await settle();

// Second character: get one stroke deliberately wrong before completing the
// rest correctly — proves everyStrokeFirstTry locks correctness to false
// even though Trace mode lets the character be finished regardless.
let secondWritingChar = null;
if (visible() === 'screen-writing') {
  secondWritingChar = el('screen-writing').dataset.char;
  const secondStrokeCount = STROKES[secondWritingChar].strokes.length;

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
  const guidedStrokeCount = STROKES[guidedChar].strokes.length;

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
  check('the Done button stays hidden until a stroke is drawn', el('writing-done').hidden === true);

  freeCharNo = el('screen-writing').dataset.char;
  const freeStrokeCount = STROKES[freeCharNo].strokes.length;

  // A bad first stroke — Free mode must NOT reject or block it the way
  // Trace/Guided would; it's just captured as "stroke 1", right or wrong.
  traceBadStroke();
  await settle();
  check('a bad stroke in Free mode is captured with no rejection message',
    el('writing-feedback').textContent === '');
  check('the Done button appears once there is a first stroke to review', el('writing-done').hidden === false);

  for (let i = 1; i < freeStrokeCount; i += 1) {
    traceModelStroke(freeCharNo, i);
    await settle();
  }
  check('Free mode never auto-completes — it always waits for Done',
    el('writing-result').hidden === true && el('writing-self-grade').hidden === true);

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
  const strokeCount = STROKES[freeCharYes].strokes.length;
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

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'quit-session' } }) } });
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

const gradeButtons = el('grade-picker')._children;
check('the grade picker offers all six elementary grades', gradeButtons.length === 6,
  gradeButtons.map((b) => b.dataset.grade).join(','));
check('grades are numbered 1 to 6 in order',
  gradeButtons.map((b) => b.dataset.grade).join(',') === '1,2,3,4,5,6');
check('grade 1 is selected by default', gradeButtons[0].className.includes('active'));

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

// The study list (kanji-expansion-plan.md §1) is maintained by real sessions,
// not only by the enrollment UI: "Add more" enrolls what it is about to teach,
// so the list stays an accurate description of what is being worked on without
// anyone curating it by hand.
check('a new profile starts with an empty study list, not an absent one — absent means un-migrated',
  afterDefinition.study && typeof afterDefinition.study === 'object',
  JSON.stringify(afterDefinition.study));
const studiedDefinition = Object.keys(afterDefinition.study)
  .filter((k) => afterDefinition.study[k].includes('definition'));
check('every kanji taught in a definition session was enrolled in the study list for that mode',
  studiedDefinition.length > 0
  && Object.keys(afterDefinition.progress)
    .filter((k) => k.startsWith('definition:'))
    .every((k) => studiedDefinition.includes(k.split(':')[1])),
  `${studiedDefinition.length} enrolled`);
check('kana practice never touches the study list — it is kanji-only',
  Object.keys(afterDefinition.study).every((k) => /[㐀-䶿一-鿿]/.test(k)),
  Object.keys(afterDefinition.study).join(''));

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
  .find((b) => (b.innerHTML || '').includes('more'));
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

const kanjiWritingStrokeCount = STROKES[kanjiWritingChar].strokes.length;
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
  const strokeCount = STROKES[char].strokes.length;
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
await settle();
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
await settle();
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
  .find((b) => (b.innerHTML || '').includes('more'));
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
await settle();
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
await settle();

const modeToggleIds = ['detail-mode-definition', 'detail-mode-recognition', 'detail-mode-writing'];
check('a never-studied kanji shows "Not studying" on its detail screen',
  el('detail-study').hidden === false && el('detail-study-toggle').textContent.includes('Not studying'),
  el('detail-study-toggle').textContent);
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
  Array.isArray(grade6Saved.study[grade6Char]) && grade6Saved.study[grade6Char].length >= 1,
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
await settle();

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
runTimers();
await settle();
check('answering the one question ends the session at the summary',
  visible() === 'screen-summary', `showing ${visible()}`);

// Back to the detail screen via the now-tappable summary chip, to confirm
// teaching it moved it out of "waiting".
fire(el('summary-list')._children[0], 'click');
await settle();
check('after being taught, the kanji is "Learning" rather than "Waiting to learn"',
  el('detail-study-toggle').textContent.includes('Learning'), el('detail-study-toggle').textContent);
check('"Study it now" is no longer offered once it has actually been taught',
  el('detail-study-now').hidden === true);

fire(el('detail-mode-writing'), 'click');
await settle();
check('a per-mode toggle turns off just that mode, independent of the others — still Learning overall',
  !el('detail-mode-writing').className.includes('active')
  && el('detail-mode-definition').className.includes('active')
  && el('detail-study-toggle').textContent.includes('Learning'));

fire(el('detail-study-toggle'), 'click');
await settle();
check('tapping the headline button again un-enrolls every mode at once',
  el('detail-study-toggle').textContent.includes('Not studying')
  && modeToggleIds.every((id) => !el(id).className.includes('active')));

const grade6SavedAfter = [...rows.values()][0];
check('un-enrolling removes the study-list entry entirely, not just clears its modes',
  !(grade6Char in grade6SavedAfter.study), JSON.stringify(grade6SavedAfter.study[grade6Char]));
check('un-enrolling never deletes the progress record already earned',
  !!grade6SavedAfter.progress[`definition:${grade6Char}`],
  JSON.stringify(grade6SavedAfter.progress[`definition:${grade6Char}`]));

// --- Settings: writing strictness ------------------------------------------
// Phase 5 of writing-mode-plan.md — a per-profile slider, same pattern as
// the existing "new characters per session" one, that feeds the strictness
// multiplier already proven in test/smoke.js's grading tests.

fire(document, 'click', { target: { closest: () => ({ dataset: { action: 'open-settings' } }) } });
await settle();
check('opening settings shows the settings screen', visible() === 'screen-settings', `showing ${visible()}`);
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
