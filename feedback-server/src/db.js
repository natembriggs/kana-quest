// Every D1 statement in the service. Bound prepared statements throughout —
// there is no string interpolation into SQL anywhere in this file, and the
// only place a caller chooses a column name is the fixed lists below.

import { STALE_CREATE_MS, STATUS_RANK } from './config.js';

export async function getRequest(db, id) {
  return db.prepare('SELECT * FROM feedback_requests WHERE id = ?').bind(id).first();
}

export async function getRequestByIssue(db, issueNumber) {
  return db.prepare('SELECT * FROM feedback_requests WHERE github_issue_number = ?')
    .bind(issueNumber).first();
}

/**
 * Insert a brand-new request, or return the existing row if this id has been
 * seen before. `INSERT OR IGNORE` plus a read is deliberate over
 * `INSERT ... ON CONFLICT`: the caller needs the *existing* row to compare
 * receipt hashes, and a conflict here is the normal retry path rather than
 * an error.
 *
 * Returns `{ row, created }`.
 */
export async function insertRequest(db, request) {
  const now = request.now;
  const result = await db.prepare(`
    INSERT OR IGNORE INTO feedback_requests
      (id, receipt_hash, receipt_hash_version, category, pending_payload,
       status, status_updated_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'accepted', ?, ?, ?)
  `).bind(
    request.id,
    request.receiptHash,
    request.receiptHashVersion,
    request.category,
    JSON.stringify(request.payload),
    now,
    now,
    now,
  ).run();

  const row = await getRequest(db, request.id);
  const created = !!(result.meta && result.meta.changes);
  if (created) {
    await appendEvent(db, {
      feedbackId: request.id,
      type: 'accepted',
      message: 'Received — getting it to the team.',
      source: 'submission',
      sourceEventId: `accepted:${request.id}`,
      now,
    });
  }
  return { row, created };
}

/**
 * Append one timeline entry, ignoring a repeat of the same source event.
 * This single ON CONFLICT is what makes a redelivered webhook and a re-run
 * release job idempotent at the timeline level, independent of whatever the
 * caller decided about the status column.
 */
export async function appendEvent(db, { feedbackId, type, message, source, sourceEventId, now }) {
  await db.prepare(`
    INSERT INTO feedback_events (feedback_id, type, message, source, source_event_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (source, source_event_id) WHERE source_event_id IS NOT NULL DO NOTHING
  `).bind(feedbackId, type, message || null, source, sourceEventId || null, now).run();
}

export async function listEvents(db, feedbackId, sinceId = 0, limit = 25) {
  const { results } = await db.prepare(`
    SELECT id, type, message, created_at FROM feedback_events
    WHERE feedback_id = ? AND id > ?
    ORDER BY id ASC LIMIT ?
  `).bind(feedbackId, sinceId, limit).all();
  return results || [];
}

export function markDispatched(db, id, now) {
  return db.prepare('UPDATE feedback_requests SET dispatched_at = ?, updated_at = ? WHERE id = ?')
    .bind(now, now, id).run();
}

/**
 * Claim a row for issue creation. The `WHERE` clause is the concurrency
 * control for the whole outbox: it succeeds only if nobody else is
 * mid-attempt (or the previous attempt is old enough to be presumed dead)
 * and no issue exists yet. Two callers racing — a `waitUntil` and a cron
 * sweep, say — mean exactly one gets `changes === 1` and proceeds.
 */
export async function claimForCreate(db, id, now) {
  const result = await db.prepare(`
    UPDATE feedback_requests
       SET create_started_at = ?, attempts = attempts + 1, updated_at = ?
     WHERE id = ?
       AND github_issue_number IS NULL
       AND status != 'delivery_failed'
       AND (create_started_at IS NULL OR create_started_at < ?)
  `).bind(now, now, id, now - STALE_CREATE_MS).run();
  return !!(result.meta && result.meta.changes);
}

