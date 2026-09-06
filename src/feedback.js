// Talking to the feedback Worker: minting a receipt, collecting the small
// allowlisted diagnostic bundle, submitting, retrying, and refreshing status.
//
// Everything that decides *what a contribution means* lives in
// contributions.js, which is pure and tested directly. This file is the
// transport, and it is deliberately the only place in the app that knows the
// endpoint exists.
//
// Two properties are worth stating plainly, because they are the reason the
// rest of the design can be as simple as it is:
//
//   * The receipt token is a CAPABILITY. It is the only thing that proves a
//     report belongs to this learner — there is no account. It must never be
//     logged, put in a URL or a query string, or sent anywhere except this
//     endpoint over HTTPS and the existing encrypted profile sync.
//
//   * The id and receipt are minted BEFORE the first request and reused for
//     every retry. That is what makes retrying safe: the server resolves a
//     repeat id to the existing row instead of filing a second issue.

export const FEEDBACK_ENDPOINT = 'https://kana-quest-feedback.natebriggs.workers.dev';

// Cloudflare's documented always-passes TEST site key. Swap this for the real
// widget's key at the same time as TURNSTILE_SECRET on the Worker — see
// feedback-server/README.md, "Going live". Until then the challenge is
// theatre and the rate limiter is the real defence, which is fine for an app
// whose entire audience is one family.
export const FEEDBACK_TURNSTILE_SITEKEY = '0x4AAAAAAEqXrOPkv5SxKAjI';

const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TURNSTILE_ACTION = 'feedback';

export const FEEDBACK_CATEGORIES = [
  { id: 'bug', emoji: '🐛', label: 'Something is broken', hint: 'It did the wrong thing, or got stuck.' },
  { id: 'idea', emoji: '💡', label: 'I have an idea', hint: 'Something you wish the app could do.' },
  { id: 'content', emoji: '📖', label: 'Something is wrong', hint: 'A reading, meaning, hint or story that looks incorrect.' },
  { id: 'other', emoji: '💬', label: 'Something else', hint: 'Anything that does not fit the others.' },
];

// --- Identity that is not an identity ---------------------------------------

const INSTALL_ID_KEY = 'kana-quest-install-id';

/**
 * A random per-browser id used for ONE purpose: as the rate-limit key, so
 * short bursts can be throttled without keying on IP alone — Cloudflare
 * warns that IP-only limits punish shared school and household networks,
 * which describes most of this app's users.
 *
 * Deliberately not in the profile: it is a property of this browser, not of
 * the learner, and it must not travel by sync or land in a backup export. It
 * is never stored server-side and cannot be linked to a profile.
 */
export function installId() {
  try {
    let id = localStorage.getItem(INSTALL_ID_KEY);
    if (!id) {
      id = randomBase64url(16);
      localStorage.setItem(INSTALL_ID_KEY, id);
    }
    return id;
  } catch {
    // Private mode, or storage disabled. A per-request id still spreads the
    // load sensibly; it just cannot be throttled across requests.
    return randomBase64url(16);
  }
}

function randomBase64url(bytes) {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  let binary = '';
  buffer.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 32 random bytes, base64url, unpadded — 43 characters. */
export function newReceiptToken() {
  return randomBase64url(32);
}

export function newFeedbackId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // Safari has had randomUUID since 15.4, but a home-screen PWA on an old
  // iPad is exactly the device this app exists for.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// --- Diagnostics -------------------------------------------------------------

/**
 * The exact bundle offered under "Include app details". Everything here is
 * either a version, a coarse category, or the name of a screen — nothing
 * that identifies a person or says anything about how they are doing.
 *
 * Deliberately NOT collected, even though each would be convenient: the
 * learner's name or badge, any progress or answer, the study list, the sync
 * code or document id, the receipt, the full URL or query string, and the
 * raw user-agent string. A full UA is a fingerprint; a browser family is
 * enough to reproduce a bug.
 */
export function collectDiagnostics({ appVersion, screen, course, mode, swVersion } = {}) {
  const ua = typeof navigator !== 'undefined' ? String(navigator.userAgent || '') : '';
  const width = typeof window !== 'undefined' ? (window.innerWidth || 0) : 0;

  const diagnostics = {
    appVersion: appVersion || 'unknown',
    display: isStandalone() ? 'standalone' : 'browser',
    browser: browserFamily(ua),
    platform: platformFamily(ua),
    viewport: width < 480 ? 'small' : (width < 900 ? 'medium' : 'large'),
    online: typeof navigator !== 'undefined' ? navigator.onLine !== false : true,
  };
  if (swVersion) diagnostics.swVersion = String(swVersion);
  if (screen) diagnostics.screen = String(screen).replace(/^screen-/, '');
  if (course) diagnostics.course = String(course);
  if (mode) diagnostics.mode = String(mode);
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    if (locale) diagnostics.locale = String(locale);
  } catch { /* no Intl worth worrying about */ }
  return diagnostics;
}

