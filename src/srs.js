// Spaced repetition: Leitner boxes, plus the rule that decides when a new
// chunk of characters is allowed to be introduced.
//
// Every grading event is appended to the item's history as [timestamp, 0|1].
// The box is a derived convenience; the history is the real record, so the
// scheduling algorithm can be replaced later without losing what a learner
// has actually done.

const DAY_MS = 24 * 60 * 60 * 1000;

// Box 0 means "ask again in this same session".
export const BOX_INTERVALS_DAYS = [0, 1, 2, 4, 8, 16, 32];
export const MAX_BOX = BOX_INTERVALS_DAYS.length - 1;

// A character that has reached the top box and has *never once* been missed
// keeps having its interval doubled rather than settling at 32 days forever.
// This matters most for a kid who already knew some characters coming in —
// something they have answered right every single time should fade out of
// review almost entirely, not keep eating a review slot every month.
// The moment a character is missed, lapses > 0 and this growth stops; it
// goes back to the ordinary box schedule like anything else being learned.
const NEVER_MISSED_GROWTH = 2;
const NEVER_MISSED_CAP_DAYS = 180;

// When this fraction of the current set has reached BOX_SETTLED, the set is
// considered consolidated. This only drives a suggestion — the learner
// decides when to take on more, it is never enforced.
const FRACTION_SETTLED = 0.8;
const BOX_SETTLED = 2;

// Keep history bounded so a profile document cannot grow without limit.
const MAX_HISTORY = 300;

// `kinds` is which course types a mode applies to: kana has no English
// definition to quiz, so Definition is offered for kanji only.
//
// The middle mode is the same activity either way — "what sound does this
// make" — but it is called Reading for kana and Yomi for kanji, so the label
// and hint are per-kind.
export const MODES = {
  definition: {
    id: 'definition',
    kinds: ['kanji'],
    name: { kanji: 'Definition' },
    hint: { kanji: 'See the kanji, tap what it means' },
  },
  recognition: {
    id: 'recognition',
    kinds: ['kana', 'kanji'],
    name: { kana: 'Reading', kanji: 'Yomi' },
    hint: {
      kana: 'See the character, tap the sound',
      kanji: 'See the kanji, tap every reading that applies',
    },
  },
  writing: {
    id: 'writing',
    kinds: ['kana', 'kanji'],
    name: { kana: 'Writing', kanji: 'Writing' },
    hint: {
      kana: 'See the sound, draw the character',
      kanji: 'See the readings and meaning, draw the kanji',
    },
  },
  // Vocabulary (vocab-plan.md §4.2): the picker shows just these two, but
  // FOUR key prefixes actually get graded — vdef/vyomi under vmeaning,
  // vprod/vspell under vrecall (see itemKey/VOCAB_SUBKEYS below). Neither
  // vdef/vyomi/vprod/vspell is itself a MODES entry: they never drive a mode
  // picker or course scheduling directly, only individual answers: See
  // recomputeVocabRollup for how they roll up into the itemKey('vmeaning'/
  // 'vrecall', word) record that dueItems/courseStats/etc. actually read.
  vmeaning: {
    id: 'vmeaning',
    kinds: ['vocab'],
    name: { vocab: 'Meaning' },
    hint: { vocab: 'See the word, tap what it means' },
  },
  // Recall (English -> Japanese, vocab-plan.md §6): stage 1 (vprod) always
  // runs; stage 2 (vspell) only when the word has kanji, isn't a `uk` word,
  // and at least one of its kanji is under study — see
  // renderVocabRecallQuestion() in app.js.
  vrecall: {
    id: 'vrecall',
    kinds: ['vocab'],
    name: { vocab: 'Recall' },
    hint: { vocab: 'See the English, tap the Japanese' },
  },
};

export function modesForKind(kind) {
  return Object.values(MODES).filter((m) => m.kinds.includes(kind));
}

/** Whether a mode is available for a given kind right now — comingSoon is
 * per-kind (kana writing shipped before kanji writing did). */
export function isModeComingSoon(mode, kind) {
  return !!(mode.comingSoon && mode.comingSoon[kind]);
}

export function modeName(modeId, kind) {
  return MODES[modeId].name[kind];
}

export function modeHint(modeId, kind) {
  return MODES[modeId].hint[kind];
}

/**
 * The mode to open a script on: whenever the current one doesn't apply, and
 * whenever a script is opened fresh from a different kind. Definition first
 * for kanji, Reading (recognition) for kana — kana has no Definition, so this
 * ordering is a no-op there.
 */
export function defaultModeForKind(kind) {
  const usable = modesForKind(kind).filter((m) => !isModeComingSoon(m, kind));
  for (const id of ['definition', 'recognition']) {
    const found = usable.find((m) => m.id === id);
    if (found) return found.id;
  }
  return usable[0].id;
}

export function itemKey(mode, kana) {
  return `${mode}:${kana}`;
}

// --- Study list -----------------------------------------------------------
//
// Which kanji the learner has actually chosen to work on, and in which of the
// three modes. See kanji-expansion-plan.md §1. Before this existed, "am I
// learning this?" was answered by "does a progress record exist for it",
// which conflated intent with history and left no way to add a kanji you care
// about or drop one you don't.
//
// Kanji only, deliberately: kana courses are small, complete and taught in a
// fixed order, so an enrollment UI over 104 characters would be noise. The
// code path is shared, and kana simply behave as though everything is
// enrolled — see eligibleItems() below, which only ever filters kanji.
//
// Progress records are NEVER deleted by un-enrolling. History is the real
// record (see the module header), so dropping a kanji and picking it up again
// a month later resumes where it left off instead of starting from zero.

const KANJI_CHAR = /[㐀-䶿一-鿿]/;

export function isKanjiChar(ch) {
  return typeof ch === 'string' && ch.length > 0 && KANJI_CHAR.test(ch[0]);
}

