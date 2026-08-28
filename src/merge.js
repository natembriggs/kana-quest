// Pure profile-merge logic. Extracted from store.js so it can be exercised
// directly, and so it can run again later against a decrypted profile pulled
// from the sync server (sync-plan.md §2.4, §4.5) with no IndexedDB involved
// at all. mergeProfiles never touches storage.
//
// Everything here is last-write-wins at whatever grain the field actually
// changes at: per progress record, per (kanji, mode) for study/unstudy
// (sync-plan.md §0.1), per settings key, and once for name/emoji together
// (sync-plan.md §0.2) — always preferring the newer real edit over
// whichever side happens to be the one receiving the merge.

import {
  MAX_BOX, deriveStudyList, isLegacyStudyShape, migrateStudyShape, exposureInternals,
} from './srs.js';

const { exposureEvents, exposureCleared, exposureStrikes } = exposureInternals;

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Latest real grading event represented by a record, including records
 * written before `updatedAt` existed. Rollups have no events of their own;
 * they are rebuilt from per-reading records after the merge below. */
function recordTimestamp(record) {
  if (!isObject(record)) return -Infinity;
  if (Number.isFinite(record.updatedAt)) return record.updatedAt;
  if (Number.isFinite(record.lastReviewed)) return record.lastReviewed;
  if (Array.isArray(record.history)) {
    return record.history.reduce((latest, event) => (
      Array.isArray(event) && Number.isFinite(event[0]) ? Math.max(latest, event[0]) : latest
    ), -Infinity);
  }
  return -Infinity;
}

function recordAttemptCount(record) {
  if (!isObject(record)) return -1;
  if (Array.isArray(record.history)) return record.history.length;
  if (Number.isFinite(record.correct) || Number.isFinite(record.incorrect)) {
    return (Number(record.correct) || 0) + (Number(record.incorrect) || 0);
  }
  return Number(record.seen) || -1;
}

/** Prefer the newer copy. Attempt count is only a backward-compatible
 * tie-breaker for old records that have no timestamp, never the primary
 * signal (ordinary histories are capped and Yomi has no history array). */
function preferIncomingRecord(current, incoming) {
  if (!isObject(current)) return true;
  const currentTime = recordTimestamp(current);
  const incomingTime = recordTimestamp(incoming);
  if (incomingTime !== currentTime) return incomingTime > currentTime;
  return recordAttemptCount(incoming) > recordAttemptCount(current);
}

function mergeProgress(current, incoming) {
  const progress = { ...(current.progress || {}) };
  for (const [key, record] of Object.entries(incoming.progress || {})) {
    if (preferIncomingRecord(progress[key], record)) progress[key] = record;
  }
  return progress;
}

/** Rebuild the two-part kanji scheduling record from the per-reading records
 * that actually survived the merge. Otherwise a mixed local/incoming result
 * could retain a stale rollup from either device until the next Yomi answer. */
function rebuildYomiRollups(progress) {
  const groups = new Map();
  Object.entries(progress).forEach(([key, record]) => {
    const parts = key.split(':');
    if (parts.length !== 3 || !isObject(record) || !Number.isFinite(record.streak)) return;
    const parentKey = `${parts[0]}:${parts[1]}`;
    if (!groups.has(parentKey)) groups.set(parentKey, []);
    groups.get(parentKey).push(record);
  });

  groups.forEach((records, parentKey) => {
    progress[parentKey] = {
      box: Math.min(...records.map((record) => Math.min(record.streak, MAX_BOX))),
      due: Math.min(...records.map((record) => Number(record.due) || 0)),
      intervalDays: 0,
      seen: records.reduce((sum, record) => sum + (Number(record.correct) || 0) + (Number(record.incorrect) || 0), 0),
      correct: records.reduce((sum, record) => sum + (Number(record.correct) || 0), 0),
      lapses: records.reduce((sum, record) => sum + (Number(record.incorrect) || 0), 0),
      history: [],
      updatedAt: Math.max(...records.map(recordTimestamp)),
    };
  });
}

/** Normalizes a profile's study list to the timestamped shape, deriving one
 * from progress if the profile predates study lists entirely, or converting
 * the pre-timestamp array shape if it predates sync-plan.md §0.1. Both
 * happen here — not only in app.js's one-time migration — because an
 * incoming backup or sync document can be in either older shape regardless
 * of what this device has already migrated to. */
function normalizedStudy(profile) {
  const raw = profile.study === undefined ? deriveStudyList(profile.progress) : profile.study;
  const study = isLegacyStudyShape(raw) ? migrateStudyShape(raw) : raw;
  const unstudy = isObject(profile.unstudy) ? profile.unstudy : {};
  return { study, unstudy };
}

