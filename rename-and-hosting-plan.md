# Renaming the app, and moving the site to Cloudflare

Status: **plan, not yet started.** Nothing in this document has been
executed. Written 20 September 2026.

## 1. Why rename at all

`Kana Quest` is taken, in this exact category, by a commercial product:
a 2020 hiragana puzzle game by Not Dead Design, published by Whitethorn
Games, still on sale on Steam at $15 and living at `kanaquestgame.com`.
It is not a dormant claim and it is not a different market — it is a
Japanese-script learning product with a marketing budget. Continuing
under the same name means permanent confusion at best.

The name is also no longer accurate. The app covers all 2,136 jōyō kanji
plus ~900 beyond, vocabulary, graded handwriting and 48 stories. "Kana"
describes roughly the first fortnight of it.

## 2. The name: undecided

`Mojiyama` (文字山) was picked on 20 September and rejected the same day.

The case made for it was that a mountain is climbed — levels, streaks,
the SRS grind — and is also where the folklore lives, so it covered both
halves of the app. That was English reasoning in a Japanese costume: the
whole argument rests on what *mountain* connotes in English. As an actual
compound, 文字山 reads like a flat place-name or a surname and carries
none of the adventure. Per Nathan's wife, a native speaker, it simply
sounds weird.

The rule that follows, and should govern the next round: **candidates go
past a native speaker before any registry research, not after.** Checking
availability first wastes the work when a name does not survive a native
ear, and worse, it quietly lets a name's availability build the case for
it.

What the name still has to do:

- carry both the drill and the stories — the objection to `MojiGym` was
  that "gym" reads as work, and the stories are meant to go beyond rote
  training
- sound natural to a Japanese ear as well as an English one
- be spellable by an English speaker who has heard it once
- ideally dodge the crowded `Moji-` prefix (the MOJi dictionary family,
  plus a "Moji – Learn Japanese & Kanji" on both app stores)

Ruled out so far: `Kana Quest` (taken, §1); `MojiGym` (the .com is a live
Japanese site on Lolipop, and the connotation problem above);
`Mojiyama` (native-speaker rejection).

Registry checks already done on 20 September, kept so the next shortlist
does not repeat them. Unregistered in `.com`: `mojiniwa`, `mojidani`,
`mojimura`, `mojizuka`, `mojirin`, `mojikko`, `mojimichi`, `fudeneko`,
`kakikko`. Taken: `mojimori`, `mojineko`, `mojiya`, `mojimaru`,
`mojidojo`, `mojimachi`, `kotodama`, `yomikaki`, `fudebako`. Note that
these were assembled under the old, wrong process — availability first —
so the list is a convenience, not a shortlist.

**Nothing else in this plan depends on the answer.** The four
load-bearing identifiers in §5 never change, so the name has no bearing
on anyone's data or on how migration works. §6 and §8 are built
name-free, and the name itself lands in one short commit at cutover.

## 3. What Nathan has to do personally

**Register the domain, once §2 has an answer.** This cannot be
delegated to the agent —
registering a domain means entering payment details, which is off-limits
regardless of authorisation. Cloudflare Registrar sells at cost
(~$10.44/yr for `.com`) and having the registrar, DNS, Workers and the
existing D1/Durable Objects under one account is the whole reason for
going to Cloudflare in the first place.

Worth grabbing at the same time, or deliberately not:

- The matching `.app` — defensive, and a plausible future home if the
  PWA ever becomes a store app.
- The matching `.co.uk` — **cannot be registered at Cloudflare**, which
  supports UK domains by transfer only. It would need a Nominet
  registrar (123-reg, Namecheap, Gandi) and a second renewal to track.

Also personal, later in the process:

- Adding the new domain to the Turnstile widget's allowed hostnames in
  the Cloudflare dashboard (§7).
- Flipping the repo to private, at the very end (§9).

## 4. The one hard constraint: storage is per-origin

This is the thing that makes the migration non-trivial, and it has no
workaround.

Every learner's data — profiles, FSRS scheduling state, what they have
answered instead, stories read, bookmarks, settings — lives in IndexedDB
under database `kana-quest`, on the origin `natembriggs.github.io`.
IndexedDB, localStorage and Cache Storage are all partitioned by origin.
There is **no browser mechanism** by which the new origin can read any of
it. Not a permission, not a flag, not a header. Simply opening the new
site presents every existing user with a brand-new, empty app.

So every user must take a deliberate action to carry their progress
across. Fortunately the app already has two mechanisms that do exactly
this, and both work cross-origin today:

