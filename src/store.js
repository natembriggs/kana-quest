// Per-device storage of learner profiles, in IndexedDB.
//
// Everything the app persists goes through this module, so that swapping
// local storage for a synced backend later is a change to this one file.
//
// Profiles are small (a few hundred records each), so a whole profile
// document is read and written at once rather than storing items separately.

import { DEFAULT_STRICTNESS } from './stroke-grader.js';
import { MAX_BOX, deriveStudyList } from './srs.js';

const DB_NAME = 'kana-quest';
const DB_VERSION = 1;
const STORE = 'profiles';

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
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function tx(mode, run) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = run(transaction.objectStore(STORE));
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
  return {
    newPerSession: 5,
    maxReviews: 15,
    strictness: DEFAULT_STRICTNESS,
    writingModePreference: 'dynamic',
  };
}

export function listProfiles() {
  return tx('readonly', (store) => store.getAll())
    .then((rows) => (rows || []).sort((a, b) => a.createdAt - b.createdAt));
}

export function getProfile(id) {
  return tx('readonly', (store) => store.get(id));
}

export function saveProfile(profile) {
  return tx('readwrite', (store) => store.put(profile));
}

export function deleteProfile(id) {
  return tx('readwrite', (store) => store.delete(id));
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
    // kanji -> [mode, ...]: which kanji are being studied, and in which
    // modes. Kanji only — see the study-list notes in srs.js. A profile saved
    // before this field existed has no `study` at all, which is the trigger
    // for the one-time migration in openProfile() (app.js); a brand-new
    // profile therefore has to start as {} rather than undefined, or it would
    // look like an un-migrated one.
    study: {},
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

function mergeStudyLists(currentStudy, incomingStudy) {
  const merged = {};
  [currentStudy, incomingStudy].forEach((study) => {
    if (!isObject(study)) return;
    Object.entries(study).forEach(([kanji, modes]) => {
      if (!Array.isArray(modes)) return;
      if (!merged[kanji]) merged[kanji] = [];
      modes.forEach((mode) => {
        if (typeof mode === 'string' && !merged[kanji].includes(mode)) merged[kanji].push(mode);
      });
      if (merged[kanji].length === 0) delete merged[kanji];
    });
  });
  return merged;
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
 * grading timestamp. Study enrollment is unioned so a transfer cannot
 * silently drop a chosen kanji/mode. Settings already chosen on this device
 * win, while missing settings are filled from the backup/defaults.
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
    const progress = { ...(current.progress || {}) };
    for (const [key, record] of Object.entries(incoming.progress || {})) {
      if (preferIncomingRecord(progress[key], record)) progress[key] = record;
    }
    rebuildYomiRollups(progress);

    // Profiles saved before the explicit study list derive enrollment from
    // progress. Do that before unioning so importing cannot make their
    // already-practised kanji disappear from scheduling.
    const currentStudy = current.study === undefined ? deriveStudyList(current.progress) : current.study;
    const incomingStudy = incoming.study === undefined ? deriveStudyList(incoming.progress) : incoming.study;
    const study = mergeStudyLists(currentStudy, incomingStudy);
    const settings = {
      ...defaultSettings(),
      ...(incoming.settings || {}),
      ...(current.settings || {}),
    };

    await saveProfile({ ...current, settings, progress, study });
    merged += 1;
  }
  return { added, merged };
}
