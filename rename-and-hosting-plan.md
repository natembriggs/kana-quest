# Renaming the app, and moving the site to Cloudflare

Status: **the rename has happened and the dual run is under way.** Written
20 September 2026, executed 21 September 2026. §§1–8 are done and live;
§9 is the part still ahead, and it has no date.

What is true right now:

- The app is called **Kanji Trail**. It serves from **kanjitrail.com**.
- The old site at `natembriggs.github.io/kana-quest/` is **still running the
  full app**, unchanged except for a migration notice on its home screen.
- Nothing has been switched off, and nothing will be until Nathan decides
  (§9). Every learner's progress is still exactly where it was.

## 1. Why rename at all

`Kana Quest` is taken, in this exact category, by a commercial product:
a 2020 hiragana puzzle game by Not Dead Design, published by Whitethorn
Games, still on sale on Steam at $15 and living at `kanaquestgame.com`.
It is not a dormant claim and it is not a different market — it is a
Japanese-script learning product with a marketing budget. Continuing
under the same name means permanent confusion at best.

The name was also no longer accurate. The app covers all 2,136 jōyō kanji
plus ~900 beyond, vocabulary, graded handwriting and 58 stories. "Kana"
described roughly the first fortnight of it.

## 2. The name: Kanji Trail

Settled 21 September 2026, after `Mojiyama` (文字山) was proposed and
rejected the day before.

**The rule that came out of the Mojiyama round, and was followed this
time:** candidates go past a native speaker *before* any registry
research, not after. Checking availability first wastes the work when a
name does not survive a native ear, and worse, it quietly lets a name's
availability build the case for it. `Kanji Trail` passed that check
first.

**The case for it, in Nathan's words:** kana can be considered the first
step on the kanji trail, and the stories are further along the same
trail. It reads as a journey rather than as work — which was the specific
objection to `MojiGym`, where "gym" made the app sound like drilling and
left no room for the stories.

**The objections, accepted rather than argued away.** A parent looking
only for kana practice for a young child might skip an app called Kanji
Trail — the mirror of the problem being fixed, and a real cost. `Kanji` +
a common English noun is also the most crowded naming pattern in this
category (Kanji Study, Kanji GO, Kanji Tree, Kanji Teacher, Kanaji), and
because "kanji" is generic and descriptive, the mark is weak: nobody can
own it, which means low legal risk and low distinctiveness together. And
trail/trial is one of the commonest transposition typos in English.

The discoverability half of that is answered in §10, not by the name.

**Written with a space.** `Kanji Trail`, not `KanjiTrail` — decided 21
September, after the first pass shipped the closed-up form. The domain is
necessarily `kanjitrail.com`, and the internal identifiers that derive
from it (`kanjitrail-site`, `kanjitrail-backup-*.json`) stay closed up;
everything a person reads has the space.

**Checked before committing to it**, on 21 September:

- No app, company, site or trademark called Kanji Trail or KanjiTrail in
  this category. On the app stores, nothing.
- `kanjitrail.com`, `.net`, `.co.uk` and `.io` were all unregistered;
  `.app` likewise. `.com` has since been bought.
- The phrase collides with the Kanji–Rangdum trek in Ladakh, which has
  real published trail content behind it. Search noise, nothing more.
- A GitHub repository called `kanji-trail-app` exists, titled かんじトレイル.
  It is one person's personal project for their own child — a kanji app
  for *Japanese* primary schoolchildren following their own school
  curriculum, which is close to the opposite audience. 31 commits across
  five working days in six months, no domain, deployed on a `github.io`
  path, and as of 21 September it has been pivoting to a different app
  entirely ("FROG QUEST") covering reading, piano and science. It is not
  a competitor and shows no sign of wanting the `.app` domain. Nothing of
  theirs has been looked at for ideas and nothing should be.
- Salesforce holds TRAILHEAD/TRAILBLAZER in education-software classes.
  Different market, different compound; assessed as not a risk.

Ruled out along the way: `Kana Quest` (taken, §1); `MojiGym` (the .com is
a live Japanese site, plus the connotation problem above); `Mojiyama`
(native-speaker rejection).

## 3. What Nathan does personally

Done:

- **Registered `kanjitrail.com`** (21 September), at Cloudflare, so
  registrar, DNS, Workers and the existing D1/Durable Objects sit in one
  account.

