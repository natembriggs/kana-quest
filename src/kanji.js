// Kanji courses (one per school grade, plus the JLPT and Kanji Trail
// re-cuts of the same kanji), and the reading-quiz question logic.
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
import { KANJI_ORDER_UNITS } from './data/kanji-orders.js';
import {
  yomiKey, isReadingStudied, recomputeYomiRollupFromProgress,
} from './srs.js';
import { kanjiComponents } from './kanji-components.js';

// toRomaji orders options alphabetically (see buildKanjiOptions) — kun
// readings are hiragana and on readings are katakana, so sorting the raw
// strings would separate the two scripts instead of interleaving by sound.
// toHiragana folds that same script split away entirely, for deciding
// whether two readings are the same SOUND (see sameSound below).
const { toRomaji, toHiragana } = window.wanakana;

/**
 * Script-insensitive reading identity: キ and き are one sound written under
 * two conventions (katakana for on'yomi, hiragana for kun), not two answers.
 * toHiragana rather than toRomaji because romaji over-merges — it maps both
 * ヂ and ジ to "ji", and ヅ and ズ to "zu", which are genuinely different
 * readings a learner is entitled to be asked to tell apart.
 */
function sameSound(a, b) {
  return toHiragana(a) === toHiragana(b);
}

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
    // Real readings this kanji has beyond the default quizzed pool — not
    // tested unless a learner opts in, see effectiveQuizReadings below and
    // kanji-expansion-plan.md's "uncommon yomi" section. Every one still has
    // a readingExamples entry, same guarantee as quizReadings.
    uncommonReadings: entry.uncommonReadings || [],
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

/** Every meaning a kanji has, lowercased — the key set buildDefinitionChoices
 * excludes distractors on. Two kanji can share a meaning without their
 * labels matching as strings (内 "inside, within" vs 中 "in, inside"), and
 * offering one as a wrong answer to the other makes the question
 * unanswerable rather than hard. Mirrors glossKeys() in vocab.js, which
 * fixed the same class of bug there first. */
