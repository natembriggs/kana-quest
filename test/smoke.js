// Headless tests for the pure logic (kana tables, answer checking, SRS).
// There is no Node on this machine; run with macOS JavaScriptCore:
//
//   /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc \
//       -m test/smoke.js
//
// Must be run from the repo root, since paths below are relative to it.

load('vendor/wanakana.min.js');
globalThis.window = { wanakana: globalThis.wanakana };

const { COURSES, romajiFor, checkRomaji, buildChoices } = await import('../src/kana.js');
const srs = await import('../src/srs.js');

let failures = 0;
function check(name, condition, detail) {
  if (condition) return;
  failures += 1;
  print(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
}
function done(name) { print(`ok    ${name}`); }

// --- Tables ---------------------------------------------------------------

const hiragana = COURSES.find((c) => c.id === 'hiragana');
const katakana = COURSES.find((c) => c.id === 'katakana');

check('hiragana chunk count', hiragana.chunks.length === 21, `got ${hiragana.chunks.length}`);
const hiraChars = hiragana.chunks.flatMap((c) => c.items);
check('hiragana character count', hiraChars.length === 104, `got ${hiraChars.length}`);
check('no duplicate hiragana', new Set(hiraChars).size === hiraChars.length);

const kataChars = katakana.chunks.flatMap((c) => c.items);
check('katakana mirrors hiragana', kataChars.length === hiraChars.length);
check('no duplicate katakana', new Set(kataChars).size === kataChars.length);
check('katakana really is katakana', kataChars.every((c) => !hiraChars.includes(c)));
done('tables');

// --- The round-trip invariant --------------------------------------------
// Whatever romaji the app shows as the answer must be accepted as the answer.

for (const course of COURSES) {
  for (const chunk of course.chunks) {
    for (const kana of chunk.items) {
      const shown = romajiFor(kana);
      check(`round-trip ${course.id} ${kana}`, checkRomaji(shown, kana), `shown as "${shown}"`);
      check(`round-trip non-empty ${kana}`, shown.length > 0);
    }
  }
}
done('every character accepts its own romaji');

// --- Alternate spellings a learner is entitled to type ---------------------

const accepted = [
  ['si', 'し'], ['shi', 'し'], ['tu', 'つ'], ['tsu', 'つ'],
  ['hu', 'ふ'], ['fu', 'ふ'], ['n', 'ん'], ['nn', 'ん'], ["n'", 'ん'],
  ['wo', 'を'], ['o', 'を'], ['di', 'ぢ'], ['ji', 'ぢ'],
  ['du', 'づ'], ['zu', 'づ'], ['kya', 'きゃ'], ['sho', 'しょ'],
  ['SHI', 'し'], [' ka ', 'か'],
  // katakana targets take the same romaji
  ['ka', 'カ'], ['shi', 'シ'], ['n', 'ン'], ['ja', 'ジャ'],
];
for (const [typed, target] of accepted) {
  check(`accept "${typed}" for ${target}`, checkRomaji(typed, target));
}

const rejected = [
  ['ka', 'き'], ['', 'か'], ['   ', 'か'], ['xyz', 'か'],
  ['ki', 'カ'], ['sa', 'し'], ['ya', 'や'.replace('や', 'ゆ')],
  // お and を must stay distinct in this direction, even though を accepts "o"
  ['wo', 'お'],
];
for (const [typed, target] of rejected) {
  check(`reject "${typed}" for ${target}`, !checkRomaji(typed, target));
}
done('alternate spellings');

// --- Multiple-choice options ---------------------------------------------
// Checked for every character in both courses, because the failure that
// matters is an unanswerable question: two options showing the same romaji
// (じ/ぢ are both "ji", ず/づ are both "zu"), or the answer missing entirely.

let ambiguous = 0;
let missingAnswer = 0;
let wrongCount = 0;
for (const course of COURSES) {
  for (const kana of course.chunks.flatMap((c) => c.items)) {
    const options = buildChoices(course, kana, 10);
    if (options.length !== 10) wrongCount += 1;
    if (new Set(options).size !== options.length) ambiguous += 1;
    if (!options.includes(romajiFor(kana))) missingAnswer += 1;
    // Exactly one option may be accepted as the answer.
    if (options.filter((o) => checkRomaji(o, kana)).length !== 1) ambiguous += 1;
  }
}
check('every question offers ten options', wrongCount === 0, `${wrongCount} did not`);
check('the right answer is always offered', missingAnswer === 0, `${missingAnswer} missing`);
check('no question has two options that both read as the answer', ambiguous === 0, `${ambiguous} ambiguous`);

const kyaOptions = buildChoices(hiragana, 'きゃ', 10);
check('options are plain romaji strings', kyaOptions.every((o) => typeof o === 'string' && o.length));
check('distractors are drawn from the same set where possible',
  kyaOptions.some((o) => ['kyu', 'kyo', 'gya', 'gyu', 'gyo'].includes(o)),
  kyaOptions.join(' '));
done('multiple-choice options');

// --- SRS ------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 0, 1);

let rec = srs.grade(srs.newRecord(), true, now);
check('pass moves to box 1', rec.box === 1, `box ${rec.box}`);
check('pass schedules 1 day out', rec.due === now + DAY, `due +${(rec.due - now) / DAY}d`);
check('history records the pass', rec.history.length === 1 && rec.history[0][1] === 1);

rec = srs.grade(rec, true, now);
rec = srs.grade(rec, true, now);
check('three passes reach box 3', rec.box === 3, `box ${rec.box}`);
check('box 3 is 4 days out', rec.due === now + 4 * DAY);

rec = srs.grade(rec, false, now);
check('miss drops to box 0', rec.box === 0);
check('miss is immediately due', srs.isDue(rec, now));
check('miss counted as a lapse', rec.lapses === 1);
check('history keeps every attempt', rec.history.length === 4);

let maxed = srs.newRecord();
for (let i = 0; i < 20; i += 1) maxed = srs.grade(maxed, true, now);
check('box is capped', maxed.box === srs.MAX_BOX, `box ${maxed.box}`);
done('leitner boxes');

// --- Chunk gating ---------------------------------------------------------

const progress = {};
const mode = 'recognition';
check('starts on the first set', srs.currentSetIndex(hiragana, mode, progress) === 0);
check('a fresh course is ready for more', srs.readyForMore(hiragana, mode, progress));

// Introduce 4 of the 5 characters in set 0 and get them to box 2.
hiragana.chunks[0].items.slice(0, 4).forEach((kana) => {
  let r = srs.newRecord();
  r = srs.grade(r, true, now);
  r = srs.grade(r, true, now);
  progress[srs.itemKey(mode, kana)] = r;
});
check('still on set 0 while one character is unmet',
  srs.currentSetIndex(hiragana, mode, progress) === 0);
check('80% at box 2 counts as consolidated', srs.readyForMore(hiragana, mode, progress));

// Adding more is never blocked, even when the current set is shaky.
const shaky = {};
hiragana.chunks[0].items.forEach((kana) => {
  shaky[srs.itemKey(mode, kana)] = srs.grade(srs.newRecord(), true, now); // box 1 only
});
check('a shaky set is flagged as not consolidated', !srs.readyForMore(hiragana, mode, shaky));
check('but more characters are still offered',
  srs.newItems(hiragana, mode, shaky, 5).length === 5,
  'adding more must never be blocked — the learner decides');
check('new characters continue in teaching order',
  srs.newItems(hiragana, mode, shaky, 5)[0] === hiragana.chunks[1].items[0]);
check('moving on advances the displayed set',
  srs.currentSetIndex(hiragana, mode, shaky) === 1);

check('writing mode is tracked separately',
  srs.currentSetIndex(hiragana, 'writing', progress) === 0
  && srs.courseStats(hiragana, 'writing', progress).started === 0);

const session = srs.buildSession(hiragana, mode, progress, 'new', { newPerSession: 3, now });
check('lesson respects the new-per-session cap', session.lesson.length === 3, `got ${session.lesson.length}`);
check('a "new" session quizzes exactly what it taught',
  session.quiz.length === session.lesson.length);
check('a "new" session never includes seen characters',
  session.lesson.every((k) => !progress[srs.itemKey(mode, k)]));

const reviewNow = srs.buildSession(hiragana, mode, progress, 'review', { now });
check('nothing is due on the same day', reviewNow.quiz.length === 0, `got ${reviewNow.quiz.length}`);
check('a review session never teaches', reviewNow.lesson.length === 0);

const later = now + 2 * DAY;
const reviewLater = srs.buildSession(hiragana, mode, progress, 'review', { now: later });
check('reviews come due after the interval', reviewLater.quiz.length === 4, `got ${reviewLater.quiz.length}`);
check('review sessions exclude never-seen characters',
  reviewLater.quiz.every((k) => progress[srs.itemKey(mode, k)]));

const practice = srs.buildSession(hiragana, mode, progress, 'practice', { now });
check('practice ignores the schedule', practice.quiz.length === 4, `got ${practice.quiz.length}`);

const stats = srs.courseStats(hiragana, mode, progress, later);
check('stats total', stats.total === 104);
check('stats started', stats.started === 4, `got ${stats.started}`);
check('stats due', stats.due === 4, `got ${stats.due}`);
done('chunk gating and sessions');

// --- Result ---------------------------------------------------------------

print('');
if (failures) {
  print(`${failures} failure(s)`);
  throw new Error(`${failures} test failure(s)`);
}
print('all tests passed');
