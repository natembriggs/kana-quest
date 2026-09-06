-- Feedback routing metadata. See feedback-plan.md, "Server data model".
--
-- The deliberate absence here is as important as what is present: no learner
-- name, no profile id, no progress, no sync code, no IP address, and no clear
-- receipt token. What this database holds is the mapping between an
-- unguessable capability the learner keeps, a GitHub issue number, and a
-- status — nothing that identifies a person.

CREATE TABLE feedback_requests (
  -- The client's crypto.randomUUID(), which doubles as the idempotency key:
  -- a retried submission reuses it, so the second POST finds this row
  -- instead of creating a second issue.
  id TEXT PRIMARY KEY,

  -- HMAC-SHA-256 of the learner's random 256-bit receipt token under a
  -- server-held pepper. The clear token exists only in the learner's
  -- encrypted profile; this column is what a status request is compared
  -- against, in constant time. `receipt_hash_version` lets the pepper
  -- rotate without invalidating every existing receipt at once.
  receipt_hash TEXT NOT NULL,
  receipt_hash_version INTEGER NOT NULL DEFAULT 1,

  category TEXT NOT NULL CHECK (category IN ('bug', 'idea', 'content', 'other')),

  -- The validated title/details/diagnostics, as JSON, held ONLY until the
  -- GitHub issue exists — at which point GitHub is the canonical copy of the
  -- report and this is cleared (feedback-plan.md, "Data retention"). A row
  -- that failed permanently keeps its payload for a documented recovery
  -- window so a person can look at what could not be filed.
  pending_payload TEXT,

  -- The two outbox markers the cron sweep reads, and nothing else.
  -- `dispatched_at`: background creation was scheduled (waitUntil).
  -- `create_started_at`: createIssueFor() actually began. A row with a start
  -- older than a couple of minutes and no issue number is stranded — either
  -- the Worker was evicted mid-flight or GitHub never answered.
  dispatched_at INTEGER,
  create_started_at INTEGER,

  -- UNIQUE is a structural guard against the failure this whole design is
  -- built to avoid: two issues for one report. If a racing retry ever got
  -- past the application-level checks, the second write fails here.
  github_issue_number INTEGER UNIQUE,

  status TEXT NOT NULL,
  status_updated_at INTEGER NOT NULL,

  -- Set when a maintainer marks this a duplicate of another report. The
  -- original learner keeps their contribution; when the canonical issue is
  -- released, the release fans out to every row pointing at it so each
  -- contributor is credited.
  canonical_issue_number INTEGER,

  released_version TEXT,
  release_message TEXT,
  released_at INTEGER,

  -- Bounded free-text describing the last permanent failure, for the
  -- operator only. Never returned to a client.
  failure_reason TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,

  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_requests_issue ON feedback_requests (github_issue_number);
CREATE INDEX idx_requests_status ON feedback_requests (status);
CREATE INDEX idx_requests_released ON feedback_requests (released_version);
CREATE INDEX idx_requests_canonical ON feedback_requests (canonical_issue_number);
-- The exact shape the cron sweep queries on.
CREATE INDEX idx_requests_outbox ON feedback_requests (github_issue_number, create_started_at);

-- An append-only, learner-safe timeline. Every string in `message` is chosen
-- by this server from a fixed vocabulary — a GitHub comment never reaches a
-- learner, because comments carry maintainer shorthand, other people's
-- personal details, and promises that were not meant as product copy.
CREATE TABLE feedback_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feedback_id TEXT NOT NULL REFERENCES feedback_requests (id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  message TEXT,
  source TEXT NOT NULL CHECK (source IN ('submission', 'github', 'release', 'operator')),
  -- Unique per source, which is what makes a replayed webhook delivery or a
  -- re-run release job a no-op rather than a duplicate timeline entry.
  source_event_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_events_feedback ON feedback_events (feedback_id, id);
CREATE UNIQUE INDEX idx_events_source ON feedback_events (source, source_event_id)
  WHERE source_event_id IS NOT NULL;

-- Replay defence for GitHub webhooks. Retained for a bounded period (see the
-- cleanup in src/sweep.js) rather than forever: the point is to reject a
-- redelivery, not to build a permanent event log.
CREATE TABLE webhook_deliveries (
  delivery_id TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL,
  processed_at INTEGER,
  outcome TEXT
);

CREATE INDEX idx_deliveries_received ON webhook_deliveries (received_at);

-- One row per deployed APP_VERSION that credited feedback. Replaying an
-- identical mapping succeeds (the deploy workflow can be re-run); changing
-- an already-recorded version is rejected and needs a deliberate operator
-- action, so a bad re-run cannot silently rewrite what a learner was told.
CREATE TABLE releases (
  version TEXT PRIMARY KEY,
  deployed_at INTEGER NOT NULL,
  source_commit TEXT,
  -- SHA-256 over the canonicalised issue->message mapping.
  mapping_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- The coarse, exact half of abuse control: a per-day count that does not
-- depend on the eventually-consistent rate-limit binding and cannot be
-- reset by rotating an install id. Keyed by day so it prunes trivially.
CREATE TABLE submission_counters (
  day TEXT PRIMARY KEY,
  count INTEGER NOT NULL
);
