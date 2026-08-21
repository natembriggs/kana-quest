// Kanji courses (one per school grade), and the reading-quiz question logic.
//
// Data comes from tools/build_kanji_data.py, which distills KANJIDIC2 and
// JMdict down to src/data/: for each kanji, its on'yomi, kun'yomi, English
// meanings and a few common example words. See that script for how "common"
// is decided.
//
// The per-kanji data is loaded lazily, one grade at a time — see
// kanji-expansion-plan.md §4. KANJI_UNITS (src/data/kanji-manifest.js) is
// small and always loaded: just the ordered character list per grade, enough
// to build every course's id/name/chunks up front, exactly as if the whole
// set were in memory. Each course's `.index` Map starts EMPTY and is filled
// in place by ensureKanjiUnitLoaded() the first time that grade is actually
// needed — kanjiInfo() and everything built on it (buildKanjiOptions,
// buildDefinitionChoices, ...) are unchanged and stay synchronous; they just
// require the caller to have awaited that load first. See app.js's
// ensureUnitReady().

import { KANJI_UNITS, NO_YOMI_CHARS, NO_MEANING_CHARS } from './data/kanji-manifest.js';
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

/**
 * plain reading -> "stem(okurigana)" for every kun'yomi that has any, e.g.
 * "まじ.わる" (KANJIDIC's own dot notation, still intact on entry.kun — see
 * build_kanji_data.py's reading_parts) becomes {"まじわる": "まじ(わる)"}. Only
 * the part actually READ by the kanji itself is worth memorising; the rest is
 * just however the word happens to end, so bracketing it tells a learner
 * which syllables are truly "the reading" at a glance. On'yomi never have
 * okurigana and are left out entirely — display falls back to the plain
 * string wherever this map has no entry (see formatReading below).
 */
function buildOkuriganaDisplay(kun) {
  const display = {};
  kun.forEach((raw) => {
    const stripped = raw.replace(/-/g, '');
    const dot = stripped.indexOf('.');
    if (dot < 0) return;
    const stem = stripped.slice(0, dot);
    const okuri = stripped.slice(dot + 1);
    if (!stem || !okuri) return;
    display[stem + okuri] = `${stem}(${okuri})`;
  });
  return display;
}

/** Shapes one raw KANJI_ENTRIES record (see build_kanji_data.py) into the
 * form course.index stores — same fields whether this runs eagerly (never,
 * now) or lazily inside ensureKanjiUnitLoaded() below. */
function normalizeEntry(entry) {
  return {
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
    okuriDisplay: buildOkuriganaDisplay(entry.kun),
  };
}

/** The short English label used as the answer in Definition mode. */
export function meaningLabel(info) {
  return info.meanings.slice(0, MEANINGS_PER_LABEL).join(', ');
}

/**
 * How a reading should actually be SHOWN to a learner — everywhere else in
 * the app (quiz matching, dataset.reading, readingExamples lookups, the
 * `correct`/`options` sets) keeps using the plain string; only the label
 * painted on screen goes through this. See buildOkuriganaDisplay above.
 */
