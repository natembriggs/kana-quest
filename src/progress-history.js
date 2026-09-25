// "My progress" (screen-progress in index.html): how many items of one
// script/mode/unit sat at each mastery level on every past day, the goals a
// learner set against those levels, and which goals have just been reached.
//
// Pure — no DOM, no storage — so test/smoke.js can drive it directly; app.js
// only renders what this returns.
//
// Levels mirror the set overview's legend (MASTERY_LABELS / masteryTier in
// srs.js), plus "added" — enrolled on the study list, whether or not it has
// been taught yet. Each level counts items at that level OR HIGHER, so the
// lines nest (every well-known item is also doing well, learning and
// started) and "Started" is exactly "on the study list and studied at least
// once" — the same figure courseStats() calls `started`.
//
// Where the past comes from: every grading event is in the record's
// history as [ts, 0|1, box] (srs.js). The box is what makes a past tier
// exact; events written before it was recorded are only [ts, 0|1], so for
// those the box is re-derived by replaying them through grade()/gradeYomi()
// from a fresh record. That replay can't know which old events were
// "I already know this" claims or Hard/Easy-rated writing answers, so it is
// an estimate for old history — pinned at its last event to the record's
// real current box, and replaced outright by the exact figure for "now".
//
// Enrollment has no history of its own, only the latest add or removal
// timestamp per (item, mode) — study/unstudy in srs.js — so an item counts
// as enrolled from the earlier of that add and its first graded event, and
// a removed item until its removal.

import {
  grade, gradeYomi, newRecord, newYomiRecord, masteryTier, itemKey, isStudying, VOCAB_SUBKEYS,
} from './srs.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** `min` is the item status (see itemStatusAt) a level starts at:
 * 0 not enrolled, 1 enrolled but untaught, 2..5 = masteryTier 1..4. */
export const PROGRESS_LEVELS = [
  { id: 'added', label: 'Added', min: 1, phrase: 'added to your study list' },
  { id: 'started', label: 'Started', min: 2, phrase: 'started' },
  { id: 'learning', label: 'Learning', min: 3, phrase: 'learning or better' },
  { id: 'doingWell', label: 'Doing well', min: 4, phrase: 'doing well or better' },
  { id: 'wellKnown', label: 'Well known', min: 5, phrase: 'well known' },
];

export function levelById(id) {
  return PROGRESS_LEVELS.find((l) => l.id === id);
}

/** Kana have no study list (everything is always "added"), so the Added
 * line would just be a flat line at the total — left out for them. */
export function levelsForKind(kind) {
  return kind === 'kana' ? PROGRESS_LEVELS.filter((l) => l.id !== 'added') : PROGRESS_LEVELS;
}

// --- Per-record box timelines ------------------------------------------------

/**
 * [[ts, box], ...] oldest first: the box `record` sat at from each graded
 * event on. `yomi` selects gradeYomi()'s streak-shaped record. A record whose
 * history was capped (MAX_HISTORY in srs.js) starts with [-Infinity, 0] — it
 * was being studied before its oldest surviving event, level unknown, so it
 * counts as "started" from the start of the chart.
 */
export function recordBoxTimeline(record, yomi = false) {
  const history = Array.isArray(record?.history) ? record.history.filter((e) => Array.isArray(e) && Number.isFinite(e[0])) : [];
  if (history.length === 0) return [];
  const out = [];
  const graded = yomi
    ? (Number(record.correct) || 0) + (Number(record.incorrect) || 0)
    : Number(record.seen) || 0;
  if (graded > history.length) out.push([-Infinity, 0]);

  let replay = null;
  history.forEach(([ts, ok, box]) => {
    if (Number.isFinite(box)) {
      out.push([ts, box]);
      return;
    }
    // Legacy entry: replay it. Only ever a prefix — every event written
    // since the box was recorded carries one — so the replay never has to
    // resume after an exact entry.
    if (yomi) {
      replay = gradeYomi(replay || newYomiRecord(), !!ok, ts);
      out.push([ts, replay.streak]);
    } else {
      replay = grade(replay || newRecord(), !!ok, ts);
      out.push([ts, replay.box]);
    }
  });

  const current = yomi ? record.streak : record.box;
  if (Number.isFinite(current)) out[out.length - 1] = [out[out.length - 1][0], current];
  return out;
}

function valueAt(timeline, t) {
  let value;
  for (let i = 0; i < timeline.length && timeline[i][0] <= t; i += 1) value = timeline[i][1];
  return value;
}