function isStandalone() {
  if (typeof window === 'undefined') return false;
  if (typeof navigator !== 'undefined' && navigator.standalone) return true; // iOS
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(display-mode: standalone)').matches;
}

function browserFamily(ua) {
  if (/Edg\//.test(ua)) return 'edge';
  if (/SamsungBrowser/.test(ua)) return 'samsung';
  if (/Firefox|FxiOS/.test(ua)) return 'firefox';
  if (/Chrome|CriOS/.test(ua)) return 'chrome';
  if (/Safari/.test(ua)) return 'safari';
  return 'other';
}

function platformFamily(ua) {
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Macintosh|Mac OS X/.test(ua)) return 'mac';
  if (/Windows/.test(ua)) return 'windows';
  if (/Linux/.test(ua)) return 'linux';
  return 'other';
}

/** A short human list of exactly what the bundle above will send. */
export function describeDiagnostics(diagnostics) {
  const names = {
    appVersion: 'App version',
    swVersion: 'Offline-cache version',
    screen: 'Which screen you were on',
    course: 'Which set you were practising',
    mode: 'Which mode you were in',
    display: 'Home-screen app or browser tab',
    browser: 'Browser family',
    platform: 'Kind of device',
    viewport: 'Rough screen size',
    online: 'Whether you were online',
    locale: 'Language setting',
  };
  return Object.keys(diagnostics)
    .filter((key) => names[key])
    .map((key) => `${names[key]}: ${String(diagnostics[key])}`);
}

// --- Turnstile ---------------------------------------------------------------

let turnstileScript = null;

/**
 * Load the challenge script once, lazily — only when the form is actually
 * opened. A learner who never taps Feedback never fetches a byte of it, and
 * it stays entirely out of the service worker's shell (the fetch handler
 * ignores cross-origin requests, so nothing here is cached either).
 */
function loadTurnstile() {
  if (turnstileScript) return turnstileScript;
  turnstileScript = new Promise((resolve, reject) => {
    if (window.turnstile) { resolve(window.turnstile); return; }
    const script = document.createElement('script');
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.turnstile);
    script.onerror = () => reject(new Error('turnstile-unavailable'));
    document.head.appendChild(script);
  }).catch((error) => {
    // Let a later attempt retry rather than caching the failure forever —
    // the usual cause is being offline, which is temporary by nature.
    turnstileScript = null;
    throw error;
  });
  return turnstileScript;
}

/**
 * Render the widget into `container` and resolve with a token. Rendered at
 * submit time rather than at open time because tokens expire after five
 * minutes and are single-use, and a form a child fills in slowly would
 * otherwise arrive with a dead one.
 */
export async function getTurnstileToken(container, { timeoutMs = 20000 } = {}) {
  const turnstile = await loadTurnstile();
  if (!turnstile) throw new Error('turnstile-unavailable');
  container.innerHTML = '';
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => { if (!settled) { settled = true; fn(value); } };
    const timer = setTimeout(() => finish(reject, new Error('turnstile-timeout')), timeoutMs);
    try {
      turnstile.render(container, {
        sitekey: FEEDBACK_TURNSTILE_SITEKEY,
        action: TURNSTILE_ACTION,
        appearance: 'interaction-only',
        callback: (token) => { clearTimeout(timer); finish(resolve, token); },
        'error-callback': () => { clearTimeout(timer); finish(reject, new Error('turnstile-failed')); },
        'expired-callback': () => { clearTimeout(timer); finish(reject, new Error('turnstile-expired')); },
      });
    } catch (error) {
      clearTimeout(timer);
      finish(reject, error);
    }
  });
}

// --- Submission ---------------------------------------------------------------

/**
 * Stable, friendly copy for every failure the server can name, plus the ones
 * only the client can hit. Never shows a raw server code to a learner, and
 * never says "try again" for something retrying cannot fix.
 */
