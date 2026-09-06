// Every fixed vocabulary the server owns, in one file, because the whole
// safety argument for this service rests on the browser choosing none of it.
// The client picks a category from an enum and types two strings; labels,
// repository, title prefix, issue template, statuses and learner-facing copy
// are all decided here.

export const CATEGORIES = ['bug', 'idea', 'content', 'other'];

export const CATEGORY_LABEL = {
  bug: 'Bug',
  idea: 'Idea',
  content: 'Content correction',
  other: 'Something else',
};

export const CATEGORY_GITHUB_LABEL = {
  bug: 'kind:bug',
  idea: 'kind:idea',
  content: 'kind:content',
  other: 'kind:other',
};

// Applied to every issue this server creates, and the filter every triage
// workflow keys off. Never set from user input.
export const SOURCE_LABEL = 'from:kanaquest-app';

// The learner-facing state machine (feedback-plan.md, "Track triage and
// implementation"). `accepted` is the only one the client sees before an
// issue exists; `sending` lives purely on the client, before this server has
// ever heard of the report.
export const STATUSES = [
  'accepted',
  'submitted',
  'under_review',
  'planned',
  'in_progress',
  'fixed',
  'released',
  'duplicate',
  'not_planned',
  'delivery_failed',
];

// GitHub label -> app status. A label outside this map changes nothing,
// which is the point: a maintainer can use whatever other labels they like
// for their own organisation without any of it leaking into a child's view
// of their report.
export const LABEL_STATUS = {
  'status:reviewing': 'under_review',
  'status:planned': 'planned',
  'status:in-progress': 'in_progress',
  'status:not-planned': 'not_planned',
};

// How far along each status is, used to decide whether an incoming signal is
// a step forward. Webhooks arrive out of order often enough (GitHub retries,
// a label and a close in the same second) that "newest timestamp wins" alone
// would let a stale `under_review` clobber a `released`. Terminal states sit
// at the top; `delivery_failed` is deliberately -1, outside the ladder,
// because it is not a stage of progress but a failure to start.
export const STATUS_RANK = {
  delivery_failed: -1,
  accepted: 0,
  submitted: 1,
  under_review: 2,
  duplicate: 3,
  planned: 3,
  not_planned: 4,
  in_progress: 4,
  fixed: 5,
  released: 6,
};

// The only copy a learner ever sees for a status. Written for a child who
// tried hard to describe something — `not_planned` in particular has to read
// as a real thank-you and not as a rejection notice.
export const STATUS_MESSAGE = {
  accepted: 'Received — getting it to the team.',
  submitted: 'Thank you — it reached the team.',
  under_review: 'It is being looked at.',
  planned: 'This is planned.',
  in_progress: 'Work has started.',
  fixed: 'Fixed, waiting for an app update.',
  released: 'Your feedback improved this version!',
  duplicate: 'Others asked about this too — your report still helped.',
  not_planned: 'Thank you for this. It is not something we are going to change, but knowing you hit it is genuinely useful.',
  delivery_failed: 'Saved on this device, but it could not reach the team yet.',
};

// Input bounds. Small and explicit — a report is a sentence or two from a
// child, not an essay, and every byte past these limits is either a mistake
// or an attack.
export const LIMITS = {
  titleMin: 4,
  titleMax: 100,
  detailsMin: 4,
  detailsMax: 4000,
  bodyBytes: 16 * 1024,
  statusBatch: 50,
  // Per-day cap across every submitter, as an exact backstop behind the
  // eventually-consistent rate-limit binding.
  dailySubmissions: 200,
  receiptBytes: 32,
};

// Diagnostics the client may attach, and the exact allowlist of values each
// may take where the value is itself an enum. Anything not named here is
// dropped rather than rejected, so an older or newer app version adding a
// field can never fail a submission — but also can never smuggle one
// through.
export const DIAGNOSTIC_FIELDS = {
  appVersion: { type: 'string', max: 32 },
  swVersion: { type: 'string', max: 32 },
  screen: { type: 'string', max: 48 },
  course: { type: 'string', max: 48 },
  mode: { type: 'string', max: 32 },
  display: { type: 'enum', values: ['standalone', 'browser'] },
  browser: { type: 'enum', values: ['safari', 'chrome', 'firefox', 'edge', 'samsung', 'other'] },
  platform: { type: 'enum', values: ['ios', 'android', 'mac', 'windows', 'linux', 'other'] },
  viewport: { type: 'enum', values: ['small', 'medium', 'large'] },
  online: { type: 'boolean' },
  locale: { type: 'string', max: 20 },
};

// A GitHub API call that fails with one of these will fail the same way
// forever — a missing repository, a token without Issues write, a body
// GitHub refuses. Retrying is pointless and, at 403, actively harmful
// (secondary rate limiting compounds). Everything else is transient.
export const PERMANENT_GITHUB_STATUS = new Set([400, 401, 403, 404, 410, 422]);

// How long a `creating` row may sit before the sweep assumes its attempt
// died and re-drives it. Long enough that a slow-but-live first attempt is
// not raced; short enough that a learner is not left on "Received" for long.
export const STALE_CREATE_MS = 2 * 60 * 1000;

// Webhook dedupe rows are replay defence, not history.
export const WEBHOOK_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

// A payload that could never be filed is kept this long so a person can see
// what was lost, then erased.
export const FAILED_PAYLOAD_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

// Signed release calls older than this are rejected outright, so a captured
// request body cannot be replayed weeks later.
export const RELEASE_SIGNATURE_WINDOW_MS = 10 * 60 * 1000;
