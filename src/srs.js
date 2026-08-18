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

// A chunk counts as learned well enough to unlock the next one when this
// fraction of its characters have reached BOX_TO_ADVANCE.
const FRACTION_TO_ADVANCE = 0.8;
const BOX_TO_ADVANCE = 2;

// Keep history bounded so a profile document cannot grow without limit.
const MAX_HISTORY = 300;

export const MODES = {
  recognition: { id: 'recognition', name: 'Reading', hint: 'See the kana, type the sound' },
  writing: { id: 'writing', name: 'Writing', hint: 'See the sound, draw the kana' },
};

export function itemKey(mode, kana) {
  return `${mode}:${kana}`;
}

export function newRecord() {
  return { box: 0, due: 0, seen: 0, correct: 0, lapses: 0, history: [] };
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
    rec.box = Math.min(rec.box + 1, MAX_BOX);
    rec.due = now + BOX_INTERVALS_DAYS[rec.box] * DAY_MS;
  } else {
    rec.lapses += 1;
    rec.box = 0;
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
 * How many chunks of a course are currently open to the learner, for a
 * given mode. Chunk 0 is always open; each subsequent chunk opens once the
 * previous one is mostly at BOX_TO_ADVANCE or better.
 */
export function unlockedChunkCount(course, mode, progress) {
  let unlocked = 1;
  for (const chunk of course.chunks) {
    const learned = chunk.items.filter((kana) => {
      const rec = progress[itemKey(mode, kana)];
      return rec && rec.box >= BOX_TO_ADVANCE;
    }).length;
    if (learned / chunk.items.length >= FRACTION_TO_ADVANCE) {
      unlocked = Math.min(unlocked + 1, course.chunks.length);
    } else {
      break;
    }
  }
  return unlocked;
}

/** Characters in the open chunks, in teaching order. */
export function unlockedItems(course, mode, progress) {
  const count = unlockedChunkCount(course, mode, progress);
  return course.chunks.slice(0, count).flatMap((chunk) => chunk.items);
}

/**
 * Build a session: a lesson of never-seen characters (capped), followed by
 * the reviews that have come due.
 */
export function buildSession(course, mode, progress, { newPerSession = 5, maxReviews = 40, now = Date.now() } = {}) {
  const open = unlockedItems(course, mode, progress);

  const fresh = open
    .filter((kana) => !progress[itemKey(mode, kana)])
    .slice(0, newPerSession);

  const reviews = open
    .filter((kana) => isDue(progress[itemKey(mode, kana)], now))
    .sort((a, b) => progress[itemKey(mode, a)].due - progress[itemKey(mode, b)].due)
    .slice(0, maxReviews);

  return { lesson: fresh, quiz: shuffle([...fresh, ...reviews]) };
}

/** Counts for the home screen. */
export function courseStats(course, mode, progress, now = Date.now()) {
  const all = course.chunks.flatMap((c) => c.items);
  const open = unlockedItems(course, mode, progress);
  const started = all.filter((k) => progress[itemKey(mode, k)]).length;
  const due = open.filter((k) => isDue(progress[itemKey(mode, k)], now)).length;
  const fresh = open.filter((k) => !progress[itemKey(mode, k)]).length;
  const mastered = all.filter((k) => {
    const rec = progress[itemKey(mode, k)];
    return rec && rec.box >= MAX_BOX;
  }).length;
  return { total: all.length, started, due, fresh, mastered };
}

export function shuffle(array) {
  const out = [...array];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
