// Kanji courses (one per school grade), and the reading-quiz question logic.
//
// Data comes from tools/build_kanji_data.py, which distills KANJIDIC2 and
// JMdict down to src/kanji-data.js: for each kanji, its on'yomi, kun'yomi,
// English meanings and a few common example words. See that script for how
// "common" is decided and why higher grades aren't built yet.

import { KANJI_BY_GRADE } from './kanji-data.js';
import { itemKey, yomiKey, MAX_BOX } from './srs.js';

// Used only to order options alphabetically (see buildKanjiOptions) — kun
// readings are hiragana and on readings are katakana, so sorting the raw
// strings would separate the two scripts instead of interleaving by sound.
const { toRomaji } = window.wanakana;

const CHUNK_SIZE = 5; // matches the kana courses, for a consistent lesson size

// A question shows at most this many readings as correct by default — enough
// to be worth answering, few enough that a kid can't pass by clicking
// everything. Always under half of BASE_TOTAL_OPTIONS, per the same
// no-better-than-guessing rule the advanced view keeps too.
const BASE_CORRECT_LIMIT = 4;
const BASE_TOTAL_OPTIONS = 10;
// "Advanced" reveals the rest of the (up to 6-reading) pool. Sized so that
// even the full pool of 6 correct stays comfortably under half.
const ADVANCED_TOTAL_OPTIONS = 15;

// Definition questions are single-answer, so the under-half ratio rule that
// governs the multi-select yomi quiz doesn't apply. Four is plenty: English
// definitions are long, and two rows of two stay readable on a phone where
// ten would not.
const DEFINITION_OPTIONS = 4;
const MEANINGS_PER_LABEL = 2;

function buildKanjiIndex(grade) {
  const entries = KANJI_BY_GRADE[grade] || [];
  const byChar = new Map();
  for (const entry of entries) {
    byChar.set(entry.kanji, {
      kanji: entry.kanji,
      // Full reading lists, for reference/display. These include readings
      // that are never quizzed (see quizReadings).
      on: entry.on,
      kun: entry.kun,
      meanings: entry.meanings,
      words: entry.words,
      // The readings actually quizzed: normalized, capped, and — since the
      // build script filters them — guaranteed to have an example word.
      // A reading no common word ever uses isn't worth a child's time and
      // has nothing to show when tapped, so it isn't offered at all.
      quizOn: entry.quizOn,
      quizKun: entry.quizKun,
      quizReadings: entry.quizReadings,
      // reading (matching quizReadings) -> {kanji, kana, en}: the most common
      // word that genuinely uses the kanji with *that* reading, established by
      // aligning the word against its reading in build_kanji_data.py rather
      // than by string-matching. Every quizzed reading has one.
      readingExamples: entry.readingExamples || {},
    });
  }
  return byChar;
}

/** The short English label used as the answer in Definition mode. */
export function meaningLabel(info) {
  return info.meanings.slice(0, MEANINGS_PER_LABEL).join(', ');
}

function buildChunks(courseId, chars) {
  const chunks = [];
  for (let i = 0; i < chars.length; i += CHUNK_SIZE) {
    const items = chars.slice(i, i + CHUNK_SIZE);
    chunks.push({
      id: `${courseId}-${chunks.length}`,
      courseId,
      index: chunks.length,
      label: items.join(''),
      items,
    });
  }
  return chunks;
}

function buildKanjiCourse(grade) {
  const index = buildKanjiIndex(grade);
  const chars = [...index.keys()];
  return {
    id: `kanji-grade-${grade}`,
    kind: 'kanji',
    name: `Kanji · Grade ${grade}`,
    native: `小学${grade}年生`,
    chunks: buildChunks(`kanji-grade-${grade}`, chars),
    index,
    // A handful of kanji (prefecture names like 媛/栃/茨) have no reading that
    // appears in any common word, so there is no yomi question to ask about
    // them — they are skipped in that mode only, and still taught in the
    // others. srs.js honours this when picking items.
    excludeForMode: {
      recognition: new Set(chars.filter((k) => index.get(k).quizReadings.length === 0)),
    },
  };
}

