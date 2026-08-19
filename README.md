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
```

Both must be run from the repo root.

To regenerate `src/kanji-data.js` (e.g. after changing `MAX_GRADE`,
currently 6, in `tools/build_kanji_data.py`):

```sh
./tools/fetch_kanji_sources.sh   # downloads KANJIDIC2 + JMdict, ~90MB, not committed
python3 tools/build_kanji_data.py
```

## Deploying to GitHub Pages

Pages serves the repo as static files, which is exactly what this app is —
there is nothing to build. Every path in the app is relative, so it works
unchanged from `https://<user>.github.io/kana-quest/` rather than a domain
root; `.nojekyll` stops Pages trying to run Jekyll over the files.

Once it's live, updating the kids' devices is just `git push` — and the
whole "phone can't reach the laptop" problem below goes away, because the
site is always reachable over HTTPS. HTTPS is also what speech input will
need later.

To publish (one-time):

1. Create an **empty** public repo named `kana-quest` at
   <https://github.com/new> — no README, no .gitignore, no licence, since
   this repo already has its history.
2. `git push -u origin main` from the repo (see "Where things live" for the
   path). The remote is already configured.
3. In the repo's **Settings → Pages**, set Source to *Deploy from a branch*,
   branch `main`, folder `/ (root)`, and Save.

The site appears at `https://<user>.github.io/kana-quest/` within a minute or
two. On each device, open that URL and *Add to Home Screen*.

## Getting around

The front page asks **Hiragana, Katakana or Kanji**. Picking one opens that
script's own screen, with the modes across the top, a grade picker below them
for kanji (1–6, with a dot on any grade that has reviews waiting), and the
session actions under that. Backing out returns to the script picker.

Modes are per script: kana has **Reading** and **Writing**; kanji has
**Definition**, **Yomi** and **Writing**. Reading and Yomi are the same
activity under two names — "what sound does this make" — so switching between
scripts keeps you in the equivalent mode rather than resetting.

## If a phone is stuck on an old version

An iOS home-screen app is stubborn about picking up new code. **Settings →
Force refresh** clears every cache, unregisters the service worker and reloads
from the server; the version shown above that button tells you which build is
actually running. Progress lives in IndexedDB and is not touched.

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

**Kanji, all six Japanese elementary-school grades (1,026 kanji).** Kanji has
three modes rather than two: **Definition**, **Yomi** and **Writing**.
Selecting Definition hides the kana courses, since kana has no English
meaning to quiz. Each mode keeps entirely separate progress.

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

## What is not built yet

- **Writing mode** — visible in the app but disabled, for both kana and
  kanji. Next thing to build: a canvas with the four-quadrant dashed guide,
  then stroke-by-stroke grading against [KanjiVG](https://kanjivg.tagaini.net/)
  stroke data.
- **Speech input** — planned via the Web Speech API. Note this needs HTTPS, so
  it cannot be tested over a plain `http://` wifi address; it will need
  deploying (GitHub Pages gives free HTTPS) to try on a phone.

## Progress and backups

Progress is stored per device in IndexedDB, and separately for each mode — a
learner can know what 生 means, be shaky on its readings, and not be able to
write it at all, and the app tracks those three independently.

For kana and for Definition mode, every pass and fail is appended to the
item's history, not just the current box, so the scheduling algorithm can be
changed later without throwing away what a learner has actually done. Yomi
mode records per *reading* instead (counts, streak, last two review times) —
see "Per-reading spaced repetition" above.

Browsers can evict site storage, and Safari is the strictest about it. The app
asks for persistent storage on launch, but that is a request rather than a
guarantee, so **Settings → Save backup file** writes a JSON file with every
profile on the device. Loading a backup on another device merges rather than
overwrites: for each character it keeps whichever record has the longer
history, so restoring an old backup cannot wipe out newer practice.

## Layout

| Path | What it is |
| --- | --- |
| `index.html` | All screens, hidden and shown by `app.js` |
| `src/kana.js` | Kana tables, chunking, romaji answer checking |
| `src/kanji.js` | Kanji courses (built from `kanji-data.js`), reading-choice selection, kanji-level rollup |
| `src/kanji-data.js` | Generated data: readings/meanings/example words per kanji, grades 1-6 — do not hand-edit, see below |
| `src/srs.js` | Leitner scheduling (kana) + per-reading scheduling (kanji) + the pace-suggestion rule |
| `src/store.js` | IndexedDB profiles, backup export/import |
| `src/app.js` | Screen routing, session flow, event wiring |
| `vendor/` | `wanakana` (romaji ↔ kana), vendored so the app works offline |
| `tools/make_icons.py` | Regenerates the home-screen icons |
| `tools/fetch_kanji_sources.sh` | Downloads KANJIDIC2 + JMdict into `tools/data_src/` (not committed, ~90MB) |
| `tools/build_kanji_data.py` | Reads `tools/data_src/`, writes `src/kanji-data.js` |

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
