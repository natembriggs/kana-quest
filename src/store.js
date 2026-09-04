// Per-device storage of learner profiles, in IndexedDB.
//
// Everything the app persists goes through this module, so that swapping
// local storage for a synced backend later is a change to this one file.
//
// Profiles are small (a few hundred records each), so a whole profile
// document is read and written at once rather than storing items separately.

import { DEFAULT_STRICTNESS } from './stroke-grader.js';
import { mergeProfiles } from './merge.js';

const DB_NAME = 'kana-quest';
const DB_VERSION = 3;
const STORE = 'profiles';
// Sync pairing state (sync-plan.md §4.2), keyed by profile id — deliberately
// its own object store rather than a field on the profile, so the profile
// document stays exactly what gets encrypted and uploaded, with nothing to
// strip out first.
const SYNC_STORE = 'sync';
// The code from the most recent successful sync, kept separately from
// SYNC_STORE above and never touched by deleteSyncState — the whole point
// is that it survives sync being turned off. Without this, turning sync
// back on always minted a brand-new code, silently orphaning the old
// document on the server (harmless on its own — see the sweep in
// sync-server/src/document-store.js — but pointless when the same device
// is very plausibly about to resume the same one).
const REMEMBERED_CODE_STORE = 'rememberedCode';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(SYNC_STORE)) {
        db.createObjectStore(SYNC_STORE, { keyPath: 'profileId' });
      }
      if (!db.objectStoreNames.contains(REMEMBERED_CODE_STORE)) {
        db.createObjectStore(REMEMBERED_CODE_STORE, { keyPath: 'profileId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function tx(storeName, mode, run) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = run(transaction.objectStore(storeName));
    transaction.oncomplete = () => resolve(request ? request.result : undefined);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  }));
}

/**
 * Ask the browser not to evict our data. Safari in particular may clear
 * storage for sites that have not been visited recently; this is a request,
 * not a guarantee, which is why export/import exists as a backstop.
 */
