// Backup/import tests. Kept separate from wiring.js so storage correctness
// can be exercised directly without booting the whole app.
//
//   /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc \
//       -m test/store.js

const rows = new Map();

function clone(value) { return JSON.parse(JSON.stringify(value)); }

globalThis.indexedDB = {
  open() {
    const request = { result: null, onsuccess: null, onerror: null, onupgradeneeded: null };
    const db = {
      objectStoreNames: { contains: () => true },
      transaction() {
        const transaction = { oncomplete: null, onerror: null, onabort: null };
        transaction.objectStore = () => ({
          getAll: () => ({ result: [...rows.values()].map(clone) }),
          get: (id) => ({ result: rows.has(id) ? clone(rows.get(id)) : undefined }),
          put: (profile) => { rows.set(profile.id, clone(profile)); return { result: profile.id }; },
          delete: (id) => { rows.delete(id); return { result: undefined }; },
        });
        Promise.resolve().then(() => { if (transaction.oncomplete) transaction.oncomplete(); });
        return transaction;
      },
    };
    request.result = db;
    Promise.resolve().then(() => { if (request.onsuccess) request.onsuccess(); });
    return request;
  },
};

const store = await import('../src/store.js');
const srs = await import('../src/srs.js');

let failures = 0;
function check(name, condition, detail) {
  if (condition) { print(`ok    ${name}`); return; }
  failures += 1;
  print(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
}

function backup(profiles) {
  return { format: 'kana-quest-backup', version: 1, exportedAt: new Date().toISOString(), profiles };
}

function standardRecord(time, correct = true) {
  return srs.grade(srs.newRecord(), correct, time);
}

function yomiRecord(time, correct = true) {
  return srs.gradeYomi(srs.newYomiRecord(), correct, time);
}

const local = {
  id: 'shared',
  name: 'Learner',
  emoji: '🌱',
  createdAt: 1,
  settings: { ...store.defaultSettings(), newPerSession: 8 },
  progress: {
    'recognition:あ': standardRecord(300),
    'recognition:生:セイ': yomiRecord(200),
    'recognition:生': { box: 1, due: 999, intervalDays: 0, seen: 1, correct: 1, lapses: 0, history: [] },
  },
  study: { 水: ['definition'], 山: ['writing'] },
};
await store.saveProfile(local);

const incomingSei = yomiRecord(400, false);
const incomingShou = yomiRecord(350, true);
const incoming = {
  ...local,
  settings: { ...store.defaultSettings(), newPerSession: 3, strictness: 5 },
  progress: {
    'recognition:あ': standardRecord(100), // older: must not replace local
    'recognition:い': standardRecord(150), // missing locally: must be copied
    'recognition:生:セイ': incomingSei,     // newer Yomi: must replace local
    'recognition:生:ショウ': incomingShou, // missing Yomi: must be copied
    'recognition:生': { box: 6, due: 1, intervalDays: 0, seen: 99, correct: 99, lapses: 0, history: [] },
  },
  study: { 水: ['writing'], 川: ['recognition'] },
};

let result = await store.importAll(backup([incoming]));
let merged = await store.getProfile('shared');

check('an existing learner is reported as merged', result.added === 0 && result.merged === 1, JSON.stringify(result));
check('a newer ordinary local record is not overwritten by an older backup',
  merged.progress['recognition:あ'].updatedAt === 300);
check('a record missing locally is always imported', merged.progress['recognition:い'].updatedAt === 150);
check('a newer Yomi record replaces the older local copy despite having no history array',
  merged.progress['recognition:生:セイ'].lastReviewed === 400
  && merged.progress['recognition:生:セイ'].incorrect === 1);
check('a Yomi record missing locally is imported',
  merged.progress['recognition:生:ショウ'].lastReviewed === 350);
check('the Yomi rollup is rebuilt from the records that survived the merge',
  merged.progress['recognition:生'].seen === 2
  && merged.progress['recognition:生'].correct === 1
  && merged.progress['recognition:生'].lapses === 1
  && merged.progress['recognition:生'].due === Math.min(incomingSei.due, incomingShou.due)
  && merged.progress['recognition:生'].updatedAt === 400,
  JSON.stringify(merged.progress['recognition:生']));
check('legacy array-shaped study lists on both sides are merged into the timestamped shape',
  '水' in merged.study && 'definition' in merged.study.水 && 'writing' in merged.study.水
  && '山' in merged.study && 'writing' in merged.study.山
  && '川' in merged.study && 'recognition' in merged.study.川,
  JSON.stringify(merged.study));
check('a legacy enrollment with no evidence of when carries timestamp 0',
  merged.study.水.definition === 0 && merged.study.水.writing === 0,
  JSON.stringify(merged.study.水));
check('settings already chosen on this device win during a merge',
  merged.settings.newPerSession === 8 && merged.settings.strictness === local.settings.strictness,
  JSON.stringify(merged.settings));

// A deliberate un-enrollment (sync-plan.md §0.1) must survive a merge even
// when the other side's copy still shows the kanji enrolled — the bug a
// plain union (the pre-timestamp model) could never fix, because it can
// only ever add.
srs.setStudying(merged.study, merged.unstudy, '水', 'writing', false, 5000);
await store.saveProfile(merged);
const staleReenroll = {
  ...incoming, progress: {}, unstudy: {},
  study: { 水: { writing: 1000 } }, // older than the removal just made
};
await store.importAll(backup([staleReenroll]));
let afterRemoval = await store.getProfile('shared');
check('a removal survives a merge against an older, still-enrolled copy',
  !srs.isStudying(afterRemoval.study, '水', 'writing')
  && afterRemoval.unstudy.水 && afterRemoval.unstudy.水.writing === 5000,
  JSON.stringify({ study: afterRemoval.study.水, unstudy: afterRemoval.unstudy.水 }));

// ...and the reverse: a re-enrollment newer than the removal beats it.
const freshReenroll = {
  ...incoming, progress: {}, unstudy: {},
  study: { 水: { writing: 9000 } }, // newer than the removal above
};
await store.importAll(backup([freshReenroll]));
const afterReenroll = await store.getProfile('shared');
check('a newer enrollment beats an older removal',
  srs.isStudying(afterReenroll.study, '水', 'writing'),
  JSON.stringify(afterReenroll.study.水));

// Per-key settings LWW (sync-plan.md §0.2): a stamped edit only wins the ONE
// key it's stamped for; an untouched key keeps ticking over to "current
// wins", exactly as if timestamps didn't exist.
afterReenroll.settingsUpdatedAt = { newPerSession: 1000 };
await store.saveProfile(afterReenroll);
const settingsEdit = {
  ...incoming, progress: {}, study: {}, unstudy: {},
  settings: { ...store.defaultSettings(), newPerSession: 2, strictness: 4 },
  settingsUpdatedAt: { newPerSession: 500, strictness: 9000 },
};
await store.importAll(backup([settingsEdit]));
const afterSettings = await store.getProfile('shared');
check('an older stamped edit does not override a newer one on the same key',
  afterSettings.settings.newPerSession === afterReenroll.settings.newPerSession,
  JSON.stringify(afterSettings.settings));
check('a newer stamped edit on one key wins while other keys are unaffected',
  afterSettings.settings.strictness === 4,
  JSON.stringify(afterSettings.settings));

// The block above did several more merges through the store, not through
// this `merged` variable — refetch before using it as a save base again, or
// the save below would silently discard them.
merged = afterSettings;

// Equal-length capped histories used to be permanently stuck on whichever
// copy happened to be local. The newest event must decide instead.
const localCapped = standardRecord(1);
localCapped.history = Array.from({ length: 300 }, (_, i) => [i + 1, 1]);
localCapped.updatedAt = undefined; // exercise compatibility with old records
const incomingCapped = { ...localCapped, history: Array.from({ length: 300 }, (_, i) => [i + 101, 1]) };
merged.progress['definition:水'] = localCapped;
await store.saveProfile(merged);
await store.importAll(backup([{ ...incoming, progress: { 'definition:水': incomingCapped }, study: {} }]));
merged = await store.getProfile('shared');
check('equal-length capped histories use their newest event as the tie-breaker',
  merged.progress['definition:水'].history[299][0] === 400);

// A new learner gets settings defaults filled, but otherwise arrives intact.
const addedProfile = {
  id: 'new', name: 'New learner', emoji: '🐧', createdAt: 2,
  settings: { strictness: 5 }, progress: { 'recognition:う': standardRecord(500) }, study: {},
};
result = await store.importAll(backup([addedProfile]));
const added = await store.getProfile('new');
check('a new learner is added with missing settings defaulted',
  result.added === 1 && result.merged === 0
  && added.settings.strictness === 5 && added.settings.newPerSession === 5);

let invalidRejected = false;
try {
  await store.importAll({ format: 'kana-quest-backup', version: 99, profiles: [] });
} catch { invalidRejected = true; }
check('an unsupported backup version is rejected before writing', invalidRejected);

invalidRejected = false;
try {
  await store.importAll(backup([{ id: 'broken', name: 'Broken', progress: [] }]));
} catch { invalidRejected = true; }
check('a malformed learner profile is rejected before writing', invalidRejected && !rows.has('broken'));

print('');
if (failures) throw new Error(`${failures} failure(s)`);
print('all store tests passed');
