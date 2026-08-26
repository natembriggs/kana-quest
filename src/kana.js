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

// Which teaching band a chunk belongs to — used to keep a randomized kana
// placement test (see srs.js's buildSession) from letting gojuon-order
// knowledge alone ace it: basic rows first, then voiced/plosive rows, then
// compound (yōon) rows, shuffled only *within* each band.
const BAND_BASIC = 'basic';
const BAND_DAKUTEN = 'dakuten';
const BAND_YOON = 'yoon';

function buildChunks(courseId, toScript) {
  const groups = [
    ...BASIC.map((row) => ({ row: Array.from(row), band: BAND_BASIC })),
    ...DAKUTEN.map((row) => ({ row: Array.from(row), band: BAND_DAKUTEN })),
    ...YOON.map((row) => ({ row, band: BAND_YOON })),
  ];
  return groups.map(({ row, band }, index) => {
    const items = row.map(toScript);
    return {
      id: `${courseId}-${index}`,
      courseId,
      index,
      band,
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

/** The romaji we show as the answer to a reading question. */
export function romajiFor(kana) {
  return toRomaji(kana);
}

// romajiFor(ぢ) and romajiFor(づ) come back as "ji"/"zu" — same as じ/ず —
// because that's how they're actually pronounced in modern Japanese, and
// that merge is exactly what ALTERNATES above lets a learner type. But
// writing mode shows romaji with no kana glyph alongside it (see
// writing-mode-plan.md's kana-prompt section): shown "zu" in isolation,
// there's no way to tell ず from づ apart, and nothing in the checker below
// is meant to resolve that — it's a display problem, not a spelling one.
// Marked here with an extra "d", the usual hint at ぢ/づ's origin as the
// dakuten forms of ち/つ rather than a spelling anyone is expected to type.
const WRITING_DISAMBIGUATE = {
  'ぢ': 'dji',
  'づ': 'dzu',
};

/** The romaji shown as the writing-mode prompt — see WRITING_DISAMBIGUATE
 * just above for why this can differ from romajiFor(). */
export function writingPromptFor(kana) {
  return WRITING_DISAMBIGUATE[toHiragana(kana)] || romajiFor(kana);
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