Still outstanding:

- **Add `kanjitrail.com` to the Turnstile widget's allowed hostnames** in
  the Cloudflare dashboard. Until this is done, a feedback submission
  from the new origin is rejected by Turnstile itself, *before* the
  Worker's own `TURNSTILE_HOSTNAMES` list is consulted — so the Worker
  config being right (it is, §7) is not enough on its own.
- **Turn on "Always Use HTTPS"** (SSL/TLS → Edge Certificates). The
  Worker answers on port 80 as well as 443, and `http://kanjitrail.com`
  was serving the app with a 200 and no redirect. This is a zone setting
  and cannot be done from here. HSTS is worth considering alongside it.
- **Decide about `www`** (§6).
- **Decide about the matching `.app`**, defensively. ~$14/yr. Assessed as
  unnecessary (see the `kanji-trail-app` note in §2), so this is comfort
  rather than protection.
- The matching `.co.uk` **cannot be registered at Cloudflare**, which
  supports UK domains by transfer only. It would need a Nominet registrar
  and a second renewal to track.

## 4. The one hard constraint: storage is per-origin

This is the thing that makes the migration non-trivial, and it has no
workaround.

Every learner's data — profiles, FSRS scheduling state, what they have
answered instead, stories read, bookmarks, settings — lives in IndexedDB
under database `kana-quest`, on the origin `natembriggs.github.io`.
IndexedDB, localStorage and Cache Storage are all partitioned by origin.
There is **no browser mechanism** by which the new origin can read any of
it. Not a permission, not a flag, not a header. Simply opening the new
site presents every existing user with a brand-new, empty app — which is
exactly what it did when the new origin was first verified.

So every user must take a deliberate action to carry their progress
across. Two mechanisms already existed that do this, and both work
cross-origin:

**Sync codes.** `src/sync-transport.js` talks to
`kana-quest-sync.natebriggs.workers.dev`, and that Worker already sends
`Access-Control-Allow-Origin: *` — deliberately, because possession of
the code *is* the authorisation boundary. A code paired on the old site
is redeemable on the new one with **zero server-side change**. The
profile is end-to-end encrypted; the Worker never sees plaintext.

**Backup files.** `store.exportAll()` / `store.importAll()` round-trip a
whole profile set — every learner on the device, not just the current one
— through a downloaded file.

### Ruled out on purpose: passing the code in the URL

The obvious "seamless" version — old site links to
`newdomain/?code=XXXX-XXXX-XXXX` — must not be built. The sync code is
key material: it is PBKDF2-stretched into both the document id and the
encryption key. Putting it in a query string writes it into browser
history, any referrer header, and every intermediate log. The whole point
of the design is that the key never leaves the device. A hand-typed or
pasted code across two tabs is the correct trade.

## 5. Things that must not be renamed

Rebranding is a find-and-replace, and several of the matches are
load-bearing. Changing any of these breaks live users for no benefit.

| Identifier | Where | Why it must stay |
|---|---|---|
| `kana-quest-sync.natebriggs.workers.dev` | `src/sync-transport.js` | Renaming the Worker breaks sync on the *old* site — i.e. breaks the migration vehicle itself. A `sync.kanjitrail.com` custom domain can be added later as an *additional* route to the same Worker. |
| `PBKDF2_SALT = 'kana-quest-sync-v1'` | `src/sync-transport.js` | Part of key derivation. Change it and every existing sync code stops resolving to its document. |
| `DB_NAME = 'kana-quest'` | `src/store.js` | The IndexedDB name. Changing it on the old origin orphans every existing user's data instantly. |
| `format: 'kana-quest-backup'` | `src/store.js`, validated on import | `importAll()` rejects any file whose `format` string does not match. Rebrand it and every backup file already on someone's disk becomes unimportable — the fallback migration path dies. |
| `CACHE_PREFIX = 'kana-quest-'` | `sw.js`, `src/app.js` | **Added 21 September.** The service worker's `activate` handler deletes superseded caches *by this prefix*, and deliberately leaves a sibling app's caches alone. Change it and every cache already on a learner's device stops being recognised as this app's: tens of megabytes of story art, kept forever, never reclaimed. |
| The `kana-quest-*` localStorage / sessionStorage keys | `src/app.js`, `src/feedback.js` | **Added 21 September.** Install id, install-nudge and sync-nudge dismissals, reader settings. Renaming them silently resets those preferences and orphans the install id every existing feedback report is keyed to. |
| D1 name/id, Durable Object class, `kana-quest-feedback` repo | `*/wrangler.toml` | Internal identifiers with live data behind them. |

