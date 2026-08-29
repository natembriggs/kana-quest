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
// Below this a yomi question isn't worth asking: two options is a coin flip
// and one is no question at all. Not a skip threshold — it's the test for
// whether showing only SOME of a word's furigana can be asked about, and a
// word that fails it has its furigana hidden entirely instead. See
// partialFuriganaIsAskable.
export const MIN_YOMI_OPTIONS = 3;

const KANJI_RE = /[㐀-䶿一-鿿]/;

/** Whether a word's surface form contains any kanji at all — a pure-kana
 * word skips the furigana rung of the reveal ladder entirely and goes
 * straight to romaji (vocab-plan.md §5.2). */
export function wordHasKanji(word) {
  return KANJI_RE.test(word);
}

/** How many kanji a surface form contains — used to prefer distractors of
 * the same shape as the word being asked about (see buildYomiChoices). */
function countKanji(word) {
  return [...word].filter((ch) => KANJI_RE.test(ch)).length;
}

/**
 * "C" for the Core group, "H" for a Higher-tier unit regardless of its own
 * theme (vocab-plan.md §2.1/phase 6 — a theme's 'h' words are their own
 * unit, "2.4h", but browse under one shared "Common words 2" group rather
 * than sitting inside 2's group next to 2.4 itself — the same shape kanji's
 * secondary-school sub-units already use, one tap-away group rather than
 * interleaved grade by grade), else the numeral before the dot ("1" for
 * "1.4"). Checked before the Core test only because it's cheap to check
 * first; Core never has an 'h' unit (build_vocab_data.py never emits one).
 * Matches KANJI_UNIT_GROUPS' role in app.js but the grouping is baked into
 * the unit id itself here, so no separate test table is needed. */
function unitGroup(unit) {
  if (unit.endsWith('h')) return 'H';
  return unit.startsWith('C') ? 'C' : unit.split('.')[0];
}

/** Core first, then group 1..5 in theme order, then every Higher-tier unit
 * last as one block (sub-unit numerically within each group) — VOCAB_UNITS
 * is already written in this order (Python dict insertion order survives
 * into JSON, and build_vocab_data.py emits 'f' units before any 'h' one),
 * but sorting explicitly here means this keeps working if a future build
 * ever writes the manifest in a different order. */
function compareUnits(a, b) {
  const ga = unitGroup(a);
  const gb = unitGroup(b);
  if (ga !== gb) {
    if (ga === 'C') return -1;
    if (gb === 'C') return 1;
    if (ga === 'H') return 1;
    if (gb === 'H') return -1;
    return ga.localeCompare(gb, undefined, { numeric: true });
  }
  return a.localeCompare(b, undefined, { numeric: true });
}

/**
 * "2.4h" describes the exact same theme as "2.4" — just the rarer-word
 * tile — so it has no label of its own in VOCAB_UNIT_LABELS; the trailing
 * 'h' is stripped before lookup rather than the build script duplicating
 * every theme's description under a second key. Whatever tells the learner
 * they're looking at the Higher tile is the group context around this
 * label (the "Common words 2" chip, or unitGroupLabel() below), not the
 * label text itself — same as a kanji grade card doesn't repeat "Primary
 * school" inside its own title.
 */
export function unitLabel(unit) {
  const base = unit.endsWith('h') ? unit.slice(0, -1) : unit;
  return VOCAB_UNIT_LABELS[base] || base;
}

export function unitGroupLabel(unit) {
  return VOCAB_GROUP_LABELS[unitGroup(unit)] || unitGroup(unit);
}

/** The short badge text for a unit tile ("2.4" either way) — inside the
 * "Common words 2" group there is no longer any "2.4" to collide with
 * (its Foundation sibling lives in a different group entirely), so the
 * trailing 'h' would only add noise. */
