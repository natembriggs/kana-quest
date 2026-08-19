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
const {
  KANJI_COURSES, kanjiInfo, readingExample, meaningLabel,
  buildKanjiOptions, buildAdvancedAdditions, buildDefinitionChoices, recomputeKanjiRollup,
} = await import('../src/kanji.js');
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

// --- All six grades: structural sanity ---------------------------------
// The depth checks below (option counts, priority ordering, rollups, ...)
// only run against grade 1, since they're testing the mechanism rather than
// the data — but every grade goes through the same build script, so a quick
// pass across all of them catches a grade-specific regression (e.g. a grade
// with a kanji that has zero readings, or one that collides with another
// grade's kanji).

check('grades 1 through 6 all exist',
  ['1', '2', '3', '4', '5', '6'].every((g) => KANJI_COURSES.some((c) => c.id === `kanji-grade-${g}`)),
  KANJI_COURSES.map((c) => c.id).join(', '));

const seenAcrossGrades = new Map(); // kanji -> which grade course first had it
let crossGradeDuplicates = 0;
let anyGradeStructureWrong = 0;
let noMeaningAnywhere = 0;
let unquizzableYomi = 0;
let quizReadingWithoutExample = 0;
for (const course of KANJI_COURSES) {
  const chars = course.chunks.flatMap((c) => c.items);
  if (new Set(chars).size !== chars.length) anyGradeStructureWrong += 1;
  if (!course.chunks.slice(0, -1).every((c) => c.items.length === 5)) anyGradeStructureWrong += 1;
  for (const kanji of chars) {
    const info = kanjiInfo(course, kanji);
    if (!info || info.on.length + info.kun.length === 0) anyGradeStructureWrong += 1;
    if (!info || info.meanings.length === 0) noMeaningAnywhere += 1;
    // Every quizzed reading must have an example word — that is now the
    // criterion for being quizzed at all.
    for (const reading of (info ? info.quizReadings : [])) {
      if (!readingExample(course, kanji, reading)) quizReadingWithoutExample += 1;
    }
    if (info && info.quizReadings.length === 0) unquizzableYomi += 1;
    if (seenAcrossGrades.has(kanji)) crossGradeDuplicates += 1;
    else seenAcrossGrades.set(kanji, course.id);
  }
}
check('every course is internally well-formed (chunks of 5, no dupes, every kanji has some reading listed)',
  anyGradeStructureWrong === 0, `${anyGradeStructureWrong} problems`);
check('every kanji has at least one non-radical English meaning to quiz',
  noMeaningAnywhere === 0, `${noMeaningAnywhere} without one`);
check('every quizzed reading has an example word — that is the bar for being quizzed',
  quizReadingWithoutExample === 0, `${quizReadingWithoutExample} without one`);
check('no kanji appears in more than one grade', crossGradeDuplicates === 0, `${crossGradeDuplicates} duplicates`);
check('the full elementary set is 1006-1030 kanji (Kyoiku kanji, allowing for JOYO revisions)',
  seenAcrossGrades.size >= 1006 && seenAcrossGrades.size <= 1030, `got ${seenAcrossGrades.size}`);

// A few kanji (prefecture names like 媛/栃/茨) have no reading appearing in any
// common word, so they have no yomi question. They must be excluded from that
// mode specifically — not dropped from the course, since Definition still
// works for them.
let excludedButQuizzable = 0;
let quizzableButExcluded = 0;
for (const course of KANJI_COURSES) {
  const excluded = course.excludeForMode.recognition;
  for (const kanji of course.chunks.flatMap((c) => c.items)) {
    const hasReadings = kanjiInfo(course, kanji).quizReadings.length > 0;
    if (excluded.has(kanji) && hasReadings) excludedButQuizzable += 1;
    if (!excluded.has(kanji) && !hasReadings) quizzableButExcluded += 1;
  }
}
check('kanji with no quizzable reading are excluded from yomi mode',
  quizzableButExcluded === 0, `${quizzableButExcluded} not excluded`);
check('nothing quizzable is excluded from yomi mode by mistake',
  excludedButQuizzable === 0, `${excludedButQuizzable} wrongly excluded`);
check('the unquizzable-yomi set is a small handful, not a systemic failure',
  unquizzableYomi <= 10, `${unquizzableYomi} kanji have no quizzable reading`);
done('all six kanji grades are structurally sound');

// --- Kanji data and reading choices ----------------------------------------
// The rest of this section goes deep on grade 1 only — see note above.

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