/**
 * Merge study enrollment per (kanji, mode), last-write-wins across BOTH
 * sides' study and unstudy maps at once — a removal beats an older
 * enrollment and an enrollment beats an older removal, regardless of which
 * device or which of the two maps it's currently sitting in. See the module
 * note above deriveStudyList in srs.js, and sync-plan.md §0.1.
 */
function mergeStudy(current, incoming) {
  const a = normalizedStudy(current);
  const b = normalizedStudy(incoming);
  const kanjiSet = new Set([
    ...Object.keys(a.study), ...Object.keys(a.unstudy),
    ...Object.keys(b.study), ...Object.keys(b.unstudy),
  ]);

  const study = {};
  const unstudy = {};
  kanjiSet.forEach((kanji) => {
    const modeSet = new Set([
      ...Object.keys(a.study[kanji] || {}), ...Object.keys(a.unstudy[kanji] || {}),
      ...Object.keys(b.study[kanji] || {}), ...Object.keys(b.unstudy[kanji] || {}),
    ]);
    modeSet.forEach((mode) => {
      const candidates = [];
      if (a.study[kanji] && mode in a.study[kanji]) candidates.push([a.study[kanji][mode], true]);
      if (a.unstudy[kanji] && mode in a.unstudy[kanji]) candidates.push([a.unstudy[kanji][mode], false]);
      if (b.study[kanji] && mode in b.study[kanji]) candidates.push([b.study[kanji][mode], true]);
      if (b.unstudy[kanji] && mode in b.unstudy[kanji]) candidates.push([b.unstudy[kanji][mode], false]);
      // Latest timestamp wins; a tie (including two legacy 0s, the common
      // case for anything not touched since this model shipped) favours
      // keeping the enrollment — the same as a plain union would have done,
      // so nothing already-enrolled is dropped by this change alone.
      candidates.sort((x, y) => (y[0] - x[0]) || (Number(y[1]) - Number(x[1])));
      const [timestamp, keep] = candidates[0];
      if (keep) {
        if (!study[kanji]) study[kanji] = {};
        study[kanji][mode] = timestamp;
      } else {
        if (!unstudy[kanji]) unstudy[kanji] = {};
        unstudy[kanji][mode] = timestamp;
      }
    });
  });
  return { study, unstudy };
}

/** Per-key last-write-wins over `settings`, arbitrated by `settingsUpdatedAt`
 * (sync-plan.md §0.2). A key present on only one side always wins outright —
 * e.g. accentColor on a profile saved before it existed. A key present on
 * both sides but stamped on neither (true of every field until app.js's
 * stampSetting() actually touches it) ties, and keeps `current`'s value —
 * the original, pre-timestamp rule, kept as the tie-break so an unedited
 * field never flips sides on its own.
 *
 * Doesn't seed from store.js's defaultSettings() — every profile that has
 * ever gone through this module already has one (createProfile and
 * normalizedNewProfile both apply it), so "missing from both sides" isn't a
 * real case, and seeding it here would need importing store.js, which
 * imports this module.
 */
function mergeSettings(current, incoming) {
  const currentSettings = current.settings || {};
  const incomingSettings = incoming.settings || {};
  const currentStamps = current.settingsUpdatedAt || {};
  const incomingStamps = incoming.settingsUpdatedAt || {};
  const keys = new Set([...Object.keys(currentSettings), ...Object.keys(incomingSettings)]);

  const settings = {};
  const settingsUpdatedAt = {};
  keys.forEach((key) => {
    const hasCurrent = key in currentSettings;
    const hasIncoming = key in incomingSettings;
    if (hasCurrent && hasIncoming) {
      const currentTs = currentStamps[key] || 0;
      const incomingTs = incomingStamps[key] || 0;
      if (incomingTs > currentTs) {
        settings[key] = incomingSettings[key];
        settingsUpdatedAt[key] = incomingTs;
      } else {
        settings[key] = currentSettings[key];
        if (currentTs) settingsUpdatedAt[key] = currentTs;
      }
    } else if (hasCurrent) {
      settings[key] = currentSettings[key];
      if (currentStamps[key] !== undefined) settingsUpdatedAt[key] = currentStamps[key];
    } else {
      settings[key] = incomingSettings[key];
      if (incomingStamps[key] !== undefined) settingsUpdatedAt[key] = incomingStamps[key];
    }
  });
  return { settings, settingsUpdatedAt };
}

/**
 * name/emoji, last-write-wins by `profileUpdatedAt` — one timestamp covers
 * both, since a profile has exactly one name and one badge at a time.
 * `profileUpdatedAt` is written only by a deliberate edit (Settings > Badge,
 * see renderProfileEmojiPicker in app.js), never at creation, so its absence
 * means "never deliberately chosen on this device" rather than "old".
 *
 * `adoptIncoming` is for first-time pairing (§5's "Enter a code"). Both
 * sides usually arrive unstamped there — each device made its own profile
 * with whatever badge the picker defaulted to — and a plain tie would keep
 * the local one, so the badge a parent actually recognises never crosses
 * over. Saying "this device is that learner" is exactly the moment the
 * remote's identity should win. A local badge that WAS deliberately chosen
 * still beats an unstamped remote, so this can't overwrite a real choice.
 */
