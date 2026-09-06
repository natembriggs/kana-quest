// HMAC and constant-time comparison, shared by the three things in this
// service that authenticate with a shared secret: receipt tokens, the GitHub
// webhook signature, and the release endpoint.

const encoder = new TextEncoder();

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hmacHex(secret, message) {
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return toHex(signature);
}

export async function hmacBytesHex(secret, bytes) {
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, bytes);
  return toHex(signature);
}

export async function sha256Hex(message) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(message));
  return toHex(digest);
}

/**
 * Compare two hex strings without leaking, through timing, how many leading
 * characters matched. Length is compared first and returned early on — the
 * length of a signature is not a secret, and every caller here compares
 * fixed-width hex anyway.
 */
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * The receipt hash stored in D1. Peppered rather than plain-hashed: a
 * receipt is 256 bits of randomness so a rainbow table is not the threat —
 * a copy of the database being enough, on its own, to impersonate every
 * learner's capability is. With the pepper held only as a Worker secret, a
 * leaked D1 export authenticates nobody.
 */
export function receiptHash(pepper, token) {
  return hmacHex(pepper, `receipt:v1:${token}`);
}

/**
 * base64url of `bytes` random bytes. Used for receipts in tests and for the
 * hidden issue marker; the browser mints its own with the same shape.
 */
export function randomToken(bytes = 32) {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  let binary = '';
  buffer.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