// The quiz-pool cap exists because some kanji (生, 上, ...) have well over a
// dozen kun'yomi once conjugated forms are counted — offering all of them
// would make even the "advanced" view unusable.
let overCap = 0;
for (const kanji of grade1Chars) {
  if (kanjiInfo(grade1, kanji).quizReadings.length > 6) overCap += 1;
}
check('quiz readings are capped at 6', overCap === 0, `${overCap} over the cap`);

const noProgress = {}; // a learner who has never seen any of this before

let baseCountWrong = 0;
let baseCorrectOverLimit = 0;
let baseCorrectAtLeastHalf = 0;
let missingCorrect = 0;
let duplicateOptions = 0;
let outOfOrder = 0;
let missingMandatory = 0;
for (const kanji of grade1Chars) {
  const info = kanjiInfo(grade1, kanji);
  const { options, correct } = buildKanjiOptions(grade1, kanji, 'recognition', noProgress);
  if (options.length !== 10) baseCountWrong += 1;
  if (correct.size > 4) baseCorrectOverLimit += 1;
  if (correct.size * 2 >= options.length) baseCorrectAtLeastHalf += 1;
  if (![...correct].every((r) => options.includes(r))) missingCorrect += 1;
  if (new Set(options).size !== options.length) duplicateOptions += 1;
  // The most common *quizzable* on'yomi and kun'yomi are never left out of
  // the base view, however the "which 2 more" priority sorts. Quizzable, not
  // KANJIDIC's first: a kanji's headline reading is skipped if no common word
  // uses it, so quizOn[0]/quizKun[0] are the right reference, not on[0]/kun[0].
  if (info.quizOn[0] && !correct.has(info.quizOn[0])) missingMandatory += 1;
  if (info.quizKun[0] && !correct.has(info.quizKun[0])) missingMandatory += 1;
  // Alphabetical by romaji, the same convention as kana.js's buildChoices —
  // on'yomi is katakana and kun'yomi is hiragana, so sorting the raw kana
  // would clump the two scripts instead of interleaving by sound.
  const romaji = options.map((r) => romajiFor(r));
  const sorted = [...romaji].sort((a, b) => a.localeCompare(b));
  if (JSON.stringify(romaji) !== JSON.stringify(sorted)) outOfOrder += 1;
}
check('every base kanji question offers ten options', baseCountWrong === 0, `${baseCountWrong} did not`);
check('base view never offers more than 4 correct', baseCorrectOverLimit === 0, `${baseCorrectOverLimit} did`);
check('base correct count is always under half (no better than guessing)',
  baseCorrectAtLeastHalf === 0, `${baseCorrectAtLeastHalf} were not`);
check('the correct set shown is always actually offered', missingCorrect === 0, `${missingCorrect} missing`);
check('no kanji question has a duplicate option', duplicateOptions === 0, `${duplicateOptions} had one`);
check('the most common on/kun reading is always in the base view',
  missingMandatory === 0, `${missingMandatory} missing`);
check('reading options are sorted alphabetically by romaji', outOfOrder === 0, `${outOfOrder} unsorted`);

// --- Advanced view: only offered when there's something to add, and the
// under-half rule holds even at the full 5/6-reading pool.

const advancedEligible = grade1Chars.filter((k) => kanjiInfo(grade1, k).quizReadings.length > 4);
check('at least one grade-1 kanji has more than 4 readings (or this whole check is vacuous)',
  advancedEligible.length > 0);

let advancedCorrectWrong = 0;
let advancedOverHalf = 0;
let advancedMissingCorrect = 0;
for (const kanji of advancedEligible) {
  const info = kanjiInfo(grade1, kanji);
  const { options, correct } = buildKanjiOptions(grade1, kanji, 'recognition', noProgress, { advanced: true });
  if (correct.size !== info.quizReadings.length) advancedCorrectWrong += 1;
  if (correct.size * 2 >= options.length) advancedOverHalf += 1;
  if (![...correct].every((r) => options.includes(r))) advancedMissingCorrect += 1;
}
check('advanced view offers the full reading pool as correct',
  advancedCorrectWrong === 0, `${advancedCorrectWrong} did not`);
check('advanced view still keeps correct under half',
  advancedOverHalf === 0, `${advancedOverHalf} did not`);
check('advanced correct set is always offered', advancedMissingCorrect === 0);

for (const kanji of grade1Chars) {
  const info = kanjiInfo(grade1, kanji);
  const isEligible = info.quizReadings.length > 4;
  const { correct } = buildKanjiOptions(grade1, kanji, 'recognition', noProgress);
  check(`advanced is only meaningful when there is more to add (${kanji})`,
    isEligible === (info.quizReadings.length > correct.size));
}
done('kanji data and base/advanced reading choices');

