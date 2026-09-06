// The learner's side of the feedback loop (feedback-plan.md, "Client data
// model and merge behavior") — everything that is a pure function of a
// profile, with no storage, no fetch and no DOM, so it can be tested
// directly the way merge.js and srs.js are.
//
// The shape of the problem: a report the learner made lives in their
// ENCRYPTED PROFILE, not in an account on a server. There is no login, no
// email and no server-readable identity, so the only thing that proves a
// report is theirs is a random 256-bit receipt token stored in that profile.
// Sync and backup carry it; nothing else can. That is a deliberate trade —
// it is also why the My contributions screen says so out loud, and why
// losing every device, backup and sync code really does lose the history.
//
// Everything here therefore has to survive the same journey as the rest of
// the profile: a merge with another device, an export to a backup file, and
// an import into a copy that has been running independently for a week.

// --- Status vocabulary ------------------------------------------------------

// `sending` is purely local — it exists before the server has ever heard of
// the report. Everything else mirrors the server's own vocabulary.
export const CONTRIBUTION_STATUSES = [
  'sending', 'accepted', 'submitted', 'under_review', 'planned', 'in_progress',
  'fixed', 'released', 'duplicate', 'not_planned', 'delivery_failed',
];

export const CATEGORY_LABEL = {
  bug: 'Something is broken',
  idea: 'An idea',
  content: 'A correction',
  other: 'Something else',
};

/**
 * The growth stage each status draws as in the improvement garden. Five
 * drawings, not eleven: the garden is a feeling, not a status readout, and
 * the cards underneath carry the actual detail.
 */
export const STATUS_STAGE = {
  sending: 'seed',
  accepted: 'seed',
  submitted: 'seed',
  delivery_failed: 'seed',
  under_review: 'sprout',
  planned: 'sprout',
  duplicate: 'sprout',
  in_progress: 'plant',
  fixed: 'bud',
  not_planned: 'bud',
  released: 'flower',
};

/**
 * What the learner reads on the card. Deliberately not the server's copy for
 * the local-only states, which the server has no opinion about.
 *
 * `not_planned` gets the most care of any string in this app. It is the one
 * most likely to be read by a child who tried hard to describe something,
 * and it has to be a real thank-you rather than a rejection notice —
 * reporting, clarifying and confirming that other people hit the same thing
 * are all genuinely useful, and none of them require the idea to be built.
 */
export const STATUS_TEXT = {
  sending: 'Sending…',
  accepted: 'Received — getting it to the team.',
  submitted: 'Thank you — it reached the team.',
  under_review: 'It is being looked at.',
  planned: 'This is planned.',
  in_progress: 'Work has started.',
  fixed: 'Fixed! It will arrive in an app update.',
  released: 'Your idea is in the app you are using now.',
  duplicate: 'Other people asked about this too — your report still helped.',
  not_planned: 'Not something we are going to change — but knowing you hit it genuinely helped.',
  delivery_failed: 'Saved on this device. It has not reached the team yet.',
};

/** Statuses where nothing further will happen, for the "waiting on" count. */
const SETTLED = new Set(['released', 'not_planned', 'duplicate']);

// --- Version comparison -----------------------------------------------------
//
// Mirrors feedback-server/src/version.js. Duplicated rather than shared
// because there is no build step and no module boundary between the app and
// the Worker — but the two have to agree exactly, so both are tested against
// the same cases.
//
// The format is this repository's own convention: YYYY-MM-DD with an
// optional lowercase letter for a second, third … build on one day. A plain
// string comparison very nearly works ('2026-09-05' < '2026-09-05a' is
// true), but the unsuffixed day sorting first is a coincidence of ASCII
// rather than a stated rule, and nothing would catch it changing.

const VERSION_RE = /^(\d{4})-(\d{2})-(\d{2})([a-z]?)$/;

export function parseVersion(value) {
  if (typeof value !== 'string') return null;
  const match = VERSION_RE.exec(value.trim());
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return {
    year: Number(match[1]),
    month,
    day,
    build: match[4] ? match[4].charCodeAt(0) - 96 : 0,
  };
}

/**
 * -1 / 0 / 1, or **null** when either side is unparseable. Null rather than
 * a guess: the caller deciding whether to tell a learner their fix has
 * shipped must be able to tell "older" from "no idea", and treating an
 * unrecognised version as older would celebrate on every single load.
 */
export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  for (const field of ['year', 'month', 'day', 'build']) {
    if (left[field] !== right[field]) return left[field] < right[field] ? -1 : 1;
  }
  return 0;
}