**Sync codes (primary).** `src/sync-transport.js` talks to
`kana-quest-sync.natebriggs.workers.dev`, and that Worker already sends
`Access-Control-Allow-Origin: *` — deliberately, because possession of
the code *is* the authorisation boundary. A code paired on the old site
can therefore be redeemed on the new one with **zero server-side
change**. The profile is end-to-end encrypted; the Worker never sees
plaintext either way.

**Backup files (fallback).** `store.exportAll()` / `store.importAll()`
already round-trip a whole profile set through a downloaded file, for
anyone who never set up sync.

### Ruled out on purpose: passing the code in the URL

The obvious "seamless" version — old site links to
`newdomain/?code=XXXX-XXXX-XXXX` — must not be built. The sync code
is key material: it is PBKDF2-stretched into both the document id and
the encryption key. Putting it in a query string writes it into browser
history, any referrer header, and every intermediate log. The whole
point of the design is that the key never leaves the device. A
hand-typed or pasted code across two tabs is the correct trade.

## 5. Things that must not be renamed

Rebranding is a find-and-replace, and three of the matches are load-
bearing. Changing any of these breaks live users for no benefit:

| Identifier | Where | Why it must stay |
|---|---|---|
| `kana-quest-sync.natebriggs.workers.dev` | `src/sync-transport.js:6` | Renaming the Worker breaks sync on the *old* site — i.e. breaks the migration vehicle itself. A `sync.<newdomain>` custom domain can be added later as an *additional* route to the same Worker. |
| `PBKDF2_SALT = 'kana-quest-sync-v1'` | `src/sync-transport.js` | Part of key derivation. Change it and every existing sync code stops resolving to its document. |
| `DB_NAME = 'kana-quest'` | `src/store.js:12` | The IndexedDB name. Changing it on the old origin orphans every existing user's data instantly. |
| `format: 'kana-quest-backup'` | `src/store.js:297`, validated at `:309` | `importAll()` rejects any file whose `format` string does not match. Rebrand this and old backup files become unimportable — the fallback migration path dies. |
| D1 name/id, Durable Object class, `kana-quest-feedback` repo | `*/wrangler.toml` | Internal identifiers with live data behind them. |

These are internal names nobody sees. They stay as they are,
indefinitely.

## 6. Phase 1 — stand up the new site (no user impact)

The new site goes up and works before anyone is told about it.

**Platform: Workers static assets, not Pages.** Cloudflare's investment
is in Workers; Pages is effectively in maintenance. Workers also keeps
the door open to serving app routes and content from the same origin
later (which would let CORS be dropped entirely), without a platform
move.

Nothing in the app hardcodes the current origin — checked — and every
path is relative (`./`, `src/…`), with `start_url` and `scope` both
`./`. So the app runs at a root domain unchanged. No path rewrites.

### Built and verified, 20 September

Done, and working against a local copy of the staged output:

- **`wrangler.toml`** at the repo root. `not_found_handling = "none"`,
  because the app is a single page — screens switch via `show()` in
  app.js and there is no path routing anywhere in `src/` — so an unknown
  path is a real mistake. Returning `index.html` instead would hide a
  missing lazy-loaded kanji grade or story file behind a confusing parse
  error, which is the same trap `sw.js` already avoids in its offline
  fallback.

- **`tools/deploy-site.sh`**, an explicit allowlist that stages the eight
  served paths and hands them to `wrangler deploy --assets`.

  The first attempt was the obvious one: `[assets] directory = "."` plus
  a `.assetsignore` blacklist excluding `.git/`, `tools/` and `*.md`.
  **It silently did nothing.** Wrangler reported reading 10,272 entries —
  the entire repository, git directory and `sync-server/node_modules`
  included — against the 380 files the app actually needs. Had that
  deployed, every design document and the whole authoring pipeline would
  have gone public. A blacklist also fails open by nature: a new
  top-level directory ships unless someone remembers to exclude it. The
  allowlist fails closed, and aborts the deploy if a listed path has been
  renamed away.

- **`.claude/launch.json`** gains a `staged-site` server on port 8751,
  serving the staged copy from `/private/tmp` — outside Dropbox, which
  the dev server cannot read anyway.