export const ERROR_TEXT = {
  offline: 'You are offline. Your report is saved — send it when you are back online.',
  network: 'Could not reach the team just now. Your report is saved on this device.',
  'turnstile-unavailable': 'Could not run the "are you a robot?" check. Your report is saved — try again in a moment.',
  'turnstile-timeout': 'The "are you a robot?" check did not finish. Your report is saved — try again.',
  'turnstile-failed': 'The "are you a robot?" check did not pass. Your report is saved — try again.',
  'turnstile-expired': 'The check timed out. Your report is saved — tap Send again.',
  turnstile_missing: 'The "are you a robot?" check did not run. Your report is saved — try again.',
  turnstile_expired: 'The check timed out. Your report is saved — tap Send again.',
  turnstile_failed: 'The "are you a robot?" check did not pass. Your report is saved — try again.',
  turnstile_hostname: 'Something is misconfigured at our end. Your report is saved.',
  turnstile_action: 'Something is misconfigured at our end. Your report is saved.',
  turnstile_unavailable: 'The robot check is not answering. Your report is saved — try again shortly.',
  turnstile_unconfigured: 'Something is misconfigured at our end. Your report is saved.',
  rate_limited: 'That is a lot of reports at once! Wait a minute, then send this one.',
  daily_limit: 'The app has taken a lot of reports today. Try again tomorrow — yours is saved.',
  submissions_paused: 'Reports are paused just now. Yours is saved and can be sent later.',
  id_conflict: 'Something went wrong saving this report. Try writing it again.',
  too_large: 'That report is too long. Try shortening it.',
  short_title: 'Give it a slightly longer title.',
  long_title: 'That title is too long.',
  short_details: 'Tell us a little more than that.',
  long_details: 'That is too long to send — try shortening it.',
  invalid_category: 'Pick what kind of report this is.',
  origin_not_allowed: 'This copy of the app cannot send reports.',
  server_error: 'Something went wrong at our end. Your report is saved on this device.',
};

export function errorText(code) {
  return ERROR_TEXT[code] || ERROR_TEXT.server_error;
}

/**
 * Send one report. `contribution` is the local record; its id and receipt are
 * reused verbatim on every attempt, which is what makes a retry safe.
 *
 * Returns `{ ok: true, status }` or `{ ok: false, code, retryable }`.
 * `retryable: false` means the draft should be dropped rather than kept
 * forever — there is no point storing a report the server will refuse every
 * single time.
 */
export async function submitFeedback(contribution, { turnstileToken }) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ok: false, code: 'offline', retryable: true };
  }

  let response;
  try {
    response = await fetch(`${FEEDBACK_ENDPOINT}/v1/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: contribution.id,
        receiptToken: contribution.receiptToken,
        category: contribution.category,
        title: contribution.title,
        details: contribution.pendingDetails,
        diagnostics: contribution.pendingDiagnostics || {},
        installId: installId(),
        turnstileToken,
      }),
    });
  } catch {
    return { ok: false, code: 'network', retryable: true };
  }

  let body = null;
  try { body = await response.json(); } catch { /* handled below */ }

  if (response.ok && body && body.ok) {
    return { ok: true, status: body.status || 'accepted' };
  }

  const code = (body && body.code) || 'server_error';
  // A validation failure will fail identically forever; everything else is
  // worth another attempt later.
  const permanent = new Set([
    'short_title', 'long_title', 'short_details', 'long_details',
    'invalid_category', 'invalid_id', 'invalid_receipt', 'invalid_body',
    'too_large', 'id_conflict', 'origin_not_allowed',
  ]);
  return { ok: false, code, retryable: !permanent.has(code) };
}

/**
 * Batch-refresh status for up to 50 reports. Returns a map of id -> result,
 * or null if the request could not be made at all — which the caller must
 * treat as "no news", never as "everything reverted".
 */
export async function fetchStatuses(items) {
  if (!items.length) return {};
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;

  const cursors = {};
  items.forEach((item) => { if (item.cursor) cursors[item.id] = item.cursor; });

  try {
    const response = await fetch(`${FEEDBACK_ENDPOINT}/v1/feedback/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        items: items.map((item) => ({ id: item.id, receiptToken: item.receiptToken })),
        cursors,
        installId: installId(),
      }),
    });
    if (!response.ok) return null;
    const body = await response.json();
    if (!body || !body.ok || !Array.isArray(body.results)) return null;
    const map = {};
    body.results.forEach((result) => { if (result && result.id) map[result.id] = result; });
    return map;
  } catch {
    return null;
  }
}