export function atLeast(version, target) {
  const result = compareVersions(version, target);
  return result !== null && result >= 0;
}

// --- Normalization ----------------------------------------------------------

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * One contribution, with every field given a defined type. Returns null for
 * anything unusable, which is how a corrupted entry in a synced profile gets
 * dropped instead of crashing the screen that renders it.
 */
export function normalizeContribution(id, raw) {
  if (!UUID_RE.test(String(id)) || !isObject(raw)) return null;
  const status = CONTRIBUTION_STATUSES.includes(raw.status) ? raw.status : 'sending';
  const number = (value) => (Number.isFinite(value) ? value : null);
  return {
    // The capability. Never logged, never put in a URL, never sent anywhere
    // but the status endpoint over HTTPS and the encrypted profile sync.
    receiptToken: typeof raw.receiptToken === 'string' ? raw.receiptToken : null,
    category: typeof raw.category === 'string' ? raw.category : 'other',
    // Title and category are all that is kept locally for history. The full
    // report body is NOT retained after submission — GitHub is the canonical
    // copy, and this field ends up in plaintext backup exports.
    title: typeof raw.title === 'string' ? raw.title : '',
    // Present only while a draft has not been accepted yet, so a retry
    // survives closing the app. Cleared the moment the server takes it.
    pendingDetails: typeof raw.pendingDetails === 'string' ? raw.pendingDetails : null,
    pendingDiagnostics: isObject(raw.pendingDiagnostics) ? raw.pendingDiagnostics : null,
    createdAt: number(raw.createdAt) || 0,
    status,
    statusUpdatedAt: number(raw.statusUpdatedAt) || 0,
    issueNumber: number(raw.issueNumber),
    issueUrl: typeof raw.issueUrl === 'string' ? raw.issueUrl : null,
    releasedIn: typeof raw.releasedIn === 'string' ? raw.releasedIn : null,
    releaseMessage: typeof raw.releaseMessage === 'string' ? raw.releaseMessage : null,
    acknowledgedVersion: typeof raw.acknowledgedVersion === 'string' ? raw.acknowledgedVersion : null,
    acknowledgedAt: number(raw.acknowledgedAt) || 0,
    // The server's event-id cursor, so a status refresh asks only for what
    // it has not already seen.
    cursor: number(raw.cursor) || 0,
    localUpdatedAt: number(raw.localUpdatedAt) || number(raw.createdAt) || 0,
  };
}

/**
 * A whole profile's contributions map. Returns **undefined** when the
 * profile has no field at all, rather than `{}` — the same trick
 * mergeStories and mergeMnemonics use in merge.js, and for the same reason:
 * a merged copy that has genuinely caught up to the remote must not differ
 * from it by an empty object, or sync would push a pointless no-op write
 * forever (see matchesRemote in sync-protocol.js).
 */
export function normalizeContributions(raw) {
  if (!isObject(raw)) return undefined;
  const out = {};
  Object.keys(raw).forEach((id) => {
    const entry = normalizeContribution(id, raw[id]);
    if (entry) out[id.toLowerCase()] = entry;
  });
  return out;
}

export function normalizeForgotten(raw) {
  if (!isObject(raw)) return undefined;
  const out = {};
  Object.keys(raw).forEach((id) => {
    const at = raw[id];
    if (UUID_RE.test(String(id)) && Number.isFinite(at)) out[id.toLowerCase()] = at;
  });
  return out;
}

// --- Merge ------------------------------------------------------------------

/**
 * Merge one contribution seen on two devices.
 *
 * The split matters. Status is **server-owned**: both devices are looking at
 * the same row on the feedback server through the same receipt, so the copy
 * with the newer `statusUpdatedAt` is simply the fresher read, and taking it
 * wholesale (status, issue number, release fields, cursor) keeps a snapshot
 * internally consistent rather than sewing together halves of two reads.
 *
 * Acknowledgement is **local evidence** and takes the maximum independently:
 * a celebration dismissed on the phone must stay dismissed on the tablet
 * even if the tablet happens to hold a newer status read. Getting this
 * backwards would show the same celebration twice, which is precisely what
 * "once per learner" rules out.
 */
