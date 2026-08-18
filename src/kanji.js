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

// Offering every reading KANJIDIC lists would be unusable — 生 alone has 18
// kun'yomi once conjugated forms are counted. Cap the pool a question can
// ever draw correct readings from; KANJIDIC already orders readings with the
// most common first, so capping keeps the ones a first encounter should teach.
const MAX_CORRECT_READINGS = 6;

// A question shows at most this many readings as correct by default — enough
// to be worth answering, few enough that a kid can't pass by clicking
// everything. Always under half of BASE_TOTAL_OPTIONS, per the same
// no-better-than-guessing rule the advanced view keeps too.
const BASE_CORRECT_LIMIT = 4;
const BASE_TOTAL_OPTIONS = 10;
// "Advanced" reveals the rest of the (up to 6-reading) pool. Sized so that
// even the full pool of 6 correct stays comfortably under half.
const ADVANCED_TOTAL_OPTIONS = 15;

/**
 * KANJIDIC marks the okurigana boundary with '.' (い.きる) and marks bound
 * forms with a leading or trailing '-' (-あ.げる, うわ-). Neither is useful
 * to a learner tapping a multiple-choice option, so this collapses a raw
 * reading down to the plain kana they would actually write: い.きる -> いきる.
 */
function normalizeReading(raw) {
  return raw.replace(/-/g, '').replace(/\./g, '');
}

function buildKanjiIndex(grade) {
  const entries = KANJI_BY_GRADE[grade] || [];
  const byChar = new Map();
  for (const entry of entries) {
    const onReadings = [...new Set(entry.on)];
    const kunReadings = [...new Set(entry.kun.map(normalizeReading))];
    byChar.set(entry.kanji, {
      kanji: entry.kanji,
      on: onReadings,
      kun: kunReadings,
      meanings: entry.meanings,
      words: entry.words,
      // The readings actually offered as correct options, capped. Kept
      // alongside the full lists above so a future "show everything" detail
      // view is not blocked by this quiz-only cap.
      quizReadings: [...onReadings, ...kunReadings].slice(0, MAX_CORRECT_READINGS),
      // reading (normalized, matching quizReadings) -> {kanji, kana, en}:
      // the most common word anchored to that specific reading, e.g. 上's
      // rare シャン on'yomi -> 上海 "Shanghai". Not every reading has one
      // (build_kanji_data.py logs which); keyed as a plain object since it's
      // only ever looked up by an exact reading string, never iterated.
      readingExamples: entry.readingExamples || {},
    });
  }
  return byChar;
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
  };
}

// Only grade 1 has been built (see tools/build_kanji_data.py — MAX_GRADE).
// Re-running that script with a higher MAX_GRADE and adding the grade number
// here is the whole extension path; nothing else needs to change.
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

/** The example word anchored to one specific reading of a kanji, if one was
 * found at build time — see build_kanji_data.py's find_reading_example. */
export function readingExample(course, kanji, reading) {
  return kanjiInfo(course, kanji).readingExamples[reading] || null;
}

function sortByRomaji(readings) {
  return [...readings].sort((a, b) => toRomaji(a).localeCompare(toRomaji(b)));
}

function distractorPool(course, kanji) {
  return shuffle([...course.index.values()]
    .filter((e) => e.kanji !== kanji)
    .flatMap((e) => [...e.on, ...e.kun]));
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
  const mandatory = [info.on[0], info.kun[0]].filter((r) => r && pool.includes(r));
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

  const options = new Set(correct);
  for (const reading of distractorPool(course, kanji)) {
    if (options.size >= total) break;
    if (correct.has(reading)) continue; // would be ambiguous as a distractor
    options.add(reading);
  }

  return { options: sortByRomaji(options), correct };
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