These are internal names nobody sees. They stay as they are, indefinitely.

**One that looked load-bearing and is not:** the backup file's *download
filename*. `importAll()` validates the `format` field inside the file and
never looks at the name, so the filename was renamed to
`kanjitrail-backup-*.json` while the format string stayed. A
`kana-quest-backup-*.json` already on a disk still imports.

## 6. Phase 1 — the new site (done, 21 September)

**Platform: Workers static assets, not Pages.** Cloudflare's investment
is in Workers; Pages is effectively in maintenance. Workers also keeps
the door open to serving app routes and content from the same origin
later (§10), without a platform move.

Nothing in the app hardcodes an origin — checked, and deliberately kept
that way — and every path is relative, with `start_url` and `scope` both
`./`. So the app runs at a root domain unchanged. No path rewrites.

Live as `kanjitrail-site`, with `kanjitrail.com` attached as a custom
domain. Attaching a route also disabled the `workers.dev` hostname and
Preview URLs, which is the right default: every extra hostname serving
the same bytes is another copy of the site competing with the original.

**`www` is deliberately not attached.** A second custom domain would
serve byte-identical pages from a second hostname — the same split-your-
own-ranking problem §8 has to handle for the dual run, except
self-inflicted and permanent. `www` needs a *redirect* to the apex, not a
second copy of the site. Until that exists, `www.kanjitrail.com` does not
resolve, which is honest but will surprise anyone who types it.

### The deploy allowlist, and what it nearly leaked

`tools/deploy-site.sh` stages an explicit allowlist of the eight served
paths and hands them to `wrangler deploy --assets`.

The first attempt was the obvious one: `[assets] directory = "."` plus a
`.assetsignore` blacklist. **It silently did nothing** — wrangler read
10,272 entries, the entire repository and `node_modules` included,
against the ~380 files the app needs. A blacklist also fails open by
nature. The allowlist fails closed and aborts if a listed path has been
renamed away.

**But the allowlist works at top-level granularity, and that was not
fine-grained enough for `assets/`.** The paintings the browser fetches
share a tree with the authoring record that produced them, so five files
the app never requests were staged for public serving on every
verification run: `assets/stories/ART-DIRECTION.md`, and the generation
prompts and source lists for the cover and story paintings. The guard
that was supposed to catch prose was `-maxdepth 1` and never looked
inside `assets/stories/`. Both are fixed: the guard is recursive, and
those files are pruned from the staged copy. Verified against the live
domain that they, `README.md` and every plan document answer 404.

### The port-80 origin, and why it mattered more than a padlock

GitHub Pages redirects plain HTTP to HTTPS automatically and `github.io`
is HSTS-preloaded, so this never arose before. A Workers custom domain
answers on port 80 too, and without the zone's "Always Use HTTPS"
setting it serves the app there — which Chrome flags with a warning
beside the address.

The warning is the least of it. **`http://kanjitrail.com` is a different
origin from `https://kanjitrail.com`**, so it is §4's partitioning trap
again, self-inflicted — and with the escape hatch shut. Measured in a
browser rather than assumed: `isSecureContext` false, `crypto.subtle`
**absent** so sync cannot derive a key, `serviceWorker` **absent** so
nothing caches or works offline, and `indexedDB` present and writable.
A learner who landed there would quietly accumulate progress the real
site can never see, and could not rescue it with a sync code either.

Fixed in two places, deliberately. The zone setting (§3) is the real fix
and answers with a 301 before anything reaches the browser. The backstop
is an inline script at the very top of `index.html`, before the manifest
link and before any module loads, scoped to the live hostname — because
`tools/serve.sh` serves over plain HTTP to a phone on the LAN and
`.claude/launch.json` over HTTP on localhost, and redirecting either
would break both.

`not_found_handling = "none"`, because the app is a single page — screens
switch via `show()` in app.js and there is no path routing anywhere in
`src/` — so an unknown path is a real mistake. Returning `index.html`
instead would hide a missing lazy-loaded kanji grade or story file behind
a confusing parse error, which is the same trap `sw.js` already avoids in
its offline fallback.