/**
 * study[kanji][mode] is the timestamp it was enrolled; unstudy[kanji][mode]
 * is the timestamp it was deliberately dropped. At most one of the two holds
 * a given (kanji, mode) pair at a time within one profile — setStudying below
 * always removes from one map when it writes to the other. Both existing at
 * once only happens transiently while merging two profiles together, which
 * mergeStudy in merge.js resolves by keeping whichever timestamp is newer.
 *
 * This exists so un-enrolling survives a sync merge. A plain union (the
 * original model, and still what a bare array-shaped legacy entry means —
 * see isLegacyStudyShape/migrateStudyShape below) can only ever add: dropping
 * 龍 from Writing on one device would keep coming back the moment a second
 * device, still showing it enrolled, synced. See sync-plan.md §0.1.
 */

/**
 * Build a study list from existing progress keys — the one-time migration for
 * profiles saved before this field existed. Only 2-part keys are considered:
 * the yomi quiz also writes 3-part per-reading keys ("recognition:生:セイ",
 * see yomiKey below) which are not items in their own right.
 *
 * A derived entry carries no evidence of *when* it was enrolled, so it reads
 * as timestamp 0 — the same fallback isLegacyStudyShape/migrateStudyShape use
 * for an old array-shaped entry. Either way, any real, later removal beats
 * it, while it survives if nothing ever removes it.
 */
export function deriveStudyList(progress) {
  const study = {};
  for (const key of Object.keys(progress || {})) {
    const parts = key.split(':');
    if (parts.length !== 2) continue;
    const [mode, char] = parts;
    if (!isKanjiChar(char)) continue;
    if (!study[char]) study[char] = {};
    if (!(mode in study[char])) study[char][mode] = 0;
  }
  return study;
}

/** True for the pre-timestamp shape (study[kanji] an array of mode ids)
 * rather than the current one (study[kanji] a {mode: enrolledAt} object).
 * Only the first entry needs checking — a profile is migrated all at once,
 * see migrateStudyShape below, so the two shapes never mix within one. */
export function isLegacyStudyShape(study) {
  const firstKey = Object.keys(study || {})[0];
  return firstKey !== undefined && Array.isArray(study[firstKey]);
}

/** Converts a legacy array-shaped study list to the timestamped shape. Every
 * entry reads as timestamp 0 for the same reason deriveStudyList's do — a
 * plain array never recorded *when* each mode was turned on. */
export function migrateStudyShape(study) {
  const migrated = {};
  for (const [kanji, modes] of Object.entries(study || {})) {
    migrated[kanji] = {};
    modes.forEach((mode) => { migrated[kanji][mode] = 0; });
  }
  return migrated;
}

export function studyModes(study, kanji) {
  return Object.keys((study || {})[kanji] || {});
}

export function isStudying(study, kanji, mode) {
  const entry = (study || {})[kanji];
  return !!entry && Object.prototype.hasOwnProperty.call(entry, mode);
}

/**
 * Enroll or un-enroll one (kanji, mode). Mutates both `study` and `unstudy`
 * and returns `study`, so a later sync merge can see not just the current
 * state but that a removal actually happened and when (see the module note
 * above). An entry that ends up empty is deleted from its map rather than
 * left as `{}`, so "is this key present" and "is anything true of it" never
 * disagree — same rule the old array shape followed.
 */
export function setStudying(study, unstudy, kanji, mode, on, now = Date.now()) {
  if (on) {
    if (!study[kanji]) study[kanji] = {};
    study[kanji][mode] = now;
    if (unstudy && unstudy[kanji]) {
      delete unstudy[kanji][mode];
      if (Object.keys(unstudy[kanji]).length === 0) delete unstudy[kanji];
    }
  } else {
    if (study[kanji]) {
      delete study[kanji][mode];
      if (Object.keys(study[kanji]).length === 0) delete study[kanji];
    }
    if (unstudy) {
      if (!unstudy[kanji]) unstudy[kanji] = {};
      unstudy[kanji][mode] = now;
    }
  }
  return study;
}

/** Every kanji enrolled in this mode, across every course. */
export function studiedKanji(study, mode) {
  return Object.keys(study || {}).filter((k) => isStudying(study, k, mode));
}

/**
 * The scheduling functions below accept either a whole profile ({progress,
 * study}) or — as the pure tests and every pre-study-list caller do — a bare
 * progress map. A bare map means "no study list", which switches enrollment
 * filtering off entirely and reproduces the original behaviour exactly.
 */
function asContext(ctx) {
  if (ctx && ctx.progress) return { progress: ctx.progress || {}, study: ctx.study, unstudy: ctx.unstudy };
  return { progress: ctx || {}, study: undefined, unstudy: undefined };
}

export function newRecord() {
  return {
    box: 0, due: 0, intervalDays: 0, seen: 0, correct: 0, lapses: 0, history: [], updatedAt: null,
  };
}

/**
 * Apply a pass/fail result to a record. Returns the updated record.
 * A miss always drops the item to box 0 so it is re-drilled in the same
 * session, and increments `lapses` so a persistently hard character is
 * visible in the stats later.
 *
 * `placement`, when true, is a "test out" answer (kanji-expansion-plan.md
 * §placement test): a NEVER-BEFORE-SEEN item answered correctly means the
 * learner already knew it coming in, so a hit jumps straight to the top box
 * instead of climbing one box at a time like an ordinary first correct
 * answer would. A miss is graded identically either way — placement testing
 * something you don't actually know should just start it normally, at box 0,
 * the same as any other first-time miss.
 *
 * `settle`, when given ({ box, intervalDays }), is the softer "I think I
 * know this" claim from markKnownItems below: a hit lands on that box (never
 * lower than the record already is) and is scheduled exactly `intervalDays`
 * out, rather than climbing one box or jumping to the top. Only one of
 * `placement`/`settle` is ever passed; `settle` wins if both somehow are.
 */
