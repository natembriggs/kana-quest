# Cross-device sync — implementation plan

Status: **not started.** Supersedes the "Progress is per-device for now"
caveat in `src/store.js` and the *Progress and backups* section of the README.

The goal is that a learner's progress follows them: practise 学 on the iPad
after school, pick up on the phone in the car, and neither device is behind.
Today that requires exporting a JSON file on one device and loading it on the
other — which works, but is a deliberate act nobody remembers to perform.

## The short version

- **No user accounts.** A profile gets a **sync code** — a 12-character
  string the parent copies from one device and types (or pastes) into the
  other. No email, no password, no reset flow, and no children's names or
  practice records tied to an adult identity on a server. §1.
- **The server is a dumb, encrypted blob store** with compare-and-swap: about
  120 lines on Cloudflare, two endpoints, no knowledge of kana, kanji,
  profiles or merging. §2.
- **The data is encrypted client-side** with a key derived from the sync code,
  which the server never sees. It stores opaque bytes. §3.
- **The merge already exists.** `importAll` in `src/store.js` is a real
  conflict-safe merge — record-level last-write-wins by grading timestamp,
  study lists unioned, Yomi rollups rebuilt. Sync is that merge run
  continuously against a remote copy rather than once against a file. §4.
- **One profile, one code, one remote document.** A shared iPad can hold two
  children syncing to two unrelated places. §1.5.

Most of the work is *not* the network code. It is §0: three gaps in the
existing merge that a once-a-year backup restore hides and continuous sync
would expose within a day.

---

## 0. What has to be fixed before any network code is written

The current merge is correct for its actual job — "I am moving to a new phone,
do not lose anything" — and its bias is deliberate: when in doubt, keep more.
Union the study lists, keep the local settings, never delete. Run that same
merge every few minutes in both directions and the bias stops being safe and
starts being wrong.

### 0.1 There is no way to express a deletion

`mergeStudyLists` unions. So:

1. On the iPad, a learner un-enrols 龍 from Writing mode — they gave up on it.
2. Sync pulls the phone's copy, which still lists it.
3. 龍 is back in Writing mode, on both devices.

There is no state the learner can reach where it stays gone, and no amount of
retrying helps. The same is true of deleting a whole profile: delete it on one
device and the next pull restores it.

The fix is **tombstones**, and the cheapest form is to make enrollment
timestamped rather than boolean. The study list changes shape:

```js
// now
study: { '学': ['definition', 'writing'] }

// after
study:  { '学': { definition: 1756000000000, writing: 1756000000000 } }
unstudy: { '龍': { writing: 1756100000000 } }
```

Merge becomes per `(kanji, mode)` last-write-wins across the two maps, exactly
like progress records. Removal is then a fact with a time on it, and a newer
removal beats an older enrollment on any device.

**Migration** follows the pattern already used for `study` itself in
`openProfile` (`app.js:377`) and described in `kanji-expansion-plan.md` §1.3:
an array value is the trigger, and each mode in it is read as timestamp `0`.
That is not a fudge — it is the right answer. A legacy enrollment carries no
evidence about *when* the learner chose it, so any explicit later removal
should beat it, and an enrollment with no competing removal survives
regardless.

Touches `deriveStudyList`, `isStudying`, `setStudying`, `studyStatus` and
`studiedKanji` (24 call sites across `srs.js` and `app.js`, all reading
through those helpers). Contained, but it is the largest single edit in this
plan and it is why it goes first, on its own, before anything can depend on
it.

### 0.2 Settings resolve in favour of the receiving device, permanently

`importAll` puts `current.settings` last in the spread, so whatever this
device already had wins. For a one-off restore that is the right call — you
don't want a six-month-old backup resetting today's strictness slider. Under
continuous two-way sync it means the two devices disagree forever, each
insisting on its own value, with the accent colour flickering back and forth
depending on which one synced last.

Add `settingsUpdatedAt: { accentColor: 1756…, strictness: 1756… }`, stamped on
write, and merge per key by that timestamp. Missing keys read as `0` and lose
to any real edit — same migration-free fallback as `strictness`,
`writingModePreference` and `accentColor` already use.

`name` and `emoji` need the same treatment (`profileUpdatedAt`), for the same
reason.

### 0.3 The merge is welded to the backup envelope

`importAll` takes `{ format, version, profiles: [...] }`, iterates, and writes
straight to IndexedDB. Sync needs the middle of that — merge *one* profile
into *one* profile, purely, with no storage involved — so it can run on a
decrypted remote document.

