// Kana tables and answer checking.
//
// Only hiragana is written out by hand. Katakana is derived with
// wanakana.toKatakana, and every romaji prompt is derived with
// wanakana.toRomaji, so there is no hand-typed romaji anywhere that could
// silently disagree with the answer checker.

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

export const COURSES = [
  {
    id: 'hiragana',
    name: 'Hiragana',
    native: 'ひらがな',
    chunks: buildChunks('hiragana', (c) => c),
  },
  {
    id: 'katakana',
    name: 'Katakana',
    native: 'カタカナ',
    chunks: buildChunks('katakana', (c) => toKatakana(c)),
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