/** Rollup of several box timelines the way recomputeYomiRollupFromProgress /
 * recomputeVocabRollup combine records: the LOWEST box among the parts that
 * exist yet (a part with no event so far is left out, not counted as 0). */
function minTimeline(timelines) {
  const live = timelines.filter((t) => t.length);
  if (live.length <= 1) return live[0] || [];
  const times = [...new Set(live.flatMap((t) => t.map(([ts]) => ts)))].sort((a, b) => a - b);
  return times.map((ts) => {
    const values = live.map((t) => valueAt(t, ts)).filter((v) => v !== undefined);
    return [ts, Math.min(...values)];
  });
}

/**
 * [[ts, tier], ...] for one item in one mode — tier being masteryTier's
 * 1..4 (never 0: a timeline only starts at the first graded event). Finds
 * the real graded records the same way buildStudyHistory (app.js) does:
 * kanji Yomi lives on per-reading records, vocab modes on their two
 * sub-keys, everything else on itemKey(mode, item) itself. `readingKeys`
 * (kanji -> its per-reading progress keys, see readingKeyIndex) saves a
 * scan of every progress key per kanji when charting thousands at once.
 */
export function itemTierTimeline(progress, kind, mode, item, readingKeys = null) {
  let boxes;
  if (kind === 'kanji' && mode === 'recognition') {
    const prefix = `${mode}:${item}:`;
    const keys = readingKeys ? (readingKeys.get(item) || []) : Object.keys(progress).filter((key) => key.startsWith(prefix));
    boxes = minTimeline(keys
      .filter((key) => Number.isFinite(progress[key]?.streak))
      .map((key) => recordBoxTimeline(progress[key], true)));
  } else if (kind === 'vocab' && VOCAB_SUBKEYS[mode]) {
    boxes = minTimeline(VOCAB_SUBKEYS[mode].map((prefix) => recordBoxTimeline(progress[itemKey(prefix, item)])));
  } else {
    boxes = recordBoxTimeline(progress[itemKey(mode, item)]);
  }
  return boxes.map(([ts, box]) => [ts, masteryTier({ box })]);
}

/** [from, to) during which `item` counted as on the study list in `mode`,
 * or null if it never visibly was. See the module note for the estimate. */
export function enrollmentWindow(study, unstudy, kind, mode, item, firstEventTs) {
  if (kind === 'kana') return [-Infinity, Infinity];
  const first = Number.isFinite(firstEventTs) ? firstEventTs : Infinity;
  if (isStudying(study, item, mode)) {
    const added = Number(study[item][mode]) || 0;
    // 0 is the legacy "enrolled before this was tracked" sentinel.
    return [added > 0 ? Math.min(added, first) : -Infinity, Infinity];
  }
  const removed = unstudy?.[item]?.[mode];
  if (Number.isFinite(removed) && first < removed) return [first, removed];
  return null;
}

/** The item's status right now, from its live records — the same reading
 * of them the overview tile and courseStats make. */
export function currentItemStatus(progress, study, kind, mode, item) {
  const enrolled = kind === 'kana' || isStudying(study, item, mode);
  if (!enrolled) return 0;
  const tier = masteryTier(progress[itemKey(mode, item)]);
  return tier > 0 ? 1 + tier : 1;
}

/** [[ts, status], ...] change points for one item, ending at `now` on its
 * current status. Status 0 before the first entry. */
export function itemStatusTimeline({
  progress, study, unstudy, readingKeys,
}, kind, mode, item, now) {
  const tiers = itemTierTimeline(progress, kind, mode, item, readingKeys);
  const firstReal = tiers.find(([ts]) => Number.isFinite(ts));
  const window = enrollmentWindow(study, unstudy, kind, mode, item, firstReal ? firstReal[0] : undefined);
  const out = [];
  if (window) {
    const points = new Set(tiers.map(([ts]) => ts));
    points.add(window[0]);
    if (Number.isFinite(window[1])) points.add(window[1]);
    [...points].filter((ts) => ts < now).sort((a, b) => a - b).forEach((ts) => {
      let status = 0;
      if (ts >= window[0] && ts < window[1]) {
        const tier = valueAt(tiers, ts);
        status = tier ? 1 + tier : 1;
      }
      if (!out.length || out[out.length - 1][1] !== status) out.push([ts, status]);
    });
  }
  out.push([now, currentItemStatus(progress, study, kind, mode, item)]);
  return out;
}

// --- Series ------------------------------------------------------------------

