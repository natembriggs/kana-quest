// Routing only. All real behaviour is in document-store.js's Durable
// Object — this file's job is just "is the URL well-formed" and "which
// Durable Object instance owns it", both cheap enough to check before ever
// touching storage (sync-plan.md §2.1).

import { DocumentStore } from './document-store.js';

export { DocumentStore };

// The id is the HKDF-derived docId from sync-plan.md §3.2 — 32 bytes, hex.
// Rejecting anything else here means a malformed id never reaches storage.
const PATH_RE = /^\/v1\/doc\/([0-9a-f]{64})$/;

// CORS is wide open on purpose, not an oversight: the 64-hex id is already
// the entire security boundary (sync-plan.md §1.1 — "holding it is the
// authorisation"), the same as the sync code it's derived from. Scoping
// Access-Control-Allow-Origin to specific origins would add no real
// protection — anyone with the id already has full read/write access from
// any origin via a plain curl — while it would break local dev, where the
// app is served from an arbitrary LAN IP and port (tools/serve.sh).
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'If-Match, If-None-Match, Content-Type',
  // Browsers hide all but a small allowlist of response headers from
  // cross-origin JS by default; ETag isn't on it, and the client needs to
  // read it (sync-plan.md §4.5), so it has to be explicitly exposed.
  'Access-Control-Expose-Headers': 'ETag',
  'Access-Control-Max-Age': '86400',
};

function withCors(response) {
  const merged = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) merged.set(key, value);
  return new Response(response.body, { status: response.status, headers: merged });
}

function plainResponse(status, message) {
  return new Response(message, { status, headers: { Date: new Date().toUTCString() } });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const match = url.pathname.match(PATH_RE);
    if (!match) {
      const response = url.pathname.startsWith('/v1/doc/')
        ? plainResponse(400, 'Document id must be 64 hex characters')
        : plainResponse(404, 'Not found');
      return withCors(response);
    }

    const id = match[1];
    const stub = env.DOCS.get(env.DOCS.idFromName(id));
    const response = await stub.fetch(request);
    return withCors(response);
  },
};