// --- Advanced "additions": grows the grid rather than rebuilding it -------

for (const kanji of advancedEligible.slice(0, 10)) {
  const info = kanjiInfo(grade1, kanji);
  const { options: shownOptions, correct: baseCorrect } = buildKanjiOptions(grade1, kanji, 'recognition', noProgress);
  const shown = new Set(shownOptions);
  const { additions, newCorrect } = buildAdvancedAdditions(grade1, kanji, shown);

  check(`additions never repeat what is already shown (${kanji})`,
    additions.every((r) => !shown.has(r)));
  check(`additions include every remaining correct reading (${kanji})`,
    [...newCorrect].every((r) => additions.includes(r)));
  check(`newCorrect is exactly the pool minus what the base view already had (${kanji})`,
    newCorrect.size === info.quizReadings.length - baseCorrect.size);

  const finalCorrectCount = baseCorrect.size + newCorrect.size;
  const finalTotal = shown.size + additions.length;
  check(`expanding still keeps correct under half of the total (${kanji})`,
    finalCorrectCount * 2 < finalTotal, `${finalCorrectCount}/${finalTotal}`);
}
done('advanced additions grow the grid without duplicating or exceeding it');

// --- Priority: never-graded readings fill the "2 more" slots before one
// that's already known and not currently due.

const priorityKanji = grade1Chars.find((k) => {
  const info = kanjiInfo(grade1, k);
  return info.on[0] && info.kun[0] && info.quizReadings.length === 5;
});
if (priorityKanji) {
  const info = kanjiInfo(grade1, priorityKanji);
  const mandatory = new Set([info.on[0], info.kun[0]]);
  const [alreadyKnown, unseenA, unseenB] = info.quizReadings.filter((r) => !mandatory.has(r));
  const progress = {};
  progress[srs.yomiKey('recognition', priorityKanji, alreadyKnown)] =
    srs.gradeYomi(srs.newYomiRecord(), true, Date.now()); // graded, due later — not due now
  const { correct } = buildKanjiOptions(grade1, priorityKanji, 'recognition', progress);
  check('never-graded readings are chosen over an already-known, not-due one',
    correct.has(unseenA) && correct.has(unseenB) && !correct.has(alreadyKnown),
    [...correct].join(', '));
} else {
  check('(skipped — no grade-1 kanji has exactly 5 readings with both a primary on and kun)', true);
}

// --- Per-reading example words --------------------------------------------
// Not every reading has one (build_kanji_data.py logs which don't), but the
// mechanism itself — including the "rare on'yomi, e.g. a loanword-derived
// reading, still finds its word even though that word may use a kanji
// outside this grade" case that motivated it — must work.

check('readingExample returns null rather than throwing for an unmapped reading',
  readingExample(grade1, '一', 'not-a-real-reading') === null);

let exampleForPrimaryOn = 0;
for (const kanji of grade1Chars) {
  const info = kanjiInfo(grade1, kanji);
  if (info.on[0] && readingExample(grade1, kanji, info.on[0])) exampleForPrimaryOn += 1;
}
check('most kanji have an example word for their primary on\'yomi',
  exampleForPrimaryOn / grade1Chars.length > 0.8,
  `${exampleForPrimaryOn}/${grade1Chars.length}`);

// 上 (above) has シャン among its on'yomi specifically because of 上海
// (Shanghai) — a rare reading findable only via a word that itself uses a
// kanji (海) outside grade 1. This is the exact case the feature is for.
const shanghai = kanjiInfo(grade1, '上');
if (shanghai && shanghai.on.includes('シャン')) {
  const example = readingExample(grade1, '上', 'シャン');
  check('the rare シャン reading of 上 finds its Shanghai example',
    !!example && example.kanji.includes('上'), JSON.stringify(example));
}

// The bug this alignment exists to prevent: 十二 reads じゅうに, so a naive
// "word reading starts with the target reading" test credited it to 二's rare
// ジ on'yomi — when in fact 二 is に there and じゅう belongs to 十. The word
// must now be credited to 二's ニ reading (or not at all), never to ジ.
const two = kanjiInfo(grade1, '二');
check('二 does not offer ジ as a quizzable reading — no common word uses it',
  !two.quizReadings.includes('ジ'), two.quizReadings.join(', '));
for (const [reading, example] of Object.entries(two.readingExamples)) {
  check(`二's example for ${reading} is not the mis-attributed 十二`,
    !(reading === 'ジ' && example.kanji === '十二'), JSON.stringify(example));
}