/** Local end-of-day for the calendar day containing `ts`. */
function endOfDay(ts) {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - 1;
}

export const PROGRESS_RANGES = [
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
  { id: 'all', label: 'All time' },
];

/**
 * Sample times for a range, oldest first, the last always exactly `now`:
 * one per day for a week or month, one per week for a year, and for "all
 * time" daily back to `firstTs` when that fits in ~two months, weekly
 * otherwise (monthly past three years, so it never grows past ~160 points).
 */
export function sampleTimes(range, now, firstTs = now) {
  let count;
  let stepDays;
  if (range === 'week') { count = 7; stepDays = 1; } else if (range === 'month') { count = 30; stepDays = 1; } else if (range === 'year') { count = 52; stepDays = 7; } else {
    const spanDays = Math.max(1, Math.ceil((now - Math.min(firstTs, now)) / DAY_MS));
    stepDays = spanDays <= 62 ? 1 : spanDays <= 3 * 366 ? 7 : 30;
    count = Math.max(1, Math.ceil(spanDays / stepDays));
  }
  const times = [];
  const today = new Date(now);
  for (let i = count; i >= 1; i -= 1) {
    // Calendar arithmetic, not i * DAY_MS, so a daylight-saving change
    // doesn't shift a sample onto the wrong day.
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i * stepDays);
    times.push(endOfDay(day.getTime()));
  }
  times.push(now);
  return times;
}

/** kanji -> every `${mode}:${kanji}:${reading}` key in `progress`. */
export function readingKeyIndex(progress, mode) {
  const index = new Map();
  Object.keys(progress).forEach((key) => {
    const parts = key.split(':');
    if (parts.length !== 3 || parts[0] !== mode) return;
    if (!index.has(parts[1])) index.set(parts[1], []);
    index.get(parts[1]).push(key);
  });
  return index;
}

/** One status timeline per distinct item (itemStatusTimeline) — the
 * expensive half of the chart, computed once and reused across ranges. */
export function buildItemTimelines({
  items, kind, mode, profile, now = Date.now(),
}) {
  const progress = profile.progress || {};
  const ctx = {
    progress,
    study: profile.study || {},
    unstudy: profile.unstudy || {},
    readingKeys: kind === 'kanji' && mode === 'recognition' ? readingKeyIndex(progress, mode) : null,
  };
  return [...new Set(items)].map((item) => itemStatusTimeline(ctx, kind, mode, item, now));
}

/** Earliest real moment any item was on the chart at all, or `now`. */
export function firstActivity(timelines, now = Date.now()) {
  let firstTs = now;
  timelines.forEach((tl) => {
    const first = tl.find(([ts, status]) => status > 0 && Number.isFinite(ts));
    if (first && first[0] < firstTs) firstTs = first[0];
  });
  return firstTs;
}

/** {levelId: number[]}: how many items were at that level or higher at
 * each of `times` (ascending). */
export function seriesFromTimelines(timelines, times) {
  const counts = {};
  PROGRESS_LEVELS.forEach((l) => { counts[l.id] = times.map(() => 0); });
  timelines.forEach((tl) => {
    let j = 0;
    let status = 0;
    times.forEach((t, i) => {
      while (j < tl.length && tl[j][0] <= t) { status = tl[j][1]; j += 1; }
      if (status === 0) return;
      PROGRESS_LEVELS.forEach((l) => { if (status >= l.min) counts[l.id][i] += 1; });
    });
  });
  return counts;
}

/**
 * { times, counts, total, firstTs } for `items` of one kind/mode —
 * buildItemTimelines + sampleTimes + seriesFromTimelines in one call.
 */
export function buildProgressSeries({
  items, kind, mode, profile, range = 'month', now = Date.now(),
}) {
  const timelines = buildItemTimelines({ items, kind, mode, profile, now });
  const firstTs = firstActivity(timelines, now);
  const times = sampleTimes(range, now, firstTs);
  return { times, counts: seriesFromTimelines(timelines, times), total: timelines.length, firstTs };
}

/**
 * The exact moment the count at `levelId` first reached `value`, or null if
 * it never has. -Infinity when it was already there before the oldest
 * history we have (a capped or pre-tracking record).
 */
export function firstReachedTime(timelines, levelId, value) {
  const { min } = levelById(levelId);
  const deltas = [];
  timelines.forEach((tl) => {
    let above = false;
    tl.forEach(([ts, status]) => {
      const now = status >= min;
      if (now !== above) { deltas.push([ts, now ? 1 : -1]); above = now; }
    });
  });
  // Ties: count every gain at a timestamp before its losses, so a swap
  // between two items at the same instant doesn't hide a crossing.
  deltas.sort((a, b) => (a[0] - b[0]) || (b[1] - a[1]));
  let count = 0;
  for (const [ts, d] of deltas) {
    count += d;
    if (count >= value) return ts;
  }
  return null;
}

