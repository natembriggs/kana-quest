// createIssueFor(id) — the one function that turns an accepted row into a
// GitHub issue, and the reason the Lean and Full tracks are the same code
// with a different caller.
//
// Three callers exist today and every one of them is at-least-once: the
// `waitUntil` on the accepting request, the cron sweep, and a client retry
// that arrives while a first attempt is still in flight. GitHub's
// create-issue endpoint has no idempotency key of its own, so the whole
// safety argument lives here:
//
//   1. Nothing but the id crosses the boundary into this function, so user
//      text never appears in a log line or a queue-inspection tool.
//   2. D1 is consulted before every external side effect.
//   3. The claim in claimForCreate() is a conditional UPDATE, so of two
//      racing callers exactly one proceeds.
//   4. If the process dies between GitHub creating the issue and D1
//      recording its number — the one window a claim cannot cover — the next
//      attempt looks for the hidden marker in recent issues instead of
//      creating a second one.

import {
  claimForCreate, getRequest, markDeliveryFailed, releaseClaim, saveIssueNumber,
} from './db.js';
import { createIssue, GitHubError, hasCredential, recentServerIssues } from './github.js';
import { idFromMarker, issueBody, issueLabels, issueTitle } from './issue-body.js';

/**
 * Attempt to give `id` a GitHub issue. Never throws: every caller is either
 * a background task or a scheduled sweep, and there is nobody to report to.
 * Returns a short outcome string, which is what gets logged and counted.
 */
export async function createIssueFor(env, id) {
  const db = env.DB;
  const now = Date.now();

  const row = await getRequest(db, id);
  if (!row) return 'missing';
  if (row.github_issue_number) return 'already-created';

  // An unconfigured server is a temporarily broken one, not a rejecting one:
  // leave the row exactly as it is and let a later sweep pick it up. Checked
  // before the claim so the attempt counter is not run up by a condition
  // that no retry can improve.
  if (!hasCredential(env)) return 'no-credential';

  if (!await claimForCreate(db, id, now)) return 'claimed-elsewhere';

  try {
    // The crash-window check. Only worth its extra API call when a previous
    // attempt actually got far enough to have created something — a first
    // attempt (attempts was 0 before this claim incremented it) cannot have.
    if (row.attempts > 0) {
      const recovered = await findExistingIssue(env, id);
      if (recovered) {
        await saveIssueNumber(db, id, recovered, Date.now());
        return 'recovered';
      }
    }

    const payload = JSON.parse(row.pending_payload || '{}');
    const issue = await createIssue(env, {
      title: issueTitle(row.category, payload.title || 'Feedback'),
      body: issueBody({
        id,
        category: row.category,
        details: payload.details || '',
        diagnostics: payload.diagnostics || {},
        submittedAt: row.created_at,
      }),
      labels: issueLabels(row.category),
    });

    await saveIssueNumber(db, id, issue.number, Date.now());
    return 'created';
  } catch (error) {
    const permanent = error instanceof GitHubError && error.permanent;
    if (permanent) {
      await markDeliveryFailed(db, id, error.message, Date.now());
      return 'failed-permanently';
    }
    // Transient: drop the claim so the next sweep retries straight away
    // rather than waiting out the staleness window.
    await releaseClaim(db, id, Date.now());
    return 'failed-transient';
  }
}

/**
 * Look for an issue this server already created for `id` by reading the
 * hidden marker out of recent issue bodies. Returns the issue number or null.
 *
 * Deliberately a listing rather than a search: GitHub's search index is
 * eventually consistent and can be minutes behind, which is precisely the
 * window this is trying to cover.
 */
async function findExistingIssue(env, id) {
  try {
    const issues = await recentServerIssues(env);
    const match = issues.find((issue) => idFromMarker(issue.body) === id);
    return match ? match.number : null;
  } catch {
    // If the lookup itself fails, fall through to a normal create attempt.
    // A duplicate issue is bad; a report that never arrives is worse, and
    // the UNIQUE constraint on github_issue_number still holds the line.
    return null;
  }
}