export function grade(record, correct, now = Date.now(), { placement = false, settle = null } = {}) {
  const rec = record || newRecord();
  // newRecord() has always carried `history`, so unlike gradeYomi's matching
  // guard this isn't fixing a known-broken shape — it's holding the same
  // invariant at the other grading entry point, so an imported or
  // hand-edited profile missing the field degrades to "history starts now"
  // instead of throwing mid-answer.
  if (!Array.isArray(rec.history)) rec.history = [];
  rec.seen += 1;
  if (correct) {
    rec.correct += 1;
    if (settle) {
      rec.box = Math.min(Math.max(rec.box, settle.box), MAX_BOX);
      rec.intervalDays = settle.intervalDays;
    } else if (placement) {
      rec.box = MAX_BOX;
      rec.intervalDays = BOX_INTERVALS_DAYS[MAX_BOX];
    } else {
      const wasAtMax = rec.box >= MAX_BOX;
      rec.box = Math.min(rec.box + 1, MAX_BOX);
      if (wasAtMax && rec.lapses === 0) {
        // Perfect record, already at the top box: keep spacing it out further
        // instead of asking again every 32 days for the rest of time.
        const previous = rec.intervalDays || BOX_INTERVALS_DAYS[MAX_BOX];
        rec.intervalDays = Math.min(previous * NEVER_MISSED_GROWTH, NEVER_MISSED_CAP_DAYS);
      } else {
        rec.intervalDays = BOX_INTERVALS_DAYS[rec.box];
      }
    }
    rec.due = now + rec.intervalDays * DAY_MS;
  } else {
    rec.lapses += 1;
    rec.box = 0;
    rec.intervalDays = 0;
    rec.due = now; // immediately due again
  }
  rec.history.push([now, correct ? 1 : 0]);
  if (rec.history.length > MAX_HISTORY) {
    rec.history.splice(0, rec.history.length - MAX_HISTORY);
  }
  // Backup merging cannot rely on history length: histories are capped, and
  // Yomi records use counters rather than an event array. A common timestamp
  // gives every record type the same unambiguous "which copy is newer?"
  // signal. Old records remain compatible; store.js derives their timestamp
  // from history/lastReviewed when this field is absent.
  rec.updatedAt = now;
  return rec;
}

export function isDue(record, now = Date.now()) {
  return !!record && record.due <= now;
}

/**
 * Every character of a course that can be quizzed in this mode, in teaching
 * order. A course may exclude some items from a mode — e.g. a kanji with no
 * reading that appears in any common word has no yomi question to ask, but is
 * still taught in the other modes. See buildKanjiCourse in kanji.js.
 */
function allItems(course, mode) {
  const excluded = course.excludeForMode && course.excludeForMode[mode];
  const items = course.chunks.flatMap((chunk) => chunk.items);
  return excluded ? items.filter((item) => !excluded.has(item)) : items;
}

/**
 * Whether an item needs deliberate enrollment before it counts as eligible —
 * true for every kanji (unchanged) and, per vocab-plan.md §4.3, every vocab
 * word regardless of its own spelling. Kana courses have no study list at
 * all (see the module note above), so this never actually runs for them;
 * checking isKanjiChar alone there was fine only because a kana item could
 * never be mistaken for a word that needs gating — vocab words break that
 * assumption (食べる should gate, たべる equally should), hence the
 * course-kind check taking priority.
 */
function gatesEnrollment(course, item) {
  if (course.kind === 'vocab') return true;
  return isKanjiChar(item);
}

/**
 * allItems, further restricted to what the learner has actually enrolled —
 * the item list every scheduling decision below is made over.
 *
 * With no study list (kana, and the pure tests) this is exactly allItems.
 * With one, kanji and vocab words must be enrolled in this mode to be
 * eligible; kana are never filtered, since the study list never gates them
 * (see gatesEnrollment above).
 */
function eligibleItems(course, mode, ctx) {
  const items = allItems(course, mode);
  if (!ctx.study) return items;
  return items.filter((item) => !gatesEnrollment(course, item) || isStudying(ctx.study, item, mode));
}

/** Characters that have been introduced, i.e. have a record for this mode. */
export function introducedItems(course, mode, ctx) {
  const c = asContext(ctx);
  return eligibleItems(course, mode, c).filter((kana) => c.progress[itemKey(mode, kana)]);
}

/**
 * Enrolled but never yet taught — "waiting to learn". Manually adding a kanji
 * from the detail screen lands it here, which is what a `new` session then
 * picks up (see newItems below).
 */
export function pendingItems(course, mode, ctx) {
  const c = asContext(ctx);
  return eligibleItems(course, mode, c).filter((kana) => !c.progress[itemKey(mode, kana)]);
}

/**
 * Every item in this unit with no progress record yet, regardless of
 * enrollment — the pool a placement test ("Test unlearned") draws from.
 * Deliberately ignores the study-list gate pendingItems applies: a
 * placement test needs to reach a kanji that was never enrolled at all, not
 * just one already sitting enrolled in "waiting to learn". For kana, which
 * have no study list, this is identical to pendingItems.
 */
export function neverSeenItems(course, mode, ctx) {
  const { progress } = asContext(ctx);
  return allItems(course, mode).filter((item) => !progress[itemKey(mode, item)]);
}

// --- "Mark as known": claiming knowledge without a quiz -------------------
//
// The bulk, no-quiz counterpart of the placement test above, for a learner
// who already knows a whole unit from elsewhere (an adult picking up an app
// built for kids, a fluent reader) and shouldn't have to answer 200
// questions one at a time to say so. Two strengths of claim:
//
// - KNOWN_CLAIM_SURE: exactly what a perfect placement round would have
//   written — grade()/gradeYomi()'s `placement` option, straight to the top
//   box, back for review at the top interval.
// - KNOWN_CLAIM_THINK: "I think I know this". A self-assessment from a
//   static tile grid is trustworthy for recognition — do you know what あ
//   sounds like, what 犬 means, what 電車 means — but not for anything that
//   asks for completeness or production: a learner can know two of 生's
//   readings without noticing there are five (Yomi), and recognising a
//   character says nothing about being able to draw it (Writing; vocab
//   Recall is the same shape, English shown and the Japanese produced). So
//   those modes get this softer default: THINK_KNOWN_BOX, one tier short of
//   "well known" on masteryTier's scale, and a real double-check review a
//   week or more out. The `sure` claim stays available in those modes too,
//   as an explicit override — see isSelfAssessable and app.js's overview
//   select bar.
//
// A batch of "I think I know this" claims is deliberately NOT all scheduled
// on the same day: forty kanji marked in one tap would otherwise come due
// as one forty-card pile three weeks later — the very review pile-up the
// rest of the scheduling here works to avoid. thinkKnownOffsetDays spreads
// a batch evenly across THINK_KNOWN_WINDOW_DAYS by position in the batch,
// so it is deterministic (testable, and stable across a re-mark) rather
// than random.

