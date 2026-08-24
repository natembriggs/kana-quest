# Kana Quest

A kana and kanji practice app for kids, built as an installable web app so it
runs on iPhone, iPad and Android from one codebase.

There is no build step and no Node: the app is plain ES modules served as
static files. Edit a file, refresh the phone.

## Running it

```sh
./tools/serve.sh
```

That prints two URLs — one for this Mac, one for a phone or tablet on the same
wifi. Open the second on the device and, in the share menu, choose **Add to
Home Screen**; it then launches fullscreen with its own icon.

To run the tests (macOS ships JavaScriptCore, which is what stands in for Node
here):

```sh
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
$JSC -m test/smoke.js     # kana/kanji tables, answer checking, spaced repetition
$JSC -m test/wiring.js    # boots the app against a stub DOM and plays full sessions
$JSC -m test/store.js     # backup validation and conflict-safe profile merging
$JSC -m test/service-worker.js # cache isolation and offline fallback behaviour
```

All four must be run from the repo root.

To regenerate the kanji data in `src/data/` (e.g. after changing `GRADES`
in `tools/build_kanji_data.py`):

```sh
./tools/fetch_kanji_sources.sh   # downloads KANJIDIC2 + JMdict, ~90MB, not committed
python3 tools/build_kanji_data.py    # writes src/data/kanji-manifest.js + kanji-grade-*.js
./tools/fetch_kanjivg.sh             # downloads KanjiVG stroke SVGs, ~13MB, not committed
python3 tools/build_stroke_data.py   # writes src/data/stroke-kana.js + stroke-grade-*.js
```

`build_stroke_data.py` reads the manifest `build_kanji_data.py` just wrote,
so run them in that order.

## Deploying to GitHub Pages

Pages serves the repo as static files, which is exactly what this app is —
there is nothing to build. Every path in the app is relative, so it works
unchanged from `https://<user>.github.io/kana-quest/` rather than a domain
root; `.nojekyll` stops Pages trying to run Jekyll over the files.

Once it's live, updating the kids' devices is just `git push` — and the
whole "phone can't reach the laptop" problem below goes away, because the
site is always reachable over HTTPS. HTTPS is also what speech input will
need later.

To publish (one-time), via GitHub Desktop:

1. Open this repo in GitHub Desktop and click **Publish repository**. It
   creates the repo on GitHub and pushes in one step — no remote needs
   configuring first. **Untick "Keep this code private"**: Pages from a
   private repo requires a paid plan.
2. In the repo's **Settings → Pages** on github.com, set Source to *Deploy
   from a branch*, branch `main`, folder `/ (root)`, and Save.

If the button says *Publish branch* rather than *Publish repository*, a
remote is already configured and Desktop will try to push to a repo that may
not exist. `git remote remove origin` puts it back to the create-and-push
path.

The site appears at `https://<user>.github.io/kana-quest/` within a minute or
two. On each device, open that URL and *Add to Home Screen*. After that,
updating every device is just a push.

## Getting around

The front page asks **Hiragana, Katakana or Kanji**. Picking one opens that
script's own screen, with the modes across the top, a grade picker below them
for kanji (1–6, with a dot on any grade that has reviews waiting), and the
session actions under that. Backing out returns to the script picker.

Modes are per script: kana has **Reading** and **Writing**; kanji has
**Definition**, **Yomi** and **Writing**. Reading and Yomi are the same
activity under two names — "what sound does this make" — so switching between
hiragana and katakana keeps you in the equivalent mode rather than resetting.
Switching to a *different kind* of script (kana ↔ kanji) resets to that
kind's own default instead, since the modes don't line up 1:1 — kanji opens
on **Definition** rather than carrying Reading in as Yomi.

**📋 View set overview**, on the course screen, opens every character in the
whole course at once — up to 200 for the biggest kanji grade — in one
scrolling grid, colour-coded green by how well each is known (a legend at the
top explains the shades). It opens scrolled to the current set rather than
the top of a long list. Tap any character for its **detail screen**: stroke
order (numbered, with a Play button that animates the strokes drawing in one
at a time), and for kanji, its readings, meanings and example words — tapping
a reading shows the word it actually comes from, the same interaction as
after answering a Yomi question.