/** Release a claim so the next sweep can retry immediately after a transient failure. */
export function releaseClaim(db, id, now) {
  return db.prepare('UPDATE feedback_requests SET create_started_at = NULL, updated_at = ? WHERE id = ?')
    .bind(now, id).run();
}

/**
 * Record the created issue and clear the report body. Once GitHub holds the
 * text, this database has no business keeping a second copy of it — see the
 * data-retention note in feedback-plan.md.
 */
export async function saveIssueNumber(db, id, issueNumber, now) {
  await db.batch([
    db.prepare(`
      UPDATE feedback_requests
         SET github_issue_number = ?, pending_payload = NULL, status = 'submitted',
             status_updated_at = ?, updated_at = ?, failure_reason = NULL
       WHERE id = ? AND github_issue_number IS NULL
    `).bind(issueNumber, now, now, id),
    db.prepare(`
      INSERT INTO feedback_events (feedback_id, type, message, source, source_event_id, created_at)
      VALUES (?, 'submitted', 'Thank you — it reached the team.', 'submission', ?, ?)
      ON CONFLICT (source, source_event_id) WHERE source_event_id IS NOT NULL DO NOTHING
    `).bind(id, `submitted:${id}`, now),
  ]);
}

export async function markDeliveryFailed(db, id, reason, now) {
  await db.batch([
    db.prepare(`
      UPDATE feedback_requests
         SET status = 'delivery_failed', status_updated_at = ?, updated_at = ?,
             failure_reason = ?, create_started_at = NULL
       WHERE id = ? AND github_issue_number IS NULL
    `).bind(now, now, String(reason).slice(0, 300), id),
    db.prepare(`
      INSERT INTO feedback_events (feedback_id, type, message, source, source_event_id, created_at)
      VALUES (?, 'delivery_failed', 'Saved, but it could not reach the team.', 'operator', ?, ?)
      ON CONFLICT (source, source_event_id) WHERE source_event_id IS NOT NULL DO NOTHING
    `).bind(id, `failed:${id}:${now}`, now),
  ]);
}

/**
 * Apply a status change only if it is a step forward on the ladder in
 * config.js, or an explicit reopen. Webhooks arrive out of order often
 * enough that plain last-write-wins would let a stale `under_review` undo a
 * `released` — and a learner being told their fix shipped and then untold it
 * is the single worst thing this service could do.
 *
 * Returns true if the row actually moved.
 */
export async function applyStatus(db, row, next, { message, source, sourceEventId, now, allowRegress = false }) {
  const currentRank = STATUS_RANK[row.status] ?? 0;
  const nextRank = STATUS_RANK[next] ?? 0;
  if (!allowRegress && nextRank <= currentRank && row.status !== next) return false;
  if (row.status === next) {
    // Same status arriving again still gets its timeline entry deduped and
    // dropped by the unique index; nothing to update on the row itself.
    await appendEvent(db, { feedbackId: row.id, type: next, message, source, sourceEventId, now });
    return false;
  }
  await db.batch([
    db.prepare('UPDATE feedback_requests SET status = ?, status_updated_at = ?, updated_at = ? WHERE id = ?')
      .bind(next, now, now, row.id),
    db.prepare(`
      INSERT INTO feedback_events (feedback_id, type, message, source, source_event_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (source, source_event_id) WHERE source_event_id IS NOT NULL DO NOTHING
    `).bind(row.id, next, message || null, source, sourceEventId || null, now),
  ]);
  return true;
}

export function setCanonicalIssue(db, id, canonicalIssueNumber, now) {
  return db.prepare('UPDATE feedback_requests SET canonical_issue_number = ?, updated_at = ? WHERE id = ?')
    .bind(canonicalIssueNumber, now, id).run();
}

/**
 * Rows the cron sweep should re-drive: accepted, no issue yet, not
 * permanently failed, and either never claimed or claimed long enough ago
 * that the attempt is presumed dead. A fresh in-flight attempt is
 * deliberately left alone.
 */