export const KNOWN_CLAIM_SURE = 'sure';
export const KNOWN_CLAIM_THINK = 'think';
// Box 4: masteryTier 3 ("doing well"), the highest tier that is still short
// of the mastered one — and below MAX_BOX, so courseStats' `mastered` count
// stays honest about what was actually proven.
export const THINK_KNOWN_BOX = 4;
export const THINK_KNOWN_FIRST_DAYS = 7;
export const THINK_KNOWN_WINDOW_DAYS = 21;

// Which mode, per kind, is safe to self-assess from a glance at the item —
// the one where the question is pure recognition of the item shown.
const SELF_ASSESSABLE_MODE = { kana: 'recognition', kanji: 'definition', vocab: 'vmeaning' };

/** Whether a glance at the item is enough to claim you know it in this
 * mode — if not, "I think I know this" is the default claim and "sure" is
 * the override. See the section note above. */
export function isSelfAssessable(kind, mode) {
  return SELF_ASSESSABLE_MODE[kind] === mode;
}

/** Days from now until the `index`-th of `count` "I think I know this"
 * claims comes due: the first at THINK_KNOWN_FIRST_DAYS, the rest spread
 * evenly across the following THINK_KNOWN_WINDOW_DAYS in batch order. */
export function thinkKnownOffsetDays(index, count) {
  return THINK_KNOWN_FIRST_DAYS + Math.floor((index * THINK_KNOWN_WINDOW_DAYS) / Math.max(count, 1));
}

/** Enrollment for a claimed item, where the kind gates on it — the same
 * lazy-per-item rule ensurePlacementEnrolled (app.js) applies during a
 * placement test. A no-op for kana (no study list) and for anything already
 * enrolled. */
function enrollClaimed(course, item, mode, c, now) {
  if (!c.study || !gatesEnrollment(course, item)) return;
  if (isStudying(c.study, item, mode)) return;
  setStudying(c.study, c.unstudy || {}, item, mode, true, now);
}

/**
 * Mark `items` of `course` as known in `mode`, writing exactly the records a
 * correct placement answer (claim 'sure') or a softer self-assessment
 * (claim 'think') would leave behind, enrolling first where the kind
 * requires it. Anything the mode excludes (yōon kana in Writing, a kanji
 * with no quizzable reading in Yomi) is skipped. Returns the items actually
 * marked, in course order.
 *
 * Kanji Yomi has no flat per-kanji record — itemKey('recognition', 生) is a
 * rollup over the per-reading records (recomputeKanjiRollup in kanji.js,
 * recomputeYomiRollupFromProgress below) whose box is the LOWEST streak of
 * any reading that has a record. So a claim here writes a record for EVERY
 * quizzable reading, not just the base few a single question shows: a
 * reading left unrecorded would be introduced at streak 1 by the very next
 * ordinary question (pickBaseCorrectReadings favours never-graded readings)
 * and drag the kanji straight back down to "learning". `readingsFor(kanji)`
 * supplies that list — kanjiInfo(course, k).quizReadings, which this module
 * cannot import without a cycle, and which needs the unit's data loaded.
 *
 * A vocab mode is a rollup over two sub-keys the same way (VOCAB_SUBKEYS),
 * so both are written for the same reason — a vyomi/vspell record first
 * created at box 1 by a later session would otherwise pull a "known" word
 * back to "just started". A sub-key no question ever reaches for a given
 * word (vyomi on a kana-only word) is inert at the top box.
 */
export function markKnownItems(course, mode, ctx, items, {
  now = Date.now(), readingsFor = null, claim = KNOWN_CLAIM_SURE,
} = {}) {
  const c = asContext(ctx);
  const { progress } = c;
  const wanted = new Set(items);
  // Course order (not selection order), so a staggered batch comes due in
  // teaching order and re-marking the same set lands on the same dates.
  const batch = allItems(course, mode).filter((item) => wanted.has(item));
  const think = claim === KNOWN_CLAIM_THINK;
  const marked = [];

  batch.forEach((item, index) => {
    const intervalDays = think ? thinkKnownOffsetDays(index, batch.length) : 0;
    const leitner = think ? { settle: { box: THINK_KNOWN_BOX, intervalDays } } : { placement: true };
    const yomi = think ? { settle: { streak: THINK_KNOWN_BOX, intervalDays } } : { placement: true };

    if (course.kind === 'kanji' && mode === 'recognition') {
      const readings = readingsFor ? readingsFor(item) : [];
      if (!readings || readings.length === 0) return;
      enrollClaimed(course, item, mode, c, now);
      readings.forEach((reading) => {
        const key = yomiKey(mode, item, reading);
        progress[key] = gradeYomi(progress[key] || newYomiRecord(), true, now, yomi);
      });
      recomputeYomiRollupFromProgress(progress, mode, item, now);
    } else if (course.kind === 'vocab') {
      enrollClaimed(course, item, mode, c, now);
      VOCAB_SUBKEYS[mode].forEach((prefix) => {
        const key = itemKey(prefix, item);
        progress[key] = grade(progress[key] || newRecord(), true, now, leitner);
      });
      recomputeVocabRollup(item, mode, progress, now);
    } else {
      enrollClaimed(course, item, mode, c, now);
      const key = itemKey(mode, item);
      progress[key] = grade(progress[key] || newRecord(), true, now, leitner);
    }
    marked.push(item);
  });

  return marked;
}