Deployed payload: 380 files, 35MB. Comfortably inside every Workers limit
(25MB per file, 20,000 files).

## 7. Phase 2 — the rebrand (done, 21 September)

Renamed: the page title and link-preview metadata, the manifest, both
screen headers, the contribution credits, the sync-code share sheet, the
backup download filename, the "not a supported backup" message, and the
attribution and licence lines across all 58 story files. The stories are
the same app's, not a different publisher's, so they carry the current
name — §11's open question, answered.

**The brand mark** moved from かな to **字**. かな was the old name's mark
and says the wrong thing under the new one; 字 means "character", so it
covers the kana a beginner starts on as well as the kanji, rather than
repeating the narrowing the name itself has. Confirmed by Nathan. A real
icon is still open (§11).

Config for the new origin, done:

- `feedback-server/wrangler.toml` → `ALLOWED_ORIGINS` gained
  `https://kanjitrail.com`. The old GitHub Pages origin **stays in the
  list** for the whole dual run: removing it early would silently break
  the feedback button for exactly the users who have not migrated yet,
  who are the ones worth hearing from.
- `feedback-server/wrangler.toml` → `TURNSTILE_HOSTNAMES` gained the new
  hostname. The matching dashboard change is still Nathan's (§3).
- Verified live: both origins pass CORS preflight, an unknown origin
  still gets 403.

## 8. Phase 3 — the dual run (running now)

Both sites are live. The old one keeps working properly — not a stub, not
degraded. It ends only when Nathan says so (§9).

One piece of luck: `sw.js` is deliberately **network-first**, so an
existing installed PWA picks up a new `index.html` on its next online
load rather than serving a cached copy forever. The migration notice
reaches people, including on iOS home screens.

**On the old site**, a notice on the home screen, styled like the
existing `sync-nudge` with the accent brought to its leading edge.
Gated on `location.hostname`, because one codebase serves both origins.
It offers two routes out:

1. **This learner's sync code** — routed through the existing Settings
   sync card, which already creates a pairing for a profile that has
   none, shows the code and scrolls it into view.
2. **A progress file** — `exportAll()`, covering *every* learner on the
   device.

The notice says which suits whom: the code moves one learner and keeps
working afterwards; the file is a one-off snapshot of everybody. §8 as
originally written framed step 1 as "this profile's sync code", which
quietly assumed one learner per device — wrong for the families who
actually use this.

Neither route re-implements pairing or export. Both call the existing,
tested functions: a second implementation is a second thing to get wrong
about a feature whose failure mode is losing somebody's progress.

"Open Kanji Trail" opens a **new tab**, so the old site stays up behind
it and a learner who has not finished copying their code down has not
lost it. **No code in the URL, ever** (§4). Dismissal lasts the browser
session only, and is per-device rather than per-profile — a parent
dismissing it while looking at one child's profile has not dealt with it
for the others.

**On the new site**, `?from=kq` makes the first-run screen name the app
the visitor is arriving from ("I already use Kana Quest somewhere else")
rather than leaving them to recognise themselves in a generic phrase. The
underlying wording is now app-neutral, so it still reads correctly for
somebody adding a second device years from now.

**Storage eviction is the clock nobody controls.** iOS evicts site data
after roughly seven days of non-use for a site opened in a *browser tab*;
home-screen-installed PWAs are exempt. This is already the documented
reason `#install-banner` exists. It means a browser-tab user of the old
site can lose their progress to the browser regardless of how long the
dual run lasts — an argument for the notice reaching people early, not
for keeping the old site up longer.

**Not built: the usage beacon.** The earlier draft proposed an anonymous
beacon on the old origin so "is anyone still there?" had an answer.
Dropped, because Nathan knows every current user personally and will
confirm migration with them individually. That is better evidence than
telemetry and collects nothing.

**Still to do here:** `<link rel="canonical">`. Both origins now serve
identical pages, which splits the site's own search ranking. It needs an
absolute URL, and the app deliberately hardcodes no origin (§6), so it is
commented in place in `index.html` rather than guessed at. Low priority
next to everything else, and worth doing before the dual run gets long.

## 9. Phase 4 — ending the dual run

