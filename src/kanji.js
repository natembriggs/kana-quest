// Kanji courses (one per school grade), and the reading-quiz question logic.
//
// Data comes from tools/build_kanji_data.py, which distills KANJIDIC2 and
// JMdict down to src/kanji-data.js: for each kanji, its on'yomi, kun'yomi,
// English meanings and a few common example words. See that script for how
// "common" is decided and why higher grades aren't built yet.

import { KANJI_BY_GRADE } from './kanji-data.js';

// Used only to order options alphabetically (see buildReadingChoices) — kun
// readings are hiragana and on readings are katakana, so sorting the raw
// strings would separate the two scripts instead of interleaving by sound.
const { toRomaji } = window.wanakana;

const CHUNK_SIZE = 5; // matches the kana courses, for a consistent lesson size

// Offering every reading KANJIDIC lists would be unusable — 生 alone has 18
// kun'yomi once conjugated forms are counted. Cap how many correct readings
// a single question offers; KANJIDIC already orders readings with the most
// common first, so capping keeps the ones a first encounter should teach.
const MAX_CORRECT_READINGS = 6;
const OPTIONS_PER_QUESTION = 10;

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

/**
 * Ten reading options for a kanji: its own on'yomi/kun'yomi (up to the cap)
 * plus distractors pulled from other kanji in the same course, so the wrong
 * options are genuinely plausible rather than obviously foreign.
 *
 * Returns { options, correct } where `correct` is the Set of option strings
 * that should be ticked.
 */
export function buildReadingChoices(course, kanji, count = OPTIONS_PER_QUESTION) {
  const info = kanjiInfo(course, kanji);
  const correct = new Set(info.quizReadings);
  const options = new Set(correct);

  const others = [...course.index.values()].filter((e) => e.kanji !== kanji);
  const pool = shuffle(others.flatMap((e) => [...e.on, ...e.kun]));

  for (const reading of pool) {
    if (options.size >= count) break;
    if (correct.has(reading)) continue; // would be ambiguous if offered as a distractor
    options.add(reading);
  }

  // Alphabetical by romaji, not by raw kana: on'yomi is katakana and kun'yomi
  // is hiragana, so sorting the characters themselves would clump the two
  // scripts instead of interleaving by sound — which is what makes a known
  // reading fast to spot in the grid.
  const sorted = [...options].sort((a, b) => toRomaji(a).localeCompare(toRomaji(b)));
  return { options: sorted, correct };
}

function shuffle(array) {
  const out = [...array];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
