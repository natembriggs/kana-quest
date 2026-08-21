// Kana tables and answer checking.
//
// Only hiragana is written out by hand. Katakana is derived with
// wanakana.toKatakana, and every romaji prompt is derived with
// wanakana.toRomaji, so there is no hand-typed romaji anywhere that could
// silently disagree with the answer checker.

import { shuffle } from './srs.js';

const { toRomaji, toKana, toHiragana, toKatakana } = window.wanakana;

// Rows of the gojuon, in the order they are normally taught.
const BASIC = [
  'あいうえお', 'かきくけこ', 'さしすせそ', 'たちつてと', 'なにぬねの',
  'はひふへほ', 'まみむめも', 'やゆよ', 'らりるれろ', 'わをん',
];

// Voiced (dakuten) and plosive (handakuten) rows.
const DAKUTEN = [
  'がぎぐげご', 'ざじずぜぞ', 'だぢづでど', 'ばびぶべぼ', 'ぱぴぷぺぽ',
];

// Contracted sounds (yoon). These are two code points each, so they are
// listed explicitly rather than split character by character.
const YOON = [
  ['きゃ', 'きゅ', 'きょ', 'ぎゃ', 'ぎゅ', 'ぎょ'],
  ['しゃ', 'しゅ', 'しょ', 'じゃ', 'じゅ', 'じょ'],
  ['ちゃ', 'ちゅ', 'ちょ', 'にゃ', 'にゅ', 'にょ'],
  ['ひゃ', 'ひゅ', 'ひょ', 'びゃ', 'びゅ', 'びょ'],
  ['ぴゃ', 'ぴゅ', 'ぴょ', 'みゃ', 'みゅ', 'みょ'],
  ['りゃ', 'りゅ', 'りょ'],
];

// Romaji that wanakana will not round-trip to the character we want, but
// which a learner is entitled to type. Keyed by hiragana; katakana targets
// are normalised to hiragana before lookup.
//   nn -> ん   (toKana('nn') gives んん)
//   o  -> を   (を is pronounced "o"; toKana('o') gives お)
//   ji -> ぢ, zu -> づ  (merged readings in modern Japanese)
const ALTERNATES = {
  'ん': ['nn'],
  'を': ['o'],
  'ぢ': ['ji'],
  'づ': ['zu'],
};

/** Every yōon (contracted-sound) character in this script, e.g. きゃ/キャ —
 * see excludeForMode below. */
function yoonItems(toScript) {
  return new Set(YOON.flat().map(toScript));
}

function buildChunks(courseId, toScript) {
  const groups = [
    ...BASIC.map((row) => Array.from(row)),
    ...DAKUTEN.map((row) => Array.from(row)),
    ...YOON,
  ];
  return groups.map((group, index) => {
    const items = group.map(toScript);
    return {
      id: `${courseId}-${index}`,
      courseId,
      index,
      // e.g. "ka – ko", derived rather than hand-labelled.
      label: items.length > 1
        ? `${toRomaji(items[0])} – ${toRomaji(items[items.length - 1])}`
        : toRomaji(items[0]),
      items,
    };
  });
}

// Writing mode has no stroke/guide data for a two-code-point yōon character
// (きゃ, キャ, ...) — kanjivg-derived src/data/stroke-kana.js only covers
// single kana — so there is nothing to trace or grade against. Excluded from
// that mode only, the same excludeForMode mechanism kanji courses use for a
// reading/meaning a given kanji doesn't have (see kanji.js's
// buildKanjiCourse); every other mode still teaches and quizzes them.
export const COURSES = [
  {
    id: 'hiragana',
    kind: 'kana',
    name: 'Hiragana',
    native: 'ひらがな',
    chunks: buildChunks('hiragana', (c) => c),
    excludeForMode: { writing: yoonItems((c) => c) },
  },
  {
    id: 'katakana',
    kind: 'kana',
    name: 'Katakana',
    native: 'カタカナ',
    chunks: buildChunks('katakana', (c) => toKatakana(c)),
    excludeForMode: { writing: yoonItems((c) => toKatakana(c)) },
  },
];

export function getCourse(courseId) {
  return COURSES.find((c) => c.id === courseId) || COURSES[0];
}

/** The romaji we show as the answer / as the writing-mode prompt. */
export function romajiFor(kana) {
  return toRomaji(kana);
}

/**
 * Multiple-choice options for a character: the correct romaji plus
 * distractors, shuffled.
 *
 * Distractors are drawn from the character's own set first, so the choice is
 * between genuinely confusable sounds rather than between one plausible
 * answer and nine obviously wrong ones.
 *
 * Options are de-duplicated by romaji, which matters because じ/ぢ are both
 * "ji" and ず/づ are both "zu" — offering both would make the question
 * unanswerable.
 */
export function buildChoices(course, kana, count = 10) {
  const answer = romajiFor(kana);
  const used = new Set([answer]);
  const options = [answer];

  const sameSet = course.chunks.find((c) => c.items.includes(kana));
  const near = shuffle(sameSet ? sameSet.items.filter((k) => k !== kana) : []);
  const far = shuffle(course.chunks.flatMap((c) => c.items).filter((k) => k !== kana));

  for (const candidate of [...near, ...far]) {
    if (options.length >= count) break;
    const romaji = romajiFor(candidate);
    if (used.has(romaji)) continue;
    // A distractor that checkRomaji would also accept for THIS target (e.g.
    // お's canonical "o" is also を's accepted alternate spelling) would be a
    // confusing pair to show together, even though tap-to-choose grades by
    // exact match and wouldn't actually mis-score it.
    if (checkRomaji(romaji, kana)) continue;
    used.add(romaji);
    options.push(romaji);
  }
  // Alphabetical rather than shuffled: if you already know the sound, it's
  // faster to scan a sorted grid than a random one.
  return options.sort();
}

/**
 * True if `input` is an acceptable romaji spelling of `target`.
 * Works for both hiragana and katakana targets.
 */
export function checkRomaji(input, target) {
  const typed = String(input || '').trim().toLowerCase();
  if (!typed) return false;
  const want = toHiragana(target);
  if ((ALTERNATES[want] || []).includes(typed)) return true;
  return toHiragana(toKana(typed)) === want;
}