/** Course items not yet enrolled at all — the pool "Add N more" draws from. */
export function unenrolledItems(course, mode, ctx) {
  const c = asContext(ctx);
  if (!c.study) return [];
  return allItems(course, mode)
    .filter((item) => gatesEnrollment(course, item) && !isStudying(c.study, item, mode));
}

/**
 * Enroll the next `limit` not-yet-enrolled kanji, in teaching order — what
 * "Add 5 more" does before running a `new` session over them. Mutates
 * `ctx.study` and returns what it enrolled.
 */
export function enrollNext(course, mode, ctx, limit = 5) {
  const c = asContext(ctx);
  if (!c.study) return [];
  const next = unenrolledItems(course, mode, c).slice(0, limit);
  next.forEach((kanji) => setStudying(c.study, c.unstudy || {}, kanji, mode, true));
  return next;
}

/**
 * Which set the learner is currently on — the set holding the next character
 * they have not met yet. Used for display only.
 *
 * A chunk can be excluded from a mode ENTIRELY (e.g. yōon kana have no
 * writing-mode guide to draw against, so writing excludes all of them — see
 * kana.js), not just item by item the way a single kanji is. The "nothing
 * left" fallback must land on the last chunk that still has something
 * eligible in this mode, not just the last chunk overall — otherwise it
 * points at a wholly-excluded trailing chunk that can never actually be
 * "current".
 */
export function currentSetIndex(course, mode, ctx) {
  const { progress } = asContext(ctx);
  const excluded = (course.excludeForMode && course.excludeForMode[mode]) || new Set();
  const usable = course.chunks
    .map((chunk, i) => i)
    .filter((i) => course.chunks[i].items.some((kana) => !excluded.has(kana)));
  const index = usable.find((i) =>
    course.chunks[i].items.some((kana) => !excluded.has(kana) && !progress[itemKey(mode, kana)]));
  if (index !== undefined) return index;
  return usable.length ? usable[usable.length - 1] : course.chunks.length - 1;
}

/**
 * Whether what the learner has already met looks solid enough that taking on
 * more would be sensible. Advisory only: the app shows a nudge, never blocks.
 *
 * Judged over everything introduced rather than over the current set, because
 * once a set has been fully introduced the "current set" is the next, empty
 * one — which would always look consolidated.
 */
export function readyForMore(course, mode, ctx) {
  const c = asContext(ctx);
  const seen = introducedItems(course, mode, c);
  if (seen.length === 0) return true;
  const settled = seen.filter((kana) => c.progress[itemKey(mode, kana)].box >= BOX_SETTLED);
  return settled.length / seen.length >= FRACTION_SETTLED;
}

// Learning new characters and reviewing old ones are deliberately kept as
// two separate activities the learner picks between, rather than one blended
// session, so that "add more" is always a conscious choice.

/**
 * What a `new` session teaches, in teaching order.
 *
 * Without a study list this is "never seen", as it always was. With one it is
 * pendingItems — enrolled but not yet taught — so a kanji added by hand from
 * the detail screen is picked up here rather than only when grade order
 * eventually reaches it. Enrolling the next few is a separate, explicit step
 * (enrollNext above), which is what keeps "add more" a conscious choice.
 */
export function newItems(course, mode, ctx, limit = 5) {
  return pendingItems(course, mode, ctx).slice(0, limit);
}

/**
 * Introduced characters whose review has come due, favouring the ones that
 * have actually been missed before. When more is due than fits the session
 * cap, a character with lapses on its record is picked ahead of one that has
 * never once been wrong — the point of review is shoring up what's shaky,
 * not re-proving what's already known. Ties break by how overdue it is.
 */
export function dueItems(course, mode, ctx, limit = 15, now = Date.now()) {
  const { progress } = asContext(ctx);
  return introducedItems(course, mode, ctx)
    .filter((kana) => isDue(progress[itemKey(mode, kana)], now))
    .sort((a, b) => {
      const ra = progress[itemKey(mode, a)];
      const rb = progress[itemKey(mode, b)];
      if (rb.lapses !== ra.lapses) return rb.lapses - ra.lapses;
      return ra.due - rb.due;
    })
    .slice(0, limit);
}

/** Free practice: anything already introduced, regardless of the schedule. */
export function practiceItems(course, mode, ctx, limit = 20) {
  return shuffle(introducedItems(course, mode, ctx)).slice(0, limit);
}

/**
 * Assemble one session. `kind` is 'new' (teach a set, then quiz just that
 * set), 'review' (quiz what is due), or 'practice' (ignore the schedule).
 */
