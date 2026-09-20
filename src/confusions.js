// What a learner actually gets wrong, and what they answer instead.
//
// A progress record already knows that 上 was missed. It does not know that
// the button tapped instead said "enter, insert" — that the miss was 上
// against 入 specifically, three times now. That second fact is the one a
// learner means by "kanji I tend to get mixed up", and it was being thrown
// away at every wrong tap in the app.
//
// Recorded per learner, on their own device, and synced with everything
// else. The pure half lives here — recording, the caps, the merge rule and
// the lookups the compare screen ranks by — next to the data it describes,
// the same split contributions.js already uses (its own mergeContributions
// lives there too, and merge.js calls into it).
//
// Shape, keyed exactly like a progress record (itemKey in srs.js), so the
// two can always be read side by side:
//
//   confusions['definition:上'] = {
//     n:    3,              // times missed, first attempts only
//     at:   1758…,          // last miss
//     with: { 入: 2, 九: 1 } // what was answered instead
//   }
//
// `with` is absent for a mode with no discrete wrong option to name —
// Writing has a stroke score, not a button, so a miss there records that it
// happened and nothing more.

import { itemKey } from './srs.js';

// A learner who genuinely cannot tell two characters apart produces a
// handful of distinct wrong answers, not fifty. The cap is generous enough
// that the real pattern always survives it, and small enough that a profile
// which syncs cannot be grown without bound by a child tapping every option
// on every question for a week.
export const CONFUSION_WITH_CAP = 8;
// Likewise across items. 400 is more than the app teaches in any one grade
// and several times what anyone has open at once; the oldest misses fall off
// first, which is also the right order on the merits — what you were mixing
// up in March is not what you are mixing up now.
export const CONFUSION_KEY_CAP = 400;

/** The entry for one item, or null. */
export function confusionFor(confusions, mode, item) {
  return (confusions || {})[itemKey(mode, item)] || null;
}

/** How many times `other` has been answered when `item` was the question —
 * 0 for a pair that has never been confused, which is most of them. */
export function confusionCount(confusions, mode, item, other) {
  const entry = confusionFor(confusions, mode, item);
  return (entry && entry.with && entry.with[other]) || 0;
}

/** Everything ever answered in place of `item`, commonest first. */
export function confusedWith(confusions, mode, item) {
  const entry = confusionFor(confusions, mode, item);
  if (!entry || !entry.with) return [];
  return Object.entries(entry.with)
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .map(([other, count]) => ({ other, count }));
}

/** Drops the least-used entries of an over-full `with` map. Ties break on
 * the key so two devices trimming the same map independently agree — a
 * merge of two differently-trimmed maps is still correct either way, but
 * agreeing keeps it from oscillating. */
function trimWith(withMap) {
  const keys = Object.keys(withMap);
  if (keys.length <= CONFUSION_WITH_CAP) return withMap;
  const kept = keys
    .sort((a, b) => (withMap[b] - withMap[a]) || a.localeCompare(b))
    .slice(0, CONFUSION_WITH_CAP);
  const out = {};
  kept.forEach((k) => { out[k] = withMap[k]; });
  return out;
}

/** Drops the least-recently-missed items of an over-full map. */
function trimKeys(confusions) {
  const keys = Object.keys(confusions);
  if (keys.length <= CONFUSION_KEY_CAP) return confusions;
  const kept = keys
    .sort((a, b) => ((confusions[b].at || 0) - (confusions[a].at || 0)) || a.localeCompare(b))
    .slice(0, CONFUSION_KEY_CAP);
  const out = {};
  kept.forEach((k) => { out[k] = confusions[k]; });
  return out;
}

/**
 * Records one miss and returns the new map (the input is never mutated).
 *
 * `chose` is what was answered instead — a kanji, a word, or a reading the
 * caller has already namespaced (see the `r:` prefix in app.js) — or null
 * for a mode that has no single wrong answer to name.
 *
 * Callers must pass FIRST attempts only. Every quiz in this app lets a
 * learner keep trying until they find the right option, so counting every
 * wrong tap would record the hunt rather than the mistake: a child who
 * knows perfectly well it isn't "nine" but taps it while working through
 * the grid has not confused anything. This matches how recordResult()
 * already seals grading to the first attempt.
 */
export function recordConfusion(confusions, mode, item, chose, now = Date.now()) {
  const key = itemKey(mode, item);
  const previous = (confusions || {})[key];
  const entry = {
    n: ((previous && previous.n) || 0) + 1,
    at: now,
  };
  const withMap = { ...((previous && previous.with) || {}) };
  if (chose) {
    withMap[chose] = (withMap[chose] || 0) + 1;
    entry.with = trimWith(withMap);
  } else if (Object.keys(withMap).length) {
    // A Writing miss on an item that has wrong answers recorded from
    // Definition keeps them; it just adds nothing of its own.
    entry.with = withMap;
  }
  return trimKeys({ ...(confusions || {}), [key]: entry });
}

/**
 * The pairs worth offering after a session: for each item missed, the thing
 * most often answered instead, commonest confusion first.
 *
 * `items` is what the session actually got wrong, so a pair only appears
 * here if it was missed just now — the summary is about this session, not a
 * standing list of everything ever mixed up. `n` on the returned pair is the
 * lifetime count though, because "you have done this four times" is the part
 * worth knowing.
 */
export function sessionConfusionPairs(confusions, mode, items) {
  const pairs = [];
  (items || []).forEach((item) => {
    const top = confusedWith(confusions, mode, item)[0];
    if (!top) return;
    pairs.push({ item, other: top.other, count: top.count });
  });
  return pairs.sort((a, b) => (b.count - a.count) || a.item.localeCompare(b.item));
}

/**
 * Merges two devices' maps.
 *
 * Counts merge by MAX, never by sum. Both halves of a sync routinely hold
 * the same misses — a device pushes, the other pulls, and the same three
 * taps come back — so adding them would double every number a sync touches
 * and go on doubling it. Max cannot overcount; at worst it forgets that two
 * devices independently recorded different misses of the same pair, which
 * costs an undercount of something already known to be a problem. This is
 * the same trade mergeExposure makes for demotion strikes, for the same
 * reason.
 *
 * Returns undefined when neither side ever had the field, matching
 * mergeMilestonesShown and mergeStories: a profile that predates this must
 * merge back to no field at all, or a merge that has genuinely caught up
 * with the remote stops looking identical to it and sync pushes a no-op
 * write forever (see matchesRemote in sync-protocol.js).
 */
export function mergeConfusions(current, incoming) {
  if (!current && !incoming) return undefined;
  const a = current || {};
  const b = incoming || {};
  const merged = {};
  new Set([...Object.keys(a), ...Object.keys(b)]).forEach((key) => {
    const x = a[key] || {};
    const y = b[key] || {};
    const entry = {
      n: Math.max(x.n || 0, y.n || 0),
      at: Math.max(x.at || 0, y.at || 0),
    };
    const keys = new Set([...Object.keys(x.with || {}), ...Object.keys(y.with || {})]);
    if (keys.size) {
      const withMap = {};
      keys.forEach((k) => {
        withMap[k] = Math.max((x.with || {})[k] || 0, (y.with || {})[k] || 0);
      });
      entry.with = trimWith(withMap);
    }
    merged[key] = entry;
  });
  return trimKeys(merged);
}