/** Just the "now" column of buildProgressSeries, without reading any
 * history — cheap enough to run at the end of every session. */
export function currentLevelCounts({ items, kind, mode, profile }) {
  const counts = {};
  PROGRESS_LEVELS.forEach((l) => { counts[l.id] = 0; });
  [...new Set(items)].forEach((item) => {
    const status = currentItemStatus(profile.progress || {}, profile.study || {}, kind, mode, item);
    PROGRESS_LEVELS.forEach((l) => { if (status >= l.min) counts[l.id] += 1; });
  });
  return counts;
}

// --- Goals and milestones -----------------------------------------------------
//
// A goal is one number against one level of one scope — "300 kanji well
// known in Writing, across every grade" — with no deadline, drawn as a
// horizontal line. User goals live in profile.settings.progressGoals as
// {scopeId: {levelId: n}} (merged last-write-wins with the rest of
// settings). Kana also get two automatic goals per level: half the script
// and all of it. Reaching any goal is celebrated once, ever, by recording
// its id in profile.milestonesShown — the same once-per-profile ledger the
// set-complete milestones use, which sync already merges as a union.

/** `unit` is a kanji/vocab unit id, or 'all' for every unit. Kana scripts
 * have one course, so theirs is always 'all'. */
export function progressScopeId(scriptId, mode, unit = 'all') {
  return `${scriptId}|${mode}|${unit}`;
}

const NOUNS = { kana: 'kana', kanji: 'kanji', vocab: 'words' };

function goalText(value, level, kind, subject) {
  return `${value} ${NOUNS[kind] || 'items'} ${level.phrase}${subject ? ` — ${subject}` : ''}`;
}

/**
 * Every goal for one scope, user-set and automatic:
 * [{ id, level, value, auto, label, text }]. `subject` names the scope in
 * celebration text ("Hiragana · Reading"); `total` is how many items it has.
 */
export function goalsForScope({ settings, scopeId, kind, total, subject, scopeName }) {
  const goals = [];
  const own = (settings && settings.progressGoals && settings.progressGoals[scopeId]) || {};
  PROGRESS_LEVELS.forEach((level) => {
    const value = Number(own[level.id]);
    if (Number.isFinite(value) && value > 0) {
      goals.push({
        id: `goal|${scopeId}|${level.id}|${value}`,
        level: level.id,
        value,
        auto: false,
        label: `Goal: ${value}`,
        text: goalText(value, level, kind, subject),
      });
    }
  });
  if (kind === 'kana' && total > 1) {
    levelsForKind(kind).forEach((level) => {
      [['half', Math.ceil(total / 2), 'Half'], ['all', total, 'All']].forEach(([key, value, word]) => {
        goals.push({
          id: `auto|${scopeId}|${level.id}|${key}`,
          level: level.id,
          value,
          auto: key,
          label: `${word}: ${value}`,
          text: `${word} of ${scopeName} ${level.phrase}${subject ? ` — ${subject}` : ''}`,
        });
      });
    });
  }
  return goals;
}

/**
 * Goals reached (count >= value) and never celebrated:
 * { show: [goal, ...], mark: [id, ...] }. Every reached id is marked, but
 * `show` keeps only the single strongest automatic goal among them — a
 * learner who reaches all of hiragana well known in one go (or opens this
 * for the first time with it long since done) hears about that, not also
 * about "half started", "all learning" and the rest, which it implies.
 */
export function pendingGoalCelebrations(goals, counts, shown = {}) {
  const reached = goals.filter((g) => (counts[g.level] || 0) >= g.value && !shown[g.id]);
  const rank = (g) => PROGRESS_LEVELS.findIndex((l) => l.id === g.level);
  const autos = reached.filter((g) => g.auto)
    .sort((a, b) => (rank(b) - rank(a)) || (b.value - a.value));
  const show = [...reached.filter((g) => !g.auto), ...autos.slice(0, 1)];
  return { show, mark: reached.map((g) => g.id) };
}

/** First sample index at which `series` reached `value`, or -1. For
 * drawing where on the chart a goal was met. */
export function firstReachedIndex(series, value) {
  return series.findIndex((n) => n >= value);
}