// Grades are whatever tools/build_kanji_data.py emitted (MAX_GRADE there).
// Raising it and re-running is the whole extension path — nothing here needs
// to change.
export const KANJI_COURSES = Object.keys(KANJI_BY_GRADE)
  .map(Number)
  .sort((a, b) => a - b)
  .map(buildKanjiCourse);

export function getKanjiCourse(courseId) {
  return KANJI_COURSES.find((c) => c.id === courseId);
}

export function kanjiInfo(course, kanji) {
  return course.index.get(kanji);
}

/** The example word anchored to one specific reading of a kanji. Every
 * quizzed reading has one — build_kanji_data.py drops readings that don't. */
export function readingExample(course, kanji, reading) {
  return kanjiInfo(course, kanji).readingExamples[reading] || null;
}

function sortByRomaji(readings) {
  return [...readings].sort((a, b) => toRomaji(a).localeCompare(toRomaji(b)));
}

/** Distractors come from other kanji's *quizzed* readings, so a wrong option
 * is always a real reading a learner could plausibly meet elsewhere. */
function distractorPool(course, kanji) {
  return shuffle([...course.index.values()]
    .filter((e) => e.kanji !== kanji)
    .flatMap((e) => e.quizReadings));
}

/**
 * Which readings a base (non-advanced) question offers as correct: the most
 * common on'yomi and the most common kun'yomi always, plus enough more (up
 * to BASE_CORRECT_LIMIT total) to round it out. The "more" are picked by
 * priority — a reading never graded before comes first, then whichever
 * introduced reading is most overdue — so which two of the remaining pool
 * show up isn't fixed forever; a shaky one keeps getting another look.
 */
function pickBaseCorrectReadings(course, kanji, mode, progress) {
  const info = kanjiInfo(course, kanji);
  const pool = info.quizReadings;
  // The most common *quizzable* on and kun — quizOn/quizKun are already
  // filtered to readings that appear in a real word, so this is the first
  // surviving one, not necessarily KANJIDIC's first.
  const mandatory = [info.quizOn[0], info.quizKun[0]].filter((r) => r && pool.includes(r));
  const remainingSlots = Math.max(0, BASE_CORRECT_LIMIT - mandatory.length);

  const candidates = pool.filter((r) => !mandatory.includes(r));
  const ranked = [...candidates].sort((a, b) => {
    const ra = progress[yomiKey(mode, kanji, a)];
    const rb = progress[yomiKey(mode, kanji, b)];
    if (!ra && !rb) return 0;
    if (!ra) return -1; // never graded — introduce it before revisiting a known one
    if (!rb) return 1;
    return ra.due - rb.due; // otherwise, most overdue first
  });

  return [...mandatory, ...ranked.slice(0, remainingSlots)];
}

/**
 * Options for a fresh kanji question. `advanced` offers the full (up to
 * 6-reading) pool as correct instead of the base ~4, with enough distractors
 * added to keep the correct fraction under half either way.
 *
 * Returns { options, correct } where `correct` is the Set of readings that
 * should turn green when clicked.
 */
export function buildKanjiOptions(course, kanji, mode, progress, { advanced = false } = {}) {
  const info = kanjiInfo(course, kanji);
  const correctReadings = advanced ? info.quizReadings : pickBaseCorrectReadings(course, kanji, mode, progress);
  const correct = new Set(correctReadings);
  const total = advanced ? ADVANCED_TOTAL_OPTIONS : BASE_TOTAL_OPTIONS;

  // The base view only shows some of this kanji's own readings as correct —
  // e.g. 子 has 5, only 4 make the base view. The other 1-2 are still
  // genuinely correct readings of 子, just not being quizzed this round, so
  // they must never appear as a "wrong" distractor even if some other kanji
  // (e.g. 音, also read ね) would otherwise offer that exact reading.
  const ownPool = new Set(info.quizReadings);

  const options = new Set(correct);
  for (const reading of distractorPool(course, kanji)) {
    if (options.size >= total) break;
    if (ownPool.has(reading)) continue; // would be ambiguous, or outright wrong to mark wrong
    options.add(reading);
  }

  return { options: sortByRomaji(options), correct };
}

