// Vocabulary courses (one per teaching unit: a Core spine of function words
// plus GCSE-style theme units — see vocab-plan.md §2) and the Meaning-mode
// question logic (§5).
//
// Data comes from tools/build_vocab_data.py, which distills JMdict down to
// src/data/: for each word, its reading, English glosses, a per-kanji ruby
// breakdown, and precomputed wrong-answer pools for both quiz directions.
// See that script for how the word LIST itself was chosen — vocab-plan.md
// §3.5's frequency-based stand-in for an official GCSE list, not the list
// itself (units are named "Common words 1/2", not "GCSE Foundation/Higher").
//
// The per-word data is loaded lazily, one unit at a time — the same pattern
// kanji.js already uses for kanji grades (see kanji-expansion-plan.md §4).
// VOCAB_UNITS (src/data/vocab-manifest.js) is small and always loaded: just
// the ordered word-id list per unit, enough to build every course's
// id/name/chunks up front. Each course's `.index` Map starts EMPTY and is
// filled in place by ensureVocabUnitLoaded() the first time that unit is
// actually needed — mirrors ensureKanjiUnitLoaded() in kanji.js exactly.

import { VOCAB_UNITS, VOCAB_GROUP_LABELS, VOCAB_UNIT_LABELS } from './data/vocab-manifest.js';

const { toRomaji } = window.wanakana;

const CHUNK_SIZE = 5; // matches kana/kanji — see vocab-plan.md §2.4

const DEFINITION_OPTIONS = 4; // vocab-plan.md §5.1 — short English labels, same count as kanji Definition
const YOMI_OPTIONS = 6; // vocab-plan.md §5.4 — short kana labels, same count as the kanji Yomi base view
// Below this the yomi follow-up isn't worth asking: two options is a coin
// flip and one is no question at all. Reached when the only kanji whose
// reading is being tested has too few plausible misreadings to fill a
// question that respects the visible furigana — see buildYomiChoices.
export const MIN_YOMI_OPTIONS = 3;

const KANJI_RE = /[㐀-䶿一-鿿]/;

/** Whether a word's surface form contains any kanji at all — a pure-kana
 * word skips the furigana rung of the reveal ladder entirely and goes
 * straight to romaji (vocab-plan.md §5.2). */
export function wordHasKanji(word) {
  return KANJI_RE.test(word);
}

/** "C" for the Core group, else the numeral before the dot ("1" for "1.4").
 * Matches KANJI_UNIT_GROUPS' role in app.js but the grouping is baked into
 * the unit id itself here, so no separate test table is needed. */
function unitGroup(unit) {
  return unit.startsWith('C') ? 'C' : unit.split('.')[0];
}

/** Core first, then group 1..5 in order, sub-unit numerically within a
 * group — VOCAB_UNITS is already written in this order (Python dict
 * insertion order survives into JSON), but sorting explicitly here means
 * this keeps working if a future build ever writes the manifest in a
 * different order. */
function compareUnits(a, b) {
  const ga = unitGroup(a);
  const gb = unitGroup(b);
  if (ga !== gb) return ga === 'C' ? -1 : gb === 'C' ? 1 : ga.localeCompare(gb, undefined, { numeric: true });
  return a.localeCompare(b, undefined, { numeric: true });
}

export function unitLabel(unit) {
  return VOCAB_UNIT_LABELS[unit] || unit;
}

export function unitGroupLabel(unit) {
  return VOCAB_GROUP_LABELS[unitGroup(unit)] || unitGroup(unit);
}

function buildChunks(courseId, ids) {
  const chunks = [];
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const items = ids.slice(i, i + CHUNK_SIZE);
    chunks.push({
      id: `${courseId}-${chunks.length}`,
      courseId,
      index: chunks.length,
      // '・' between words, not run together like kana's chunk label — a
      // word can be several characters long, unlike a kana character, so
      // running them together would be unreadable. The id itself (rather
      // than the real surface from a loaded entry) is fine here: it IS the
      // surface for every word except a homograph collision (§3.3), and this
      // has to work before the unit's real data is ever loaded — same
      // constraint kanji.js's course skeleton is built under.
      label: items.map((id) => id.split('|')[0]).join('・'),
      items,
    });
  }
  return chunks;
}

