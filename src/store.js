// Per-device storage of learner profiles, in IndexedDB.
//
// Everything the app persists goes through this module, so that swapping
// local storage for a synced backend later is a change to this one file.
//
// Profiles are small (a few hundred records each), so a whole profile
// document is read and written at once rather than storing items separately.

import { DEFAULT_STRICTNESS } from './stroke-grader.js';

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
    newPerSession: 5, maxReviews: 15, strictness: DEFAULT_STRICTNESS, writingModePreference: 'dynamic',
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

/**
 * Merge a backup into this device. Profiles are matched by id; for a profile
 * that already exists, each item keeps whichever record has the longer
 * history, so importing an older backup can never erase newer practice.
 */
export async function importAll(data) {
  if (!data || data.format !== 'kana-quest-backup' || !Array.isArray(data.profiles)) {
    throw new Error('That does not look like a Kana Quest backup file.');
  }
  const existing = new Map((await listProfiles()).map((p) => [p.id, p]));
  let added = 0;
  let merged = 0;

  for (const incoming of data.profiles) {
    const current = existing.get(incoming.id);
    if (!current) {
      await saveProfile(incoming);
      added += 1;
      continue;
    }
    const progress = { ...current.progress };
    for (const [key, record] of Object.entries(incoming.progress || {})) {
      const mine = progress[key];
      const theirs = record;
      const mineLen = mine && mine.history ? mine.history.length : -1;
      const theirsLen = theirs && theirs.history ? theirs.history.length : -1;
      if (theirsLen > mineLen) progress[key] = theirs;
    }
    await saveProfile({ ...current, progress });
    merged += 1;
  }
  return { added, merged };
}
