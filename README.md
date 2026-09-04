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
$JSC -m test/sync.js      # the sync pull/merge/push/retry state machine, against a fake transport
```

All five must be run from the repo root.

To regenerate the kanji data in `src/data/` (e.g. after changing `GRADES`
in `tools/build_kanji_data.py`):

```sh
./tools/fetch_kanji_sources.sh   # downloads KANJIDIC2 + JMdict + Tanaka Corpus, ~125MB, not committed
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

**✓ Mark as known**, on the overview (and as a row under **Test unlearned**
on the course card, which opens the overview straight into it), is the
no-quiz way to say you already know a batch: tick the tiles you know — or
**Select all not started** — and mark them in one go. In a recognition mode
(kana Reading, kanji Definition, vocab Meaning) that counts them as mastered
straight away, exactly as a correct **Test unlearned** answer would. In Yomi,
Writing and vocab Recall, where a glance can't tell you whether you know
*every* reading or can really draw the character, the default is the softer
**I think I know these**: one tier short of mastered, with a quick
double-check review for each, spread out over the following weeks rather
than all landing on one day — **I'm sure** sits beside it for when you are.

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
- **Spaced repetition.** FSRS (Free Spaced Repetition Scheduler) — each
  character or word carries its own `difficulty` (1-10) and `stability` (days
  until recall probability decays to 90%), both updated from every answer, so
  two items at the same rough mastery level by very different histories are
  no longer scheduled identically the way a fixed box ladder would. A miss
  always drops the character to box 0 and makes it due again immediately, so
  it comes back later in the same session — that redrill-on-a-miss behavior
  is a pedagogy choice independent of the scheduling algorithm underneath.
  A review session is a capped smattering (15 by default), not a forced march
  through everything due — and when more is due than fits, characters with a
  lapse on record are pulled ahead of ones that have never once been missed.
  `box`/`streak` (0-6, shown in the overview grid's colour-coding) are still
  present on every record, now derived from stability rather than being the
  schedule themselves — see `src/fsrs.js` for the algorithm and `src/srs.js`
  for how it plugs in.
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
count, current streak (0-6, derived from FSRS stability the same way `box`
is elsewhere), its own FSRS `stability`/`difficulty`, and the timestamps of
its last two reviews (so the interval actually taken between them, and the
elapsed-days input FSRS needs, can be reconstructed later). A reading
answered right 30 times that just had one slip recovers a longer interval
than a reading with no track record at all, because 30 correct answers leave
`difficulty` low, and low difficulty is what makes a post-lapse recovery earn
a bigger jump back — not a separate "lifetime correct count" bonus grafted on
top the way the pre-FSRS scheduler needed. See `gradeYomi` in `src/srs.js`.

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

### Vocabulary

**A fourth thing to practise, alongside the three scripts above: whole
words.** Grouped into a "Core" spine of function words (numbers, question
words, the verbs and adjectives you can't avoid) plus themed units — family,
school, travel, food, and so on — modelled on how a UK GCSE course is
organised, at three cumulative levels ("Common words 1/2" for GCSE
Foundation/Higher, then "A level"), plus a bonus "From kanji pages" group of
words already met as example sentences on a kanji's own detail page. The word
list itself is not the official specification (see `vocab-plan.md` §3.5 for
why): it's JMdict's own corpus-frequency ranking, so the units are labelled
"Common words 1/2" rather than "Foundation" / "Higher".

Two modes, both live:

**Meaning** (Japanese → English):

- A word is shown with **four English meanings** to choose from, the same
  count and layout as kanji Definition mode.
- **The word itself is the tap target.** Furigana over any kanji the learner
  has any claim on (studied in Definition, Yomi *or* Writing) starts
  hidden — tap once to reveal it, tap again for romaji if the kana is the
  problem. A kanji nobody has met yet shows its reading openly from the
  start, since there's nothing to protect by hiding it.
- **Revealing a hidden reading grades it as a miss, immediately** — the
  honest answer to "did you know this" — and a **correct definition
  answered without ever revealing** anything then asks for the reading too,
  as a six-option follow-up. Both feed the same word's schedule.
- Furigana also hides itself automatically once a reading has been *seen*
  (shown and not revealed) four times, with no enrolment and no quiz —
  passive exposure earning the same "you probably know this" treatment as
  active study. A revealed reading that turns out to still be needed knocks
  that back off after two such reveals. See `vocab-plan.md` §5.3.

**Recall** (English → Japanese): the English meaning is shown, and the
learner picks the word in kana from six options, then — for a word written
with kanji the learner is studying in any mode — a second stage asks them to
pick the correct kanji spelling from among plausible near-misses (a real
word with a wrong kanji swapped in). A kanji the learner has already mastered
is excluded from ever appearing as the wrong choice, since eliminating it by
meaning would test the wrong thing.

#### Example sentences

A word's own page ends with **up to three real sentences using it** — furigana
over every kanji in each whole sentence, not just over the word, an English
translation of all of it, and **every word in the sentence its own tap
target**: tap one for its reading, the dictionary word it comes from, what it
means, its kanji, and its own page where the app teaches it. The word being
studied is underlined where it appears.

Three rather than one because one usage is often the least representative
thing about a word: ご招待をありがとうございます is a correct example of 招待 and
a set phrase that says nothing about 招待する. The three are chosen to differ
from each other — a sentence using the word in a written form one already
picked uses, or made largely of the same words in the same order, is ranked
down for it.

These come from the [Tanaka
Corpus](https://www.edrdg.org/wiki/index.php/Tanaka_Corpus) at build time
(`build_examples()` in `tools/build_vocab_data.py`), chosen over Tatoeba's
larger export for one reason: each of its ~148,000 sentences carries an index
line naming the dictionary form of every word in it, with a reading wherever
that form is ambiguous. No Japanese tokeniser is available to this build, and
without one that index is the only way to gloss a whole *sentence* — or to
make every word in one tappable.

**Readings.** A wrong reading taught confidently is worse than no example at
all, so a reading comes from the index line's own annotation first, then the
reading the corpus itself uses most often for that written form elsewhere, and
only then JMdict's first-listed reading — and only counted as certain there if
JMdict lists just one. Sentences needing a guess are ranked down rather than
excluded.

**What makes a good example**, in the order these matter:

- **It is not an idiom or proverb.** 一寸の虫にも五分の魂 ("tread on a worm and
  it will turn") is a fine proverb and a terrible example sentence: non-literal,
  partly archaic, and its English teaches nothing about any word in it. JMdict
  tags these (`proverb`/`id`/`quote`/`yoji`) and the penalty all but removes
  them. Six survive, for words like 千里 and 縄 that are barely used outside
  one saying, and each is labelled as an idiom in the app rather than passed
  off as ordinary usage.
- **Its translation is literal.** English runs about 2.5 characters per
  Japanese character; well under that, the translation is giving the sense
  rather than saying what the sentence says, which is no use to someone
  matching the two halves up. Penalised below 1.6, refused below 1.2.
- **The rest of its words are words this app teaches**, so the sentence can be
  pieced together rather than read past.
- **It is short**, the corpus flags it as a good example of this word, and it
  is a whole sentence rather than a fragment of dialogue.

**Tapping a word** is answered from `src/data/example-words.js`: every distinct
word across every example sentence — 9,600 of them, particles included — with
its reading and meaning. One shared file, fetched once on the first tap of a
session, rather than a gloss inlined on each of ~80,000 tokens, which would
repeat は and 私 thousands of times over and bloat every unit file. Its keys
carry whatever narrowing JMdict needed: `開く|ひらく` for a written form with
several readings, `で#2028980` where the corpus names the exact entry, `と@3`
where it names a sense. An unannotated particle is given every sense at once
("if · and · with · used for quoting") rather than one of six presented as the
answer.

**83% of words have at least one** (2,661 have three). The remaining ~670
appear in no corpus sentence at all — almost all rare newspaper compounds in
the A-level and "From kanji pages" units (春闘, 特殊法人, 撚糸) — and their
pages show nothing rather than an empty heading. Core is the best covered:
112 of its 113 words have all three.

See `vocab-plan.md` for the full design, including how exposure-based hiding
and Recall mode's distractor selection actually work.

### Reading

**A fifth thing to do, and the first one that isn't practice.** A **Read**
card on the home screen opens a library of short stories, graded across six
levels from a ~110-word first-steps tier up to unabridged difficulty. A
learner opens one and reads it — nothing is asked, nothing is scored, and the
app forms no opinion about how it went.

Every story is authored once, in ordinary Japanese with kanji, and rendered
differently for each learner: someone who hasn't started kanji sees an
all-hiragana, space-separated text; someone partway through the kanji course
sees a window of kanji they're learning now plus what's next, with everything
else in kana; a learner further along sees the story as written, with
furigana. Tapping a word shows its pronunciation, tapping again shows its
definition (with the sentence's English translation one tap further, and a
route through to the word's, the kanji's or the kana's own detail screen).
None of this enrols anything or grades anything — the only place a reading
session turns into study is an optional **Add** button per word on the end
card, once the story is finished.

Furigana hides itself the same way vocabulary's does — by study enrolment
or by having simply been seen often enough — and reading feeds the identical
exposure counter vocabulary uses, so a word met repeatedly in a story starts
losing its furigana in the vocabulary quiz too, and vice versa.

24 stories ship today, four at every level, all original retellings of
traditional or public-domain-motif tales (Momotarō, Cinderella, and others)
rather than direct imports of an existing text. See `stories-plan.md` for
the full design, `story-writing-guide.md` for how one is authored, and
`stories-plan.md` §12.1 for how the actual sourcing differs from the
document's original plan.

## Design documents

Larger pieces of work get a plan document at the repo root before they get
code. Each one keeps its own running record of decisions, including the ones
that turned out to be wrong and were reversed — that history is the point, so
the reasoning behind a tolerance or a piece of UX is recoverable later.

| Document | Covers | Status |
| --- | --- | --- |
| `writing-mode-plan.md` | Draw-the-character practice, graded stroke by stroke against KanjiVG | **Complete** — shipped, all phases done |
| `kanji-expansion-plan.md` | All jōyō kanji, JLPT/frequency orderings, and an explicit study list | **In progress** — see its phase table |
| `sync-plan.md` | Keeping one learner's progress in step across several devices | **In progress** — sync works and runs automatically; phases 4-5 remain |
| `vocab-plan.md` | Whole-word vocabulary, grouped for GCSE Foundation/Higher and A level | **In progress** — Meaning, Recall, exposure-based hiding and Higher/A level all ship; extracting a shared `furigana.js` (phase 8, see `stories-plan.md` §5.7) remains |
| `stories-plan.md` | Graded reading — levelled stories and serialized episodes, rendered to each learner's own script stage, with sentence-by-sentence English and no testing of any kind | **In progress** — the reader, library and 24 standalone stories (four per level) ship; serialized multi-episode series (phase 9) has not started — see its phase table |
| `story-writing-guide.md` | How to author a story: levels, tokenisation, contextual glosses, conjugation labels, translations, sourcing | **Live** — read before writing a story |
| `feedback-plan.md` | In-app feedback submission, GitHub issue creation, request tracking, and a learner-facing contribution history | **Proposal** — research and design complete, no code written |
| `external-import-plan.md` | Importing kanji/vocabulary progress from WaniKani, renshuu, Anki and similar apps | **Proposal** — research and scoping complete, no code written |

## What is not built yet

- **The rest of `kanji-expansion-plan.md`** — grouping kanji by JLPT level or
  frequency instead of school grade (phase 7). Full jōyō coverage, the
  explicit study list, lazy per-grade data loading, and the beyond-jōyō
  "names & places" set (phase 8) are all done — see that document's phase
  table.
- **Serialized stories** — every one of the 24 shipped stories is standalone;
  a multi-episode series that continues from where a learner left off has not
  been written yet. See `stories-plan.md` phase 9.
- **A shared furigana component** — the reveal-ladder behaviour (bare → ruby
  → romaji) is implemented twice, once for vocabulary and once for the story
  reader, rather than as one component both use. See `vocab-plan.md` phase 8.
- **Speech input** — planned via the Web Speech API. Note this needs HTTPS, so
  it cannot be tested over a plain `http://` wifi address; it will need
  deploying (GitHub Pages gives free HTTPS) to try on a phone.
- **Sync robustness details** — clock-skew correction for a device whose
  clock is badly wrong, and deleting a learner removing their synced copy
  too. Sync itself works and runs automatically; see `sync-plan.md` phases
  4-5.

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
latest grading time, study-list enrollment and removal are each resolved by
whichever happened more recently, and settings are resolved per field the
same way, falling back to whatever's already on the receiving device only
for a field neither side has actually touched. Restoring an old backup
therefore cannot wipe out newer practice, and un-enrolling a kanji actually
sticks rather than being silently undone by an older copy.

**Settings → Sync across devices** does the same merge continuously instead
of through a file: generate a code on one device (**Turn on sync**), type it
into Settings on another (**Enter a code**), and from then on the two stay in
step on their own. There's no account — the code itself is what a device
needs to read or write that learner's progress — and the data is encrypted
before it ever leaves the device, so the server holds opaque bytes, not a
name or a record of what's been practised.

Syncing happens at natural boundaries rather than after every answer: opening
a learner, finishing a session, and leaving or returning to the app. That is
deliberately frugal — a sync where nothing changed anywhere costs a single
conditional request that comes back "not modified", and one carrying real
practice costs two, so a household's whole day lands in the low tens of
requests against a daily allowance of 100,000. **Sync now** is still there for
when you want to force it, but it shouldn't be needed.

## Layout

| Path | What it is |
| --- | --- |
| `index.html` | All screens, hidden and shown by `app.js` |
| `src/kana.js` | Kana tables, chunking, romaji answer checking |
| `src/kanji.js` | Kanji courses (built from `src/data/kanji-manifest.js`, one grade's real data loaded lazily on demand — see below), reading-choice selection, kanji-level rollup |
| `src/data/kanji-manifest.js` | Generated data: just the character list per grade — always loaded, enough to build the course skeleton without fetching anything else |
| `src/data/kanji-grade-*.js` | Generated data: readings/meanings/example words per kanji, one file per grade — do not hand-edit, see below. Fetched lazily the first time that grade is opened, not on startup |
| `src/srs.js` | FSRS-backed scheduling (kana/kanji/vocab) + per-reading scheduling (kanji) + the pace-suggestion rule + `masteryTier` (overview colour-coding) |
| `src/fsrs.js` | The FSRS-6 algorithm itself — difficulty/stability update formulas, retrievability, interval calculation. No app dependencies; srs.js is its only caller |
| `src/strokes.js` | Builds the numbered stroke-order SVG and its draw-in animation, from `src/data/stroke-*.js` |
| `src/data/stroke-kana.js` | Generated data: kana stroke paths from KanjiVG — always loaded (small, and needed by every writing screen) |
| `src/data/example-words.js` | Generated data: every word appearing in any example sentence, with its reading and meaning — one shared file, loaded lazily on the first tap of a word inside a sentence |
| `src/data/stroke-grade-*.js` | Generated data: kanji stroke paths per grade, from KanjiVG — do not hand-edit, see below. Loaded lazily alongside that grade's kanji data |
| `src/stroke-geometry.js` | Bézier parsing, smoothing, resampling and the bounded best-fit offset behind Writing mode's grading — pure, no DOM |
| `src/stroke-grader.js` | The stroke-by-stroke tolerance formula and strictness ladder behind Writing mode — pure, no DOM. See `writing-mode-plan.md` §2 |
| `src/writing.js` | The writing-mode canvas widget: pointer capture, ink rendering, the three guide modes (Trace/Guided/Free) |
| `src/vocab.js` | Vocabulary courses (built from `src/data/vocab-manifest.js`), Meaning/Recall question building, per-mode rollups. See `vocab-plan.md` |
| `src/data/vocab-manifest.js` | Generated data: unit id → ordered word list, plus group/label metadata — always loaded |
| `src/data/vocab-*.js` | Generated data: full vocabulary entries (readings, glosses, ruby alignment, distractor pools) per unit — do not hand-edit. Loaded lazily the first time that unit is opened |
| `src/data/vocab-lookup.js` | Generated data: surface form → vocab unit, for cross-unit lookup — used at story build time, not fetched by the running app |
| `src/reader.js` | Pure rendering for Stories: per-learner script rendering, the furigana-hiding rules and the exposure-occurrence counter. See `stories-plan.md` §5-§6 |
| `src/data/story-manifest.js` | Generated data: id → `{title, series, level, blurb, hash, length}` for every story — always loaded, small |
| `src/data/story-*.js` | Generated data: one full story's tokenised body — do not hand-edit, see `story-writing-guide.md`. Loaded lazily when that story is opened |
| `src/store.js` | IndexedDB profiles, backup export/import |
| `src/merge.js` | Pure profile-merge logic backup import runs on — kept separate from storage so the same merge can run against a synced profile later, see `sync-plan.md` §0.3 |
| `src/sync-protocol.js` | The pull/merge/push/retry state machine behind Sync across devices — pure, takes a transport and encrypt/decrypt as parameters so it's testable without real crypto or a network. See `sync-plan.md` §4.1 |
| `src/sync-transport.js` | The real thing `sync-protocol.js` is handed: sync codes, PBKDF2/HKDF key derivation, AES-GCM encrypt/decrypt, and the fetch calls to `sync-server/` |
| `src/app.js` | Screen routing, session flow, event wiring |
| `src/changelog.js` | Hand-maintained, plain-language "what's new" shown in Settings — add an entry here in the same commit as any user-visible `APP_VERSION` bump |
| `vendor/` | `wanakana` (romaji ↔ kana), vendored so the app works offline |
| `tools/make_icons.py` | Regenerates the home-screen icons |
| `tools/fetch_kanji_sources.sh` | Downloads KANJIDIC2, JMdict and the Tanaka Corpus into `tools/data_src/` (not committed, ~125MB) |
| `tools/build_kanji_data.py` | Reads `tools/data_src/`, writes `src/data/kanji-manifest.js` + `kanji-grade-*.js` |
| `tools/fetch_kanjivg.sh` | Downloads KanjiVG stroke SVGs into `tools/data_src/kanjivg/` (not committed, ~13MB) |
| `tools/build_stroke_data.py` | Reads `tools/data_src/kanjivg/` (and the manifest above), writes `src/data/stroke-kana.js` + `stroke-grade-*.js` |
| `tools/build_vocab_data.py` | Reads `tools/data_src/` and `tools/vocab_src/`, writes `src/data/vocab-manifest.js` + `vocab-*.js` + `vocab-lookup.js` |
| `tools/story_src/` | Hand-tokenised story source, one file per story — see `story-writing-guide.md`. No morphological tokenizer is used; the author sets every token boundary and reading directly |
| `tools/build_story_data.mjs` | Reads `tools/story_src/` and `src/data/vocab-lookup.js` (for `d`, the vocab-id link, at build time only), writes `src/data/story-manifest.js` + `story-*.js` |

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
Vocabulary example sentences come from the [Tanaka
Corpus](https://www.edrdg.org/wiki/index.php/Tanaka_Corpus) as distributed
with WWWJDIC and maintained by the [Tatoeba Project](https://tatoeba.org/),
CC BY 2.0 FR.