/**
 * Options for a Definition question: one correct English meaning label plus
 * distractors taken from other kanji in the same grade.
 *
 * Single-answer, unlike the yomi quiz — the whole meaning label ("above, up")
 * is one option rather than each meaning separately, so there is exactly one
 * defensible answer instead of several overlapping ones.
 *
 * Returns { options, answer }.
 */
export function buildDefinitionChoices(course, kanji, count = DEFINITION_OPTIONS) {
  const answer = meaningLabel(kanjiInfo(course, kanji));
  const used = new Set([answer]);
  const options = [answer];

  for (const entry of shuffle([...course.index.values()])) {
    if (options.length >= count) break;
    if (entry.kanji === kanji) continue;
    const label = meaningLabel(entry);
    // Different kanji can share a meaning; an identical label would make the
    // question unanswerable.
    if (!label || used.has(label)) continue;
    used.add(label);
    options.push(label);
  }

  return { options: options.sort((a, b) => a.localeCompare(b)), answer };
}

/**
 * The readings to *add* to a question already on screen when "Advanced" is
 * pressed, rather than rebuilding the grid — so taps already made keep their
 * colour. `shown` is every reading string currently rendered (correct and
 * distractor alike), used only to avoid re-offering something already there.
 */
export function buildAdvancedAdditions(course, kanji, shown) {
  const info = kanjiInfo(course, kanji);
  const newCorrect = new Set(info.quizReadings.filter((r) => !shown.has(r)));
  const targetNewTotal = Math.max(0, ADVANCED_TOTAL_OPTIONS - shown.size);

  const additions = new Set(newCorrect);
  for (const reading of distractorPool(course, kanji)) {
    if (additions.size >= targetNewTotal) break;
    if (shown.has(reading) || additions.has(reading)) continue;
    additions.add(reading);
  }

  return { additions: sortByRomaji(additions), newCorrect };
}

/**
 * Roll up a kanji's individual reading records into one record at the
 * kanji's own progress key, so the existing generic course-scheduling logic
 * in srs.js (currentSetIndex, dueItems, courseStats, ...) keeps working
 * unchanged on kanji courses without knowing readings exist.
 *
 * `due` is the *soonest* of any introduced reading's due date — per Nathan's
 * call, a kanji resurfaces as soon as any one reading on it is shaky, rather
 * than waiting for every reading to lapse. `box` is the *lowest* streak
 * among introduced readings (capped like a Leitner box), so "mastered" means
 * every reading tested is solid, not just the easiest one.
 *
 * Call this right after grading any reading of the kanji.
 */
export function recomputeKanjiRollup(course, kanji, mode, progress, now = Date.now()) {
  const info = kanjiInfo(course, kanji);
  const records = info.quizReadings
    .map((r) => progress[yomiKey(mode, kanji, r)])
    .filter(Boolean);
  if (records.length === 0) return;

  progress[itemKey(mode, kanji)] = {
    box: Math.min(...records.map((r) => Math.min(r.streak, MAX_BOX))),
    due: Math.min(...records.map((r) => r.due)),
    intervalDays: 0,
    seen: records.reduce((sum, r) => sum + r.correct + r.incorrect, 0),
    correct: records.reduce((sum, r) => sum + r.correct, 0),
    lapses: records.reduce((sum, r) => sum + r.incorrect, 0),
    history: [],
  };
}

function shuffle(array) {
  const out = [...array];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
