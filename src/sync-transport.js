// The only module in the sync feature that touches the network or
// WebCrypto. Everything else (sync-protocol.js) is pure and takes this
// module's exports as parameters, so it can be driven by a stub in a test
// environment that has neither — see sync-plan.md §4.1.

const WORKER_BASE = 'https://kana-quest-sync.natebriggs.workers.dev';

// --- Sync codes -------------------------------------------------------------
// Crockford base32 — 0-9 and A-Z minus I L O U, so nothing in a hand-typed
// code can be misread as something else. See sync-plan.md §1.2.
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_GROUP_LENGTH = 4;
const CODE_GROUPS = 3;

export function generateCode() {
  const bytes = new Uint8Array(CODE_GROUP_LENGTH * CODE_GROUPS);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]);
  const groups = [];
  for (let i = 0; i < chars.length; i += CODE_GROUP_LENGTH) {
    groups.push(chars.slice(i, i + CODE_GROUP_LENGTH).join(''));
  }
  return groups.join('-');
}

/** Upper-cases and strips everything but the code alphabet, so a pasted
 * code with or without dashes — or with stray whitespace — reads the same. */
export function normalizeCode(input) {
  return String(input || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

export function formatCode(normalized) {
  const groups = [];
  for (let i = 0; i < normalized.length; i += CODE_GROUP_LENGTH) {
    groups.push(normalized.slice(i, i + CODE_GROUP_LENGTH));
  }
  return groups.join('-');
}

// --- Key derivation ----------------------------------------------------------
// sync-plan.md §3.2: one expensive derivation (PBKDF2, deliberately slow),
// then two independent HKDF outputs, so the id handed to the server leaks
// nothing about the key that never leaves the device.
const PBKDF2_ITERATIONS = 200_000;
const PBKDF2_SALT = 'kana-quest-sync-v1';
const IV_BYTES = 12;

const keyCache = new Map(); // normalized code -> Promise<{docId, aesKey}>

async function deriveMaster(code) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: new TextEncoder().encode(PBKDF2_SALT),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  );
  return new Uint8Array(bits);
}

async function hkdf(master, info) {
  const key = await crypto.subtle.importKey('raw', master, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode(info) },
    key,
    256,
  );
  return new Uint8Array(bits);
}

function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Derives `{docId, aesKey}` from a sync code: `docId` is the 64-hex string
 * sent to the server (see sync-server/), `aesKey` is a non-extractable
 * AES-GCM CryptoKey that never leaves this function. Cached per normalized
 * code — PBKDF2 at 200k iterations is deliberately slow, and the code is
 * the same for as long as a profile stays paired.
 */
export function deriveKeys(rawCode) {
  const code = normalizeCode(rawCode);
  if (!keyCache.has(code)) {
    keyCache.set(code, (async () => {
      const master = await deriveMaster(code);
      const docIdBytes = await hkdf(master, 'doc-id');
      const keyBytes = await hkdf(master, 'content-key');
      const aesKey = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
      return { docId: toHex(docIdBytes), aesKey };
    })());
  }
  return keyCache.get(code);
}

// --- Encryption --------------------------------------------------------------
// Body layout is `IV ‖ ciphertext`, a fresh random IV every PUT (sync-plan.md
// §3.2). Plaintext is the profile document as UTF-8 JSON.

export async function encryptProfile(aesKey, profile) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = new TextEncoder().encode(JSON.stringify(profile));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, plaintext));
  const body = new Uint8Array(IV_BYTES + ciphertext.byteLength);
  body.set(iv, 0);
  body.set(ciphertext, IV_BYTES);
  return body;
}

export async function decryptProfile(aesKey, body) {
  const bytes = new Uint8Array(body);
  const iv = bytes.slice(0, IV_BYTES);
  const ciphertext = bytes.slice(IV_BYTES);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintext));
}

// --- Transport -----------------------------------------------------------
// The real implementation of the {pull, push} interface sync-protocol.js's
// functions take as a parameter — see sync-plan.md §2.1 for the wire
// protocol this speaks, and §4.1 for why it's kept separate.

function etagVersion(response) {
  const raw = response.headers.get('ETag');
  return raw ? raw.replace(/^W\//, '').replace(/^"|"$/g, '') : null;
}

export async function pull(docId, knownVersion) {
  const headers = {};
  if (knownVersion != null) headers['If-None-Match'] = `"${knownVersion}"`;
  let response;
  try {
    response = await fetch(`${WORKER_BASE}/v1/doc/${docId}`, { headers });
  } catch {
    return { status: 'offline' };
  }
  if (response.status === 304) return { status: 'not-modified' };
  if (response.status === 404) return { status: 'not-found' };
  if (!response.ok) return { status: 'error' };
  return { status: 'ok', version: etagVersion(response), ciphertext: await response.arrayBuffer() };
}

export async function push(docId, version, ciphertext) {
  const headers = version == null ? { 'If-None-Match': '*' } : { 'If-Match': `"${version}"` };
  let response;
  try {
    response = await fetch(`${WORKER_BASE}/v1/doc/${docId}`, { method: 'PUT', headers, body: ciphertext });
  } catch {
    return { status: 'offline' };
  }
  if (response.status === 200) return { status: 'ok', version: etagVersion(response) };
  if (response.status === 412) return { status: 'conflict', version: etagVersion(response) };
  if (response.status === 404) return { status: 'not-found' };
  if (response.status === 413) return { status: 'too-large' };
  return { status: 'error' };
}

export const transport = { pull, push };