export async function requestPersistence() {
  if (!navigator.storage || !navigator.storage.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export function defaultSettings() {
  // maxReviews is deliberately small: a review session is meant to be a
  // smattering, favouring characters that have actually been missed, not a
  // forced march through everything that happens to be due. See srs.js.
  // strictness is writing mode's grading strictness, 1 (Gentle) to 5
  // (Strict) — see STRICTNESS_LEVELS in stroke-grader.js. Per profile, so
  // two children sharing a device can set it differently. A profile saved
  // before this field existed just reads as undefined and falls back to
  // DEFAULT_STRICTNESS wherever it's used — no migration needed.
  // writingModePreference is 'dynamic' (Trace/Guided/Free chosen per
  // character from its own mastery — see autoWritingMode in srs.js) or a
  // fixed 'trace'/'guided'/'free' that applies to every character from the
  // very first one of a session, chosen before starting on the course
  // screen. Same no-migration fallback as strictness.
  // accentColor is one of ACCENT_COLORS' ids (app.js) — the learner's
  // chosen brand colour, applied via a data-accent attribute whenever their
  // profile is open (applyAccentColor() in app.js). Same no-migration
  // fallback as the two above: an old profile reads as undefined and falls
  // back to 'coral', the default, wherever it's read.
  // vocabProgression is which order the vocabulary course is taught in:
  // 'common' (the default — every word ranked by how often it actually turns
  // up, commonest first; see COMMONNESS_MAX in tools/build_vocab_data.py) or
  // 'syllabus' (the GCSE/A-level themes). The same words either way, only
  // grouped and ordered differently, so switching costs no progress — a
  // word's records are keyed by the word, not by the unit it was met in.
  // Same no-migration fallback as the fields above.
  return {
    newPerSession: 5,
    maxReviews: 15,
    strictness: DEFAULT_STRICTNESS,
    writingModePreference: 'dynamic',
    accentColor: 'coral',
    vocabProgression: 'common',
  };
}

export function listProfiles() {
  return tx(STORE, 'readonly', (store) => store.getAll())
    .then((rows) => (rows || []).sort((a, b) => a.createdAt - b.createdAt));
}

export function getProfile(id) {
  return tx(STORE, 'readonly', (store) => store.get(id));
}

/**
 * Saving a profile also marks its sync pairing (if any) as having local
 * changes to send. This lives here rather than at the ~20 call sites
 * precisely so none of them can forget it — a missed mark means practice
 * that silently never reaches the other device.
 *
 * The read is cheap and local; the write only happens on the first save
 * after a successful push, so a whole session of grading costs one extra
 * sync-store write, not one per answer.
 */
export async function saveProfile(profile) {
  await tx(STORE, 'readwrite', (store) => store.put(profile));
  const syncState = await tx(SYNC_STORE, 'readonly', (store) => store.get(profile.id));
  if (syncState && !syncState.dirty) {
    await tx(SYNC_STORE, 'readwrite', (store) => store.put({ ...syncState, dirty: true }));
  }
}

export function deleteProfile(id) {
  return tx(STORE, 'readwrite', (store) => store.delete(id));
}

// --- Sync pairing state ----------------------------------------------------
// One row per profile that has ever turned sync on: { profileId, code,
// docId, version, lastPulledAt, lastPushedAt }. `code` and `docId` are kept
// together so the key never has to be re-derived from a version-less state,
// and `version` is the last remote ETag this device knows about — see
// sync-plan.md §4.2. Absence of a row means "not syncing".

export function getSyncState(profileId) {
  return tx(SYNC_STORE, 'readonly', (store) => store.get(profileId));
}

export function saveSyncState(state) {
  return tx(SYNC_STORE, 'readwrite', (store) => store.put(state));
}

export function deleteSyncState(profileId) {
  return tx(SYNC_STORE, 'readwrite', (store) => store.delete(profileId));
}

// A single string per profile, deliberately outliving deleteSyncState above
// — see REMEMBERED_CODE_STORE. Written on every successful sync (app.js's
// runSync), read only when turning sync on, to resume the same document
// instead of minting a fresh one.
export function rememberSyncCode(profileId, code) {
  return tx(REMEMBERED_CODE_STORE, 'readwrite', (store) => store.put({ profileId, code }));
}

export function getRememberedSyncCode(profileId) {
  return tx(REMEMBERED_CODE_STORE, 'readonly', (store) => store.get(profileId))
    .then((row) => row && row.code);
}

export function createProfile(name, emoji) {
  const profile = {
    id: `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name: String(name || '').trim() || 'Learner',
    emoji: emoji || '🌱',
    createdAt: Date.now(),
    settings: defaultSettings(),
    // itemKey ("mode:kana") -> record, see srs.js
    progress: {},
    // kanji -> {mode: enrolledAt}: which kanji are being studied, in which
    // modes, and since when. Kanji only — see the study-list notes in
    // srs.js. A profile saved before `study` existed has no field at all,
    // which is the trigger for the one-time migration in openProfile()
    // (app.js); a brand-new profile therefore has to start as {} rather than
    // undefined, or it would look like an un-migrated one.
    study: {},
    // kanji -> {mode: removedAt}: the tombstone half of the same model —
    // see the module note above deriveStudyList in srs.js and
    // sync-plan.md §0.1 for why un-enrolling needs one.
    unstudy: {},
    // (kanji, reading) or word -> timestamps a hidden reading was met
    // (vocab-plan.md §5.3). Starts as {} for the same reason `study` and
    // `unstudy` do: a profile saved before this field existed has none at
    // all, which is what tells openProfile() there is nothing to migrate —
    // only to start counting from here.
    exposure: {},
    // (kanji, reading) or word -> when the learner chose "Hide furigana in
    // future" on it (vocab-plan.md §5.3) — a manual, permanent alternative
    // to earning the hidden default by exposure. Same key scheme as
    // `exposure`, same {} starting point, same no-migration story.
    muted: {},
    // Reading progress (stories-plan.md §9) — `read[id]` is when a story was
    // first/last opened and finished, `pos[id]` is where to resume it. Same
    // starting-as-{} reasoning as exposure/muted above: a profile saved
    // before this existed has read nothing, which needs no migration.
    stories: { read: {}, pos: {} },
    // First-run self-placement (onboarding-plan.md §2). `false` is written
    // here and nowhere else: a profile saved before this flow existed has no
    // field at all, which openProfile() (app.js) reads as "already
    // onboarded" — so an existing learner is never sent through it
    // retroactively. Only a genuinely brand-new profile carries the explicit
    // `false` that opens the flow, and completing OR skipping it sets true.
    onboarded: false,
  };
  return saveProfile(profile).then(() => profile);
}

// --- Backup / transfer between devices -----------------------------------
// Progress is per-device for now. These two functions are how a learner
// moves to a new phone or tablet without losing their history.

export async function exportAll() {
  const profiles = await listProfiles();
  return {
    format: 'kana-quest-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    profiles,
  };
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validateBackup(data) {
  if (!data || data.format !== 'kana-quest-backup' || data.version !== 1 || !Array.isArray(data.profiles)) {
    throw new Error('That does not look like a supported Kana Quest backup file.');
  }
  const ids = new Set();
  data.profiles.forEach((profile) => {
    if (!isObject(profile) || typeof profile.id !== 'string' || !profile.id
      || typeof profile.name !== 'string' || !isObject(profile.progress)
      || (profile.settings !== undefined && !isObject(profile.settings))
      || (profile.study !== undefined && !isObject(profile.study))
      || (profile.exposure !== undefined && !isObject(profile.exposure))
      || (profile.muted !== undefined && !isObject(profile.muted))
      || ids.has(profile.id)) {
      throw new Error('That backup contains an invalid learner profile.');
    }
    ids.add(profile.id);
  });
}

function normalizedNewProfile(profile) {
  return {
    ...profile,
    settings: { ...defaultSettings(), ...(profile.settings || {}) },
    progress: { ...profile.progress },
  };
}

/**
 * Merge a backup into this device. Profiles are matched by id. Missing
 * records are always copied; conflicts keep the copy with the latest real
 * grading timestamp. Study enrollment is merged per (kanji, mode) so a
 * deliberate un-enrollment survives just as reliably as a new one (see
 * mergeProfiles in merge.js and sync-plan.md §0.1). Settings and identity
 * are merged per field, by whichever side actually edited them more
 * recently — see the same module for what happens when neither side has.
 */
export async function importAll(data) {
  validateBackup(data);
  const existing = new Map((await listProfiles()).map((p) => [p.id, p]));
  let added = 0;
  let merged = 0;

  for (const incoming of data.profiles) {
    const current = existing.get(incoming.id);
    if (!current) {
      await saveProfile(normalizedNewProfile(incoming));
      added += 1;
      continue;
    }
    await saveProfile(mergeProfiles(current, incoming));
    merged += 1;
  }
  return { added, merged };
}