function mergeIdentity(current, incoming, adoptIncoming) {
  const currentTs = current.profileUpdatedAt || 0;
  const incomingTs = incoming.profileUpdatedAt || 0;
  const takeIncoming = incomingTs > currentTs || (adoptIncoming && currentTs === 0);
  if (takeIncoming) {
    return { name: incoming.name, emoji: incoming.emoji, profileUpdatedAt: incomingTs || undefined };
  }
  return { name: current.name, emoji: current.emoji, profileUpdatedAt: currentTs || undefined };
}

// A one-minute window: two timestamps that close together are almost
// certainly the same real encounter recorded on two devices before they ever
// synced, not two separate ones. Sorted ascending first so the window is
// measured against whichever timestamp is actually adjacent.
const EXPOSURE_MERGE_WINDOW_MS = 60 * 1000;
const EXPOSURE_KEEP = 8;

function dedupeClose(timestamps) {
  const sorted = [...timestamps].sort((a, b) => a - b);
  const out = [];
  sorted.forEach((t) => {
    if (out.length === 0 || t - out[out.length - 1] > EXPOSURE_MERGE_WINDOW_MS) out.push(t);
  });
  return out;
}

/**
 * Union two copies of one exposure key (vocab-plan.md §5.3/§8): timestamps
 * from both sides, deduped within a minute of each other, dropped if older
 * than either side's demotion tombstone, and capped to the newest
 * EXPOSURE_KEEP. Idempotent and commutative by construction — union, dedupe
 * and max all are — which is what stops a three-device household inflating
 * its own exposure count just by syncing more than once.
 *
 * `strikes` (progress toward the NEXT demotion, since the last clear) is
 * taken as the max of both sides rather than summed, for the same reason:
 * two devices independently registering a strike is weaker evidence of two
 * real, distinct unambiguous reveals than it looks, since both may be
 * reporting on encounters close enough in time to be the same session's
 * work echoing back after a sync. Undercounting a strike costs one more
 * reveal before a wrongly-promoted reading is demoted; overcounting would
 * demote a reading the learner never actually got wrong twice.
 */
function mergeExposureEntry(a, b) {
  const cleared = Math.max(exposureCleared(a), exposureCleared(b));
  const events = dedupeClose([...exposureEvents(a), ...exposureEvents(b)])
    .filter((t) => t > cleared)
    .slice(-EXPOSURE_KEEP);
  const strikes = Math.max(exposureStrikes(a), exposureStrikes(b));
  return (cleared || strikes) ? { cleared, events, strikes } : events;
}

/** Per-key union of both sides' exposure maps — see mergeExposureEntry. */
export function mergeExposure(current, incoming) {
  const keys = new Set([...Object.keys(current || {}), ...Object.keys(incoming || {})]);
  const exposure = {};
  keys.forEach((key) => {
    exposure[key] = mergeExposureEntry((current || {})[key], (incoming || {})[key]);
  });
  return exposure;
}

/**
 * Merge one incoming profile into the current copy of the same profile
 * (matched by id by the caller — see importAll in store.js). Pure: no
 * storage, no side effects, so it can run identically whether the incoming
 * copy came from a backup file or a decrypted sync document.
 *
 * `adoptIncomingIdentity` — see mergeIdentity above. Off everywhere except
 * the moment a device pairs with a code for the first time.
 */
export function mergeProfiles(current, incoming, { adoptIncomingIdentity = false } = {}) {
  const progress = mergeProgress(current, incoming);
  rebuildYomiRollups(progress);
  const { study, unstudy } = mergeStudy(current, incoming);
  const exposure = mergeExposure(current.exposure, incoming.exposure);
  const { settings, settingsUpdatedAt } = mergeSettings(current, incoming);
  const { name, emoji, profileUpdatedAt } = mergeIdentity(current, incoming, adoptIncomingIdentity);

  return {
    ...current,
    name,
    emoji,
    profileUpdatedAt,
    settings,
    // Left off entirely when empty, rather than written as `{}`. Both mean
    // "no setting has ever been deliberately changed", but only the absent
    // form matches a profile that predates the field — which is what lets
    // sync recognise a merged copy as identical to what the remote already
    // holds, and skip a pointless push (see matchesRemote in
    // sync-protocol.js).
    settingsUpdatedAt: Object.keys(settingsUpdatedAt).length ? settingsUpdatedAt : undefined,
    progress,
    study,
    unstudy,
    exposure,
  };
}