export function mergeContribution(a, b) {
  if (!a) return b;
  if (!b) return a;

  // Ties keep `a` — arbitrary but deterministic, which is what matters when
  // two devices stamp the same millisecond.
  const fresher = (b.statusUpdatedAt || 0) > (a.statusUpdatedAt || 0) ? b : a;
  const staler = fresher === a ? b : a;

  // A pending draft is cleared by acceptance, so "either side has cleared
  // it" means it has been accepted somewhere and must not come back.
  const stillPending = a.pendingDetails !== null && b.pendingDetails !== null;

  return {
    ...fresher,
    // Evidence, so the earliest sighting wins — the report was made once.
    createdAt: Math.min(a.createdAt || Infinity, b.createdAt || Infinity) || fresher.createdAt,
    receiptToken: fresher.receiptToken || staler.receiptToken,
    title: fresher.title || staler.title,
    pendingDetails: stillPending ? fresher.pendingDetails : null,
    pendingDiagnostics: stillPending ? fresher.pendingDiagnostics : null,
    // Independent maxima — see the note above.
    acknowledgedVersion: newerVersion(a.acknowledgedVersion, b.acknowledgedVersion),
    acknowledgedAt: Math.max(a.acknowledgedAt || 0, b.acknowledgedAt || 0),
    cursor: Math.max(a.cursor || 0, b.cursor || 0),
    localUpdatedAt: Math.max(a.localUpdatedAt || 0, b.localUpdatedAt || 0),
  };
}

/** The later of two acknowledged versions, tolerating null and nonsense. */
function newerVersion(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const compared = compareVersions(a, b);
  if (compared === null) return a;
  return compared >= 0 ? a : b;
}

/**
 * Merge both halves of the contribution model across two profiles.
 *
 * A tombstone in `forgottenContributions` beats any contribution record
 * older than it — that is what stops a device that has been in a drawer for
 * a month resurrecting a report the learner deliberately removed. Tombstones
 * themselves are unioned and never expire, because the only thing that can
 * outvote one is the learner making a brand-new report with a brand-new id.
 *
 * Returns `undefined` for a field neither side has ever had, for the
 * no-op-sync reason described on normalizeContributions above.
 */
export function mergeContributions(current, incoming) {
  const a = normalizeContributions(current && current.contributions);
  const b = normalizeContributions(incoming && incoming.contributions);
  const forgottenA = normalizeForgotten(current && current.forgottenContributions);
  const forgottenB = normalizeForgotten(incoming && incoming.forgottenContributions);

  if (!a && !b && !forgottenA && !forgottenB) {
    return { contributions: undefined, forgottenContributions: undefined };
  }

  const forgottenKeys = new Set([
    ...Object.keys(forgottenA || {}),
    ...Object.keys(forgottenB || {}),
  ]);
  const forgotten = {};
  forgottenKeys.forEach((id) => {
    const x = (forgottenA || {})[id];
    const y = (forgottenB || {})[id];
    // Earliest removal wins: the learner meant it the first time.
    forgotten[id] = x && y ? Math.min(x, y) : (x || y);
  });

  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  const contributions = {};
  keys.forEach((id) => {
    if (forgotten[id] !== undefined) return; // tombstoned — stays gone
    const merged = mergeContribution((a || {})[id], (b || {})[id]);
    if (merged) contributions[id] = merged;
  });

  return {
    contributions: (a || b) ? contributions : undefined,
    forgottenContributions: forgottenKeys.size ? forgotten : (forgottenA || forgottenB ? {} : undefined),
  };
}

// --- Applying a server status refresh ---------------------------------------

/**
 * Fold one server status result into a local contribution.
 *
 * The rule that matters: a refresh may only ever move a report **forward**.
 * A cached `released` must never be undone by a stale or partial read — a
 * learner told their fix shipped and then untold it is the worst outcome
 * this whole feature can produce, and it is far likelier to come from a
 * confused client than from the server. So an older `statusUpdatedAt` is
 * ignored outright, and `releasedIn` is never cleared once set.
 *
 * Returns the updated contribution, or the original object unchanged (by
 * identity, so callers can cheaply tell whether anything moved).
 */
