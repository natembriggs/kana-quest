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
      kanji: 'See the meaning, draw the kanji',
    },
    comingSoon: true,
  },
};

export function modesForKind(kind) {
  return Object.values(MODES).filter((m) => m.kinds.includes(kind));
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
  const usable = modesForKind(kind).filter((m) => !m.comingSoon);
  for (const id of ['definition', 'recognition']) {
    const found = usable.find((m) => m.id === id);
    if (found) return found.id;
  }
  return usable[0].id;
}

export function itemKey(mode, kana) {
  return `${mode}:${kana}`;
}

export function newRecord() {
  return { box: 0, due: 0, intervalDays: 0, seen: 0, correct: 0, lapses: 0, history: [] };
}

/**
 * Apply a pass/fail result to a record. Returns the updated record.
 * A miss always drops the item to box 0 so it is re-drilled in the same
 * session, and increments `lapses` so a persistently hard character is
 * visible in the stats later.
 */
export function grade(record, correct, now = Date.now()) {
  const rec = record || newRecord();
  rec.seen += 1;
  if (correct) {
    rec.correct += 1;
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

/** Characters that have been introduced, i.e. have a record for this mode. */
export function introducedItems(course, mode, progress) {
  return allItems(course, mode).filter((kana) => progress[itemKey(mode, kana)]);
}

/**
 * Which set the learner is currently on — the set holding the next character
 * they have not met yet. Used for display only.
 */
export function currentSetIndex(course, mode, progress) {
  const excluded = (course.excludeForMode && course.excludeForMode[mode]) || new Set();
  const index = course.chunks.findIndex((chunk) =>
    chunk.items.some((kana) => !excluded.has(kana) && !progress[itemKey(mode, kana)]));
  return index === -1 ? course.chunks.length - 1 : index;
}

/**
 * Whether what the learner has already met looks solid enough that taking on
 * more would be sensible. Advisory only: the app shows a nudge, never blocks.
 *
 * Judged over everything introduced rather than over the current set, because
 * once a set has been fully introduced the "current set" is the next, empty
 * one — which would always look consolidated.
 */
export function readyForMore(course, mode, progress) {
  const seen = introducedItems(course, mode, progress);
  if (seen.length === 0) return true;
  const settled = seen.filter((kana) => progress[itemKey(mode, kana)].box >= BOX_SETTLED);
  return settled.length / seen.length >= FRACTION_SETTLED;
}

// Learning new characters and reviewing old ones are deliberately kept as
// two separate activities the learner picks between, rather than one blended
// session, so that "add more" is always a conscious choice.

/** The next never-seen characters, in teaching order. */
export function newItems(course, mode, progress, limit = 5) {
  return allItems(course, mode)
    .filter((kana) => !progress[itemKey(mode, kana)])
    .slice(0, limit);
}

/**
 * Introduced characters whose review has come due, favouring the ones that
 * have actually been missed before. When more is due than fits the session
 * cap, a character with lapses on its record is picked ahead of one that has
 * never once been wrong — the point of review is shoring up what's shaky,
 * not re-proving what's already known. Ties break by how overdue it is.
 */
export function dueItems(course, mode, progress, limit = 15, now = Date.now()) {
  return introducedItems(course, mode, progress)
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
export function practiceItems(course, mode, progress, limit = 20) {
  return shuffle(introducedItems(course, mode, progress)).slice(0, limit);
}

/**
 * Assemble one session. `kind` is 'new' (teach a set, then quiz just that
 * set), 'review' (quiz what is due), or 'practice' (ignore the schedule).
 */
export function buildSession(course, mode, progress, kind, { newPerSession = 5, maxReviews = 15, limit = 20, now = Date.now() } = {}) {
  if (kind === 'new') {
    const fresh = newItems(course, mode, progress, newPerSession);
    return { lesson: fresh, quiz: shuffle(fresh) };
  }
  if (kind === 'review') {
    return { lesson: [], quiz: shuffle(dueItems(course, mode, progress, maxReviews, now)) };
  }
  return { lesson: [], quiz: practiceItems(course, mode, progress, limit) };
}

/** Counts for the home and summary screens. */
export function courseStats(course, mode, progress, now = Date.now()) {
  const all = allItems(course, mode);
  const started = introducedItems(course, mode, progress);
  const due = started.filter((k) => isDue(progress[itemKey(mode, k)], now)).length;
  const mastered = started.filter((k) => progress[itemKey(mode, k)].box >= MAX_BOX).length;
  return {
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
  };
}

/**
 * Apply a pass/fail result to a reading's record. A miss resets the streak
 * to zero and makes it due immediately, but — unlike the kana boxes — does
 * not erase the lifetime correct count, so rebuilding the streak afterward
 * earns a longer interval sooner than a reading with no track record would.
 */
export function gradeYomi(record, correct, now = Date.now()) {
  const rec = record || newYomiRecord();
  rec.secondLastReviewed = rec.lastReviewed;
  rec.lastReviewed = now;

  if (correct) {
    rec.correct += 1;
    rec.streak += 1;
    const base = YOMI_STREAK_DAYS[Math.min(rec.streak, YOMI_STREAK_DAYS.length - 1)];
    // Credit for total correct answers, even ones before the current streak
    // started — e.g. a reading answered right 30 times total that just had
    // one slip shouldn't need to re-climb from a 1-day interval.
    const experience = 1 + Math.floor(Math.log2(1 + rec.correct));
    rec.intervalDays = Math.min(base * experience, YOMI_MAX_INTERVAL_DAYS);
    rec.due = now + rec.intervalDays * DAY_MS;
  } else {
    rec.incorrect += 1;
    rec.streak = 0;
    rec.intervalDays = 0;
    rec.due = now;
  }
  return rec;
}

export function shuffle(array) {
  const out = [...array];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
