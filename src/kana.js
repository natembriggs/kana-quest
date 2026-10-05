// Kana tables and answer checking.
//
// Only hiragana is written out by hand. Katakana is derived with
// wanakana.toKatakana. All displayed romaji goes through romajiFor, which
// uses wanakana with the same disambiguating spellings in every mode.

import { shuffle } from './srs.js';

const { toRomaji, toKana, toHiragana, toKatakana } = window.wanakana;

// Keep ぢ/づ distinct from じ/ず even when writing prompts hide the glyph.
// The detail note explains the pronunciation and Japanese keyboard input.
// Include their contracted forms so words use the same spelling as kana.
const DISPLAY_ROMAJI = {
  'ぢ': 'dji', 'づ': 'dzu',
  'ぢゃ': 'dja', 'ぢゅ': 'dju', 'ぢょ': 'djo',
};

// Japanese romaji keyboard spellings (including accepted shorter forms):
// https://support.apple.com/en-gb/guide/japanese-input-method/jpim10277/mac
// These explain differences; they do not replace the app's display spelling.
const ROMAJI_NOTES = {
  'ぢ': 'pronounced "ji", typed as "di"',
  'づ': 'pronounced "zu", typed as "du"',
  'ぢゃ': 'pronounced "ja", typed as "dya"',
  'ぢゅ': 'pronounced "ju", typed as "dyu"',
  'ぢょ': 'pronounced "jo", typed as "dyo"',
  'を': 'pronounced "o", typed as "wo"',
  'ん': 'typed as "nn" or "n\'" on a Japanese keyboard',
  'は': 'pronounced "wa" when used as a particle, typed as "ha"',
  'へ': 'pronounced "e" when used as a particle, typed as "he"',
  'し': 'also typed as "si"',
  'じ': 'also typed as "zi"',
  'ち': 'also typed as "ti"',
  'つ': 'also typed as "tu"',
  'ふ': 'also typed as "hu"',
  'しゃ': 'also typed as "sya"',
  'しゅ': 'also typed as "syu"',
  'しょ': 'also typed as "syo"',
  'じゃ': 'also typed as "jya" or "zya"',
  'じゅ': 'also typed as "jyu" or "zyu"',
  'じょ': 'also typed as "jyo" or "zyo"',
  'ちゃ': 'also typed as "tya" or "cya"',
  'ちゅ': 'also typed as "tyu" or "cyu"',
  'ちょ': 'also typed as "tyo" or "cyo"',
};

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
        ? `${romajiFor(items[0])} – ${romajiFor(items[items.length - 1])}`
        : romajiFor(items[0]),
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

/** The romaji shown throughout the app, for kana and words alike. */
export function romajiFor(kana) {
  return toRomaji(kana, { customRomajiMapping: DISPLAY_ROMAJI });
}

/** Parenthetical detail copy, shared by both scripts except particle notes. */
export function romajiNoteFor(kana) {
  const hira = toHiragana(kana);
  if (kana !== hira && (hira === 'は' || hira === 'へ')) return '';
  return ROMAJI_NOTES[hira] || '';
}

/** Writing uses exactly the spelling taught and tested in reading mode. */
export function writingPromptFor(kana) {
  return romajiFor(kana);
}

/**
 * Multiple-choice options for a character: the correct romaji plus
 * distractors, shuffled.
 *
 * Distractors are drawn from the character's own set first, so the choice is
 * between genuinely confusable sounds rather than between one plausible
 * answer and nine obviously wrong ones.
 *
 * Options are de-duplicated by romaji and exclude accepted alternate
 * answers, so a question never offers two valid spellings of its target.
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
  // The spelling we teach must be accepted even when it is a display hint
  // (dji/dzu) rather than the keystrokes a Japanese keyboard expects (di/du).
  if (typed === romajiFor(want)) return true;
  if ((ALTERNATES[want] || []).includes(typed)) return true;
  return toHiragana(toKana(typed)) === want;
}