/**
 * Course skeleton for one teaching unit, built entirely from the small
 * always-loaded manifest. `.index` starts empty; ensureVocabUnitLoaded()
 * below fills it in place the first time this unit's real data is needed.
 * `excludeForMode` is always empty — unlike kanji, no vocab word is
 * unquizzable in a mode it could otherwise be enrolled in.
 */
function buildVocabCourse(unit) {
  const ids = VOCAB_UNITS[unit];
  return {
    id: `vocab-${unit}`,
    kind: 'vocab',
    unit,
    name: `Vocabulary · ${unitLabel(unit)}`,
    native: unitLabel(unit),
    chunks: buildChunks(`vocab-${unit}`, ids),
    index: new Map(),
    excludeForMode: {},
  };
}

export const VOCAB_COURSES = Object.keys(VOCAB_UNITS)
  .sort(compareUnits)
  .map(buildVocabCourse);

export function getVocabCourse(courseId) {
  return VOCAB_COURSES.find((c) => c.id === courseId);
}

// word id -> unit, built once from the manifest — needed to open a word's
// detail screen without already knowing which unit it's in (search, and any
// cross-unit pool), same role as kanjiUnitFor in kanji.js.
const unitByWord = new Map();
Object.entries(VOCAB_UNITS).forEach(([unit, ids]) => {
  ids.forEach((id) => unitByWord.set(id, unit));
});
export function vocabUnitFor(id) {
  return unitByWord.get(id) || null;
}

const loadedUnits = new Set();
const loadingUnits = new Map(); // unit -> in-flight Promise, dedupes concurrent callers

/** Loads one unit's real per-word data and fills its course's `.index` Map
 * in place. Memoized — see ensureKanjiUnitLoaded in kanji.js, which this
 * mirrors exactly. */
export async function ensureVocabUnitLoaded(unit) {
  if (loadedUnits.has(unit)) return;
  if (!loadingUnits.has(unit)) {
    loadingUnits.set(unit, import(`./data/vocab-${unit}.js`).then((mod) => {
      const course = getVocabCourse(`vocab-${unit}`);
      mod.VOCAB_ENTRIES.forEach((entry) => course.index.set(entry.id, entry));
      loadedUnits.add(unit);
    }));
  }
  await loadingUnits.get(unit);
}

export function areAllVocabUnitsLoaded() {
  return VOCAB_COURSES.every((c) => loadedUnits.has(c.unit));
}

export function vocabInfo(course, id) {
  return course.index.get(id);
}