export function applyStatusResult(contribution, result) {
  if (!contribution || !result || result.found !== true) return contribution;

  const incomingAt = Number(result.statusUpdatedAt) || 0;
  const knownAt = contribution.statusUpdatedAt || 0;
  const release = typeof result.releasedIn === 'string' ? result.releasedIn : null;

  // Nothing newer, and no release we did not already know about.
  if (incomingAt <= knownAt && (!release || release === contribution.releasedIn)) {
    const cursor = Math.max(contribution.cursor || 0, Number(result.cursor) || 0);
    return cursor === contribution.cursor ? contribution : { ...contribution, cursor };
  }

  return {
    ...contribution,
    status: CONTRIBUTION_STATUSES.includes(result.status) ? result.status : contribution.status,
    statusUpdatedAt: Math.max(knownAt, incomingAt),
    issueNumber: Number.isFinite(result.issueNumber) ? result.issueNumber : contribution.issueNumber,
    issueUrl: typeof result.issueUrl === 'string' ? result.issueUrl : contribution.issueUrl,
    // Never cleared once known.
    releasedIn: release || contribution.releasedIn,
    releaseMessage: typeof result.releaseMessage === 'string'
      ? result.releaseMessage
      : contribution.releaseMessage,
    cursor: Math.max(contribution.cursor || 0, Number(result.cursor) || 0),
    localUpdatedAt: Date.now(),
  };
}

// --- Celebration ------------------------------------------------------------

/**
 * Which contributions deserve a thank-you on this load.
 *
 * All three conditions have to hold, and each rules out a specific way of
 * lying to a learner:
 *
 *   releasedIn exists            — closing an issue is not shipping it
 *   appVersion >= releasedIn     — and this must be the version of the
 *                                  JavaScript actually executing, not what
 *                                  the server last deployed, or a client
 *                                  still held on an old service worker would
 *                                  claim to have a fix it cannot run
 *   acknowledgedVersion < releasedIn — it has not already been celebrated,
 *                                  here or on a synced device
 *
 * Sorted oldest-first so a combined celebration reads in the order the
 * learner reported things.
 */
export function pendingCelebrations(contributions, appVersion) {
  const entries = Object.entries(contributions || {});
  return entries
    .map(([id, c]) => ({ id, ...c }))
    .filter((c) => {
      if (!c.releasedIn) return false;
      if (!atLeast(appVersion, c.releasedIn)) return false;
      if (!c.acknowledgedVersion) return true;
      // Already acknowledged at or past the version that fixed it.
      return !atLeast(c.acknowledgedVersion, c.releasedIn);
    })
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

/**
 * Mark a set of contributions celebrated. Stamped with the version that was
 * actually running, so a later, bigger release can still celebrate
 * separately, and so the merge in mergeContribution has a real version to
 * compare rather than a bare boolean.
 */
export function acknowledgeCelebrations(contributions, ids, appVersion, now = Date.now()) {
  const out = { ...contributions };
  ids.forEach((id) => {
    if (!out[id]) return;
    out[id] = {
      ...out[id],
      acknowledgedVersion: appVersion,
      acknowledgedAt: now,
      localUpdatedAt: now,
    };
  });
  return out;
}

// --- Summary ----------------------------------------------------------------

/**
 * The three small, non-competitive totals at the top of My contributions.
 * No points, no ranking, no streaks — see feedback-plan.md.
 */
export function contributionSummary(contributions) {
  const list = Object.values(contributions || {});
  return {
    shared: list.length,
    inProgress: list.filter((c) => !SETTLED.has(c.status) && c.status !== 'sending').length,
    shipped: list.filter((c) => c.status === 'released').length,
  };
}

/** Newest activity first, which is what a learner is looking for. */
export function sortedContributions(contributions) {
  return Object.entries(contributions || {})
    .map(([id, c]) => ({ id, ...c }))
    .sort((a, b) => (b.statusUpdatedAt || b.createdAt || 0) - (a.statusUpdatedAt || a.createdAt || 0));
}

/**
 * Reports still needing to be sent — an offline draft, or one whose delivery
 * failed. The submit path retries these with the SAME id and receipt, which
 * is what makes retry safe rather than duplicating.
 */
export function unsentContributions(contributions) {
  return Object.entries(contributions || {})
    .map(([id, c]) => ({ id, ...c }))
    .filter((c) => (c.status === 'sending' || c.status === 'delivery_failed') && c.pendingDetails);
}

/**
 * Receipts worth asking the server about. A report that has settled and been
 * acknowledged will never change again, so refreshing it forever would be a
 * request per load for no reason.
 */
export function refreshableContributions(contributions) {
  return Object.entries(contributions || {})
    .map(([id, c]) => ({ id, ...c }))
    .filter((c) => {
      if (!c.receiptToken) return false;
      if (c.status === 'sending') return false;
      if (c.status === 'released' && c.acknowledgedAt) return false;
      if (c.status === 'not_planned' || c.status === 'duplicate') return false;
      return true;
    })
    .slice(0, 50);
}
