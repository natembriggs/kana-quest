// Headless tests for the pure logic (kana tables, answer checking, SRS).
// There is no Node on this machine; run with macOS JavaScriptCore:
//
//   /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc \
//       -m test/smoke.js
//
// Must be run from the repo root, since paths below are relative to it.

load('vendor/wanakana.min.js');
globalThis.window = { wanakana: globalThis.wanakana };

const { COURSES, romajiFor, checkRomaji } = await import('../src/kana.js');
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
check('first chunk is open', srs.unlockedChunkCount(hiragana, mode, progress) === 1);

// Learn 4 of the 5 characters in chunk 0 to box 2 — 80%, enough to advance.
hiragana.chunks[0].items.slice(0, 4).forEach((kana) => {
  let r = srs.newRecord();
  r = srs.grade(r, true, now);
  r = srs.grade(r, true, now);
  progress[srs.itemKey(mode, kana)] = r;
});
check('80% at box 2 opens the next chunk',
  srs.unlockedChunkCount(hiragana, mode, progress) === 2,
  `got ${srs.unlockedChunkCount(hiragana, mode, progress)}`);

check('writing mode is tracked separately',
  srs.unlockedChunkCount(hiragana, 'writing', progress) === 1);

const session = srs.buildSession(hiragana, mode, progress, { newPerSession: 3, now });
check('lesson respects the new-per-session cap', session.lesson.length === 3, `got ${session.lesson.length}`);
check('new characters come only from open chunks',
  session.lesson.every((k) => hiragana.chunks.slice(0, 2).flatMap((c) => c.items).includes(k)));
check('nothing is due yet today', session.quiz.length === session.lesson.length);

const later = now + 2 * DAY;
const dueSession = srs.buildSession(hiragana, mode, progress, { newPerSession: 0, now: later });
check('reviews come due after the interval', dueSession.quiz.length === 4, `got ${dueSession.quiz.length}`);

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