export function buildSession(course, mode, ctx, kind, { newPerSession = 5, maxReviews = 15, limit = 20, now = Date.now() } = {}) {
  if (kind === 'new') {
    const fresh = newItems(course, mode, ctx, newPerSession);
    return { lesson: fresh, quiz: shuffle(fresh) };
  }
  if (kind === 'review') {
    return { lesson: [], quiz: shuffle(dueItems(course, mode, ctx, maxReviews, now)) };
  }
  if (kind === 'placement') {
    // "Test out" of never-seen items with no lesson step first, and no
    // enrollment step here either — unlike 'new', nothing is enrolled
    // upfront. neverSeenItems ignores the study-list gate entirely, so this
    // reaches kanji never enrolled at all, not just ones already "waiting to
    // learn". The caller (app.js) enrolls each one lazily, only once it's
    // actually attempted — see ensurePlacementEnrolled() there. See
    // grade()'s `placement` option for what a correct answer does.
    const never = neverSeenItems(course, mode, ctx);
    // Kanji: deliberately NOT shuffled — a placement test is meant to find
    // out where a learner's knowledge actually runs out, which is a much
    // clearer signal in teaching order (neverSeenItems already returns items
    // in course order — chunk by chunk, unit by unit) than scattered — a bad
    // run of unlucky misses says less about "where do I stand" than watching
    // it get harder in the order it was designed to be learned.
    //
    // Kana: the opposite problem applies — the gojuon order (a, i, u, e,
    // o...) is itself something a learner can have memorized without being
    // able to actually read the characters, so quizzing strict teaching
    // order would let that alone ace the test. Shuffled instead, but only
    // *within* each teaching band (see kana.js's BAND_* chunk tagging) —
    // band order (plain kana, then voiced/plosive, then compound yōon) is
    // kept, since a learner who has never met dakuten shouldn't be quizzed
    // on it before the plain set is exhausted.
    //
    // Vocab: same problem as kana, worse — a course is one themed unit
    // (e.g. C2's numbers 一二三四五...), and unlike kanji's multi-grade
    // sweep, word order within a unit carries no difficulty gradient to
    // preserve. Left in manifest order, "Numbers" would let a learner guess
    // 四 follows a just-answered 三 without knowing either reading. Fully
    // shuffled, since there's no meaningful order here to protect.
    if (course.kind === 'vocab') return { lesson: [], quiz: shuffle(never) };
    if (course.kind !== 'kana') return { lesson: [], quiz: never };
    const bandOf = new Map(course.chunks.flatMap((chunk) => chunk.items.map((item) => [item, chunk.band])));
    const bands = new Map();
    never.forEach((item) => {
      const band = bandOf.get(item);
      if (!bands.has(band)) bands.set(band, []);
      bands.get(band).push(item);
    });
    return { lesson: [], quiz: [...bands.values()].flatMap((items) => shuffle(items)) };
  }
  return { lesson: [], quiz: practiceItems(course, mode, ctx, limit) };
}

/** Counts for the home and summary screens. */
export function courseStats(course, mode, ctx, now = Date.now()) {
  const c = asContext(ctx);
  const { progress } = c;
  const all = allItems(course, mode);
  const started = introducedItems(course, mode, c);
  const due = started.filter((k) => isDue(progress[itemKey(mode, k)], now)).length;
  const mastered = started.filter((k) => progress[itemKey(mode, k)].box >= MAX_BOX).length;
  return {
    // Enrolled but not yet taught, and course items not yet enrolled at all.
    // Both are 0 without a study list, where "fresh" below keeps its original
    // meaning of everything not yet started.
    pending: pendingItems(course, mode, c).length,
    unenrolled: unenrolledItems(course, mode, c).length,
    total: all.length,
    started: started.length,
    due,
    fresh: all.length - started.length, // still available to learn
    mastered,
  };
}

/**
 * A 0-4 mastery tier from a record's box, for colour-coding an overview
 * grid: 0 = never introduced, 1 = just started (box 0 — including a fresh
 * miss, which always drops back to box 0), 2-3 = making progress, 4 = at or
 * past the top box. Works on both the Leitner records kana/Definition use
 * and the kanji-rollup records Yomi produces (recomputeKanjiRollup in
 * kanji.js), since both carry the same `.box` field.
 */
export function masteryTier(record) {
  if (!record) return 0;
  if (record.box <= 0) return 1;
  if (record.box <= 2) return 2;
  if (record.box <= 4) return 3;
  return 4;
}

/**
 * Trace/Guided/Free, chosen from the SAME writing record masteryTier reads
 * (see writing-mode-plan.md §3): a character never attempted gets the full
 * guide (Trace), one still being learned gets the guide revealed stroke-by-
 * stroke as earned (Guided), and one that has reached box 3 or beyond is
 * tested with no guide at all (Free). This is only the default — the
 * three-way toggle on the writing screen overrides it for the rest of the
 * session, see writingSetSubMode() in app.js.
 */
export function autoWritingMode(record) {
  if (!record) return 'trace';
  if (record.box >= 3) return 'free';
  return 'guided';
}

// --- Per-reading records (kanji reading quiz) ------------------------------
//
// The kanji reading quiz grades each on'yomi/kun'yomi individually rather
// than the kanji as a whole — a kid can know セイ cold while still shaky on
// うまれる for the same kanji, and lumping them into one record would hide
// that. This model is deliberately different from the Leitner boxes above:
// no fixed box ladder, just two numbers the request asked for directly —
// current streak (consecutive correct, reset by any miss) and lifetime
// correct count — both pushing the interval out, so a reading with a long
// history doesn't fall all the way back to "brand new" spacing after one
// slip. lastReviewed/secondLastReviewed are kept so the interval actually
// taken between the last two reviews can be reconstructed later even though
// scheduling itself only looks at `due`.

const YOMI_STREAK_DAYS = [0, 1, 2, 4, 8, 16, 32];
const YOMI_MAX_INTERVAL_DAYS = 120;

export function yomiKey(mode, kanji, reading) {
  return `${mode}:${kanji}:${reading}`;
}

export function newYomiRecord() {
  return {
    correct: 0,
    incorrect: 0,
    streak: 0,
    lastReviewed: null,
    secondLastReviewed: null,
    due: 0,
    intervalDays: 0,
    // Per-event [timestamp, 0|1] log, same shape and cap as grade()'s
    // history — added for the study-history timeline (a kanji's Yomi is
    // scored per reading, so this is where its pass/fail record actually
    // lives; recomputeKanjiRollup's own itemKey('recognition', kanji) rollup
    // has none, see its `history: []`).
    history: [],
    updatedAt: null,
  };
}

/**
 * Apply a pass/fail result to a reading's record. A miss resets the streak
 * to zero and makes it due immediately, but — unlike the kana boxes — does
 * not erase the lifetime correct count, so rebuilding the streak afterward
 * earns a longer interval sooner than a reading with no track record would.
 *
 * `placement` (see grade() above) jumps the streak straight to MAX_BOX
 * instead of incrementing by one — recomputeKanjiRollup in kanji.js derives
 * the kanji-level box as min(streak, MAX_BOX) across every reading, so a
 * placement-correct reading here is what lets a whole kanji's rollup land on
 * "well known" from a single clean round, the same as grade() does for the
 * simpler per-kanji record modes.
 *
 * `settle` ({ streak, intervalDays }) is grade()'s option of the same name
 * for the "I think I know this" claim: the streak lands at that value (never
 * lower than it already is) and the interval is taken as given, bypassing
 * the experience multiplier — the point of a claim is that the due date is
 * chosen deliberately (staggered across a batch, see markKnownItems), not
 * derived from a track record the reading doesn't yet have.
 */
