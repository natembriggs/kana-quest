// Cloudflare Turnstile server-side validation.
//
// The token the browser sends is worthless until Siteverify confirms it, and
// three properties of that confirmation matter beyond `success`:
//
//   hostname — the challenge must have been solved on one of our own pages,
//              not embedded on somebody else's site pointed at this Worker
//   action   — must be the action this widget was rendered with, so a token
//              minted somewhere else on the site cannot be spent here
//   freshness — tokens are valid for five minutes and redeemable once, which
//              Cloudflare enforces; a redeemed token comes back as a failure
//
// Turnstile's documented always-passes test secret is the configured
// fallback, so the Worker is usable before a real widget exists. That is
// safe only because it is *also* the point at which the rate limiter and
// the daily counter are the real defence — see README.md, "Going live".

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export const TURNSTILE_ACTION = 'feedback';

export function turnstileSecret(env) {
  return env.TURNSTILE_SECRET || env.TURNSTILE_SECRET_FALLBACK || '';
}

/** True while running on Cloudflare's published test secret. */
export function usingTestKeys(env) {
  return !env.TURNSTILE_SECRET;
}

/**
 * Returns `{ ok, code }`. `code` is a stable machine string for the client,
 * never Cloudflare's raw error list — which can name internal reasons and is
 * of no use to a learner.
 */
export async function verifyTurnstile(env, token, remoteIp) {
  const secret = turnstileSecret(env);
  if (!secret) return { ok: false, code: 'turnstile_unconfigured' };
  if (!token || typeof token !== 'string' || token.length > 2048) {
    return { ok: false, code: 'turnstile_missing' };
  }

  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  // Cloudflare treats this as a hint, not an identity, and nothing here
  // stores it. Omitted entirely when the platform did not supply one.
  if (remoteIp) form.append('remoteip', remoteIp);

  let data;
  try {
    const response = await fetch(SITEVERIFY, { method: 'POST', body: form });
    data = await response.json();
  } catch {
    // Turnstile being unreachable must not silently become "verified".
    return { ok: false, code: 'turnstile_unavailable' };
  }

  if (!data || data.success !== true) {
    const codes = Array.isArray(data && data['error-codes']) ? data['error-codes'] : [];
    if (codes.includes('timeout-or-duplicate')) return { ok: false, code: 'turnstile_expired' };
    return { ok: false, code: 'turnstile_failed' };
  }

  const allowedHosts = String(env.TURNSTILE_HOSTNAMES || '')
    .split(',').map((h) => h.trim()).filter(Boolean);
  if (allowedHosts.length && !allowedHosts.includes(data.hostname)) {
    return { ok: false, code: 'turnstile_hostname' };
  }

  // The action is only asserted once a real widget is configured. The test
  // keys echo whatever action they were given, so checking it there would
  // assert nothing while making local testing needlessly brittle.
  if (!usingTestKeys(env) && data.action && data.action !== TURNSTILE_ACTION) {
    return { ok: false, code: 'turnstile_action' };
  }

  return { ok: true, code: 'ok' };
}