Verified in the browser against the staged copy at a root path (not
today's `/kana-quest/` subpath): the app loads with no console errors,
profiles open, the story shelf renders its painted covers, and a story
opens with furigana and tap-to-define working — so `assets/`, lazy story
data and the per-grade kanji chunks all resolve. Every path in the
service worker's `SHELL` list and every relative reference in
`index.html` resolves inside the staged copy. `README.md`, the plan
documents and `tools/` all return 404.

Deployed payload: 380 files, 35MB, down from the 10,272 entries the
blacklist approach would have shipped.

Not yet done, and the one step that needs a nod: **the first actual
deploy.** It creates a publicly reachable `workers.dev` URL in Nathan's
account, so it is his call rather than something to do unasked.

Comfortably inside every Workers limit (25MB per file, 20,000 files).

## 7. Phase 2 — rebrand the app itself

Brand strings, by file: `index.html` 9 (7 user-visible), `styles.css` 6,
`sw.js` 3, `manifest.webmanifest` 1, `src/app.js` 10, plus ~60
`src/data/story-*.js` files carrying attribution and licence lines
("An original story written for Kana Quest", "Original to Kana Quest;
…"). Those last ones are user-visible in each story's credits and should
be updated — it is the same app under a new name, not a different
publisher — but they are a bulk edit to review carefully rather than
sed blindly.

Config that must change for the new origin:

- `feedback-server/wrangler.toml` → `ALLOWED_ORIGINS` gains
  the new origin (and its `www.` form if served). The old GitHub Pages origin **stays in the list** for the
  whole dual-run period.
- `feedback-server/wrangler.toml` → `TURNSTILE_HOSTNAMES` gains the new
  hostname, alongside the dashboard change in §3.
- `.claude/launch.json` name, and the localhost origins already
  allowlisted, can stay as they are.

Per the standing rule: `APP_VERSION` in `src/app.js:82` and `VERSION` in
`sw.js` bumped in step, with a `src/changelog.js` entry, in the same
commit.

Open question for Nathan: **a new icon.** The current mark is generic.
文字山 suggests an obvious one. Not required to ship, easy to do later.

## 8. Phase 3 — the dual run

Both sites live. The old one keeps working properly — not a stub, not
degraded. It ends only when Nathan says so.

One piece of luck here: `sw.js` is deliberately **network-first**, so an
existing installed PWA picks up a new `index.html` on its next online
load rather than serving a cached copy forever. The migration notice
will actually reach people, including on iOS home screens.

**On the old site** — a banner, styled like the existing `sync-nudge`
rather than as an alarm:

> Kana Quest is becoming **<new name>** — same app, new name and new
> home.
> Your progress does not move by itself. Here is how to bring it.

Leading to a two-step flow:
1. Show this profile's sync code (creating one if the profile has none),
   with a copy button — and, for anyone who would rather not use sync,
   a "download your progress file" button onto the existing
   `exportAll()`.
2. A button that opens the new site at `?from=kq` in a new tab. **No code
   in the URL** (§4).

**On the new site** — when `?from=kq` is present, lead the first-run
screen with "I already use Kana Quest" (that entry point already exists
at `index.html:245`) rather than making a migrating user hunt for it.

**Knowing when it is safe to stop.** Ending the dual run on a guess
means silently destroying someone's streak. The old site should report,
anonymously, that it is still being used — a small beacon keyed to the
existing random install id, so the question "is anyone still on the old
origin?" has an answer. This is new data collection and belongs under
the terms already being worked out in `analytics-plan.md`; it is
proposed, not assumed. Without it, the alternative is simply waiting a
very long time.

## 9. Phase 4 — ending the dual run (manual, much later)

Not scheduled. Triggered by Nathan, when the beacon has been quiet long
enough to be convincing.

1. Old site becomes a holding page: the name change, a link, and the
   code/backup flow still reachable for a straggler.
2. Later still: GitHub Pages off, repo private.
3. The Worker origin allowlists keep the old entries until the old
   origin is genuinely dead, and not before.

## 10. What going private does and does not buy

Stated plainly, because the goal as phrased is only partly achievable.

A private repo removes from public view: the git history, the fork
button, every `*-plan.md` design document, and the whole `tools/`
authoring pipeline. That is a substantial amount of the actual work.

It does **not** hide the app's code. This is a client-side PWA: the
HTML, CSS, JavaScript and every story's text are delivered to the
browser to run, and are readable in devtools by anyone who opens them.
Serving from Cloudflare does not change that; nothing can, short of
moving content behind an authenticated Worker endpoint — the option
considered and set aside for now. It remains available later without a
platform change, which is part of why §6 picks Workers.

If the real concern is the stories and the artwork specifically, that is
the conversation to reopen, and it is a different piece of work.

## 11. Open decisions

- The name itself (§2) — the only thing now blocking cutover.
- Whether to buy the matching `.app` defensively.
- Whether to commission a new icon now or after the move.
- Whether the story attribution/licence lines take the new name or keep
  their historical "Kana Quest" wording.
- Whether the old-site usage beacon in §8 is acceptable, or the dual run
  just gets a long fixed period instead.