export function gradeYomi(record, correct, now = Date.now(), { placement = false, settle = null } = {}) {
  const rec = record || newYomiRecord();
  // Yomi records predating the study-history timeline have no `history` at
  // all — newYomiRecord() gained it only when that shipped, and nothing
  // migrates existing profiles. Seed it here rather than at read time: this
  // is the single point every yomi record passes through on its way to
  // being written, so one guard covers every caller. Without it the push
  // below throws on any pre-existing record, which — because the only
  // caller on a correct vocab answer is creditVocabYomi() — presented as
  // "the right answer does nothing, the wrong one works".
  if (!Array.isArray(rec.history)) rec.history = [];
  rec.secondLastReviewed = rec.lastReviewed;
  rec.lastReviewed = now;

  if (correct) {
    rec.correct += 1;
    if (settle) {
      rec.streak = Math.max(rec.streak, settle.streak);
      rec.intervalDays = settle.intervalDays;
    } else {
      rec.streak = placement ? MAX_BOX : rec.streak + 1;
      const base = YOMI_STREAK_DAYS[Math.min(rec.streak, YOMI_STREAK_DAYS.length - 1)];
      // Credit for total correct answers, even ones before the current
      // streak started — e.g. a reading answered right 30 times total that
      // just had one slip shouldn't need to re-climb from a 1-day interval.
      const experience = 1 + Math.floor(Math.log2(1 + rec.correct));
      rec.intervalDays = Math.min(base * experience, YOMI_MAX_INTERVAL_DAYS);
    }
    rec.due = now + rec.intervalDays * DAY_MS;
  } else {
    rec.incorrect += 1;
    rec.streak = 0;
    rec.intervalDays = 0;
    rec.due = now;
  }
  rec.history.push([now, correct ? 1 : 0]);
  if (rec.history.length > MAX_HISTORY) {
    rec.history.splice(0, rec.history.length - MAX_HISTORY);
  }
  rec.updatedAt = now;
  return rec;
}

/**
 * Rebuilds one kanji's Yomi rollup by scanning `progress` for whatever
 * per-reading records already exist under `mode:kanji:*` — the same
 * aggregation recomputeKanjiRollup (kanji.js) does, but discovering which
 * readings to aggregate from the progress keys themselves rather than from
 * the kanji course's own `quizReadings` list.
 *
 * This is what lets vocabulary crediting (vocab-plan.md §4.5) write a correct
 * kanji-reading answer with no `await` in the middle of grading a vocab
 * question: the credited kanji's own course unit is very often not loaded
 * during a vocab session (unlike kanji.js's version, which needs
 * kanjiInfo(course, kanji) and so needs that unit loaded already), and
 * loading it just to find the reading list would mean pausing the question
 * to fetch data no answer here actually depends on.
 */
export function recomputeYomiRollupFromProgress(progress, mode, kanji, now = Date.now()) {
  const prefix = `${mode}:${kanji}:`;
  const records = Object.keys(progress)
    .filter((key) => key.startsWith(prefix) && Number.isFinite(progress[key].streak))
    .map((key) => progress[key]);
  if (records.length === 0) return;

  progress[itemKey(mode, kanji)] = {
    box: Math.min(...records.map((r) => Math.min(r.streak, MAX_BOX))),
    due: Math.min(...records.map((r) => r.due)),
    intervalDays: 0,
    seen: records.reduce((sum, r) => sum + r.correct + r.incorrect, 0),
    correct: records.reduce((sum, r) => sum + r.correct, 0),
    lapses: records.reduce((sum, r) => sum + r.incorrect, 0),
    history: [],
    updatedAt: now,
  };
}