function shuffle(array) {
  const out = [...array];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Options for a Meaning-mode stage-1 question: one correct English label
 * (vocab-plan.md §5.1 — already length-capped at build time) plus
 * distractors from other words in the same unit. Same-part-of-speech
 * candidates are tried first (§5.5 — a verb among nouns is the answer by
 * shape alone), falling back to the rest of the unit if there aren't
 * enough. Single-answer, like kanji Definition, so this returns
 * {options, answer} rather than a correct Set.
 */
export function buildMeaningChoices(course, wordId, count = DEFINITION_OPTIONS) {
  const info = vocabInfo(course, wordId);
  const answer = info.en[0];
  const used = new Set([answer]);
  const options = [answer];

  const pool = [...course.index.values()].filter((e) => e.id !== wordId);
  const bySamePos = shuffle(pool.filter((e) => e.pos === info.pos));
  const rest = shuffle(pool.filter((e) => e.pos !== info.pos));

  for (const entry of [...bySamePos, ...rest]) {
    if (options.length >= count) break;
    const label = entry.en[0];
    if (!label || used.has(label)) continue;
    used.add(label);
    options.push(label);
  }

  return { options: options.sort((a, b) => a.localeCompare(b)), answer };
}

/**
 * Character offsets, within a word's own kana reading, of the segment each
 * kanji position contributes — derived from `w` + `ruby` by walking the
 * surface and accumulating (a kana character contributes itself, a kanji
 * contributes its ruby segment). This is the runtime half of the split
 * build_ruby did at build time; returns null if the walk doesn't
 * reconstruct the reading exactly, i.e. the two disagree.
 */
function readingSpans(info) {
  if (!info.ruby) return null;
  const rubyByPos = new Map(info.ruby.map((r) => [r[0], r[1]]));
  const spans = new Map();
  let off = 0;
  [...info.w].forEach((ch, pos) => {
    const kana = rubyByPos.get(pos);
    if (kana === undefined) { off += [...ch].length; return; }
    spans.set(pos, [off, off + [...kana].length]);
    off += [...kana].length;
  });
  return off === [...info.r].length ? spans : null;
}

/**
 * Whether a wrong reading is still consistent with the furigana the learner
 * can SEE — that is, whether it differs from the correct reading only
 * inside a span whose furigana is hidden. build_mis splices exactly one
 * position and leaves the rest of the reading untouched, so "differs only
 * inside span [s, e)" is exactly "agrees on the leading s characters and on
 * the trailing (length - e)". Note the trailing run is matched from the END
 * of each string, since a substituted segment can change the word's length
 * and shift everything after it along.
 */
function variesOnlyWhereHidden(correct, candidate, spans, hidden) {
  for (const pos of hidden) {
    const span = spans.get(pos);
    if (!span) continue;
    const [start, end] = span;
    const tail = correct.length - end;
    if (candidate.length - tail < start) continue;
    const headOk = correct.slice(0, start).join('') === candidate.slice(0, start).join('');
    const tailOk = correct.slice(end).join('') === candidate.slice(candidate.length - tail).join('');
    if (headOk && tailOk) return true;
  }
  return false;
}

/**
 * Options for the Meaning-mode yomi follow-up (§5.4): the word's own kana
 * reading plus up to 5 wrong ones, built at quiz time from `mis` (the
 * build-time-generated near-miss readings — see build_vocab_data.py's
 * build_mis). If `mis` didn't leave enough after dedup (a word with few
 * alternate kanji readings), the pool is topped up with OTHER words'
 * readings from the same unit — weaker distractors, but only reached when
 * the good ones run out, per vocab-plan.md §5.4.
 *
 * `hidden` is the reveal ladder's set of kanji positions whose furigana is
 * NOT on screen (null when the whole word's furigana is hidden, e.g. a
 * jukujikun word in `whole` mode). Whenever some furigana IS on screen, the
 * options must every one of them agree with it: 質問 shown as 質[しつ]問
 * only genuinely asks how 問 is read, so an option like じつもん or ちもん
 * is eliminated by a glance rather than by knowing anything, and a whole
 * screen of them turns a six-way question into a two-way one. So the pool
 * is filtered to candidates that vary only where the learner can't see, and
 * the cross-word top-up is skipped entirely — another word's reading has no
 * reason to match the visible furigana either. That can leave very few
 * options; the caller decides whether what's left is still worth asking.
 */
export function buildYomiChoices(course, wordId, hidden = null) {
  const info = vocabInfo(course, wordId);
  const correct = info.r;
  const spans = hidden ? readingSpans(info) : null;
  const anyVisible = spans ? [...spans.keys()].some((pos) => !hidden.has(pos)) : false;

  let pool = info.mis || [];
  if (anyVisible) {
    const chars = [...correct];
    pool = pool.filter((m) => variesOnlyWhereHidden(chars, [...m], spans, hidden));
  }

  const options = new Set([correct]);
  shuffle(pool).forEach((reading) => {
    if (options.size < YOMI_OPTIONS) options.add(reading);
  });
  if (!anyVisible && options.size < YOMI_OPTIONS) {
    shuffle([...course.index.values()]).forEach((entry) => {
      if (options.size < YOMI_OPTIONS && entry.id !== wordId) options.add(entry.r);
    });
  }
  return { options: shuffle([...options]), answer: correct };
}

// --- Pronunciation: romaji's literal-per-kana spelling can mislead ---------
//
// The app's ordinary romaji (wanakana's toRomaji, used everywhere — kana
// quizzes, writing prompts, the reveal ladder's own romaji rung) is a
// SPELLING system: は is always "ha", づ is always "du", a long vowel is two
// separate letters. That is deliberate and must stay exactly as it is
// everywhere else — the kana quiz literally grades typing "ha" for は. But
// used as a "how do I SAY this" hint on a whole word, it is sometimes wrong
// in a way a beginner has no way to catch themselves:
//
// - こんばんは spells with は but is SAID "konbanwa" — は as a fossilised
//   topic particle (今晩は, "as for tonight...") is pronounced わ, same as
//   the grammatical particle は always is. This can't be derived from the
//   kana alone (づ、ば etc are always literal); it is a closed, small set of
//   known words, kept in PRONUNCIATION_OVERRIDES below rather than guessed.
// - とう/こう/おおきい etc are said with a genuinely long vowel, which
//   standard romaji spells as two letters ("tou", "ookii") rather than a
//   macron ("tō", "ōkii"). This one IS derivable from the kana, mora by
//   mora — see mergesLongVowel below.
//
// pronunciationFor() is used ONLY for the vocab hint shown once a learner
// has tapped past furigana to romaji (vocab-plan.md §5.2) — never for
// anything graded, and never as a replacement for the literal romaji
// elsewhere, which teaches the (entirely real, entirely necessary) spelling
// convention instead.

// A handful of words whose reading is written with は/へ/を functioning as a
// fossilised grammatical particle, pronounced わ/え/お rather than literally.
// Add to this as new words surface it — there is no way to detect it from
// the kana alone (べつ, 母 etc all read は literally, correctly).
const PRONUNCIATION_OVERRIDES = {
  こんにちは: 'こんにちわ',
  こんばんは: 'こんばんわ',
};

// Every hiragana character's own vowel sound, small combining kana
// (きゃ/きゅ/きょ and the katakana-loanword ぁぃぅぇぉ) included — needed to
// track which vowel a long-vowel mark (or an おう-type sequence) is actually
// extending. ん and っ carry no vowel of their own (absent below), which is
// exactly right: neither can ever be immediately followed by a genuine long
// vowel mark in real Japanese, so the gap never needs special-casing.
const VOWEL_GROUPS = {
  a: 'あかがさざただなはばぱまやらわゃぁ',
  i: 'いきぎしじちぢにひびぴみりゐぃ',
  u: 'うくぐすずつづぬふぶぷむゆるゅぅ',
  e: 'えけげせぜてでねへべぺめれゑぇ',
  o: 'おこごそぞとどのほぼぽもよろをょぉ',
};
const VOWEL_OF = {};
Object.entries(VOWEL_GROUPS).forEach(([vowel, chars]) => {
  [...chars].forEach((ch) => { VOWEL_OF[ch] = vowel; });
});
const MACRON = { a: 'ā', i: 'ī', u: 'ū', e: 'ē', o: 'ō' };

/**
 * Whether `ch`, coming right after a mora whose vowel was `prevVowel`,
 * lengthens it into a macron. Deliberately narrower than every vowel
 * sequence that COULD be pronounced long: い+い (いい) and え+い (せんせい)
 * are left as plain "ii"/"ei" because that is how virtually every
 * romanization convention actually renders them, and a macron there would
 * read as unfamiliar rather than helpful to anyone who has seen romaji
 * before. お+う and お+お (both genuinely common — とう, おおきい) and う+う,
 * あ+あ, え+え are merged, and the katakana prolonged-sound mark ー always
 * lengthens whatever vowel precedes it (コーヒー).
 */
function mergesLongVowel(prevVowel, ch) {
  if (ch === 'ー') return prevVowel !== null;
  if (ch === 'う') return prevVowel === 'u' || prevVowel === 'o';
  if (ch === 'あ') return prevVowel === 'a';
  if (ch === 'え') return prevVowel === 'e';
  if (ch === 'お') return prevVowel === 'o';
  // い deliberately never merges (いい, せんせい's えい both stay as two
  // plain letters) — see the docstring above.
  return false;
}

/** A pronunciation hint for a hiragana reading — see the module note above.
 * Returns null when it would be IDENTICAL to the plain romaji, so the
 * caller can skip showing a redundant second line. */
export function pronunciationFor(reading) {
  const plain = toRomaji(reading);
  const kana = PRONUNCIATION_OVERRIDES[reading] || reading;

  let out = '';
  let segmentStart = 0;
  let lastVowel = null;
  for (let i = 0; i < kana.length; i += 1) {
    const ch = kana[i];
    if (mergesLongVowel(lastVowel, ch)) {
      const segment = toRomaji(kana.slice(segmentStart, i));
      out += segment ? segment.slice(0, -1) + MACRON[lastVowel] : MACRON[lastVowel];
      segmentStart = i + 1;
      continue;
    }
    lastVowel = VOWEL_OF[ch] || null;
  }
  out += toRomaji(kana.slice(segmentStart));

  return out === plain ? null : out;
}
