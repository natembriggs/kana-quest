// Tests for sync-protocol.js — the pure pull/merge/push/retry state
// machine, driven here against a scripted fake transport rather than real
// fetch/crypto.subtle, neither of which JavaScriptCore has. See
// sync-plan.md §4.1 and §7.
//
//   /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc \
//       -m test/sync.js
//
// Must be run from the repo root.

const { pull, push, syncProfile } = await import('../src/sync-protocol.js');

let failures = 0;
function check(name, condition, detail) {
  if (condition) { print(`ok    ${name}`); return; }
  failures += 1;
  print(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
}

// encrypt/decrypt are identity here — sync-protocol.js treats the result as
// opaque, so real serialization would only add noise to test failures.
const encrypt = async (profile) => profile;
const decrypt = async (ciphertext) => ciphertext;

/** A transport whose pull()/push() responses are scripted per call, in
 * order, recording every call it received for assertions. Each entry in
 * `pulls`/`pushes` is either a response object or a function of the call's
 * arguments returning one, for scenarios where the response depends on what
 * was actually sent (e.g. a conflict resolving once the retry uses the
 * merged version). */
function scriptedTransport(pulls = [], pushes = []) {
  const calls = { pulls: [], pushes: [] };
  const nextFrom = (queue, args) => {
    const entry = queue.shift();
    if (entry === undefined) throw new Error('scriptedTransport: ran out of scripted responses');
    return typeof entry === 'function' ? entry(...args) : entry;
  };
  return {
    calls,
    async pull(docId, knownVersion) {
      calls.pulls.push({ docId, knownVersion });
      return nextFrom(pulls, [docId, knownVersion]);
    },
    async push(docId, version, ciphertext) {
      calls.pushes.push({ docId, version, ciphertext });
      return nextFrom(pushes, [docId, version, ciphertext]);
    },
  };
}

function profile(id, overrides = {}) {
  return {
    id, name: 'Learner', emoji: '🌱', progress: {}, study: {}, unstudy: {}, exposure: {}, muted: {}, settings: {}, ...overrides,
  };
}

function record(updatedAt, correct = true) {
  return { box: 1, due: 0, intervalDays: 0, seen: 1, correct: correct ? 1 : 0, lapses: 0, history: [], updatedAt };
}

// --- pull(): clean pull, 304, and a genuinely new document -----------------

{
  const local = profile('p1');
  const remote = profile('p1', { progress: { 'recognition:あ': record(500) } });
  const transport = scriptedTransport([{ status: 'ok', version: '3', ciphertext: remote }]);
  const result = await pull({ transport, decrypt, docId: 'd1', knownVersion: '2', localProfile: local });
  check('a clean pull merges the remote copy in', result.outcome === 'merged'
    && result.profile.progress['recognition:あ'].updatedAt === 500 && result.version === '3');
}

{
  const local = profile('p1');
  const transport = scriptedTransport([{ status: 'not-modified' }]);
  const result = await pull({ transport, decrypt, docId: 'd1', knownVersion: '3', localProfile: local });
  check('a 304 leaves the local profile untouched', result.outcome === 'unchanged'
    && result.profile === local && result.version === '3');
}

{
  const local = profile('p1');
  const transport = scriptedTransport([{ status: 'not-found' }]);
  const result = await pull({ transport, decrypt, docId: 'd1', knownVersion: null, localProfile: local });
  check('pulling a docId with nothing there yet is "unchanged", not an error',
    result.outcome === 'unchanged' && result.version === null);
}

{
  const local = profile('p1');
  const transport = scriptedTransport([{ status: 'not-found' }]);
  const result = await pull({ transport, decrypt, docId: 'd1', knownVersion: '9', localProfile: local });
  check('a document we knew a version of, now gone, is reported as deleted',
    result.outcome === 'deleted' && result.version === null);
}

// --- push(): create, straightforward update, size ceiling ------------------

{
  const transport = scriptedTransport([], [{ status: 'ok', version: '1' }]);
  const result = await push({
    transport, encrypt, decrypt, docId: 'd1', knownVersion: null, profile: profile('p1'),
  });
  check('a null knownVersion creates (If-None-Match: * under the hood)',
    result.outcome === 'ok' && result.version === '1' && transport.calls.pushes[0].version === null);
}

{
  const transport = scriptedTransport([], [{ status: 'too-large' }]);
  const result = await push({
    transport, encrypt, decrypt, docId: 'd1', knownVersion: '1', profile: profile('p1'),
  });
  check('a 413 is reported as too-large without retrying', result.outcome === 'too-large'
    && transport.calls.pushes.length === 1);
}

// --- push(): the conflict-retry loop (sync-plan.md §4.5) -------------------

{
  // First push: 412 against version 1. Pull (unconditional) returns the
  // copy that beat it, at version 2. Retry with If-Match: 2 succeeds.
  const local = profile('p1', { progress: { 'recognition:あ': record(100) } });
  const winner = profile('p1', { progress: { 'recognition:い': record(200) } });
  const transport = scriptedTransport(
    [{ status: 'ok', version: '2', ciphertext: winner }],
    [{ status: 'conflict', version: '2' }, { status: 'ok', version: '3' }],
  );
  const result = await push({
    transport, encrypt, decrypt, docId: 'd1', knownVersion: '1', profile: local,
  });
  check('a single conflict resolves by pulling, merging, and retrying once',
    result.outcome === 'ok' && result.version === '3'
    && result.profile.progress['recognition:あ'].updatedAt === 100
    && result.profile.progress['recognition:い'].updatedAt === 200);
  check('the retried push actually carries the merged version, not the stale one',
    transport.calls.pushes[1].version === '2');
}

{
  // Every attempt conflicts — retries exhaust and the caller finds out,
  // rather than looping forever or silently dropping local changes.
  const transport = scriptedTransport(
    [
      { status: 'ok', version: '2', ciphertext: profile('p1') },
      { status: 'ok', version: '3', ciphertext: profile('p1') },
      { status: 'ok', version: '4', ciphertext: profile('p1') },
    ],
    [
      { status: 'conflict', version: '2' },
      { status: 'conflict', version: '3' },
      { status: 'conflict', version: '4' },
      { status: 'conflict', version: '5' },
    ],
  );
  const result = await push({
    transport, encrypt, decrypt, docId: 'd1', knownVersion: '1', profile: profile('p1'),
  });
  check('conflicts on every attempt eventually give up rather than retrying forever',
    result.outcome === 'conflict', result.outcome);
}

{
  // 404 on push (If-Match against a version that no longer exists remotely)
  // means the document was deleted — no pull needed, just recreate.
  const transport = scriptedTransport(
    [],
    [{ status: 'not-found' }, { status: 'ok', version: '1' }],
  );
  const result = await push({
    transport, encrypt, decrypt, docId: 'd1', knownVersion: '5', profile: profile('p1'),
  });
  check('a 404 on push recreates the document rather than pulling first',
    result.outcome === 'ok' && result.version === '1' && transport.calls.pulls.length === 0);
  check('the recreate attempt uses If-None-Match: * (a null version), not the stale one',
    transport.calls.pushes[1].version === null);
}

{
  // A network failure mid-push is reported, not thrown or retried forever.
  const transport = scriptedTransport([], [{ status: 'offline' }]);
  const result = await push({
    transport, encrypt, decrypt, docId: 'd1', knownVersion: '1', profile: profile('p1'),
  });
  check('a transport failure surfaces as an error outcome, not an exception',
    result.outcome === 'error');
}

// --- syncProfile(): the combined pull-then-push every UI action uses -------

{
  // Sync now, nothing changed on either side: a 304 pull, then a push that
  // still confirms the remote matches.
  const transport = scriptedTransport(
    [{ status: 'not-modified' }],
    [{ status: 'ok', version: '4' }],
  );
  const result = await syncProfile({
    transport, encrypt, decrypt, docId: 'd1', knownVersion: '4', localProfile: profile('p1'),
  });
  check('nothing changed on either side reports unchanged, and still confirms the remote',
    result.outcome === 'unchanged' && transport.calls.pushes.length === 1);
}

{
  // Enter a code: knownVersion null, remote already has real progress. Pull
  // merges it in, then push writes the union back so the remote reflects
  // both devices, not just whichever paired last.
  const remote = profile('p1', { progress: { 'recognition:あ': record(100) } });
  const local = profile('p1', { progress: { 'recognition:い': record(200) } });
  const transport = scriptedTransport(
    [{ status: 'ok', version: '7', ciphertext: remote }],
    [{ status: 'ok', version: '8' }],
  );
  const result = await syncProfile({
    transport, encrypt, decrypt, docId: 'd1', knownVersion: null, localProfile: local,
  });
  check('pairing with a code that already has data merges both sides and pushes the union',
    result.outcome === 'merged'
    && result.profile.progress['recognition:あ'].updatedAt === 100
    && result.profile.progress['recognition:い'].updatedAt === 200
    && transport.calls.pushes[0].version === '7');
}

{
  // Turn on sync: knownVersion null, nothing exists at this brand-new
  // docId. Pull finds nothing, push creates.
  const transport = scriptedTransport(
    [{ status: 'not-found' }],
    [{ status: 'ok', version: '1' }],
  );
  const result = await syncProfile({
    transport, encrypt, decrypt, docId: 'd1', knownVersion: null, localProfile: profile('p1'),
  });
  check('turning on sync for the first time creates the remote document',
    result.outcome === 'unchanged' && result.version === '1'
    && transport.calls.pushes[0].version === null);
}

{
  // A pull failure is fatal to the whole sync (nothing to merge against
  // safely) — it must not fall through to pushing local over an unknown
  // remote state.
  const transport = scriptedTransport([{ status: 'error' }], []);
  const result = await syncProfile({
    transport, encrypt, decrypt, docId: 'd1', knownVersion: '1', localProfile: profile('p1'),
  });
  check('a failed pull aborts before ever attempting to push',
    result.outcome === 'error' && transport.calls.pushes.length === 0);
}

// --- Not spending requests on nothing (sync-plan.md §4.3) ------------------
// What makes automatic sync affordable: the common cases cost one request,
// not two. These are the paths every launch and every app-switch takes.

{
  // Nothing practised here since the last push, nothing new there: a single
  // conditional GET that comes back 304, and no push at all.
  const transport = scriptedTransport([{ status: 'not-modified' }], []);
  const result = await syncProfile({
    transport, encrypt, decrypt, docId: 'd1', knownVersion: '4',
    localProfile: profile('p1'), localChanged: false,
  });
  check('an unchanged sync with nothing local to send costs one request, not two',
    result.outcome === 'unchanged' && result.pushed === false
    && transport.calls.pulls.length === 1 && transport.calls.pushes.length === 0);
}

{
  // The other device did the work; this one only catches up. The merge
  // result is already exactly what the remote holds, so writing it back
  // would be a pure waste of a request.
  const remote = profile('p1', { progress: { 'recognition:あ': record(100) } });
  const transport = scriptedTransport([{ status: 'ok', version: '9', ciphertext: remote }], []);
  const result = await syncProfile({
    transport, encrypt, decrypt, docId: 'd1', knownVersion: '8',
    localProfile: profile('p1'), localChanged: false,
  });
  check('catching up on another device\'s work needs no write-back',
    result.outcome === 'merged' && result.pushed === false
    && transport.calls.pushes.length === 0
    && result.profile.progress['recognition:あ'].updatedAt === 100);
}

{
  // But local work always gets sent, even when the pull found nothing new.
  const transport = scriptedTransport([{ status: 'not-modified' }], [{ status: 'ok', version: '5' }]);
  const result = await syncProfile({
    transport, encrypt, decrypt, docId: 'd1', knownVersion: '4',
    localProfile: profile('p1'), localChanged: true,
  });
  check('local practice is still pushed when the pull found nothing new',
    result.pushed === true && transport.calls.pushes.length === 1);
}

{
  // And a document that doesn't exist yet is always created, even with
  // nothing local to send — that case is "Turn on sync".
  const transport = scriptedTransport([{ status: 'not-found' }], [{ status: 'ok', version: '1' }]);
  const result = await syncProfile({
    transport, encrypt, decrypt, docId: 'd1', knownVersion: null,
    localProfile: profile('p1'), localChanged: false,
  });
  check('a remote document that does not exist yet is created regardless',
    result.pushed === true && transport.calls.pushes.length === 1);
}

// --- Identity adoption on first pairing (the badge that wouldn't sync) -----

{
  const local = profile('p1', { name: 'Local', emoji: '🌱' });
  const remote = profile('p1', { name: 'Kenji', emoji: '🦊' });
  const transport = scriptedTransport(
    [{ status: 'ok', version: '2', ciphertext: remote }], [{ status: 'ok', version: '3' }],
  );
  const result = await syncProfile({
    transport, encrypt, decrypt, docId: 'd1', knownVersion: null, localProfile: local,
    adoptIncomingIdentity: true,
  });
  check('pairing adopts the other device\'s name and badge when neither was deliberately set',
    result.profile.emoji === '🦊' && result.profile.name === 'Kenji',
    `${result.profile.emoji} ${result.profile.name}`);
}

{
  // ...but a badge this device deliberately chose is a real preference and
  // must survive pairing against an unstamped remote.
  const local = profile('p1', { name: 'Mine', emoji: '🐙', profileUpdatedAt: 5000 });
  const remote = profile('p1', { name: 'Theirs', emoji: '🦊' });
  const transport = scriptedTransport(
    [{ status: 'ok', version: '2', ciphertext: remote }], [{ status: 'ok', version: '3' }],
  );
  const result = await syncProfile({
    transport, encrypt, decrypt, docId: 'd1', knownVersion: null, localProfile: local,
    adoptIncomingIdentity: true,
  });
  check('a deliberately chosen badge is not overwritten by pairing',
    result.profile.emoji === '🐙' && result.profile.name === 'Mine',
    `${result.profile.emoji} ${result.profile.name}`);
}

{
  // Ordinary (non-pairing) sync: newest deliberate edit wins, either way.
  const local = profile('p1', { emoji: '🐙', profileUpdatedAt: 1000 });
  const remote = profile('p1', { emoji: '🦉', profileUpdatedAt: 9000 });
  const transport = scriptedTransport(
    [{ status: 'ok', version: '2', ciphertext: remote }], [{ status: 'ok', version: '3' }],
  );
  const result = await syncProfile({
    transport, encrypt, decrypt, docId: 'd1', knownVersion: '1', localProfile: local,
  });
  check('a newer badge change travels between devices on an ordinary sync',
    result.profile.emoji === '🦉', result.profile.emoji);
}

print('');
if (failures) throw new Error(`${failures} failure(s)`);
print('all sync tests passed');
