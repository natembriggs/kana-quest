// POST /v1/github/webhook — the bridge that turns maintainer activity in
// GitHub into the small, curated state a learner sees.
//
// The translation is deliberately lossy. Only labels from a fixed map, close
// reasons, and reopens become app state. Issue *comments* never do: they
// carry maintainer shorthand, other people's personal details, hostile text
// from anyone who can reach the repository, and promises that were never
// meant as product copy. A child's contribution screen is not a mirror of a
// bug tracker.

import { LABEL_STATUS, STATUS_MESSAGE } from './config.js';
import {
  applyStatus, claimDelivery, finishDelivery, getRequestByIssue, setCanonicalIssue,
} from './db.js';
import { hmacBytesHex, timingSafeEqual } from './crypto.js';

/**
 * Verify X-Hub-Signature-256 over the *raw* bytes. Re-serialising the parsed
 * JSON and signing that would pass for ASCII and fail the moment a learner
 * writes in Japanese or uses an emoji, so the body is read once as an
 * ArrayBuffer and both the signature check and the parse work from it.
 */
export async function verifySignature(secret, rawBytes, headerValue) {
  if (!secret || typeof headerValue !== 'string' || !headerValue.startsWith('sha256=')) return false;
  const expected = await hmacBytesHex(secret, rawBytes);
  return timingSafeEqual(expected, headerValue.slice('sha256='.length).toLowerCase());
}

/**
 * Decide what an `issues` event means, as a pure function of the payload, so
 * the whole label/close/reopen vocabulary can be tested without a database.
 * Returns null when the event should change nothing at all — which is the
 * common case and must stay cheap and silent.
 */
export function translateIssueEvent(action, payload) {
  const issue = payload.issue || {};
  const labels = (issue.labels || []).map((l) => (typeof l === 'string' ? l : l.name));

  if (action === 'closed') {
    // GitHub's state_reason distinguishes "we did it" from "we are not going
    // to" from "someone else already asked". All three are legitimate
    // endings for a report and each gets its own honest copy.
    const reason = issue.state_reason;
    if (reason === 'not_planned') return { status: 'not_planned' };
    if (reason === 'duplicate') return { status: 'duplicate' };
    // `completed`, or an older payload with no reason at all. Closing means
    // the code work is done — never that a learner's phone is running it.
    // Only a signed release call can say that.
    return { status: 'fixed' };
  }

  if (action === 'reopened') {
    // Back to whatever the labels currently claim, or plain "being looked
    // at" if they claim nothing. allowRegress, because a reopen is the one
    // signal that legitimately moves a report *backwards*.
    const fromLabel = labels.map((name) => LABEL_STATUS[name]).find(Boolean);
    return { status: fromLabel || 'under_review', allowRegress: true };
  }

  if (action === 'labeled' || action === 'unlabeled') {
    // Recomputed from the issue's whole current label set rather than from
    // the one label in `payload.label`: removing `status:planned` should
    // fall back to whatever else is set, not leave the app asserting a state
    // the tracker no longer shows.
    const statuses = labels.map((name) => LABEL_STATUS[name]).filter(Boolean);
    if (!statuses.length) return null;
    // If a maintainer has several status labels on at once, the furthest
    // along wins — that is almost always the one they just added.
    const ranked = ['not_planned', 'under_review', 'planned', 'in_progress'];
    const best = statuses.sort((a, b) => ranked.indexOf(b) - ranked.indexOf(a))[0];
    return { status: best };
  }

  return null;
}

export async function handleWebhook(request, env, rawBytes) {
  const db = env.DB;
  const secret = env.GITHUB_WEBHOOK_SECRET;
  const signature = request.headers.get('x-hub-signature-256');
  const deliveryId = request.headers.get('x-github-delivery');
  const event = request.headers.get('x-github-event');

  if (!secret) return new Response('not configured', { status: 503 });
  if (!await verifySignature(secret, rawBytes, signature)) {
    return new Response('bad signature', { status: 401 });
  }
  if (!deliveryId) return new Response('missing delivery id', { status: 400 });

  // Ping is what GitHub sends when the hook is first saved; answering it is
  // how the setup UI shows a green tick.
  if (event === 'ping') return new Response('pong', { status: 200 });
  if (event !== 'issues') return new Response('ignored', { status: 202 });

  const now = Date.now();
  if (!await claimDelivery(db, deliveryId, now)) {
    // A redelivery. Already handled; saying so is not an error.
    return new Response('duplicate', { status: 200 });
  }

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(rawBytes));
  } catch {
    await finishDelivery(db, deliveryId, 'unparseable', Date.now());
    return new Response('bad json', { status: 400 });
  }

  // The repository is pinned to configuration, not taken from the payload.
  // A hook accidentally installed somewhere else, or a forged delivery that
  // somehow had the secret, still cannot write to rows it does not own.
  const repo = payload.repository || {};
  if (repo.name !== env.GITHUB_REPO || (repo.owner && repo.owner.login) !== env.GITHUB_OWNER) {
    await finishDelivery(db, deliveryId, 'wrong-repo', Date.now());
    return new Response('wrong repository', { status: 202 });
  }

  const issueNumber = payload.issue && payload.issue.number;
  if (!issueNumber) {
    await finishDelivery(db, deliveryId, 'no-issue', Date.now());
    return new Response('ignored', { status: 202 });
  }

  const row = await getRequestByIssue(db, issueNumber);
  if (!row) {
    // An issue opened by hand in the inbox repository. Perfectly normal;
    // there is simply no learner waiting on it.
    await finishDelivery(db, deliveryId, 'unmapped', Date.now());
    return new Response('unmapped', { status: 202 });
  }

  const translated = translateIssueEvent(payload.action, payload);
  if (!translated) {
    await finishDelivery(db, deliveryId, 'no-op', Date.now());
    return new Response('no change', { status: 200 });
  }

  if (translated.status === 'duplicate') {
    // GitHub's payload does not name the canonical issue for a duplicate
    // close, so the link is recorded separately by the operator endpoint.
    // Until then the learner still gets an honest "others asked too".
    await setCanonicalIssue(db, row.id, row.canonical_issue_number || null, Date.now());
  }

  const moved = await applyStatus(db, row, translated.status, {
    message: STATUS_MESSAGE[translated.status],
    source: 'github',
    sourceEventId: deliveryId,
    now: Date.now(),
    allowRegress: !!translated.allowRegress,
  });

  await finishDelivery(db, deliveryId, moved ? translated.status : 'no-change', Date.now());
  return new Response(moved ? 'updated' : 'no change', { status: 200 });
}
