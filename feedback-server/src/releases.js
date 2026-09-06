// POST /v1/admin/releases — the one call that is allowed to say "this fix is
// actually on learners' devices".
//
// Everything else in the pipeline stops at `fixed`. A merged pull request, a
// closed issue, even a green deploy are all "the code work is done"; only a
// deployment that has succeeded can name the exact APP_VERSION containing a
// given issue, and only then can the app truthfully thank anyone. Getting
// this wrong in the optimistic direction — celebrating a fix a learner
// cannot yet see — is the failure this whole distinction exists to prevent.
//
// Not a browser endpoint. Called by release automation (or by hand as the
// break-glass path) with an HMAC over the raw body and a timestamp.

import { RELEASE_SIGNATURE_WINDOW_MS } from './config.js';
import { hmacBytesHex, sha256Hex, timingSafeEqual } from './crypto.js';
import { markReleased, recordRelease, rowsForIssues } from './db.js';
import { isValidVersion } from './version.js';

/**
 * The signature covers the timestamp and the raw body together, so a
 * captured request cannot be replayed later with a fresh timestamp bolted
 * on. Same construction as the GitHub webhook, different secret.
 */
export async function signRelease(secret, timestamp, rawBytes) {
  const prefix = new TextEncoder().encode(`${timestamp}.`);
  const joined = new Uint8Array(prefix.length + rawBytes.byteLength);
  joined.set(prefix, 0);
  joined.set(new Uint8Array(rawBytes), prefix.length);
  return `sha256=${await hmacBytesHex(secret, joined)}`;
}

/**
 * Canonical form of the credited mapping, so that a re-run of the same
 * deploy hashes identically regardless of key order or issue order, while a
 * genuinely different mapping for the same version does not.
 */
export function mappingFingerprint(credits) {
  const canonical = [...credits]
    .map((c) => ({ issue: Number(c.issue), message: String(c.message || '') }))
    .sort((a, b) => a.issue - b.issue)
    .map((c) => `${c.issue}:${c.message}`)
    .join('\n');
  return sha256Hex(canonical);
}

export async function handleRelease(request, env, rawBytes) {
  const secret = env.RELEASE_SECRET;
  if (!secret) return json({ ok: false, code: 'not_configured' }, 503);

  const timestamp = Number(request.headers.get('x-kanaquest-timestamp'));
  const signature = request.headers.get('x-kanaquest-signature');
  if (!timestamp || !signature) return json({ ok: false, code: 'unsigned' }, 401);

  // A stale request is rejected before the signature is even checked against
  // the body: it costs nothing and shrinks the replay window to minutes.
  if (Math.abs(Date.now() - timestamp) > RELEASE_SIGNATURE_WINDOW_MS) {
    return json({ ok: false, code: 'stale' }, 401);
  }

  const expected = await signRelease(secret, timestamp, rawBytes);
  if (!timingSafeEqual(expected, signature)) return json({ ok: false, code: 'bad_signature' }, 401);

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(rawBytes));
  } catch {
    return json({ ok: false, code: 'bad_json' }, 400);
  }

  const version = payload && payload.version;
  if (!isValidVersion(version)) return json({ ok: false, code: 'bad_version' }, 400);

  const credits = Array.isArray(payload.credits) ? payload.credits : [];
  for (const credit of credits) {
    if (!credit || !Number.isInteger(credit.issue) || credit.issue <= 0) {
      return json({ ok: false, code: 'bad_credit' }, 400);
    }
    if (typeof credit.message !== 'string' || credit.message.length > 300) {
      return json({ ok: false, code: 'bad_credit_message' }, 400);
    }
  }

  const now = Date.now();
  const fingerprint = await mappingFingerprint(credits);
  const recorded = await recordRelease(env.DB, {
    version,
    deployedAt: Number(payload.deployedAt) || now,
    sourceCommit: typeof payload.commit === 'string' ? payload.commit.slice(0, 64) : null,
    mappingHash: fingerprint,
    now,
  });

  if (!recorded.ok) {
    // The version exists with a different mapping. Re-running a deploy is
    // fine; quietly rewriting what a learner was already told is not.
    return json({ ok: false, code: 'version_conflict' }, 409);
  }

  // Fan out to every credited issue AND to every report a maintainer marked
  // as a duplicate of one — the whole point of keeping canonical_issue_number
  // is that the second person to report something still gets thanked.
  const issueNumbers = credits.map((c) => c.issue);
  const rows = await rowsForIssues(env.DB, issueNumbers);
  const messageFor = new Map(credits.map((c) => [c.issue, c.message]));

  let credited = 0;
  for (const row of rows) {
    const key = messageFor.has(row.github_issue_number)
      ? row.github_issue_number
      : row.canonical_issue_number;
    const message = messageFor.get(key);
    if (!message) continue;
    await markReleased(env.DB, row, { version, message, now });
    credited += 1;
  }

  return json({
    ok: true,
    version,
    replay: recorded.replay,
    credited,
    // Issues named in the payload that no row maps to. Almost always a fix
    // for something nobody reported through the app, which is normal — but
    // worth surfacing in the workflow log rather than swallowing.
    unmatched: issueNumbers.filter((n) => !rows.some(
      (r) => r.github_issue_number === n || r.canonical_issue_number === n,
    )),
  }, 200);
}

/**
 * POST /v1/admin/duplicate — links a report to the canonical one it
 * duplicates, which GitHub's own webhook payload does not tell us. Same
 * signature scheme as a release, because it has the same consequence: it
 * decides who gets credited when the canonical issue ships.
 */
export async function handleDuplicateLink(request, env, rawBytes) {
  const secret = env.RELEASE_SECRET;
  if (!secret) return json({ ok: false, code: 'not_configured' }, 503);

  const timestamp = Number(request.headers.get('x-kanaquest-timestamp'));
  const signature = request.headers.get('x-kanaquest-signature');
  if (!timestamp || !signature) return json({ ok: false, code: 'unsigned' }, 401);
  if (Math.abs(Date.now() - timestamp) > RELEASE_SIGNATURE_WINDOW_MS) {
    return json({ ok: false, code: 'stale' }, 401);
  }
  const expected = await signRelease(secret, timestamp, rawBytes);
  if (!timingSafeEqual(expected, signature)) return json({ ok: false, code: 'bad_signature' }, 401);

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(rawBytes));
  } catch {
    return json({ ok: false, code: 'bad_json' }, 400);
  }

  const { issue, canonical } = payload || {};
  if (!Number.isInteger(issue) || !Number.isInteger(canonical) || issue === canonical) {
    return json({ ok: false, code: 'bad_request' }, 400);
  }

  const result = await env.DB.prepare(
    'UPDATE feedback_requests SET canonical_issue_number = ?, updated_at = ? WHERE github_issue_number = ?',
  ).bind(canonical, Date.now(), issue).run();

  return json({ ok: true, linked: !!(result.meta && result.meta.changes) }, 200);
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
