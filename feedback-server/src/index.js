// kana-quest-feedback — the Worker that turns an in-app report into a GitHub
// issue and reports its progress back, without the browser ever holding a
// GitHub credential and without this service ever learning who a learner is.
//
// Kept deliberately separate from kana-quest-sync. That Worker cannot read
// its own payload and broad CORS is a considered part of its design; this one
// validates and formats user text, holds a GitHub credential, and gets a real
// origin allowlist. Two trust models, two Workers — so a bug or a leaked key
// here cannot reach the encrypted profile store, and the privacy promise of
// sync stays easy to state and audit.
//
// See feedback-plan.md for the full design and README.md for setup.

import { LIMITS, STATUS_MESSAGE } from './config.js';
import { bumpDailyCounter, getRequest, insertRequest, listEvents, markDispatched } from './db.js';
import { receiptHash, timingSafeEqual } from './crypto.js';
import { createIssueFor } from './issues.js';
import { handleDuplicateLink, handleRelease } from './releases.js';
import { handleWebhook } from './webhook.js';
import { runSweep } from './sweep.js';
import { parseStatusRequest, parseSubmission, ValidationError } from './validate.js';
import { verifyTurnstile } from './turnstile.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('origin');

    if (request.method === 'OPTIONS') return preflight(request, env);

    // The webhook and the two admin endpoints are machine-to-machine and
    // authenticate with their own signatures; they are not browser routes and
    // get no CORS headers at all.
    if (url.pathname === '/v1/github/webhook' && request.method === 'POST') {
      return handleWebhook(request, env, await request.arrayBuffer());
    }
    if (url.pathname === '/v1/admin/releases' && request.method === 'POST') {
      return handleRelease(request, env, await request.arrayBuffer());
    }
    if (url.pathname === '/v1/admin/duplicate' && request.method === 'POST') {
      return handleDuplicateLink(request, env, await request.arrayBuffer());
    }

    if (url.pathname === '/health') {
      return withCors(json({ ok: true, service: 'kana-quest-feedback' }), request, env);
    }

    // Browser routes below. An unlisted origin is refused outright rather
    // than merely being denied a CORS header — a header-only refusal still
    // runs the whole handler, which for a route that creates GitHub issues
    // is the wrong shape of protection.
    if (!originAllowed(origin, env)) {
      return withCors(json({ ok: false, code: 'origin_not_allowed' }, 403), request, env);
    }

    try {
      if (url.pathname === '/v1/feedback' && request.method === 'POST') {
        return withCors(await handleSubmit(request, env, ctx), request, env);
      }
      if (url.pathname === '/v1/feedback/status' && request.method === 'POST') {
        return withCors(await handleStatus(request, env), request, env);
      }
    } catch (error) {
      if (error instanceof ValidationError) {
        return withCors(json({ ok: false, code: error.code }, 400), request, env);
      }
      // Never leak a D1 or GitHub error to a browser. The request id in the
      // log is how an operator finds the real one.
      console.error('unhandled', { path: url.pathname, error: String(error) });
      return withCors(json({ ok: false, code: 'server_error' }, 500), request, env);
    }

    return withCors(json({ ok: false, code: 'not_found' }, 404), request, env);
  },

  /**
   * The outbox sweep (feedback-plan.md, "Create the GitHub issue"). Not a
   * backstop for an exotic failure: on the Lean track an evicted `waitUntil`
   * is the ordinary way a row gets stranded, so this is the component that
   * actually guarantees a report reaches GitHub eventually.
   */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runSweep(env));
  },
};

// --- Submission -------------------------------------------------------------

async function handleSubmit(request, env, ctx) {
  if (env.ACCEPTING_SUBMISSIONS === 'false') {
    // The kill switch. Status reads and sync keep working, so a learner
    // mid-flow still sees their existing history.
    return json({ ok: false, code: 'submissions_paused' }, 503);
  }

  const raw = await request.arrayBuffer();
  if (raw.byteLength > LIMITS.bodyBytes) return json({ ok: false, code: 'too_large' }, 413);

  let body;
  try {
    body = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return json({ ok: false, code: 'bad_json' }, 400);
  }

  const submission = parseSubmission(body);
  const db = env.DB;
  const now = Date.now();

  // Retry before Turnstile. A submission whose response was lost after the
  // single-use Turnstile token had already been redeemed would otherwise be
  // unretryable: the client has a perfectly good id and receipt, but no way
  // to spend them. So an id that already exists is resolved first — matching
  // receipt means "this is your row, here it is", and the expensive checks
  // are skipped entirely.
  const existing = await getRequest(db, submission.id);
  if (existing) {
    const hash = await receiptHash(pepper(env), submission.receiptToken);
    if (!timingSafeEqual(hash, existing.receipt_hash)) {
      return json({ ok: false, code: 'id_conflict' }, 409);
    }
    // Re-drive a row that never reached GitHub. Harmless if it did: the
    // claim in createIssueFor() sees the issue number and returns at once.
    if (!existing.github_issue_number) {
      ctx.waitUntil(createIssueFor(env, submission.id));
    }
    return json({
      ok: true,
      id: existing.id,
      status: existing.status,
      message: STATUS_MESSAGE[existing.status],
      duplicate: true,
    }, 200);
  }

  const limited = await checkRateLimit(env, submission.installId, request);
  if (limited) return json({ ok: false, code: limited }, 429);

  const turnstile = await verifyTurnstile(
    env,
    submission.turnstileToken,
    request.headers.get('cf-connecting-ip'),
  );
  if (!turnstile.ok) return json({ ok: false, code: turnstile.code }, 403);

  const hash = await receiptHash(pepper(env), submission.receiptToken);
  const { row, created } = await insertRequest(db, {
    id: submission.id,
    receiptHash: hash,
    receiptHashVersion: 1,
    category: submission.category,
    payload: {
      title: submission.title,
      details: submission.details,
      diagnostics: submission.diagnostics,
    },
    now,
  });

  // Lost a race with a concurrent identical submission — the other request
  // inserted first. Same receipt, so this is the same learner double-tapping.
  if (!created && !timingSafeEqual(hash, row.receipt_hash)) {
    return json({ ok: false, code: 'id_conflict' }, 409);
  }

  await markDispatched(db, submission.id, now);
  ctx.waitUntil(createIssueFor(env, submission.id));

  // 202, not 201: the report is durably ours, but the issue does not exist
  // yet and the client must not be told otherwise.
  return json({
    ok: true,
    id: submission.id,
    status: 'accepted',
    message: STATUS_MESSAGE.accepted,
  }, 202);
}

