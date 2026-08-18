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
const { KANJI_COURSES, kanjiInfo, buildReadingChoices } = await import('../src/kanji.js');
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

// --- Kanji data and reading choices ----------------------------------------

const grade1 = KANJI_COURSES.find((c) => c.id === 'kanji-grade-1');
check('grade-1 course exists', !!grade1);
const grade1Chars = grade1.chunks.flatMap((c) => c.items);
check('grade 1 has 80 kanji', grade1Chars.length === 80, `got ${grade1Chars.length}`);
check('no duplicate kanji', new Set(grade1Chars).size === grade1Chars.length);
check('chunked in fives like the kana courses',
  grade1.chunks.slice(0, -1).every((c) => c.items.length === 5));

let noMeanings = 0;
let noWords = 0;
let noReadings = 0;
for (const kanji of grade1Chars) {
  const info = kanjiInfo(grade1, kanji);
  check(`kanjiInfo resolves for ${kanji}`, !!info);
  if (!info) continue;
  if (info.meanings.length === 0) noMeanings += 1;
  if (info.words.length === 0) noWords += 1;
  if (info.on.length + info.kun.length === 0) noReadings += 1;
}
check('every grade-1 kanji has at least one meaning', noMeanings === 0, `${noMeanings} missing`);
check('every grade-1 kanji has at least one example word', noWords === 0, `${noWords} missing`);
check('every grade-1 kanji has at least one reading', noReadings === 0, `${noReadings} missing`);

// The quiz cap exists because some kanji (生, 上, ...) have well over a dozen
// kun'yomi once conjugated forms are counted — offering all of them would
// make a 10-option question impossible.
let overCap = 0;
for (const kanji of grade1Chars) {
  if (kanjiInfo(grade1, kanji).quizReadings.length > 6) overCap += 1;
}
check('quiz readings are capped at 6', overCap === 0, `${overCap} over the cap`);

let optionCountWrong = 0;
let missingCorrect = 0;
let duplicateOptions = 0;
let outOfOrder = 0;
for (const kanji of grade1Chars) {
  const { options, correct } = buildReadingChoices(grade1, kanji, 10);
  if (options.length !== 10) optionCountWrong += 1;
  if (![...correct].every((r) => options.includes(r))) missingCorrect += 1;
  if (new Set(options).size !== options.length) duplicateOptions += 1;
  // Alphabetical by romaji, the same convention as kana.js's buildChoices —
  // on'yomi is katakana and kun'yomi is hiragana, so sorting the raw kana
  // would clump the two scripts instead of interleaving by sound.
  const romaji = options.map((r) => romajiFor(r));
  const sorted = [...romaji].sort((a, b) => a.localeCompare(b));
  if (JSON.stringify(romaji) !== JSON.stringify(sorted)) outOfOrder += 1;
}
check('every kanji question offers ten options', optionCountWrong === 0, `${optionCountWrong} did not`);
check('the full correct set is always offered', missingCorrect === 0, `${missingCorrect} missing an answer`);
check('no kanji question has a duplicate option', duplicateOptions === 0, `${duplicateOptions} had one`);
check('reading options are sorted alphabetically by romaji', outOfOrder === 0, `${outOfOrder} unsorted`);

done('kanji data and reading choices');

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

// --- Never-missed characters fade out of review -----------------------------
// The point: a kid who already knew some characters coming in should stop
// seeing them in review almost entirely, as long as they never get one wrong.

let neverMissed = srs.newRecord();
for (let i = 0; i < 6; i += 1) neverMissed = srs.grade(neverMissed, true, now); // reaches box 6
check('six straight passes reach the top box', neverMissed.box === srs.MAX_BOX);
check('top box is the ordinary 32-day interval', neverMissed.intervalDays === 32);

const afterOne = srs.grade(neverMissed, true, now);
check('a further pass with a perfect record grows the interval', afterOne.intervalDays === 64);
const afterTwo = srs.grade(afterOne, true, now);
check('it keeps growing', afterTwo.intervalDays === 128, `got ${afterTwo.intervalDays}`);
const afterThree = srs.grade(afterTwo, true, now);
check('growth is capped rather than unbounded', afterThree.intervalDays === 180, `got ${afterThree.intervalDays}`);
check('box stays at the top, only the interval keeps growing', afterThree.box === srs.MAX_BOX);

// The moment a character is missed even once, the extra growth stops for
// good — it goes back to behaving like anything else being learned.
let onceMissed = srs.newRecord();
for (let i = 0; i < 6; i += 1) onceMissed = srs.grade(onceMissed, true, now);
onceMissed = srs.grade(onceMissed, false, now); // one lapse, box back to 0
for (let i = 0; i < 6; i += 1) onceMissed = srs.grade(onceMissed, true, now); // climbs back up
check('recovering to the top box after one lapse stays at the ordinary interval',
  onceMissed.intervalDays === 32, `got ${onceMissed.intervalDays}`);
const onceMissedAgain = srs.grade(onceMissed, true, now);
check('it does not resume growing just because it is passing again',
  onceMissedAgain.intervalDays === 32, `got ${onceMissedAgain.intervalDays}`);
done('never-missed characters get spaced out further, not reviewed forever');

// --- Review favours characters that have actually been missed --------------
// (using the literal mode id here, not the `mode` binding declared further
// down in this file, to sidestep a temporal-dead-zone reference)

const revProgress = {};
const solidChars = 'あいうえお'.split('');
const shakyChars = 'かきくけこ'.split('');
solidChars.forEach((k) => {
  let r = srs.newRecord();
  r = srs.grade(r, true, now - DAY);
  revProgress[srs.itemKey('recognition', k)] = r; // due, zero lapses
});
shakyChars.forEach((k) => {
  let r = srs.newRecord();
  r = srs.grade(r, true, now - 2 * DAY);
  r = srs.grade(r, false, now - DAY); // one lapse, back to box 0, due
  revProgress[srs.itemKey('recognition', k)] = r;
});
const ranked = srs.dueItems(hiragana, 'recognition', revProgress, 5, now);
check('a capped review pulls the missed characters first',
  ranked.every((k) => shakyChars.includes(k)),
  ranked.join(''));

const smallCourse = { chunks: [{ items: [...solidChars, ...shakyChars] }] };
const uncapped = srs.dueItems(smallCourse, 'recognition', revProgress, 100, now);
check('nothing due is silently dropped when the cap is not hit',
  uncapped.length === 10, `got ${uncapped.length}`);
check('within the same lapse count, the more overdue one comes first',
  uncapped.indexOf(shakyChars[0]) < uncapped.indexOf(solidChars[0]));
done('review favours misses over a perfect record');

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
