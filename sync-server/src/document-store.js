// One Durable Object instance per sync document. Single-threaded per
// instance, so compare-and-swap needs no protocol of its own — it's just
// ordinary sequential code. See sync-plan.md §2.2 for why this is a Durable
// Object rather than Workers KV (eventually consistent, so CAS would be
// unsound) or D1 (would work, but is a fallback kept only in case Durable
// Objects turn out not to be available — they are, verified 2026-08-24).
//
// The body is opaque ciphertext to everything here. This object has no idea
// it's holding kana-quest sync-plan.md#3 profile data, and that's the point:
// it cannot leak what it cannot read.

// §2.3: reject bodies over this before they're written.
const MAX_BODY_BYTES = 4 * 1024 * 1024;

// §2.3: a document untouched for this long is swept via Durable Object
// alarms, reset on every successful write. Deliberately generous — language
// learning routinely has multi-year hiatuses, and this is the only backstop
// a learner who lost their device and forgot to save the code has, so it
// should outlast an ordinary gap in practice by a wide margin, not just
// match one.
const SWEEP_AFTER_MS = 5 * 365 * 24 * 60 * 60 * 1000;

function dateHeader() {
  return new Date().toUTCString();
}

function headers(version, extra) {
  const h = { Date: dateHeader(), ...extra };
  if (version !== undefined) h.ETag = `"${version}"`;
  return h;
}

function parseETag(value) {
  if (value == null) return null;
  return value.replace(/^W\//, '').replace(/^"|"$/g, '').trim();
}

export class DocumentStore {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    switch (request.method) {
      case 'GET': return this.handleGet(request);
      case 'PUT': return this.handlePut(request);
      case 'DELETE': return this.handleDelete(request);
      default: return new Response('Method not allowed', { status: 405, headers: headers() });
    }
  }

  async currentVersion() {
    return (await this.state.storage.get('version')) || 0;
  }

  async handleGet(request) {
    const version = await this.currentVersion();
    if (version === 0) return new Response(null, { status: 404, headers: headers() });

    const ifNoneMatch = parseETag(request.headers.get('If-None-Match'));
    if (ifNoneMatch !== null && ifNoneMatch === String(version)) {
      return new Response(null, { status: 304, headers: headers(version) });
    }

    const body = await this.state.storage.get('body');
    return new Response(body, {
      status: 200,
      headers: headers(version, { 'Content-Type': 'application/octet-stream' }),
    });
  }

  async handlePut(request) {
    const body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY_BYTES) {
      return new Response('Payload too large', { status: 413, headers: headers() });
    }

    const version = await this.currentVersion();
    const ifMatch = request.headers.get('If-Match');
    const ifNoneMatch = request.headers.get('If-None-Match');

    if (ifNoneMatch !== null) {
      if (ifNoneMatch.trim() !== '*') {
        return new Response('If-None-Match must be *', { status: 400, headers: headers(version) });
      }
      if (version !== 0) return new Response(null, { status: 412, headers: headers(version) });
    } else if (ifMatch !== null) {
      if (parseETag(ifMatch) !== String(version)) {
        return new Response(null, { status: 412, headers: headers(version) });
      }
    } else {
      return new Response('If-Match or If-None-Match: * is required', { status: 400, headers: headers(version) });
    }

    const newVersion = version + 1;
    await this.state.storage.put({ version: newVersion, body, updatedAt: Date.now() });
    await this.state.storage.setAlarm(Date.now() + SWEEP_AFTER_MS);

    return new Response(null, { status: 200, headers: headers(newVersion) });
  }

  async handleDelete(request) {
    const version = await this.currentVersion();
    if (version === 0) return new Response(null, { status: 404, headers: headers() });

    const ifMatch = parseETag(request.headers.get('If-Match'));
    if (ifMatch === null) {
      return new Response('If-Match is required', { status: 400, headers: headers(version) });
    }
    if (ifMatch !== String(version)) {
      return new Response(null, { status: 412, headers: headers(version) });
    }

    await this.state.storage.deleteAll();
    await this.state.storage.deleteAlarm();
    return new Response(null, { status: 204, headers: headers() });
  }

  // Nothing has written to this document in SWEEP_AFTER_MS — evict it. A
  // fresh write later just starts the document over at version 1, same as
  // if it had never existed (§2.3).
  async alarm() {
    await this.state.storage.deleteAll();
  }
}