export function unitBadge(unit) {
  return unit.endsWith('h') ? unit.slice(0, -1) : unit;
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

// Surface form -> every id sharing it — almost always exactly one, except
// the single homograph collision above (§3.3) — so a kanji detail page's own
// "common words" list (kanji.js's own JMdict-derived word list, built
// independently of this file's separate frequency-based curriculum) can
// check whether one of ITS words is also something taught here, without
// loading a single vocab unit just to find out.
const idsBySurface = new Map();
unitByWord.forEach((_unit, id) => {
  const surface = id.split('|')[0];
  if (!idsBySurface.has(surface)) idsBySurface.set(surface, []);
  idsBySurface.get(surface).push(id);
});

/**
 * The vocab word id matching a {kanji, kana} pair from elsewhere in the app,
 * or null if that exact word isn't part of the taught vocab curriculum at
 * all. Disambiguates the one homograph collision (市場) by kana; an
 * unmatched kana on an ambiguous surface falls back to the first id, which
 * only ever affects that single pair.
 */
export function vocabIdForWord(kanji, kana) {
  const candidates = idsBySurface.get(kanji);
  if (!candidates) return null;
  if (candidates.length === 1) return candidates[0];
  return candidates.find((id) => id.endsWith(`|${kana}`)) || candidates[0];
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

// --- Glosses: senses, labels, and overlap (vocab-plan.md §5.6) -------------
//
// `en` is every kept sense's glosses flattened in sense order, and `sn` — when
// present — is the size of each sense group, so the flat list reads back as
// groups. A word with one sense has no `sn` at all (the build script omits it
// rather than shipping a one-element array 536 times), which is why every
// reader here defaults to "one group of everything".
//
// どうして is the word that forced this: its everyday meaning is "why", but
// that lives in JMdict's SECOND sense, and the build script only ever read the
// first — so a learner who knew the word perfectly was shown four options none
// of which said "why". See §5.6.

/** A gloss as it should be SHOWN and COMPARED: JMdict's bracketed asides
 * ("which one (esp. of two alternatives)", "(of a person) tall") are
 * disambiguation for a dictionary reader, not part of the translation, and on
 * a quiz button they are the difference between a label that fits and one that
 * wraps to four lines. Dropped from both ends; an interior one ("to make (a
 * hole)") is left alone, since removing it strands the sentence. */
function normGloss(gloss) {
  return gloss
    .replace(/^\s*\([^()]*\)\s*/, '')
    .replace(/\s*\([^()]*\)\s*$/, '')
    .trim() || gloss.trim();
}

/**
 * A word's glosses grouped back into their senses, normalised and deduped —
 * [["why", "for what reason"], ["how", "in what way"]]. Deduping matters after
 * normalisation, which can collapse two genuinely distinct dictionary glosses
 * ("to open (a door)" / "to open (for business)") into one word; showing that
 * word twice on the same button reads as a mistake.
 */
export function glossSenses(info) {
  const sizes = info.sn || [info.en.length];
  const seen = new Set();
  const groups = [];
  let at = 0;
  for (const size of sizes) {
    const group = [];
    for (const raw of info.en.slice(at, at + size)) {
      const g = normGloss(raw);
      const key = g.toLowerCase();
      if (!g || seen.has(key)) continue;
      seen.add(key);
      group.push(g);
    }
    at += size;
    if (group.length) groups.push(group);
  }
  return groups.length ? groups : [[info.en[0]]];
}

/** Every normalised gloss a word has, lowercased — the key set both exclusion
 * rules compare on (§5.6). Normalised, not raw: "to open (a door, etc.)" and
 * "to open (for business)" are different strings and the same button, and
 * comparing the raw forms misses exactly the pairs that make a question
 * unanswerable. */
export function glossKeys(info) {
  return new Set(glossSenses(info).flat().map((g) => g.toLowerCase()));
}

// Roughly two lines of a full-width choice button at 16px — see §5.6. The
// build script's own MEANING_LABEL_MAX (45) caps a SINGLE gloss; this caps the
// whole multi-sense label, so it has to be the larger of the two.
const LABEL_BUDGET = 52;
const SENSE_SEP = ' / ';
const GLOSS_SEP = ', ';

function renderLabel(groups) {
  return groups.map((g) => g.join(GLOSS_SEP)).join(SENSE_SEP);
}

/**
 * The English label for a word on a quiz button or as a Recall prompt
 * (§5.6): the first gloss of EVERY sense, then as many extra within-sense
 * glosses as the budget allows.
 *
 * Sense heads come first and are never traded away for a second gloss of an
 * earlier sense, because they are the whole point — the learner whose mind
 * jumps to "why" for どうして has to find "why" on the button, and the "how,
 * in what way" beside it is the context that says these are one word. Only if
 * the heads ALONE overflow does a trailing sense get dropped, and never below
 * one.
 */
export function wordMeaningLabel(info) {
  const senses = glossSenses(info);
  let heads = senses.map((s) => [s[0]]);
  while (heads.length > 1 && renderLabel(heads).length > LABEL_BUDGET) heads.pop();

  const picked = heads.map((h) => [...h]);
  // Round-robin by gloss index, not sense by sense: with a tight budget the
  // second gloss of sense 1 and of sense 2 are worth the same, and taking
  // them in that order shares the room out instead of spending it all on the
  // first sense.
  const deepest = Math.max(...senses.slice(0, picked.length).map((s) => s.length));
  for (let i = 1; i < deepest; i += 1) {
    for (let s = 0; s < picked.length; s += 1) {
      const gloss = senses[s][i];
      if (!gloss) continue;
      picked[s].push(gloss);
      if (renderLabel(picked).length > LABEL_BUDGET) picked[s].pop();
    }
  }
  return renderLabel(picked);
}

/**
 * A word's full meaning for a detail or lesson screen (§5.6): every gloss,
 * senses separated by " · " and glosses within a sense by ", ".
 *
 * Unlike wordMeaningLabel this keeps the RAW glosses, brackets and all, and
 * has no budget. A quiz button is a label and wants "which one"; a detail
 * screen is exactly where "which one (esp. of two alternatives)" earns its
 * keep, and there is room for it.
 */
export function wordGlossSummary(info) {
  const sizes = info.sn || [info.en.length];
  const groups = [];
  let at = 0;
  for (const size of sizes) {
    const group = info.en.slice(at, at + size);
    at += size;
    if (group.length) groups.push(group.join(', '));
  }
  return groups.join(' · ');
}

/**
 * Options for a Meaning-mode stage-1 question: one correct English label
 * (vocab-plan.md §5.6 — every sense the word has, budgeted) plus distractors
 * from other words in the same unit. Same-part-of-speech candidates are tried
 * first (§5.5 — a verb among nouns is the answer by shape alone), falling back
 * to the rest of the unit if there aren't enough. Single-answer, like kanji
 * Definition, so this returns {options, answer} rather than a correct Set.
 *
 * The gloss-overlap exclusion is the mirror of readingsSharingGloss on the
 * Recall side (§6.1), which has guarded this since phase 4 while this
 * direction went without: an entry sharing ANY gloss with the answer word is
 * never offered, because どう ("how") against どうして ("how") is not a hard
 * question, it is an unanswerable one. Deduping on the label string alone —
 * all this used to do — misses it, since the two labels differ in every part
 * except the one that matters.
 *
 * A unit that can't spare `count` safe distractors returns fewer options
 * rather than relaxing the rule; a three-way question is still a question.
 */
export function buildMeaningChoices(course, wordId, count = DEFINITION_OPTIONS) {
  const info = vocabInfo(course, wordId);
  const answer = wordMeaningLabel(info);
  const banned = glossKeys(info);
  const used = new Set([answer]);
  const options = [answer];

  const pool = [...course.index.values()]
    .filter((e) => e.id !== wordId && ![...glossKeys(e)].some((g) => banned.has(g)));
  const bySamePos = shuffle(pool.filter((e) => e.pos === info.pos));
  const rest = shuffle(pool.filter((e) => e.pos !== info.pos));

  for (const entry of [...bySamePos, ...rest]) {
    if (options.length >= count) break;
    const label = wordMeaningLabel(entry);
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
 * The `mis` candidates usable against a given hidden set, and whether any
 * furigana is on screen at all. Shared by buildYomiChoices and the display
 * decision that precedes it, so the two can't drift apart.
 *
 * Whenever some furigana IS visible, every option has to agree with it:
 * 質問 shown as 質[しつ]問 only genuinely asks how 問 is read, so an option
 * like じつもん or ちもん is eliminated by a glance rather than by knowing
 * anything, and a screenful of them turns a six-way question into a two-way
 * one. So the pool drops to candidates that vary only where the learner
 * can't see.
 */
function usablePool(info, hidden) {
  const spans = hidden ? readingSpans(info) : null;
  const anyVisible = spans ? [...spans.keys()].some((pos) => !hidden.has(pos)) : false;
  const mis = info.mis || [];
  if (!anyVisible) return { pool: mis, anyVisible };
  const chars = [...info.r];
  return { pool: mis.filter((m) => variesOnlyWhereHidden(chars, [...m], spans, hidden)), anyVisible };
}

/**
 * Whether showing this word with only SOME of its furigana leaves enough
 * agreeing distractors to ask a real yomi question with (§5.4). When it
 * doesn't — 曜 in 月曜日 has no alternate reading worth offering, so hiding
 * it alone yields one usable option — the caller hides the word's furigana
 * entirely instead, which costs nothing (the learner can still tap to
 * reveal) and puts every `mis` candidate, plus the cross-word top-up, back
 * in play. Hiding more is always askable; hiding a little sometimes isn't.
 */
export function partialFuriganaIsAskable(info, hidden) {
  return usablePool(info, hidden).pool.length >= MIN_YOMI_OPTIONS - 1;
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
 * jukujikun word in `whole` mode) — see usablePool for what that does to
 * the candidates. The cross-word top-up only runs when nothing is visible,
 * both because another word's reading has no reason to match the furigana
 * on screen and because, by the time a partly-shown word gets here,
 * partialFuriganaIsAskable has already confirmed its own pool is deep
 * enough not to need topping up.
 */
export function buildYomiChoices(course, wordId, hidden = null) {
  const info = vocabInfo(course, wordId);
  const correct = info.r;
  const { pool, anyVisible } = usablePool(info, hidden);

  const options = new Set([correct]);
  shuffle(pool).forEach((reading) => {
    if (options.size < YOMI_OPTIONS) options.add(reading);
  });
  if (!anyVisible && options.size < YOMI_OPTIONS) {
    // §5.4's "close in length" fallback. With no furigana on screen any
    // wrong reading is at least a fair option, but one of visibly the wrong
    // shape — three kanji where the question shows two — is still answerable
    // without reading it, so prefer the same kanji count first and a similar
    // number of kana second. Shuffled before sorting, so equally-good
    // candidates don't always come out in unit order.
    const targetKanji = countKanji(info.w);
    const targetLen = [...correct].length;
    const nearness = (entry) => [
      Math.abs(countKanji(entry.w) - targetKanji),
      Math.abs([...entry.r].length - targetLen),
    ];
    shuffle([...course.index.values()])
      .filter((entry) => entry.id !== wordId)
      .sort((a, b) => {
        const [ak, al] = nearness(a);
        const [bk, bl] = nearness(b);
        return (ak - bk) || (al - bl);
      })
      .forEach((entry) => {
        if (options.size < YOMI_OPTIONS) options.add(entry.r);
      });
  }
  return { options: shuffle([...options]), answer: correct };
}

// --- Recall: English -> Japanese (vocab-plan.md §6) ------------------------

const RECALL_OPTIONS = 6; // §6.1/§6.2 — short kana/kanji labels, same count as the yomi stage
const MIN_SPELLING_OPTIONS = 3; // §6.4's fallback ladder floor — below this the stage is skipped

/**
 * Every reading in `course` that would also correctly answer the English
 * prompt built from `answerInfo` (vocab-plan.md §6.1: "never an option that
 * is also a correct answer to the prompt" — e.g. 電車 and 列車 both glossing
 * "train"). A whole READING is excluded, not just the specific entry that
 * shares the gloss: 食料 and 食糧 are two different dictionary entries that
 * happen to share the one reading しょくりょう, and only 食料 glosses "food"
 * the same way 食品 does — but offering しょくりょう at all is still offering
 * a string that reads as a correct answer, regardless of which entry the
 * code thinks it "means". Checked against every gloss on both sides, and on
 * the NORMALISED form (glossKeys, §5.6) — a synonym pair need not agree on
 * which gloss comes first, nor on which bracketed aside the dictionary hung
 * off the end of it.
 *
 * This got stricter for free when §5.6 widened `en` to every sense: どちら
 * glosses "who" now, so 誰 can no longer be offered against it.
 */
function readingsSharingGloss(course, answerInfo) {
  const glosses = glossKeys(answerInfo);
  const unsafe = new Set();
  course.index.forEach((e) => {
    if (e.id !== answerInfo.id && [...glossKeys(e)].some((g) => glosses.has(g))) unsafe.add(e.r);
  });
  return unsafe;
}

/**
 * Options for Recall stage 1 — pick the kana (§6.1): the word's own reading,
 * always kana even for a kanji word (producing the word means recalling
 * でんしゃ, not recognising 電車), plus 5 distractors from the same unit.
 * Ranked by confusability — sharing the first mora, then closest in length —
 * per §6.1's "sharing the first mora... is better than random". Two hard
 * exclusions: no duplicate kana string (homographs like はし/はし — bridge vs
 * chopsticks — would make the question unanswerable) and no option whose
 * reading is also a correct answer to the English prompt (readingsSharingGloss
 * above).
 */
export function buildRecallChoices(course, wordId, count = RECALL_OPTIONS) {
  const info = vocabInfo(course, wordId);
  const answer = info.r;
  const firstMora = [...answer][0];
  const targetLength = [...answer].length;
  const unsafeReadings = readingsSharingGloss(course, info);

  const pool = shuffle([...course.index.values()])
    .filter((e) => e.id !== wordId && !unsafeReadings.has(e.r));
  const ranked = pool.sort((a, b) => {
    const aClose = [...a.r][0] === firstMora ? 0 : 1;
    const bClose = [...b.r][0] === firstMora ? 0 : 1;
    if (aClose !== bClose) return aClose - bClose;
    return Math.abs([...a.r].length - targetLength) - Math.abs([...b.r].length - targetLength);
  });

  const options = [answer];
  const used = new Set([answer]);
  for (const entry of ranked) {
    if (options.length >= count) break;
    if (used.has(entry.r)) continue;
    used.add(entry.r);
    options.push(entry.r);
  }
  return { options: shuffle(options), answer };
}

/**
 * Whether Recall stage 2 (the spelling stage) applies to this word at all,
 * structurally — a kana-only word has no spelling to pick between, and a
 * `uk` word's kanji spelling exists but nobody uses it (vocab-plan.md §3.3),
 * so testing it would be testing trivia rather than the word. This is only
 * the structural half of the gate; the caller also requires at least one of
 * the word's kanji to be under study in some mode (§6.2), which needs the
 * study list vocab.js doesn't have access to.
 */
export function recallHasSpellingStage(info) {
  return wordHasKanji(info.w) && !info.uk;
}

/**
 * Options for Recall stage 2 — pick the kanji spelling (§6.2/§6.3/§6.4),
 * from the `sp` pool `build_vocab_data.py` generated (up to 16 candidates,
 * every one already confirmed at build time not to be a real JMdict word).
 *
 * `masteryOf(kanji)` reports a 0-4 tier (srs.js's masteryTier, read off that
 * kanji's own Definition record) for one character — vocab.js has no
 * profile to read, so the caller supplies this rather than vocab.js
 * reaching into app state itself.
 *
 * The mastered-kanji exclusion runs first and is absolute (§6.4): a
 * candidate containing any kanji at masteryOf(k) === 4 is dropped entirely,
 * never merely deprioritised — offering it would let the question be
 * answered by recognising the ANSWER's kanji as "the familiar one" rather
 * than by knowing the spelling. What survives is then ORDERED, not just
 * filtered, to close the trap that opens right behind that rule: a kanji
 * met but not yet mastered looks exactly as familiar as the answer's own
 * kanji and can't be eliminated by that same "which looks familiar" shortcut,
 * so those candidates come first; a kanji never met at all is weaker but
 * still fair, and comes second.
 *
 * Returns null once the fallback ladder (6 -> 4 -> 3 options) still can't
 * clear MIN_SPELLING_OPTIONS after the exclusion — the caller skips the
 * stage entirely rather than serving a giveaway question, per §6.4.
 */
export function buildSpellingChoices(course, wordId, masteryOf, count = RECALL_OPTIONS) {
  const info = vocabInfo(course, wordId);
  const answer = info.w;

  const survivors = shuffle(info.sp || [])
    .map((spelling) => {
      const tiers = [...spelling].filter((ch) => KANJI_RE.test(ch)).map(masteryOf);
      const mastered = tiers.some((t) => t >= 4);
      const met = tiers.some((t) => t >= 1 && t <= 3);
      return { spelling, mastered, met };
    })
    .filter((c) => !c.mastered)
    .sort((a, b) => Number(b.met) - Number(a.met))
    .map((c) => c.spelling);

  for (const target of [count, 4, MIN_SPELLING_OPTIONS]) {
    const need = target - 1;
    if (survivors.length >= need) {
      return { options: shuffle([answer, ...survivors.slice(0, need)]), answer };
    }
  }
  return null;
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
