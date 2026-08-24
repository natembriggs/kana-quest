// Pure: no fetch, no crypto.subtle, no IndexedDB. `transport` ({pull, push})
// and `encrypt`/`decrypt` are passed in rather than imported, so this can be
// driven by a stub — see test/sync.js — in an environment (JavaScriptCore)
// that has none of those. The real implementations live in
// sync-transport.js; app.js is what wires them together. See sync-plan.md
// §4.1.

import { mergeProfiles } from './merge.js';

const MAX_PUSH_RETRIES = 3;

/**
 * Pull the remote copy, if it's changed since `knownVersion`, and merge it
 * into `localProfile`. Never writes anywhere — the caller decides whether
 * and how to persist the result. `knownVersion` null means "no opinion, get
 * whatever's there" (first pairing, or recovering from a deleted remote).
 *
 * outcome is one of:
 *   'unchanged' — nothing pulled (304, or nothing exists there yet)
 *   'merged'    — a remote copy was pulled and merged in
 *   'deleted'   — a document we knew a version of no longer exists
 *   'error'     — the transport failed (offline, or an unexpected status)
 */
export async function pull({
  transport, decrypt, docId, knownVersion, localProfile,
}) {
  const result = await transport.pull(docId, knownVersion);
  if (result.status === 'not-modified') {
    return { outcome: 'unchanged', profile: localProfile, version: knownVersion };
  }
  if (result.status === 'not-found') {
    return {
      outcome: knownVersion == null ? 'unchanged' : 'deleted',
      profile: localProfile,
      version: null,
    };
  }
  if (result.status !== 'ok') {
    return { outcome: 'error', profile: localProfile, version: knownVersion };
  }
  const remoteProfile = await decrypt(result.ciphertext);
  return { outcome: 'merged', profile: mergeProfiles(localProfile, remoteProfile), version: result.version };
}

/**
 * Push `profile`, retrying through a conflict by pulling the copy that beat
 * it, merging, and trying again (sync-plan.md §4.5). This converges because
 * the merge is commutative and idempotent per record — whichever device
 * retries, both end up with the same result. `knownVersion` null means
 * "believed not to exist remotely yet" (create, via If-None-Match: *).
 *
 * outcome is one of 'ok', 'conflict' (retries exhausted), 'too-large', or
 * 'error'.
 */
export async function push({
  transport, encrypt, decrypt, docId, knownVersion, profile,
}) {
  let version = knownVersion;
  let current = profile;

  for (let attempt = 0; attempt <= MAX_PUSH_RETRIES; attempt += 1) {
    const ciphertext = await encrypt(current);
    const result = await transport.push(docId, version, ciphertext);

    if (result.status === 'ok') {
      return { outcome: 'ok', profile: current, version: result.version };
    }
    if (result.status === 'too-large') {
      return { outcome: 'too-large', profile: current, version };
    }
    if (result.status === 'not-found') {
      // The remote document was deleted since `version` was last known —
      // nothing to merge against. The next attempt creates it fresh.
      version = null;
      continue;
    }
    if (result.status === 'conflict') {
      if (attempt === MAX_PUSH_RETRIES) return { outcome: 'conflict', profile: current, version };
      const pulled = await transport.pull(docId, null);
      if (pulled.status === 'ok') {
        const remoteProfile = await decrypt(pulled.ciphertext);
        current = mergeProfiles(current, remoteProfile);
        version = pulled.version;
      } else {
        version = null; // gone by the time we looked — create fresh instead
      }
      continue;
    }
    return { outcome: 'error', profile: current, version };
  }
  return { outcome: 'conflict', profile: current, version };
}

/**
 * Pull whatever's changed, merge it in, then push the result so the remote
 * ends up reflecting the same union — not just whichever side happened to
 * write last. This one function covers every sync-plan.md §5 UI action:
 *
 *   Turn on sync  → knownVersion: null on a brand-new docId (nothing to
 *                   pull; push creates)
 *   Enter a code  → knownVersion: null on an existing docId (pulls
 *                   whatever's there, merges, pushes the union back)
 *   Sync now      → knownVersion: the version this device last saw
 *
 * outcome is 'merged' (something new came in), 'unchanged' (nothing did,
 * push still confirmed the remote matches), or one of push's failure
 * outcomes ('conflict', 'too-large', 'error') if the push side failed.
 */
export async function syncProfile({
  transport, encrypt, decrypt, docId, knownVersion, localProfile,
}) {
  const pulled = await pull({
    transport, decrypt, docId, knownVersion, localProfile,
  });
  if (pulled.outcome === 'error') {
    return { outcome: 'error', profile: localProfile, version: knownVersion };
  }
  const pushed = await push({
    transport, encrypt, decrypt, docId, knownVersion: pulled.version, profile: pulled.profile,
  });
  return {
    outcome: pushed.outcome === 'ok' ? pulled.outcome : pushed.outcome,
    profile: pushed.profile,
    version: pushed.version,
  };
}