**Extract `src/merge.js`** exporting a pure `mergeProfiles(current, incoming)
→ profile`, and have `importAll` call it in a loop. No behaviour change; the
existing `test/store.js` assertions keep passing unmodified, which is exactly
the property that makes this refactor safe to do first.

This also leaves the door open to running the identical merge on the server
later (§2.4) — one implementation, one set of tests, both sides.

---

## 1. Identity: a sync code, not an account

### 1.1 Why not accounts

Accounts would give recoverability and per-device revocation. They cost:

- A signup / sign-in / forgotten-password UI in an app whose entire
  authentication model today is *tap your name*.
- An adult email address stored next to children's learning records, which
  turns a static toy into something with a privacy policy, a data-subject
  request path, and a COPPA/UK-GDPR-children posture.
- A password a parent will forget, protecting data whose worst-case loss is
  "the kid re-learns which kanji were due".

A sync code is the same trust model the app already ships: today's backup file
is unauthenticated JSON that anyone holding it can read. The code is a
capability — holding it *is* the authorisation — and nothing else exists to
be stolen, phished or reset.

### 1.2 Format

Twelve characters of Crockford base32 (`0-9A-Z` minus `I L O U`, so nothing
can be misread as something else), displayed in groups of four:

```
K7QM-3XR9-P2FT
```

60 bits. Against a public endpoint with per-IP rate limiting this is not
attackable, and the document id derived from it (§3.2) is a 256-bit hash, so
there is nothing enumerable to sweep.

Chosen over a word list (`frog-tide-mossy-lantern`) because the realistic
transfer is copy-and-paste, not reading aloud across a room — words are easier
to say and materially worse to type on a phone keyboard. Entry auto-uppercases,
inserts the dashes, and ignores them on submit, so a pasted code with or
without dashes works.

### 1.3 QR codes were considered and rejected

The obvious pairing UX is a QR on device A encoding
`…/kana-quest/#sync=K7QM3XR9P2FT`, scanned by device B's camera. It does not
work here. On iOS, scanning opens the URL **in Safari**, and an installed
home-screen PWA does not share storage with Safari — so the code would land in
a completely different, empty copy of the app. Scanning from *inside* the app
would need `BarcodeDetector`, which Safari does not implement.

So manual entry is the primary path, not a fallback, and the code is sized for
typing. Device A gets a **Copy code** button; the practical flow is copy,
send it to yourself in Messages, paste on device B.

### 1.4 Losing the code

Nothing is recoverable server-side, by construction — see §3. Mitigations, in
order of usefulness:

- Local progress is never at risk. Losing the code loses *sync*, not history.
- The code is shown in full in Settings on any device already paired, and can
  be copied from there at any time.
- Generating a new code on a device starts a fresh remote document seeded from
  that device's local state, so recovery from "we lost the code" is: pick the
  most up-to-date device, generate a new code, re-pair the others.
- The existing backup file keeps working and is still the answer for
  "everything is gone".

### 1.5 Per-profile, not per-device

Each profile carries its own code and its own remote document. This costs a
little UI (a code per learner) and buys:

- A child's progress follows *them*, not a household. Two siblings on one
  shared iPad sync to two unrelated places.
- One code is the key to one child's data, not to everyone's.
- Profile deletion becomes trivially correct: the remote document is that
  profile's alone, so deleting locally can also `DELETE` it remotely, with no
  tombstone bookkeeping needed at the device level. §4.6.

---

## 2. The server

### 2.1 The entire API

Two endpoints. The body is opaque ciphertext (`application/octet-stream`), and
the version is an HTTP `ETag`, so compare-and-swap is plain conditional-request
semantics rather than something invented:

```
GET /v1/doc/:id
    If-None-Match: "7"
  → 200 ETag: "9"   <ciphertext>
  → 304                              (nothing changed since version 7)
  → 404                              (no document — this code is new)

PUT /v1/doc/:id
    If-Match: "7"                    (or If-None-Match: * to create)
    <ciphertext>
  → 200 ETag: "8"
  → 412 ETag: "9"                    (someone else wrote first — pull, merge, retry)
  → 413                              (over the size ceiling)

DELETE /v1/doc/:id
    If-Match: "8"
  → 204
```

Every response carries `Date`, which the client uses for clock correction
(§4.7). `:id` must be exactly 64 hex characters or the request is rejected
before any storage is touched.

### 2.2 Storage: a Durable Object per code, not KV