export function shuffle(array) {
  const out = [...array];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// --- Exposure: earning the hidden-furigana default by meeting a reading ---
// (vocab-plan.md §5.3). This lives in srs.js rather than vocab.js because
// stories (the next feature, §10) accrue against the same counter over a
// different corpus.
//
// Per (kanji, reading), not per kanji — 生 met as せい in 先生/学生/生活/一生
// says nothing about なま, so the key has to carry the reading. A jukujikun
// word has no per-kanji reading to key on and accrues against the whole word
// instead (`exposureWordKey`).
//
// An entry is EITHER a plain array of ascending timestamps (the common case —
// see the shape in the plan's own example), or `{ cleared, events, strikes }`
// once a demotion has ever touched this key: `cleared` is when the evidence
// was wiped (so a merge with a device still holding pre-demotion timestamps
// drops them — see mergeExposure in merge.js), `events` is the timestamp list
// since then, and `strikes` counts unambiguous reveals since the last clear
// (see recordDemotionStrike). Both shapes report through the same accessors
// below so callers never have to branch on which one they were handed.

export const EXPOSURE_THRESHOLD = 4;
// Kept beyond the threshold, not exactly at it, so a later change to
// EXPOSURE_THRESHOLD (or a sync round-trip between two devices that each
// independently reached the threshold before ever syncing) has real evidence
// to work with rather than history already thrown away.
const EXPOSURE_KEEP = 8;
// Two unambiguous reveals of an exposure-promoted reading demote it back to
// "not yet earned" — see recordDemotionStrike.
const DEMOTION_STRIKES = 2;

export function exposureKanjiKey(kanji, reading) {
  return `${kanji}:${reading}`;
}

export function exposureWordKey(word) {
  return `word:${word}`;
}

function exposureEvents(entry) {
  if (!entry) return [];
  return Array.isArray(entry) ? entry : (Array.isArray(entry.events) ? entry.events : []);
}

function exposureCleared(entry) {
  return entry && !Array.isArray(entry) && Number.isFinite(entry.cleared) ? entry.cleared : 0;
}

function exposureStrikes(entry) {
  return entry && !Array.isArray(entry) && Number.isFinite(entry.strikes) ? entry.strikes : 0;
}

/** How many genuine encounters this key has on record since its last (if
 * any) demotion. The array can hold up to EXPOSURE_KEEP, but in ordinary,
 * single-device use it settles at EXPOSURE_THRESHOLD by construction — once
 * a reading is promoted it is hidden by default, so nothing downstream keeps
 * calling addExposure for it (see the caller-side gating in app.js). */
export function exposureCount(exposure, key) {
  const entry = (exposure || {})[key];
  const cleared = exposureCleared(entry);
  return exposureEvents(entry).filter((t) => t > cleared).length;
}

export function isExposurePromoted(exposure, key) {
  return exposureCount(exposure, key) >= EXPOSURE_THRESHOLD;
}

/**
 * Record one encounter with `key` — the ruby was actually shown, whether by
 * default or because the learner tapped to reveal it (vocab-plan.md §5.3).
 * The caller is responsible for the "at most one per session per key" rule
 * (session.vocabExposed in app.js) and for not calling this once a reading
 * is already promoted (isExposurePromoted) — that's what makes the count
 * settle at the threshold rather than needing a cap here.
 */
export function addExposure(exposure, key, now = Date.now()) {
  const entry = exposure[key];
  const cleared = exposureCleared(entry);
  const strikes = exposureStrikes(entry);
  const events = [...exposureEvents(entry), now].filter((t) => t > cleared).sort((a, b) => a - b).slice(-EXPOSURE_KEEP);
  exposure[key] = (cleared || strikes) ? { cleared, events, strikes } : events;
  return exposure;
}

/**
 * One unambiguous reveal of an exposure-promoted reading (vocab-plan.md
 * §5.3's "when exposure was not enough") — the caller has already checked
 * this was the ONLY hidden reading in the word, so the reveal can be blamed
 * on it specifically. Two strikes clear the evidence (a tombstone, so a
 * merge with a device still holding the old timestamps drops them — see
 * mergeExposure) and the reading can re-earn the hidden default from
 * scratch. Returns whether this call demoted it.
 */
export function recordDemotionStrike(exposure, key, now = Date.now()) {
  const entry = exposure[key];
  const strikes = exposureStrikes(entry) + 1;
  if (strikes >= DEMOTION_STRIKES) {
    exposure[key] = { cleared: now, events: [], strikes: 0 };
    return true;
  }
  exposure[key] = { cleared: exposureCleared(entry), events: exposureEvents(entry), strikes };
  return false;
}

// Exported for merge.js, which needs to read both shapes without duplicating
// the branch above.
export const exposureInternals = { exposureEvents, exposureCleared, exposureStrikes };

// --- Muted: a manual, permanent alternative to earning the hidden default
// by exposure (vocab-plan.md §5.3) — "Hide furigana in future" on the quiz
// screen. Keyed exactly like `exposure` (exposureKanjiKey/exposureWordKey),
// so the same key already earned by passive exposure is the same key a
// learner can mute outright. Unlike exposure there is nothing to count or
// demote: presence means muted, permanently, until the field is deleted by
// hand — so a plain timestamp per key is enough, kept only in case a future
// screen wants to show "muted since" or offer to undo it.

export function isFuriganaMuted(muted, key) {
  return !!(muted || {})[key];
}

export function muteFuriganaKey(muted, key, now = Date.now()) {
  muted[key] = now;
  return muted;
}

// --- Vocabulary: two-stage records rolled into one schedulable card -------
//
// vocab-plan.md §4.2/§4.4: a Meaning question grades TWO things (vdef: did
// they know what it means, vyomi: did they know how it's read — only
// reached when relevant, see the app's quiz flow) and a Recall question
// grades another two (vprod:, vspell:) — but the mode picker only shows
// "Meaning" and "Recall", and every generic scheduling function above
// (dueItems, courseStats, currentSetIndex, ...) needs ONE record per item
// per mode to work against, the same as it does for kana and kanji. Unlike
// kanji's per-reading records (gradeYomi — a different shape, with streak/
// correct/incorrect rather than box/due), all four vocab sub-keys are
// ordinary grade() Leitner records: a word has exactly one reading and one
// spelling, so there is nothing finer-grained to schedule within a sub-key
// itself, only across the two that make up a mode.
export const VOCAB_SUBKEYS = {
  vmeaning: ['vdef', 'vyomi'],
  vrecall: ['vprod', 'vspell'],
};

/**
 * Roll a word's vdef/vyomi (or vprod/vspell) records into the itemKey(mode,
 * word) card the rest of srs.js reads. `due` is the soonest of the two —
 * same rule recomputeKanjiRollup (kanji.js) uses and for the same reason: a
 * word resurfaces as soon as EITHER half looks shaky. `box` is the lower of
 * the two, so "mastered" means both are solid, not just whichever is asked
 * more often. A sub-key with no record yet (vyomi before the yomi stage has
 * ever actually been reached for this word) is simply left out of the
 * rollup rather than treated as zero — see the module docstring above.
 */
export function recomputeVocabRollup(word, mode, progress, now = Date.now()) {
  const records = VOCAB_SUBKEYS[mode]
    .map((prefix) => progress[itemKey(prefix, word)])
    .filter(Boolean);
  if (records.length === 0) return;

  progress[itemKey(mode, word)] = {
    box: Math.min(...records.map((r) => r.box)),
    due: Math.min(...records.map((r) => r.due)),
    intervalDays: 0,
    seen: records.reduce((sum, r) => sum + r.seen, 0),
    correct: records.reduce((sum, r) => sum + r.correct, 0),
    lapses: records.reduce((sum, r) => sum + r.lapses, 0),
    history: [],
    updatedAt: now,
  };
}