// Same class of error in the other direction: a reading must be credited to
// the kanji that actually contributes it, wherever in the word it sits.
const ten = kanjiInfo(grade1, '十');
if (ten.readingExamples['ジュウ']) {
  check('十 credits じゅう to a word where 十 really is read じゅう',
    ten.readingExamples['ジュウ'].kana.startsWith('じゅう'),
    JSON.stringify(ten.readingExamples['ジュウ']));
}

let exampleContainsKanji = 0;
let exampleMissingKanji = 0;
for (const course of KANJI_COURSES) {
  for (const kanji of course.chunks.flatMap((c) => c.items)) {
    for (const reading of kanjiInfo(course, kanji).quizReadings) {
      const example = readingExample(course, kanji, reading);
      if (example && example.kanji.includes(kanji)) exampleContainsKanji += 1;
      else exampleMissingKanji += 1;
    }
  }
}
check('every reading example actually contains the kanji it illustrates',
  exampleMissingKanji === 0, `${exampleMissingKanji} did not`);
check('the reading-example index is substantial, not near-empty after filtering',
  exampleContainsKanji > 2000, `only ${exampleContainsKanji}`);

done('per-reading example words');

// --- Meanings: definitions only, no radical names -------------------------

let radicalNameLeaked = 0;
let legitimateRadicalMeaningLost = 0;
for (const course of KANJI_COURSES) {
  for (const kanji of course.chunks.flatMap((c) => c.items)) {
    for (const meaning of kanjiInfo(course, kanji).meanings) {
      // KANJIDIC lists the radical's *name* as a pseudo-meaning, e.g.
      // "one radical (no.1)" — not a definition, so it must be gone.
      if (/radical\s*\(no/i.test(meaning)) radicalNameLeaked += 1;
    }
  }
}
check('radical names are stripped from meanings', radicalNameLeaked === 0, `${radicalNameLeaked} leaked`);

// ...but "radical" as a genuine English definition must survive: 根 is a
// mathematical root/radical, 基 is a chemical radical. Filtering on the bare
// word would wrongly delete these.
for (const [kanji, expected] of [['根', 'radical'], ['基', 'radical (chem)']]) {
  const course = KANJI_COURSES.find((c) => c.index.has(kanji));
  if (course) {
    check(`${kanji} keeps its genuine "radical" definition`,
      kanjiInfo(course, kanji).meanings.includes(expected),
      kanjiInfo(course, kanji).meanings.join(', '));
  }
}
done('meanings are definitions only, without discarding real ones');

// --- Definition mode choices ----------------------------------------------

// Four options (two rows of two), not ten: English definitions are long, and
// a definition question is single-answer so the under-half rule that governs
// the multi-select yomi quiz doesn't apply.
let defCountWrong = 0;
let defMissingAnswer = 0;
let defDuplicate = 0;
let defUnsorted = 0;
for (const kanji of grade1Chars) {
  const { options, answer } = buildDefinitionChoices(grade1, kanji);
  if (options.length !== 4) defCountWrong += 1;
  if (!options.includes(answer)) defMissingAnswer += 1;
  if (new Set(options).size !== options.length) defDuplicate += 1;
  const sorted = [...options].sort((a, b) => a.localeCompare(b));
  if (JSON.stringify(options) !== JSON.stringify(sorted)) defUnsorted += 1;
}
check('every definition question offers four options by default',
  defCountWrong === 0, `${defCountWrong} did not`);
check('the correct definition is always offered', defMissingAnswer === 0, `${defMissingAnswer} missing`);
check('no definition question repeats an option — a duplicate label would be unanswerable',
  defDuplicate === 0, `${defDuplicate} had one`);
check('definition options are sorted alphabetically', defUnsorted === 0, `${defUnsorted} unsorted`);

const defOne = buildDefinitionChoices(grade1, '一');
check('the definition answer is the kanji\'s own meaning label',
  defOne.answer === meaningLabel(kanjiInfo(grade1, '一')), defOne.answer);
check('the definition answer is English prose, not a reading',
  /[a-z]/i.test(defOne.answer), defOne.answer);
check('definition options carry no radical-name text',
  defOne.options.every((o) => !/radical\s*\(no/i.test(o)));
done('definition mode choices');

// --- Kanji-level rollup, aggregated from per-reading records ---------------

const rollupKanji = grade1Chars[0];
const rollupInfo = kanjiInfo(grade1, rollupKanji);
const rollupProgress = {};
const rollupNow = Date.now();

recomputeKanjiRollup(grade1, rollupKanji, 'recognition', rollupProgress, rollupNow);
check('rollup does nothing when no reading has been graded yet',
  !rollupProgress[srs.itemKey('recognition', rollupKanji)]);

const [firstReading, secondReading] = rollupInfo.quizReadings;
rollupProgress[srs.yomiKey('recognition', rollupKanji, firstReading)] =
  srs.gradeYomi(srs.newYomiRecord(), true, rollupNow); // due soon, streak 1
if (secondReading) {
  let solid = srs.newYomiRecord();
  for (let i = 0; i < 6; i += 1) solid = srs.gradeYomi(solid, true, rollupNow); // due much later, streak 6
  rollupProgress[srs.yomiKey('recognition', rollupKanji, secondReading)] = solid;
}
recomputeKanjiRollup(grade1, rollupKanji, 'recognition', rollupProgress, rollupNow);
const rollup = rollupProgress[srs.itemKey('recognition', rollupKanji)];
check('rollup exists once at least one reading has a record', !!rollup);
check('rollup due date is the EARLIEST due among introduced readings — a kanji resurfaces as soon as any one reading is shaky',
  rollup.due === rollupProgress[srs.yomiKey('recognition', rollupKanji, firstReading)].due);
if (secondReading) {
  check('rollup box is the LOWEST streak among introduced readings — mastered means every reading tested is solid',
    rollup.box === 1, `got ${rollup.box}`);
} else {
  check('with only one reading, rollup box matches its streak', rollup.box === 1);
}
check('rollup correct/lapses are summed across readings',
  rollup.correct === (secondReading ? 7 : 1) && rollup.lapses === 0,
  JSON.stringify(rollup));

done('kanji-level rollup aggregates per-reading records');

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

// --- Per-reading (yomi) records: streak + lifetime-correct driven interval -

let yrec = srs.newYomiRecord();
check('a fresh yomi record has no history', yrec.correct === 0 && yrec.incorrect === 0 && yrec.streak === 0);

yrec = srs.gradeYomi(yrec, true, now);
check('first correct: streak 1', yrec.streak === 1);
check('first correct: lifetime correct count is 1', yrec.correct === 1);
check('lastReviewed is set, secondLastReviewed is not (no prior review)',
  yrec.lastReviewed === now && yrec.secondLastReviewed === null);

const secondNow = now + DAY;
yrec = srs.gradeYomi(yrec, true, secondNow);
check('second correct in a row: streak 2', yrec.streak === 2);
check('secondLastReviewed captures the previous review', yrec.secondLastReviewed === now);
check('the interval taken between the last two reviews is reconstructable',
  yrec.lastReviewed - yrec.secondLastReviewed === DAY);

yrec = srs.gradeYomi(yrec, false, secondNow + DAY);
check('a miss resets the streak to zero', yrec.streak === 0);
check('a miss counts as incorrect, not correct', yrec.incorrect === 1 && yrec.correct === 2);
check('a miss does NOT erase the lifetime correct count — that is the whole point', yrec.correct === 2);
check('a miss makes the record due right away', yrec.due === secondNow + DAY);
check('the generic isDue() helper works on a yomi record too (same .due field)',
  srs.isDue(yrec, secondNow + DAY) && !srs.isDue(yrec, secondNow + DAY - 1));

// The central claim: a reading with a long correct history recovers a longer
// interval after one slip than a reading with no track record at all, even
// though both are back to streak 1.
let veteran = srs.newYomiRecord();
for (let i = 0; i < 20; i += 1) veteran = srs.gradeYomi(veteran, true, now); // 20 lifetime correct
veteran = srs.gradeYomi(veteran, false, now); // one slip
veteran = srs.gradeYomi(veteran, true, now); // back to streak 1
let rookie = srs.newYomiRecord();
rookie = srs.gradeYomi(rookie, true, now); // streak 1, correct 1 — nothing else
check('both records are at streak 1 for a fair comparison', veteran.streak === 1 && rookie.streak === 1);
check('a veteran reading earns a longer interval than a rookie at the same streak',
  veteran.intervalDays > rookie.intervalDays,
  `veteran ${veteran.intervalDays}d vs rookie ${rookie.intervalDays}d`);

let longStreak = srs.newYomiRecord();
for (let i = 0; i < 50; i += 1) longStreak = srs.gradeYomi(longStreak, true, now);
check('the interval is capped rather than growing without bound',
  longStreak.intervalDays <= 120, `got ${longStreak.intervalDays}`);
done('per-reading records reward both streak and lifetime correct count');

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