## If a phone is stuck on an old version

An iOS home-screen app is stubborn about picking up new code. **Settings →
Force refresh** clears Kana Quest's caches, unregisters its service worker and
reloads from the server; the version shown above that button tells you which
build is actually running. Other apps hosted on the same origin are left
alone. Progress lives in IndexedDB and is not touched.

Worth knowing about the underlying cause, since it will keep happening while
the app is served off a laptop: the phone can only update when it can actually
reach `tools/serve.sh` at the same LAN address it was installed from. If the
Mac is asleep, the server isn't running, or DHCP moved the Mac to a different
IP, the app silently keeps serving its cached copy — that is the service
worker doing its job, not a bug. Deploying to a stable HTTPS URL (GitHub
Pages) removes the whole class of problem.

The worker itself now defends against the two failure modes that are actual
bugs: it fetches with `cache: 'no-store'` (Safari applies heuristic freshness
to `python3 -m http.server` responses, which send no `Cache-Control`, so
network-first alone was not enough), and it precaches files individually
rather than via `cache.addAll`, whose all-or-nothing behaviour meant one slow
file could stop a new worker from ever activating.

## What works now

**Reading practice for hiragana and katakana.** A character is shown, and the
learner taps its sound from ten options laid out in two rows of five. Nothing
is typed, so no keyboard appears and the layout never shifts under a finger.

- **Profiles.** Several learners per device, no passwords — tap a name.
- **Adding more is always a deliberate choice.** The home screen and the
  end-of-session screen both offer *Add 5 more* and *Review N* as separate
  buttons; the app never slips new characters into a review session on its own.
  New characters are taught on their own cards before being quizzed.
- **Spaced repetition.** Leitner boxes, reviewed after 1, 2, 4, 8, 16 then 32
  days. A miss drops the character to box 0, so it comes back later in the same
  session and again the next day. A review session is a capped smattering
  (15 by default), not a forced march through everything due — and when more
  is due than fits, characters with a lapse on record are pulled ahead of ones
  that have never once been missed. A character that reaches the top box
  having *never* been missed keeps having its interval doubled (32 → 64 → 128
  → capped at 180 days) instead of settling there forever — useful for a kid
  who already knew some characters coming in, since those fade out of review
  almost entirely rather than eating a review slot every month.
- **The pace suggestion never blocks.** If most of what has been introduced is
  not yet solid, the card shows a *review first* tip — but *Add 5 more* stays
  enabled. The learner decides.
- **Distractors are confusable on purpose.** The nine wrong options are drawn
  from the character's own set first, and de-duplicated by romaji, because
  じ/ぢ are both "ji" and ず/づ are both "zu" — offering both would make a
  question unanswerable. A test checks this for all 208 characters.
- **A wrong tap gets one more try**, not an instant reveal. The tapped option
  turns red and locks; a second, different tap either finds the right answer
  or reveals it. Either way, the pass/fail record is locked to the *first*
  attempt — recovering on the second try doesn't erase the miss from spaced
  repetition, since the point of the record is what a learner actually knew
  before being shown anything.

**Kanji: the full 2,136-character jōyō set, plus ~900 more** — all six
Japanese elementary-school grades ("Primary school grade") plus secondary
jōyō ("Secondary school", everything else in general use, split into six
frequency-ordered sub-units so no single one is unwieldy; see
`kanji-expansion-plan.md` §8), plus a "Names & places" set beyond jōyō
(jinmeiyō and other common non-jōyō kanji, also split into six sub-units; see
§5). Kanji has three modes rather than two:
**Definition**, **Yomi** and **Writing**. Selecting Definition hides the kana
courses, since kana has no English meaning to quiz. Each mode keeps entirely
separate progress.

### Definition mode

Single-answer, like the kana quiz: the kanji is shown, and four English
meanings are offered in two rows of two — its own plus distractors from other
kanji in the same grade. Four rather than ten because English definitions are
long and ten would not stay readable on a phone; the under-half ratio rule
that governs the multi-select yomi quiz doesn't apply to a single-answer
question. Same one-more-try-then-reveal rule, same
first-attempt-locks-the-record rule. Once the question resolves, the kanji's
readings are shown as follow-up context (the reverse of Yomi mode, where the
meanings are the follow-up).