export async function outboxBatch(db, now, limit = 20) {
  const { results } = await db.prepare(`
    SELECT id FROM feedback_requests
     WHERE github_issue_number IS NULL
       AND status IN ('accepted', 'delivery_failed')
       AND (create_started_at IS NULL OR create_started_at < ?)
       AND created_at > ?
     ORDER BY created_at ASC
     LIMIT ?
  `).bind(now - STALE_CREATE_MS, now - 30 * 24 * 60 * 60 * 1000, limit).all();
  return (results || []).map((r) => r.id);
}

/**
 * Every row credited by a release, including duplicates that point at a
 * credited issue through `canonical_issue_number` — that fan-out is how the
 * person whose report was merged into another still gets thanked.
 */
export async function rowsForIssues(db, issueNumbers) {
  if (!issueNumbers.length) return [];
  const placeholders = issueNumbers.map(() => '?').join(',');
  const { results } = await db.prepare(`
    SELECT * FROM feedback_requests
     WHERE github_issue_number IN (${placeholders})
        OR canonical_issue_number IN (${placeholders})
  `).bind(...issueNumbers, ...issueNumbers).all();
  return results || [];
}

export async function recordRelease(db, { version, deployedAt, sourceCommit, mappingHash, now }) {
  const existing = await db.prepare('SELECT * FROM releases WHERE version = ?').bind(version).first();
  if (existing) {
    // A re-run of the same deploy is fine and must be a no-op. A *different*
    // mapping for a version learners have already been told about is not
    // something to guess at — it needs a person.
    return { ok: existing.mapping_hash === mappingHash, replay: true, existing };
  }
  await db.prepare(`
    INSERT INTO releases (version, deployed_at, source_commit, mapping_hash, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(version, deployedAt, sourceCommit || null, mappingHash, now).run();
  return { ok: true, replay: false };
}

export async function markReleased(db, row, { version, message, now }) {
  await db.batch([
    db.prepare(`
      UPDATE feedback_requests
         SET status = 'released', status_updated_at = ?, released_version = ?,
             release_message = ?, released_at = ?, updated_at = ?
       WHERE id = ? AND (released_version IS NULL OR released_version = ?)
    `).bind(now, version, message, now, now, row.id, version),
    db.prepare(`
      INSERT INTO feedback_events (feedback_id, type, message, source, source_event_id, created_at)
      VALUES (?, 'released', ?, 'release', ?, ?)
      ON CONFLICT (source, source_event_id) WHERE source_event_id IS NOT NULL DO NOTHING
    `).bind(row.id, message, `release:${version}:${row.id}`, now),
  ]);
}

/** Webhook replay defence. Returns false if this delivery has been seen. */
export async function claimDelivery(db, deliveryId, now) {
  const result = await db.prepare(
    'INSERT OR IGNORE INTO webhook_deliveries (delivery_id, received_at) VALUES (?, ?)',
  ).bind(deliveryId, now).run();
  return !!(result.meta && result.meta.changes);
}

export function finishDelivery(db, deliveryId, outcome, now) {
  return db.prepare('UPDATE webhook_deliveries SET processed_at = ?, outcome = ? WHERE delivery_id = ?')
    .bind(now, String(outcome).slice(0, 80), deliveryId).run();
}

/**
 * The exact, non-eventually-consistent half of abuse control: one counter
 * per UTC day across every submitter. Returns the count after incrementing.
 */
export async function bumpDailyCounter(db, day) {
  await db.prepare(`
    INSERT INTO submission_counters (day, count) VALUES (?, 1)
    ON CONFLICT (day) DO UPDATE SET count = count + 1
  `).bind(day).run();
  const row = await db.prepare('SELECT count FROM submission_counters WHERE day = ?').bind(day).first();
  return row ? row.count : 0;
}
