// The cron sweep. Runs every five minutes (see wrangler.toml).
//
// On the Lean track this is not an optional backstop. `waitUntil()` extends a
// request's lifetime but is explicitly not a durability guarantee — an
// evicted isolate drops the callback — so a stranded row is the *ordinary*
// failure here, not an exotic one. This is the component that makes "your
// report will reach the team" true.
//
// It is also what files everything that arrived while no GitHub credential
// was configured, which is how the Worker can be deployed and used before
// the token exists.

import { FAILED_PAYLOAD_RETENTION_MS, WEBHOOK_RETENTION_MS } from './config.js';
import { outboxBatch } from './db.js';
import { createIssueFor } from './issues.js';

export async function runSweep(env) {
  const now = Date.now();
  const counts = {};
  const bump = (outcome) => { counts[outcome] = (counts[outcome] || 0) + 1; };

  const ids = await outboxBatch(env.DB, now);
  for (const id of ids) {
    // Sequential, not Promise.all: a burst of GitHub creates is exactly what
    // triggers secondary rate limiting, and there is no deadline pressure on
    // a job that runs again in five minutes.
    bump(await createIssueFor(env, id));
  }

  await cleanup(env, now);

  // One structured line per run. Counts and outcomes only — no ids, no body
  // text, no receipts. A sweep that keeps finding work every run is the
  // signal that `waitUntil` is failing rather than that the sweep is doing
  // its job as a backstop, which is worth alerting on.
  console.log('sweep', JSON.stringify({ found: ids.length, ...counts }));
  return counts;
}

/**
 * Retention. Webhook dedupe rows are replay defence, not history, and a
 * payload that could never be filed is kept just long enough for a person to
 * look at what was lost. Neither touches a learner's actual contribution
 * history, which is the one thing here with no expiry.
 */
async function cleanup(env, now) {
  await env.DB.prepare('DELETE FROM webhook_deliveries WHERE received_at < ?')
    .bind(now - WEBHOOK_RETENTION_MS).run();

  await env.DB.prepare(`
    UPDATE feedback_requests SET pending_payload = NULL
     WHERE pending_payload IS NOT NULL
       AND status = 'delivery_failed'
       AND updated_at < ?
  `).bind(now - FAILED_PAYLOAD_RETENTION_MS).run();

  // Day counters older than a week are of no use to anyone.
  const cutoff = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await env.DB.prepare('DELETE FROM submission_counters WHERE day < ?').bind(cutoff).run();
}