export function formatReading(info, reading) {
  return info.okuriDisplay[reading] || reading;
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

/** "1".."6" (elementary) before "8-1".."8-6" (secondary jōyō sub-units) before
 * "9-1".."9-N" (beyond-jōyō names & places sub-units, see
 * kanji-expansion-plan.md §4/§5/§8) — compares numerically part by part so
 * this keeps working unchanged how ever many dash-separated parts a unit key
 * gains later, rather than hardcoding today's shapes. */
function compareUnits(a, b) {
  const pa = a.split('-').map(Number);
  const pb = b.split('-').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? -1) - (pb[i] ?? -1);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function unitLabel(unit) {
  if (unit.startsWith('9-')) return `Names & places ${unit.slice(2)}`;
  if (unit.startsWith('8-')) return `Secondary ${unit.slice(2)}`;
  return `Grade ${unit}`;
}
function unitNative(unit) {
  if (unit.startsWith('9-')) return `人名・地名 ${unit.slice(2)}`;
  if (unit.startsWith('8-')) return `中学以降 ${unit.slice(2)}`;
  return `小学${unit}年生`;
}

/**
 * Course skeleton for one teaching unit, built entirely from the small
 * always-loaded manifest — id, name, chunks (character order) and the Yomi
 * exclusion set (from NO_YOMI_CHARS, not the per-unit chunk, so this is
 * correct immediately rather than only once the unit has actually loaded —
 * srs.js consults excludeForMode during scheduling, which can happen before
 * that). `.index` starts empty; ensureKanjiUnitLoaded() below fills it in
 * place the first time this unit's real data is needed.
 */
function buildKanjiCourse(unit) {
  const chars = KANJI_UNITS[unit];
  return {
    id: `kanji-grade-${unit}`,
    kind: 'kanji',
    unit,
    name: `Kanji · ${unitLabel(unit)}`,
    native: unitNative(unit),
    chunks: buildChunks(`kanji-grade-${unit}`, chars),
    index: new Map(),
    // A handful of kanji (prefecture names like 媛/栃/茨, and beyond-jōyō
    // names/places kanji, see kanji-expansion-plan.md §5) have no reading
    // that appears in any common word, so there is no yomi question to ask
    // about them — they are skipped in that mode only, and still taught in
    // the others. A much smaller handful have no non-radical English
    // meaning at all (KANJIDIC's only gloss for them is their own radical
    // name), so Definition is skipped the same way. srs.js honours both when
    // picking items.
    excludeForMode: {
      recognition: new Set(chars.filter((k) => NO_YOMI_CHARS.includes(k))),
      definition: new Set(chars.filter((k) => NO_MEANING_CHARS.includes(k))),
    },
  };
}

export const KANJI_COURSES = Object.keys(KANJI_UNITS)
  .sort(compareUnits)
  .map(buildKanjiCourse);

export function getKanjiCourse(courseId) {
  return KANJI_COURSES.find((c) => c.id === courseId);
}

// char -> unit, built once from the manifest — cheap (~3,000 entries at most)
// and needed wherever a kanji's home unit has to be found without already
// knowing which course it's in: the "everything I'm studying" pool (spans
// every grade) and search (doesn't know which grade to look in by design).
const unitByChar = new Map();
Object.entries(KANJI_UNITS).forEach(([unit, chars]) => {
  chars.forEach((char) => unitByChar.set(char, unit));
});
export function kanjiUnitFor(char) {
  return unitByChar.get(char) || null;
}

const loadedUnits = new Set();
const loadingUnits = new Map(); // unit -> in-flight Promise, dedupes concurrent callers

/**
 * Loads one unit's real per-kanji data (readings, meanings, example words)
 * and fills its course's `.index` Map in place. Memoized: safe to call any
 * number of times, from any number of call sites, for the same unit — the
 * dynamic import only actually happens once. Every other function in this
 * module (kanjiInfo, buildKanjiOptions, ...) stays synchronous; the contract
 * is simply that the caller has awaited this first. See app.js's
 * ensureUnitReady(), the only place that should call this directly.
 */
export async function ensureKanjiUnitLoaded(unit) {
  if (loadedUnits.has(unit)) return;
  if (!loadingUnits.has(unit)) {
    loadingUnits.set(unit, import(`./data/kanji-grade-${unit}.js`).then((mod) => {
      const course = getKanjiCourse(`kanji-grade-${unit}`);
      mod.KANJI_ENTRIES.forEach((entry) => course.index.set(entry.kanji, normalizeEntry(entry)));
      loadedUnits.add(unit);
    }));
  }
  await loadingUnits.get(unit);
}

/** Sync check for whether every unit's real data has been loaded — used by
 * search (app.js), which needs to know whether it can match right now or
 * has to kick off a full load first. */
export function areAllKanjiUnitsLoaded() {
  return KANJI_COURSES.every((c) => loadedUnits.has(c.unit));
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
