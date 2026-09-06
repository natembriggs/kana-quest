// The only code in this service that talks to GitHub.
//
// Two credential shapes are supported, deliberately. A **GitHub App** is the
// release design — installation tokens expire after an hour, actions are
// attributed to the app rather than to a person, and the permissions are
// narrower than any user token can be. A **fine-grained personal access
// token** scoped to the one inbox repository is the short path, and is what
// this Worker runs on until an App is registered. Whichever is configured,
// nothing else in the service changes: createIssue() is the same call.
//
// If NEITHER is configured the Worker still accepts submissions. They sit in
// D1 as `accepted` and the cron sweep files them the moment a credential
// appears — which is exactly the failure mode the outbox already exists for,
// so an unconfigured server behaves like a temporarily broken one rather
// than like a rejecting one, and nobody's words are lost in between.

import { PERMANENT_GITHUB_STATUS, SOURCE_LABEL } from './config.js';

const API = 'https://api.github.com';
const UA = 'kana-quest-feedback (+https://github.com/natembriggs/kana-quest)';

export class GitHubError extends Error {
  constructor(status, message, { permanent = false } = {}) {
    super(message);
    this.status = status;
    this.permanent = permanent;
  }
}

/** Does this environment hold any credential at all? */
export function hasCredential(env) {
  return !!(env.GITHUB_TOKEN || (env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY));
}

// --- GitHub App authentication ---------------------------------------------

function base64url(bytes) {
  let binary = '';
  new Uint8Array(bytes).forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * GitHub hands out a PKCS#1 key ("BEGIN RSA PRIVATE KEY"); WebCrypto imports
 * PKCS#8. node:crypto (enabled by the nodejs_compat flag) converts between
 * the two, which keeps key handling on the server and out of any build step
 * or checked-in conversion script. A key already in PKCS#8 ("BEGIN PRIVATE
 * KEY") is passed straight through.
 */
async function importAppKey(pem) {
  const trimmed = pem.trim();
  let der;
  if (trimmed.includes('BEGIN RSA PRIVATE KEY')) {
    const { createPrivateKey } = await import('node:crypto');
    der = createPrivateKey(trimmed).export({ type: 'pkcs8', format: 'der' });
  } else {
    const body = trimmed.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
    der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  }
  return crypto.subtle.importKey(
    'pkcs8',
    der instanceof Uint8Array ? der : new Uint8Array(der),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

async function appJwt(env) {
  const now = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();
  const header = base64url(encoder.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  // `iat` is backdated a minute: GitHub rejects a JWT issued in the future,
  // and a Worker's clock can sit a second or two ahead of theirs.
  const claims = base64url(encoder.encode(JSON.stringify({
    iat: now - 60,
    exp: now + 540,
    iss: env.GITHUB_APP_ID,
  })));
  const key = await importAppKey(env.GITHUB_APP_PRIVATE_KEY);
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    encoder.encode(`${header}.${claims}`),
  );
  return `${header}.${claims}.${base64url(signature)}`;
}

// Installation tokens last an hour. Cached in module scope, which on Workers
// means "for the life of this isolate" — a miss costs one extra round trip,
// never a wrong answer, so no coordination between isolates is needed.
let cachedInstallationToken = null;

async function installationToken(env) {
  if (cachedInstallationToken && cachedInstallationToken.expiresAt > Date.now() + 60_000) {
    return cachedInstallationToken.token;
  }
  const jwt = await appJwt(env);
  const installationId = env.GITHUB_INSTALLATION_ID || await discoverInstallation(env, jwt);
  const response = await fetch(`${API}/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${jwt}`,
      accept: 'application/vnd.github+json',
      'user-agent': UA,
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!response.ok) {
    throw new GitHubError(response.status, 'Could not mint an installation token.', {
      permanent: PERMANENT_GITHUB_STATUS.has(response.status),
    });
  }
  const data = await response.json();
  cachedInstallationToken = {
    token: data.token,
    expiresAt: Date.parse(data.expires_at) || (Date.now() + 3_000_000),
  };
  return cachedInstallationToken.token;
}

/** Makes GITHUB_INSTALLATION_ID optional — one extra call, cached with the token. */
async function discoverInstallation(env, jwt) {
  const response = await fetch(`${API}/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/installation`, {
    headers: {
      authorization: `Bearer ${jwt}`,
      accept: 'application/vnd.github+json',
      'user-agent': UA,
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!response.ok) {
    throw new GitHubError(response.status, 'The app is not installed on that repository.', { permanent: true });
  }
  return (await response.json()).id;
}

async function authHeader(env) {
  if (env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY) {
    return `Bearer ${await installationToken(env)}`;
  }
  if (env.GITHUB_TOKEN) return `Bearer ${env.GITHUB_TOKEN}`;
  // Not permanent: the row stays in the outbox and the next sweep after a
  // credential is configured will file it.
  throw new GitHubError(0, 'No GitHub credential is configured.', { permanent: false });
}

// --- API calls --------------------------------------------------------------

async function call(env, path, init = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: await authHeader(env),
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'user-agent': UA,
      'x-github-api-version': '2022-11-28',
      ...(init.headers || {}),
    },
  });
  if (response.ok) return response.json();

  // GitHub's own guidance: a 403 carrying a retry-after or a "secondary rate
  // limit" body is transient and must be backed off, not read as a
  // permission problem. Everything else in PERMANENT_GITHUB_STATUS would
  // fail identically forever, and retrying only compounds the throttling.
  const text = await response.text().catch(() => '');
  const secondary = response.status === 403 && /secondary rate limit|retry after/i.test(text);
  throw new GitHubError(
    response.status,
    `GitHub ${response.status} on ${path}`,
    { permanent: !secondary && PERMANENT_GITHUB_STATUS.has(response.status) },
  );
}

export function createIssue(env, { title, body, labels }) {
  return call(env, `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues`, {
    method: 'POST',
    body: JSON.stringify({ title, body, labels }),
  });
}

/**
 * Recent issues carrying this server's own label, newest first. Used only by
 * the reconciliation path in issues.js: after a crash between "GitHub created
 * it" and "D1 recorded the number", this is how the hidden marker in the body
 * is found again rather than a second issue being created for one report.
 */
export function recentServerIssues(env, perPage = 50) {
  const params = new URLSearchParams({
    state: 'all',
    labels: SOURCE_LABEL,
    sort: 'created',
    direction: 'desc',
    per_page: String(perPage),
  });
  return call(env, `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues?${params}`);
}