Meanings come from KANJIDIC2 with radical *names* stripped — it lists those
as if they were definitions ("one radical (no.1)"), and they aren't. The
filter matches the `radical (no. N)` shape rather than the bare word, so 根
("radical", a mathematical root) and 基 ("radical (chem)") keep their genuine
English definitions.

### Yomi mode

A kanji is shown with up to 10 candidate readings — its own on'yomi/kun'yomi
plus plausible ones borrowed from other kanji in the same grade. Unlike the
kana quiz, there's no submit step: **click a reading and it turns green or red
immediately.**

- **Grading happens per reading, not per kanji.** A kid can know セイ cold
  while still shaky on うまれる for the same 生, and the record reflects that
  — see "Per-reading spaced repetition" below.
- **The base view shows up to 4 readings as correct** (out of 10 options) —
  always the single most common on'yomi and kun'yomi, plus up to 2 more
  chosen by priority (never-graded readings first, then whichever is most
  overdue). Correct options are deliberately kept under half the total, so
  passing by clicking everything isn't possible.
- **The grading moment is the first wrong click**, not a submit button.
  Whatever was clicked correctly *before* that click is recorded correct;
  whatever correct reading was still unclicked at that moment is recorded
  incorrect — permanently, even if it's found afterward. After a miss, the
  learner can either keep clicking around to find the rest ("learning" —
  this still unlocks *Next*, it just doesn't rewrite the record) or tap
  **Show answers** to reveal everything and move on.
- **Advanced**, shown only when a kanji has more than 4 real readings, grows
  the same grid in place (existing taps keep their colour) to offer the rest
  of the pool — up to 6 — with enough distractors added to keep correct
  readings under half even at the full pool size. Never required to
  progress.
- **Only readings that appear in a real word are quizzed.** A reading no
  common word ever uses isn't worth a child's time and has no example to show
  when tapped, so it's dropped entirely — about 900 of 3,400 across the six
  grades. A handful of kanji (prefecture names like 媛/栃/茨) end up with no
  quizzable reading at all; they're skipped in Yomi mode specifically, and
  still taught in the other modes.
- **After a question resolves, clicking a (green) reading shows the most
  common word that uses it.** This is aimed squarely at readings that are
  easy to forget precisely because they're rare — 上 (above) has シャン among
  its on'yomi *only* because of 上海 (Shanghai); clicking シャン surfaces
  that word directly, even though 海 is a grade-2 kanji the learner may not
  have met yet.
- Meanings and the kanji's general example word are shown as feedback once a
  question resolves either way.

Data (readings, meanings, example words) comes from KANJIDIC2 and JMdict —
see `tools/build_kanji_data.py`.

### Getting the example words right

Deciding which word demonstrates which reading is the fiddly part, and the
obvious approach is wrong. Testing whether a word's reading *starts with* the
target reading offers 十二 (じゅうに) as proof that 二 can be read ジ — but 二 is
に there, and じゅう belongs to 十. Position doesn't fix it either, since a
kanji can sit anywhere in a word.

So the build script **aligns** each word against its reading: kana in the
written form must match the reading literally, which anchors everything, and
each kanji consumes one of its own known readings (from KANJIDIC, all 13,000
of them — not just the grades being built, since an example word may contain
any kanji at all). Longest candidate first, so 十 claims じゅう before じ is
ever considered. Rendaku (連濁, か→が) and gemination (促音, がく→がっ) are
handled, so 十指 correctly credits じっ and 三十日 (みそか) correctly resolves to
三=み, 十=そ, 日=か.

One kanji per word may absorb an arbitrary span, which is what keeps 上海
(しゃんはい) working — はい isn't among 海's listed readings, so a strict
alignment would reject exactly the rare-reading case the feature exists for.
About 98% of candidate words align; the rest are dropped rather than guessed
at.

### Per-reading spaced repetition

Each reading of each kanji gets its own record — correct count, incorrect
count, current streak (consecutive correct, reset by any miss), and the
timestamps of its last two reviews (so the interval actually taken between
them can be reconstructed later). Both the streak *and* the lifetime correct
count push the review interval out — a reading answered right 30 times that
just had one slip doesn't fall all the way back to "brand new" spacing the
way a reading with no track record would. See `gradeYomi` in `src/srs.js`.

The kanji itself (as a schedulable "card") doesn't have its own real record —
it's a **rollup**, recomputed from its readings' records after every grading
event: due date is the *soonest* of any introduced reading (so a kanji comes
back for review as soon as any one reading on it looks shaky, not only once
every reading has lapsed), and "mastered" means *every* reading tested on
that kanji is solid, not just the easiest one. See `recomputeKanjiRollup` in
`src/kanji.js`.

### Writing mode

A character is shown — romaji for kana, on'yomi/kun'yomi and the English
meaning for kanji — and drawn on a quartered canvas, graded stroke-by-stroke
against [KanjiVG](https://kanjivg.tagaini.net/) stroke data. For kanji, the
example word shown alongside the readings is masked (学校 → ○校) so it can't
give the target kanji's shape away before a stroke is drawn.

- **Three modes** — Trace (the whole model shown faintly throughout), Guided
  (each stroke's model is revealed only once drawn correctly, never in
  advance), and Free (no guide until the character is finished, then it's
  reviewed stroke-by-stroke). Chosen automatically per character from its own
  spaced-repetition box — new → Trace, still learning → Guided, box 3+ →
  Free — or overridden manually for the rest of the session with the toggle
  at the bottom of the screen.
- **False positives are strongly preferred to false negatives.** This is
  practice, not an exam: the grading tolerances are tuned so a sloppy attempt
  is accepted rather than rejected, since the correct form is shown
  afterward regardless. Grading strictness (Gentle to Strict) is a
  per-profile setting under Settings. "Mark this attempt as bad" — offered in
  place of the praise message when redoing an already-correct character — is
  the manual correction channel for when the app was too generous.
- Stroke order is enforced, and placement/size/shape are graded, but pen
  speed, pressure and aesthetics are not.

See `writing-mode-plan.md` for the full design, including the numbers behind
the grading tolerances.

## Design documents

Larger pieces of work get a plan document at the repo root before they get
code. Each one keeps its own running record of decisions, including the ones
that turned out to be wrong and were reversed — that history is the point, so
the reasoning behind a tolerance or a piece of UX is recoverable later.

| Document | Covers | Status |
| --- | --- | --- |
| `writing-mode-plan.md` | Draw-the-character practice, graded stroke by stroke against KanjiVG | **Complete** — shipped, all phases done |
| `kanji-expansion-plan.md` | All jōyō kanji, JLPT/frequency orderings, and an explicit study list | **In progress** — see its phase table |
| `sync-plan.md` | Keeping one learner's progress in step across several devices | **In progress** — server deployed (`sync-server/`), client not started |

## What is not built yet

- **The rest of `kanji-expansion-plan.md`** — grouping kanji by JLPT level or
  frequency instead of school grade (phase 7). Full jōyō coverage, the
  explicit study list, lazy per-grade data loading, and the beyond-jōyō
  "names & places" set (phase 8) are all done — see that document's phase
  table.
- **Speech input** — planned via the Web Speech API. Note this needs HTTPS, so
  it cannot be tested over a plain `http://` wifi address; it will need
  deploying (GitHub Pages gives free HTTPS) to try on a phone.
- **Cross-device sync** — progress is per device, and moving it means saving a
  backup file and loading it on the other device. `sync-plan.md` designs the
  automatic version: a per-learner *sync code* rather than an account, a small
  encrypted blob store behind it, and the merge that `src/merge.js` already
  performs on a backup run continuously instead of once.

## Progress and backups

Progress is stored per device in IndexedDB, and separately for each mode — a
learner can know what 生 means, be shaky on its readings, and not be able to
write it at all, and the app tracks those three independently.

For kana and for Definition mode, every pass and fail is appended to the
item's history, not just the current box, so the scheduling algorithm can be
changed later without throwing away what a learner has actually done. Yomi
mode records per *reading* instead (counts, streak, last two review times) —
see "Per-reading spaced repetition" above.

Browsers can evict site storage, and Safari is the strictest about it —
an ordinary browser tab is far more likely to have its storage cleared than
an installed home-screen app. The app asks for persistent storage on launch,
but that is a request rather than a guarantee, which is why *Add to Home
Screen* (see "Deploying to GitHub Pages" above) matters for more than
convenience. A phone browser that isn't already running installed sees a
dismissible banner nudging this on launch — an actual **Install** button on
Android/Chromium (via `beforeinstallprompt`), instructions to use the Share
sheet on iOS, since no browser exposes a programmatic install trigger there.
As a second line of defence regardless, **Settings → Save backup file**
writes a JSON file with every profile on the device. Loading a backup on
another device merges rather than overwrites: records are resolved by their
latest grading time, study lists are unioned, and settings already chosen on
the receiving device win. Restoring an old backup therefore cannot wipe out
newer practice.

## Layout

| Path | What it is |
| --- | --- |
| `index.html` | All screens, hidden and shown by `app.js` |
| `src/kana.js` | Kana tables, chunking, romaji answer checking |
| `src/kanji.js` | Kanji courses (built from `src/data/kanji-manifest.js`, one grade's real data loaded lazily on demand — see below), reading-choice selection, kanji-level rollup |
| `src/data/kanji-manifest.js` | Generated data: just the character list per grade — always loaded, enough to build the course skeleton without fetching anything else |
| `src/data/kanji-grade-*.js` | Generated data: readings/meanings/example words per kanji, one file per grade — do not hand-edit, see below. Fetched lazily the first time that grade is opened, not on startup |
| `src/srs.js` | Leitner scheduling (kana) + per-reading scheduling (kanji) + the pace-suggestion rule + `masteryTier` (overview colour-coding) |
| `src/strokes.js` | Builds the numbered stroke-order SVG and its draw-in animation, from `src/data/stroke-*.js` |
| `src/data/stroke-kana.js` | Generated data: kana stroke paths from KanjiVG — always loaded (small, and needed by every writing screen) |
| `src/data/stroke-grade-*.js` | Generated data: kanji stroke paths per grade, from KanjiVG — do not hand-edit, see below. Loaded lazily alongside that grade's kanji data |
| `src/store.js` | IndexedDB profiles, backup export/import |
| `src/merge.js` | Pure profile-merge logic backup import runs on — kept separate from storage so the same merge can run against a synced profile later, see `sync-plan.md` §0.3 |
| `src/app.js` | Screen routing, session flow, event wiring |
| `src/changelog.js` | Hand-maintained, plain-language "what's new" shown in Settings — add an entry here in the same commit as any user-visible `APP_VERSION` bump |
| `vendor/` | `wanakana` (romaji ↔ kana), vendored so the app works offline |
| `tools/make_icons.py` | Regenerates the home-screen icons |
| `tools/fetch_kanji_sources.sh` | Downloads KANJIDIC2 + JMdict into `tools/data_src/` (not committed, ~90MB) |
| `tools/build_kanji_data.py` | Reads `tools/data_src/`, writes `src/data/kanji-manifest.js` + `kanji-grade-*.js` |
| `tools/fetch_kanjivg.sh` | Downloads KanjiVG stroke SVGs into `tools/data_src/kanjivg/` (not committed, ~13MB) |
| `tools/build_stroke_data.py` | Reads `tools/data_src/kanjivg/` (and the manifest above), writes `src/data/stroke-kana.js` + `stroke-grade-*.js` |

Katakana is not written out anywhere: it is derived from the hiragana tables
with `wanakana.toKatakana`, and every romaji prompt is derived with
`wanakana.toRomaji`, so there is no hand-typed romaji that could disagree with
the answer checker. `test/smoke.js` asserts that invariant for all 208
characters.

## Credits

Uses [WanaKana](https://wanakana.com/) (MIT) for romaji/kana conversion.
Kanji readings, meanings and example words are distilled from
[KANJIDIC2](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project) and
[JMdict](https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project),
© The Electronic Dictionary Research and Development Group, CC BY-SA 4.0.