Not scheduled, and **not on a fixed clock**. Roughly a month is the
working expectation, but it is a guide and not a commitment: Nathan
closes the old site when he is ready and has confirmed with each user
that they have moved.

Two corrections to the earlier draft, which had this wrong:

**The old origin never has to be switched off.** GitHub Pages is free and
a holding page is a few KB. Keeping a minimal page at that exact URL
indefinitely — one that does nothing but read the existing IndexedDB and
offer "show my sync code" / "download your progress file" — means a
straggler returning in three years still gets their data out. Turning
Pages off converts "hasn't migrated yet" into "has lost everything", for
no saving at all.

**"Repo private" and "old URL alive" conflict as previously written.** On
a free GitHub account, Pages cannot serve from a private repository. The
path `/kana-quest/` comes from the *repo name*, so the way to have both
is to keep a public repo named `kana-quest` containing only the holding
page, and move the app to a new private repo.

The repository stays **public** until the migration is over, deliberately.

Sequence, when Nathan calls it:

1. Old site becomes the holding page above: the name change, a link, and
   the code/backup flow still reachable.
2. Later, if wanted: the app moves to a private repo, with a public stub
   repo left holding the URL.
3. The Worker origin allowlists keep the old entries until the old origin
   is genuinely dead, and not before.

## 10. Being findable, and what going private does not buy

### Findability

The name contains none of the words a parent actually searches for, and
after the rename it contains fewer of them: "kanji" is the part of this
app a beginner reaches last. The name is not where that gets fixed.

**Done (21 September):** the page title now carries the descriptive half
— `Kanji Trail — hiragana, katakana and kanji practice for kids` — since
the title tag is what a search result displays. Plus a real meta
description, Open Graph tags so a pasted link shows the icon and a
sentence instead of a bare URL, and a `SoftwareApplication` JSON-LD
block. No `aggregateRating`: there is no honest source for one and it
must not be invented.

**Proposed, not started.** A brand-new domain has no authority and will
not touch "learn hiragana", which belongs to sites with fifteen years of
backlinks. What is reachable is long tail, and the strongest available
pages are `/hiragana` and `/katakana` — full charts with stroke order
(the KanjiVG data is already here), romaji and audio. Those pages do not
*contain* the search term, they **are** it, and they put the words the
brand lacks on the domain. A parent-facing page or two ("what order to
teach kana in, and why") alongside them.

Not proposed: mass-generating 3,000 kanji pages from KANJIDIC/JMdict. The
data is here, but auto-generated pages over public dictionary data read
as thin and duplicative; Jisho ranks despite that because of authority,
not because the pages are good.

The stories are the strongest content here by a distance — and exactly
what the privacy goal below says to stop publishing. That is a real
either/or and belongs to Nathan.

Realistically, one well-placed link (r/LearnJapanese, one of the "best
apps for studying Japanese" roundups) outperforms months of on-page work
at this scale. The pages exist mostly so there is something to link *to*
that is not a bare app shell.

### Going private

Stated plainly, because the goal as phrased is only partly achievable.

A private repo removes from public view: the git history, the fork
button, every `*-plan.md` design document, and the whole `tools/`
authoring pipeline. That is a substantial amount of the actual work, and
the deploy allowlist (§6) already keeps all of it off the served site
today.

It does **not** hide the app's code. This is a client-side PWA: the HTML,
CSS, JavaScript and every story's text are delivered to the browser to
run, and are readable in devtools by anyone who opens them. Serving from
Cloudflare does not change that; nothing can, short of moving content
behind an authenticated Worker endpoint — the option considered and set
aside for now. It remains available later without a platform change,
which is part of why §6 picks Workers.

If the real concern is the stories and the artwork specifically, that is
the conversation to reopen, and it is a different piece of work.

## 11. Open decisions

- "Always Use HTTPS" on the zone (§3). A backstop is shipped, but the
  redirect belongs at the edge.
- `www`: redirect to the apex, or leave it not resolving (§6).
- The `.app` domain, defensively (§3).
- The canonical link (§8).
- A real icon. 字 is a deliberate placeholder, not a design.
- Whether to build the `/hiragana` and `/katakana` pages (§10), and
  whether any stories are published as public pages — which trades
  directly against §10's privacy goal.
- When to end the dual run (§9). Nathan's call, on his evidence.