export function meaningKeys(info) {
  return new Set(info.meanings.map((m) => m.toLowerCase()));
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

// Unit keys, across all three teaching orders (kanji-expansion-plan.md §3).
// Every key is unique across orders, so a unit key alone names one course:
//   school grade  "1".."6", "8-1".."8-6", "9-1".."9-6"
//   JLPT          "N5", "N4", "N3-1".."N1-7", "NJ" (jōyō on no JLPT list),
//                 "NP-1".."NP-4" (the names & places kanji on no list)
//   Kanji Trail   "T1".."T6", "T8-1".."T8-6", then the school-grade
//                 names & places units themselves, reused unchanged
const JLPT_UNIT = /^N([1-5])(?:-(\d+))?$/;

export function unitLabel(unit) {
  const jlpt = unit.match(JLPT_UNIT);
  if (jlpt) return `JLPT N${jlpt[1]}${jlpt[2] ? ` · ${jlpt[2]}` : ''}`;
  if (unit === 'NJ') return 'Other jōyō';
  if (unit.startsWith('NP-')) return `Names & places ${unit.slice(3)}`;
  if (unit.startsWith('T8-')) return `Secondary ${unit.slice(3)}`;
  if (unit.startsWith('T')) return `Stage ${unit.slice(1)}`;
  if (unit.startsWith('9-')) return `Names & places ${unit.slice(2)}`;
  if (unit.startsWith('8-')) return `Secondary ${unit.slice(2)}`;
  return `Grade ${unit}`;
}
function unitNative(unit) {
  const jlpt = unit.match(JLPT_UNIT);
  if (jlpt) return `日本語能力試験 N${jlpt[1]}${jlpt[2] ? ` · ${jlpt[2]}` : ''}`;
  if (unit === 'NJ') return 'その他の常用漢字';
  if (unit.startsWith('NP-')) return `人名・地名 ${unit.slice(3)}`;
  if (unit.startsWith('T8-')) return `中学以降 ${unit.slice(3)}`;
  if (unit.startsWith('T')) return `漢字トレイル ${unit.slice(1)}`;
  if (unit.startsWith('9-')) return `人名・地名 ${unit.slice(2)}`;
  if (unit.startsWith('8-')) return `中学以降 ${unit.slice(2)}`;
  return `小学${unit}年生`;
}

/** The heading a unit sits under in the unit picker. Consecutive units with
 * the same heading form one group (app.js's unitGroupsFor). */
export function unitGroupLabel(unit) {
  const jlpt = unit.match(JLPT_UNIT);
  if (jlpt) return `N${jlpt[1]}`;
  if (unit === 'NJ') return 'Other jōyō';
  if (unit.startsWith('NP-') || unit.startsWith('9-')) return 'Names & places';
  if (unit.startsWith('T8-') || unit.startsWith('8-')) return 'Secondary school';
  if (unit.startsWith('T')) return 'Kanji Trail stage';
  return 'Primary school grade';
}

/** Short text for a unit's picker tile — "1".."6" for elementary, "S1".."S6"
 * for secondary jōyō, "N1".."N6" for the school-grade names & places units.
 * Inside a JLPT level, just the part number, since the group chip above
 * already says which level; a level with one part shows the level itself. */
export function unitBadge(unit) {
  const jlpt = unit.match(JLPT_UNIT);
  if (jlpt) return jlpt[2] || `N${jlpt[1]}`;
  if (unit === 'NJ') return 'Jōyō';
  if (unit.startsWith('NP-')) return unit.slice(3);
  if (unit.startsWith('T8-')) return `S${unit.slice(3)}`;
  if (unit.startsWith('T')) return unit.slice(1);
  if (unit.startsWith('9-')) return `N${unit.slice(2)}`;
  if (unit.startsWith('8-')) return `S${unit.slice(2)}`;
  return unit;
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
function exclusionsFor(chars) {
  return {
    recognition: new Set(chars.filter((k) => NO_YOMI_CHARS.includes(k))),
    definition: new Set(chars.filter((k) => NO_MEANING_CHARS.includes(k))),
  };
}

function buildKanjiCourse(unit) {
  const chars = KANJI_UNITS[unit];
  return {
    id: `kanji-grade-${unit}`,
    kind: 'kanji',
    unit,
    order: 'grade',
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
    excludeForMode: exclusionsFor(chars),
  };
}

/** The school-grade courses: the app's default order, and the HOME of every
 * kanji's data — each kanji's readings, meanings and strokes live in its
 * school-grade unit's files, whichever order it is being taught in. */
export const KANJI_COURSES = Object.keys(KANJI_UNITS)
  .sort(compareUnits)
  .map(buildKanjiCourse);

const homeCourseByUnit = new Map(KANJI_COURSES.map((c) => [c.unit, c]));

/**
 * A course in one of the other two orders (JLPT, Kanji Trail) — the same
 * shape as a school-grade course, over kanji whose data lives in several
 * school-grade units at once. Like vocab's commonness units (vocab.js), it is
 * a second view, never a second copy: `.index` is read through to the home
 * courses on every access rather than filled in, so it can never go stale
 * as home units load behind it, and nothing needs to load it separately —
 * whatever loads a kanji's home unit (ensureKanjiUnitLoaded, via app.js's
 * ensureUnitsReady over kanjiUnitFor, which every session start already
 * does) makes it visible here too. Rebuilding a map over ~185 kanji per
 * access is cheap next to anything that reads it.
 */
function buildOrderCourse(order, unit, chars) {
  const id = `kanji-${order}-${unit}`;
  const course = {
    id,
    kind: 'kanji',
    unit,
    order,
    name: `Kanji · ${unitLabel(unit)}`,
    native: unitNative(unit),
    chunks: buildChunks(id, chars),
    excludeForMode: exclusionsFor(chars),
  };
  Object.defineProperty(course, 'index', {
    enumerable: true,
    get() {
      const index = new Map();
      chars.forEach((kanji) => {
        const home = homeCourseByUnit.get(unitByChar.get(kanji));
        const info = home && home.index.get(kanji);
        if (info) index.set(kanji, info);
      });
      return index;
    },
  });
  return course;
}

/** The three teaching orders, in the order the picker offers them. */
export const KANJI_ORDERS = ['grade', 'jlpt', 'trail'];

const COURSES_BY_ORDER = {
  grade: KANJI_COURSES,
  jlpt: Object.entries(KANJI_ORDER_UNITS.jlpt)
    .map(([unit, chars]) => buildOrderCourse('jlpt', unit, Array.from(chars))),
  // Kanji Trail never reorders the beyond-jōyō names & places units (see
  // tools/build_kanji_orders.py), so it ends with the school-grade ones
  // themselves rather than copies of them.
  trail: [
    ...Object.entries(KANJI_ORDER_UNITS.trail)
      .map(([unit, chars]) => buildOrderCourse('trail', unit, Array.from(chars))),
    ...KANJI_COURSES.filter((c) => c.unit.startsWith('9-')),
  ],
};

/** The course list for one order, in teaching order. An unknown order (a
 * profile synced from a newer build, say) falls back to school grade. */
export function kanjiCoursesFor(order) {
  return COURSES_BY_ORDER[order] || KANJI_COURSES;
}

/** Every kanji course in every order, each once — for anything that
 * resolves a course by id (session restore, ALL_COURSES in app.js).
 * Browsing and totals must use ONE order's list, never this, or every kanji
 * would be counted three times. */
export const KANJI_ALL_COURSES = [...new Set(Object.values(COURSES_BY_ORDER).flat())];

const courseByUnit = new Map(KANJI_ALL_COURSES.map((c) => [c.unit, c]));

/** The course a unit key names, in whichever order it belongs to — unit
 * keys are unique across orders (see unitLabel above). */
export function kanjiCourseForUnit(unit) {
  return courseByUnit.get(unit);
}

export function getKanjiCourse(courseId) {
  return KANJI_ALL_COURSES.find((c) => c.id === courseId);
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
 * quizzed or uncommon reading has one — build_kanji_data.py drops readings
 * that don't. */
export function readingExample(course, kanji, reading) {
  return kanjiInfo(course, kanji).readingExamples[reading] || null;
}

/**
 * The pool of readings actually tested for this kanji: the default
 * `quizReadings` plus whichever of its `uncommonReadings` this learner has
 * opted into via the per-reading yomi study list (srs.js's
 * isReadingStudied/setReadingStudied) — see kanji-expansion-plan.md's
 * "uncommon yomi" section. An empty/absent `yomiStudy` (every existing
 * profile, and every call site that doesn't pass one) falls straight
 * through to `info.quizReadings` unchanged.
 */
export function effectiveQuizReadings(info, kanji, yomiStudy) {
  const extra = info.uncommonReadings.filter((r) => isReadingStudied(yomiStudy, kanji, r));
  return extra.length ? [...info.quizReadings, ...extra] : info.quizReadings;
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
function pickBaseCorrectReadings(course, kanji, mode, progress, yomiStudy) {
  const info = kanjiInfo(course, kanji);
  const pool = effectiveQuizReadings(info, kanji, yomiStudy);
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
export function buildKanjiOptions(course, kanji, mode, progress, { advanced = false, yomiStudy = null } = {}) {
  const info = kanjiInfo(course, kanji);
  const pool = effectiveQuizReadings(info, kanji, yomiStudy);
  const correctReadings = advanced ? pool : pickBaseCorrectReadings(course, kanji, mode, progress, yomiStudy);
  const correct = new Set(correctReadings);
  // A learner who has opted a bunch of uncommon readings into study can push
  // the advanced pool past the usual 6-reading cap this constant assumes —
  // scale up rather than crowd them past half the grid. Unchanged for the
  // (overwhelmingly common) case of an empty yomi study list, where
  // correct.size never exceeds 6 and this reduces to ADVANCED_TOTAL_OPTIONS.
  const total = advanced ? Math.max(ADVANCED_TOTAL_OPTIONS, correct.size * 2 + 3) : BASE_TOTAL_OPTIONS;

  // The base view only shows some of this kanji's own readings as correct —
  // e.g. 子 has 5, only 4 make the base view. The other 1-2 are still
  // genuinely correct readings of 子, just not being quizzed this round, so
  // they must never appear as a "wrong" distractor even if some other kanji
  // (e.g. 音, also read ね) would otherwise offer that exact reading.
  //
  // Matched by SOUND, not by string: 木 is read き, so offering キ (a real
  // on'yomi of 気/期/記, and the very same syllable) and marking it wrong
  // tests nothing but which script the app happened to print the answer in.
  // A third of all kanji have a reading with a cross-script twin somewhere
  // in the pool, so this is common, and it is the harsher half of the same
  // rule the exact match above already encodes — the learner knew the sound.
  // Seeded with every own reading, so the same set also stops two distractors
  // that differ only by script (き from one kanji, キ from another) landing in
  // one grid, where they read as the app having printed the same option twice
  // and then marked both wrong. No kanji has a same-sound pair among its own
  // readings, so seeding this can never suppress a correct option.
  const takenSounds = new Set(pool.map(toHiragana));

  const options = new Set(correct);
  for (const reading of distractorPool(course, kanji)) {
    if (options.size >= total) break;
    const sound = toHiragana(reading);
    if (takenSounds.has(sound)) continue;
    takenSounds.add(sound);
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
 * A candidate sharing ANY meaning with the answer kanji is excluded outright
 * (meaningKeys above), not just one with an identical label — 内 "inside,
 * within" and 中 "in, inside" are different strings and the same button.
 * Deduping on the label string alone used to be all this did, which is
 * exactly how those two ended up on the same question. A grade that can't
 * spare `count` safe distractors returns fewer options rather than relaxing
 * the rule; a three-way question is still a question.
 *
 * Returns { options, answer, source }, where `source` maps each option's
 * label back to the kanji it was taken from — the answer's own label
 * included.
 */

/** The component characters (e.g. 氵) drawn in `char`, or an empty set for a
 * kanji with no breakdown on record. Used to bias distractor choice below —
 * see buildDefinitionChoices. */
function componentChars(unit, char) {
  const entry = kanjiComponents(unit, char);
  return new Set(entry && entry.parts ? entry.parts.map((p) => p.c) : []);
}

export function buildDefinitionChoices(course, kanji, count = DEFINITION_OPTIONS) {
  const info = kanjiInfo(course, kanji);
  const answer = meaningLabel(info);
  const banned = meaningKeys(info);
  const used = new Set([answer]);
  const options = [answer];
  // Which kanji each option's meaning actually belongs to. The mapping has
  // always existed here — every distractor is lifted off a real entry a
  // couple of lines below — it just used to be thrown away at the return,
  // leaving the quiz screen holding four English labels and no way back to
  // the characters behind three of them. Carrying it out is what lets a
  // resolved question offer the side-by-side comparison (see
  // armChoiceComparison in app.js).
  const source = new Map([[answer, kanji]]);

  // A learner can often guess the general theme of a meaning from a common
  // component alone — a water radical (氵) means "something wet" whether or
  // not you know THIS kanji — which makes a question too easy if the wrong
  // answers don't share that shortcut. So kanji built from the same
  // component(s) as the answer are tried first; only if there aren't enough
  // of those does the question fall back to the rest of the grade.
  const unit = kanjiUnitFor(kanji);
  const targetComponents = componentChars(unit, kanji);

  const pool = shuffle([...course.index.values()])
    .filter((entry) => entry.kanji !== kanji
      && ![...meaningKeys(entry)].some((m) => banned.has(m)));

  if (targetComponents.size) {
    pool.sort((a, b) => {
      const bShares = [...componentChars(unit, b.kanji)].some((c) => targetComponents.has(c)) ? 1 : 0;
      const aShares = [...componentChars(unit, a.kanji)].some((c) => targetComponents.has(c)) ? 1 : 0;
      return bShares - aShares;
    });
  }

  for (const entry of pool) {
    if (options.length >= count) break;
    const label = meaningLabel(entry);
    if (!label || used.has(label)) continue;
    used.add(label);
    options.push(label);
    source.set(label, entry.kanji);
  }

  return { options: options.sort((a, b) => a.localeCompare(b)), answer, source };
}

/**
 * The readings to *add* to a question already on screen when "Advanced" is
 * pressed, rather than rebuilding the grid — so taps already made keep their
 * colour. `shown` is every reading string currently rendered (correct and
 * distractor alike), used only to avoid re-offering something already there.
 */
export function buildAdvancedAdditions(course, kanji, shown, yomiStudy) {
  const info = kanjiInfo(course, kanji);
  const pool = effectiveQuizReadings(info, kanji, yomiStudy);
  const newCorrect = new Set(pool.filter((r) => !shown.has(r)));
  // Every pool reading already in `shown` must already be correct (the base
  // view never shows a pool reading as a distractor — see buildKanjiOptions),
  // so the grid's final correct count is exactly pool.length once this
  // finishes. Scale the target total the same way buildKanjiOptions does, so
  // a learner's studied uncommon readings never crowd past half the grid;
  // unchanged from the old fixed ADVANCED_TOTAL_OPTIONS when pool.length <= 6
  // (every existing, yomiStudy-less kanji).
  const total = Math.max(ADVANCED_TOTAL_OPTIONS, pool.length * 2 + 3);
  const targetNewTotal = Math.max(0, total - shown.size);

  // Same sound-level exclusion buildKanjiOptions applies, over both the
  // kanji's own readings and whatever the base grid is already showing —
  // expanding a grid must not slip in a distractor that only differs from
  // an option already on screen (or from a correct answer) by script.
  const takenSounds = new Set(
    [...pool, ...shown].map(toHiragana),
  );

  const additions = new Set(newCorrect);
  for (const reading of distractorPool(course, kanji)) {
    if (additions.size >= targetNewTotal) break;
    const sound = toHiragana(reading);
    if (takenSounds.has(sound)) continue;
    takenSounds.add(sound);
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
 *
 * Delegates to srs.js's recomputeYomiRollupFromProgress, which discovers
 * which readings to aggregate by scanning `progress` for `mode:kanji:*` keys
 * rather than trusting a fixed reading list — the same aggregation, just
 * sourced from whatever was actually graded. `course` and `yomiStudy` are
 * used to pass the kanji's CURRENT testable pool (effectiveQuizReadings) as
 * that function's `activeReadings`, so a reading that has since fallen out
 * of the pool — un-studied, or demoted by a common/uncommon reclassification
 * — can no longer pin the kanji permanently due on the strength of a `due`
 * date it can never earn its way out of (kana-quest-feedback#11).
 */
export function recomputeKanjiRollup(course, kanji, mode, progress, yomiStudy, now = Date.now()) {
  const info = kanjiInfo(course, kanji);
  const active = effectiveQuizReadings(info, kanji, yomiStudy);
  recomputeYomiRollupFromProgress(progress, mode, kanji, now, active);
}

function shuffle(array) {
  const out = [...array];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