// --- Status batch -----------------------------------------------------------

async function handleStatus(request, env) {
  const raw = await request.arrayBuffer();
  if (raw.byteLength > LIMITS.bodyBytes) return json({ ok: false, code: 'too_large' }, 413);

  let body;
  try {
    body = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return json({ ok: false, code: 'bad_json' }, 400);
  }

  const pairs = parseStatusRequest(body);
  const limited = await checkStatusLimit(env, body.installId, request);
  if (limited) return json({ ok: false, code: limited }, 429);

  const cursors = (body && typeof body.cursors === 'object' && body.cursors) || {};
  const results = [];

  for (const pair of pairs) {
    const row = await getRequest(env.DB, pair.id);
    if (!row) {
      // Indistinguishable from a wrong receipt, deliberately: this endpoint
      // must not be usable to discover which ids exist.
      results.push({ id: pair.id, found: false });
      continue;
    }
    const hash = await receiptHash(pepper(env), pair.receiptToken);
    if (!timingSafeEqual(hash, row.receipt_hash)) {
      results.push({ id: pair.id, found: false });
      continue;
    }

    const since = Number(cursors[pair.id]) || 0;
    const events = await listEvents(env.DB, pair.id, since);

    results.push({
      id: row.id,
      found: true,
      status: row.status,
      statusUpdatedAt: row.status_updated_at,
      message: STATUS_MESSAGE[row.status] || null,
      // The issue URL is returned only for a public tracker. A private
      // inbox would hand the learner a link to a 404, which reads as being
      // shut out of their own report rather than as the privacy measure it
      // is; the in-app timeline carries the whole story instead.
      issueNumber: env.ISSUES_ARE_PUBLIC === 'true' ? row.github_issue_number : null,
      issueUrl: env.ISSUES_ARE_PUBLIC === 'true' && row.github_issue_number
        ? `https://github.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues/${row.github_issue_number}`
        : null,
      releasedIn: row.released_version,
      releaseMessage: row.release_message,
      events: events.map((e) => ({ id: e.id, type: e.type, message: e.message, at: e.created_at })),
      cursor: events.length ? events[events.length - 1].id : since,
    });
  }

  return json({ ok: true, results }, 200);
}

// --- Abuse controls ---------------------------------------------------------

/**
 * Two layers, because neither is sufficient. The rate-limit binding is fast
 * and keyed by the caller's random install id — Cloudflare warns that
 * IP-only limits punish shared school and household networks, which is most
 * of this app's audience — but it is eventually consistent and deliberately
 * permissive. The D1 day counter is exact, global, and cannot be reset by
 * minting a new install id.
 */
async function checkRateLimit(env, installId, request) {
  const key = installId || request.headers.get('cf-connecting-ip') || 'anonymous';
  if (env.SUBMIT_LIMIT) {
    const { success } = await env.SUBMIT_LIMIT.limit({ key });
    if (!success) return 'rate_limited';
  }
  const day = new Date().toISOString().slice(0, 10);
  const count = await bumpDailyCounter(env.DB, day);
  if (count > LIMITS.dailySubmissions) return 'daily_limit';
  return null;
}

async function checkStatusLimit(env, installId, request) {
  if (!env.STATUS_LIMIT) return null;
  const key = (typeof installId === 'string' && installId.slice(0, 64))
    || request.headers.get('cf-connecting-ip') || 'anonymous';
  const { success } = await env.STATUS_LIMIT.limit({ key });
  return success ? null : 'rate_limited';
}

// --- Plumbing ---------------------------------------------------------------

function pepper(env) {
  // A missing pepper would silently hash every receipt under the empty
  // string, which still works but throws away the protection a leaked D1
  // export is supposed to run into. Loud is better.
  if (!env.RECEIPT_PEPPER) throw new Error('RECEIPT_PEPPER is not configured');
  return env.RECEIPT_PEPPER;
}

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
}

function originAllowed(origin, env) {
  // A same-origin or non-browser caller sends no Origin header at all; curl
  // and the test script rely on that, and neither can be a cross-site
  // request forgery, which is the only thing this check defends against.
  if (!origin) return true;
  return allowedOrigins(env).includes(origin);
}

function preflight(request, env) {
  const origin = request.headers.get('origin');
  if (!originAllowed(origin, env)) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

function corsHeaders(origin) {
  return {
    'access-control-allow-origin': origin || '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

function withCors(response, request, env) {
  const origin = request.headers.get('origin');
  if (!originAllowed(origin, env)) return response;
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(origin))) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