The naive choice is Workers KV, and it is subtly wrong: KV is **eventually
consistent** — a write can take up to a minute to be visible globally. That
makes compare-and-swap unsound. Two devices could each read version 7 from
different edge locations, each write version 8, and one child's afternoon
disappears with no conflict ever detected.

Options that are actually consistent:

- **Durable Object keyed by document id** — single-threaded per object, so CAS
  is not a protocol at all, just ordinary sequential code. The SQLite-backed
  storage handles multi-megabyte values and shards naturally: a family's
  traffic touches exactly one object. This is the recommendation.
- **D1** — a real database with `UPDATE … WHERE version = ?`, which gives
  correct CAS. Simpler mental model, but a single shared database for every
  user, and a per-value size ceiling (~2 MB) that §6 could eventually reach.

Recommend the Durable Object, with D1 as the fallback if free-tier DO turns
out not to be available on the account — verify before building, this is
listed in §9.

Either way, an `R2` object holding the ciphertext with only the version in the
consistent store is the escape hatch if payloads grow past what a row wants to
hold.

### 2.3 Abuse and cost

- Reject ids that aren't 64 hex chars; reject bodies over 4 MB.
- Per-IP rate limit (Cloudflare's built-in rate limiting rules, no code).
- No enumeration surface: ids are hashes, and a wrong id is a 404 that reveals
  nothing.
- Sweep documents untouched for 12 months.

A family syncing a handful of profiles a few times a day is three orders of
magnitude inside every free tier involved. The realistic cost is £0 and the
realistic risk is the account being forgotten about, not the bill.

### 2.4 Why the server has no merge logic

It would be elegant for the server to run `mergeProfiles` — it's JavaScript,
the Worker could import the very same module, and delta pushes would fall out
for free (§6). It is deliberately not done, for two reasons:

1. **The data is encrypted.** A server that merges is a server that reads.
   The whole of §3 goes away.
2. **Offline-first already forces the client to own the merge.** A device that
   has been offline for a week must merge on reconnect regardless. A server
   merge would be a *second* implementation of a subtle algorithm, not a
   replacement for the first.

Client-side merge plus a dumb store means the correctness-critical code is one
module, tested by one test file, running in one place.

---

## 3. Encryption

### 3.1 From day one, not later

Retrofitting encryption means migrating every existing remote document under
users who have no idea a migration is happening. It is ~60 lines of WebCrypto
against a plan that already requires a key-shaped secret to exist. Doing it
later is strictly more work than doing it now.

What it buys: the server holds a first name, an emoji and a record of a
child's Japanese practice for an unknown number of children, with no login
protecting it. Encrypted, it holds none of that — which is the difference
between "must think carefully about children's data" and "there is no
children's data here".

### 3.2 Deriving the id and the key from the code

One expensive derivation, then two independent outputs via HKDF, so the id
handed to the server leaks nothing about the key:

```
master  = PBKDF2-SHA256(code, salt = "kana-quest-sync-v1", 200_000 iters) → 32 bytes
docId   = HKDF-SHA256(master, info = "doc-id") → 32 bytes, hex            (sent to server)
aesKey  = HKDF-SHA256(master, info = "content-key") → AES-GCM-256          (never sent)
```

Body layout is `12-byte random IV ‖ ciphertext`, a fresh IV per PUT.
Plaintext is the profile document as UTF-8 JSON.

PBKDF2, HKDF and AES-GCM are all available in Safari's `crypto.subtle`.
Derivation runs once per profile per launch and is cached in memory; AES-GCM
over even a 4 MB document is single-digit milliseconds.

### 3.3 What the server can still see

Document id, ciphertext length, request times, IP address. Not names, not
progress, not which characters exist — and length is the only real signal,
which at best distinguishes "a lot of practice" from "a little".

---

## 4. The client

### 4.1 Two modules, split on a testing seam

`src/sync.js` is the whole feature from the app's point of view, but it splits
in two, because JavaScriptCore — what stands in for Node here — has no
`crypto.subtle` and no `fetch`:

| Module | Contains | Tested by |
| --- | --- | --- |
| `src/sync-protocol.js` | Pure: what to do next given local state, remote version and the last outcome — the pull/merge/push/retry state machine | `test/sync.js`, directly |
| `src/sync-transport.js` | `fetch`, `crypto.subtle`, key caching | Exercised through a stub in `test/sync.js` |

Same seam the repo already uses for `test/wiring.js`, which boots the app
against a stub DOM. The part with the interesting failure modes — conflict,
retry, backoff, "the clock is wrong" — is the part that is pure and directly
testable.

### 4.2 Where sync state lives

**Not in the profile.** IndexedDB gets a second object store, `sync`, keyed by
profile id (`DB_VERSION` 1 → 2; the existing `onupgradeneeded` already guards
with `objectStoreNames.contains`, so the upgrade is additive):

```js
{ profileId, code, docId, version, lastPulledAt, lastPushedAt, lastPushedHash }
```

Keeping it out of the profile means the profile document is *exactly* what
gets encrypted and uploaded, with nothing to strip first — no footgun where a
future field quietly ships the code inside the blob it protects.

### 4.3 When sync runs

| Trigger | Action |
| --- | --- |
| App launch, profile list loaded | Pull every coded profile, in the background — the profile picker must not wait on the network |
| Opening a profile | Pull, then render |
| Any `saveProfile` on a coded profile | Debounced 5 s → push |
| Session end | Push immediately |
| `online` event | Sync every coded profile |
| `visibilitychange` → hidden | Flush the pending push |
| Settings → **Sync now** | Full pull + push, with visible status |

The `hidden` flush is best-effort: `sendBeacon` cannot carry `If-Match`, so
the push is fired eagerly and a loss is simply picked up at next launch. That
is acceptable precisely because local IndexedDB — not the server — is the
source of truth.

### 4.4 One hard rule: never merge mid-question

`state.profile` in `app.js` is a live object that the session flow holds a
reference to and mutates. A pull that replaces it underneath an in-flight
question would grade the answer against a profile that is no longer the one on
screen.

**Pull only when `state.session` is null.** If a pull completes while a
session is running, hold the merged result and apply it at the next screen
transition. Pushing during a session is fine — it only reads.

### 4.5 The conflict loop

```
push:
  PUT If-Match: <known version>
  200 → record new version, done
  412 → GET, decrypt, mergeProfiles into local, save, retry (max 3)
      → after 3, back off exponentially and leave it for the next trigger
  404 on PUT If-Match → the remote document was deleted; treat as create
```

This converges because the merge is commutative and idempotent at record
level: whichever device retries, both end up with the same record set. Two
devices genuinely being used at the same instant is the pathological case and
it costs one extra round trip, not data.

### 4.6 Deleting a learner

Because a document belongs to exactly one profile (§1.5), deleting the
profile locally can `DELETE` the remote document, and every other paired
device then sees `404` on its next pull. A 404 on pull for a profile that
exists locally means *deleted elsewhere* — prompt rather than act, since the
alternative is a mis-tap on one device silently destroying practice on
another.

### 4.7 Clocks

The entire merge is last-write-wins on client timestamps, so a tablet with a
badly wrong clock either wins every conflict forever or loses every one. Cheap
fix: every response carries `Date`; store `offset = serverDate - Date.now()`,
and grade through a `syncedNow()` helper instead of `Date.now()`.

This is nearly free because `grade()` and `gradeYomi()` in `src/srs.js`
already take `now` as a parameter — the caller supplies it, so there is one
place in `app.js` to change and no scheduling code to touch.

### 4.8 Offline

Nothing changes. IndexedDB stays the source of truth, every sync trigger is
allowed to fail silently, and the service worker already ignores cross-origin
requests and non-GET methods (`sw.js`, fetch handler) — so sync traffic passes
through it untouched, with no cache to poison and no change needed there.

---

## 5. The UI

One new card in Settings, above **Backup & transfer**, which stays exactly as
it is — the file backup remains the answer for "everything is gone", and for
anyone who would rather not use a server at all.

**Not yet syncing:**

> ### Sync across devices
> Practice on this device only. Turn on sync to keep this learner's progress
> the same on every phone and tablet.
>
> `[ Turn on sync ]`  `[ Enter a code from another device ]`

**Turn on sync** generates a code, pushes the current state, and switches to:

**Syncing:**

> ### Sync across devices
> `K7QM-3XR9-P2FT`  `[ Copy code ]`
>
> Enter this code in Settings on another device to keep them in step.
> Last synced 2 minutes ago.
>
> `[ Sync now ]`  `[ Turn off sync ]`

**Enter a code** takes the code, pulls, merges into this profile, and starts
syncing. The first pull is the risky moment for a parent — they are about to
combine two histories — so it reports what happened in the app's existing
plain register: *"Merged. 42 characters were further ahead on the other
device."*

**Turn off sync** stops pushing and forgets the code locally. It does not
delete the remote document; that only happens when the profile itself is
deleted (§4.6).

Status stays in Settings rather than becoming a permanent header indicator.
The audience is a child practising kanji, and a sync spinner on the practice
screen is an invitation to worry about something they cannot act on.

---

## 6. Payload size

A profile is pushed whole. Rough shape of a serious learner — 300 kanji across
all three modes, plus both kana sets:

| | records | ≈ bytes |
| --- | --- | --- |
| Definition | 300 | 105 KB |
| Writing | 300 | 105 KB |
| Yomi rollups | 300 | 60 KB |
| Yomi per-reading | ~1000 | 180 KB |
| Kana, both modes | 416 | 145 KB |
| **Total** | | **≈ 600 KB**, ~120 KB compressed |

Fine. The upper bound is not: all 2,136 jōyō in three modes approaches 4 MB,
and `MAX_HISTORY = 300` means one heavily-drilled character can carry 5 KB of
history by itself.

Two things keep this from mattering now, and one fixes it later:

- **Pulls are usually free.** `If-None-Match` returns `304` with no body
  whenever nothing changed elsewhere, which is the common case.
- **Pushes are skipped when nothing changed**, via `lastPushedHash`.
- **If it does become a problem**, shard the document by key prefix — one
  remote object per `mode:script` group, each with its own version — so a
  Writing session pushes only the Writing shard. This is a change to
  `sync-protocol.js` and the storage key, not to the merge, the encryption or
  the server. Deliberately deferred: it is real complexity bought for a
  problem no current user has.

---

## 7. Tests

Extending what exists rather than adding a new style of test:

- **`test/store.js`** — grows to cover §0: removal beating an older
  enrollment, per-key settings LWW, the array→timestamp study-list migration,
  and the existing assertions passing unchanged through the `merge.js`
  extraction (that last one is the point of doing the refactor separately).
- **`test/sync.js`** — new. Drives `sync-protocol.js` against a scripted fake
  transport: clean pull, 304, 404-then-create, 412-then-merge-then-succeed,
  three-way conflict, offline mid-push, remote deleted, clock offset applied.
- **`test/wiring.js`** — grows one case: a pull that lands mid-session is
  deferred and applied at the screen transition (§4.4).
- **Server** — a small script driving the Worker under `wrangler dev`,
  asserting the CAS semantics: `If-Match` mismatch is a 412 and does not
  write; concurrent PUTs produce exactly one winner.

---

## 8. Phasing

Each phase ships on its own and is useful on its own. Nothing before phase 3
changes anything a learner would notice.

| Phase | What | Why here |
| --- | --- | --- |
| **0** | Timestamped study list + tombstones, per-key settings LWW, extract `src/merge.js` | Improves the *existing* backup path immediately. Everything else depends on it, and it is the only phase that touches scheduling code |
| **1** | The Worker: two endpoints, Durable Object, deployed, no client | Independently verifiable with `curl`. Confirms the free-tier question in §9 before any client work is committed to it |
| **2** | `src/sync-transport.js` + `sync-protocol.js`, Settings UI, **manual** sync only | Real cross-device sync, but only when a parent asks for it. Every failure mode is observed with a human watching |
| **3** | Automatic triggers (§4.3), deferred-merge rule (§4.4), status line | This is the phase that delivers the actual goal |
| **4** | Clock correction, backoff, remote delete on profile delete, 404-means-deleted prompt | Robustness, once the shape has survived real use |
| **5** | *Only if needed:* shard the document (§6) | No current user has this problem |

Phase 0 is worth doing next regardless of whether the rest is ever built: the
un-enrol bug in §0.1 is reachable today, through the backup file, and is a
plain bug.

---

## 9. Open questions

- **Is the SQLite-backed Durable Object available on the free plan for this
  account?** Verify before phase 1; D1 is the fallback (§2.2) and the client
  cannot tell the difference.
- **Should one code be able to cover several children?** §1.5 says no, on the
  grounds that a shared iPad shouldn't force siblings together. But a parent
  setting up two kids on two devices then types two codes. Worth revisiting
  after phase 2 with actual use.
- **What should happen when the same profile is genuinely in use on two
  devices at once?** The merge converges, but the *sessions* don't — both
  devices may serve the same due character. Probably acceptable; note it and
  see.
- **Retention.** A 12-month sweep is proposed in §2.3. A family that stops for
  a school year and comes back would lose the remote copy, though not local
  progress on any device that still has it. Is 12 months right, or should it
  be longer?
- **Does the sync code belong in the backup file?** Including it makes
  restore-and-resume seamless; excluding it means a leaked backup can't be
  turned into ongoing read access to a live document. Leaning exclude.
