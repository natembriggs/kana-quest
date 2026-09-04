# Review follow-ups (as of 2026-09-04)

Consolidated punch list from the 2026-09-02/03 review (codebase map, code
health, pedagogy research, hands-on UI walkthrough, synthesis, plus two
rounds of live-usage feedback on the first feature it produced). Full raw
reports aren't kept in the repo; this file is the durable reference — read
it fresh in a new session rather than assuming anything below is still
accurate without checking the current code first.

**Fourth pass, 2026-09-04:** every remaining item that needed a real human
decision (not just a code fact to verify) got one, in a single walkthrough
with the app owner — see each item below for what was decided. Two items
now have their own dedicated plan docs with the decisions folded in
directly: `onboarding-plan.md` (new, full build brief) and
`kanji-mnemonic-plan.md` (updated §8). `feedback-plan.md`'s own "Phase-0
choices" section is similarly updated in place. A **priority/build order**
was also set (§ below) — this is the order these should actually get
built in, not just importance in the abstract.

## Build order

Set 2026-09-04, balancing the original review's priority ranking against
effort and what's now fully spec'd vs. still needing design work at build
time:

1. **Onboarding self-placement** — full build brief at `onboarding-plan.md`.
2. **Feed story word-lookups into spaced review** — small, high pedagogy
   value, decided (one-tap add on the gloss card).
3. **Chunk-relative progress on home tiles** — small, complements #1 (a
   freshly-placed learner immediately sees a sane chunk figure instead of
   "0/2825").
4. **Milestone celebration** — moderate, shares `courseStats()` groundwork
   with #3.
5. **Leech handling in `srs.js`** — moderate, self-contained scheduler
   change.
6. **Duplicated furigana reveal-ladder logic** — moderate, pure cleanup,
   worth doing before the mnemonic feature (#7) touches the same
   neighborhood of code again.
7. **Kanji component breakdown + mnemonics** — larger, full plan at
   `kanji-mnemonic-plan.md`.
8. **In-app feedback channel** — large, new infrastructure (a Cloudflare
   Worker, a GitHub App) rather than in-app learning UX; full plan at
   `feedback-plan.md`.
9. **FSRS-style scheduling** — large, explicitly deferred by the original
   review's own reasoning ("do after the above"); spec'd anyway (below) so
   it's ready whenever queue sizes justify it.
10. **Contingent: import known words from Anki/WaniKani** — only if bulk
    "Mark as known" turns out to be insufficient in practice; not scheduled.

## Shipped this cycle

- `e7ff9f9` — Course screen: Review/Test unlearned/Learn as a labelled
  ladder (each action gets a one-line subtitle, the recommended one is
  highlighted), plus due counts summed across every mode on the home
  screen and mode picker.
- `8ca210b` — Fixed the mode-picker due badge to sum across every unit of
  a script, not just whichever grade/unit was selected below it (it sits
  above the unit selector, so a per-unit count there was misleading).
- `7299835` — "Mark as known": bulk, no-quiz self-assessment from the set
  overview. Two-tier by mode — a single "known" claim for Reading/
  Definition/Meaning (pure recognition), a softer "I think I know this"
  (staggered due dates over ~4 weeks) plus an "I'm sure" override for
  Yomi/Writing/Recall, where a glance can't verify completeness or
  production.
- `50675f0` — Follow-up fixes from actually using it: stopped dimming
  already-mastered tiles in select mode (it fought the grid's own colour
  language), filtered mode-inapplicable characters out of the overview
  entirely (yōon in kana Writing, etc.), added long-press on a tile as a
  third way into select mode, added a sticky mode picker to the overview
  screen itself.
- `7445c96` — Extracted a shared `addChoiceButton()` helper, replacing six
  duplicated ~7-line button-creation call sites across the quiz renderers
  in `app.js`. Same-behavior refactor, no visible change.
- `0c79c49` — Added `test/reader.js`: 38 direct unit tests for
  `renderSentence`, `tokenAtLevel`, `storyOccurrenceIndex`,
  `isTokenFuriganaHidden`, `exposureTargetsForToken`, and `tokenHasKanji`,
  per the spec `stories-plan.md` §10 already laid out. All passed against
  actual `reader.js` behavior on the first real run; no spec/behavior
  mismatches turned up.
- `1de948a` — Accessibility pass: `role="tab"`/`aria-selected` on the five
  genuinely tab-like segmented controls, `aria-pressed` on two
  non-exclusive toggle groups (per-mode study toggles, the story-level
  browse strip) where tab semantics would have misrepresented them to a
  screen reader, and `aria-live="polite"` on `#quiz-feedback`,
  `#writing-feedback`, `#sync-status`, `#transfer-status`. No visible
  change. Not necessarily an exhaustive audit of every toggle in the app —
  worth a second look if a screen-reader user reports a gap.
- `51f0da3` — CI workflow: `.github/workflows/test.yml` on `macos-latest`,
  runs every `test/*.js` suite on push/PR against `main`, fails the job on
  any non-zero exit. Live on `origin/main`.
- `be762e7` — Copy fix, flagged live during this session: vocab Recall's
  spelling follow-up stage said "Now choose how it's spelled" / "spell it",
  which reads like typing when the step is actually picking the right kanji
  spelling from multiple-choice options. Now says "Now choose the correct
  kanji" / "pick the kanji".
- **Verified 2026-09-04 (real device, no code change)** — long-press on a
  tile as a third way into select mode (`50675f0`) tested on a real Android
  device by the app owner and confirmed working. This closes the one
  open question from the original round-2 review: Chrome's own
  `contextmenu` timing on a long touch is close enough to the app's own
  ~500ms long-press threshold that it was flagged as worth an on-device
  check rather than trusting desktop-Chrome pointer-event semantics alone.
  No longer a concern.

The `50675f0`/`7299835` pair was implemented by Claude Fable 5.1 as a
deliberate trial (reviewed, tested, and verified live by Claude Sonnet 5
both times) — it went well; nothing wrong was found that needed more than
one small copy fix. No standing reason to prefer or avoid Fable for the
items below on that basis alone.

## Remaining, in build order (see above)

1. **Onboarding self-placement.** Still the biggest gap from the original
   review: a new profile has no "where are you starting from?" step, so
   an advanced adult and a beginner kid land on identical grade-1/L1
   content. **Fully spec'd 2026-09-04 at `onboarding-plan.md`** — a
   3-branch first screen (connect to existing profile / complete beginner
   guide / already-learning screener), the screener's "know all" answers
   claim mastery immediately via the existing bulk self-assessment
   machinery, "some" answers arm a highlighted nudge toward "Select known"
   the first time that unit is opened (persists 5 sessions if deferred,
   clears if declined). Skip always available, defaults to zero. "Change
   my level" in Settings explicitly shelved — no clear use case for
   walking placement backwards given the existing forward-only tools.
2. **Feed story word-lookups into spaced review.** Confirmed 2026-09-03:
   tapping a word in a story does **not** feed the SRS due-date queue —
   it only updates the separate `exposure`/`muted` bookkeeping that drives
   the furigana reveal ladder (`recordReaderExposure`, `src/app.js`
   ~6416/6778). The only existing bridge is a manual "+ Add" button on the
   story's end-card (`src/app.js` ~7002), which requires finishing the
   whole story first. Remains the single highest-value pending pedagogy
   fix per the original retrieval-practice research. **Decided
   2026-09-04:** add a one-tap "+ Add" directly on the word's gloss card
   itself (at the moment of lookup), alongside — not replacing — the
   existing end-card button.
3. **Chunk-relative progress on home tiles.** Home screen shows e.g.
   "0/2825" against the whole kanji corpus — demoralizing for a beginner,
   uninformative for an advanced learner. `frontierKanjiUnit(profile)`
   already computes the learner's current kanji grade, so this is a
   display change over data that already exists. **Decided 2026-09-04:**
   label format is `"[Chunk name]: X/Y"` (e.g. "Primary 1: 12/80",
   "Everyday essentials: 34/120"); the corpus-wide figure is hidden while
   a chunk is still in progress, and once a chunk is finished the
   secondary figure shown is progress toward the **jōyō/common-use kanji
   total**, not the app's full extended corpus (2825 includes
   `kanji-expansion-plan.md` additions beyond jōyō) — verify at build time
   whether the kanji data already flags which characters are jōyō vs.
   expansion additions, since that flag (or the lack of one) determines
   how this is actually computed.
4. **Milestone celebration.** Nothing marks completing a full set (all
   hiragana, a kanji grade) — only a per-session "Session done" screen.
   Hook `finishSession()` to compare `courseStats()` before/after and
   detect a transition into "started === total" for a whole set.
   **Decided 2026-09-04:** trigger set is each kana script (all of
   hiragana, all of katakana) and kanji — both per-grade ("Primary 1
   kanji complete") and one bigger milestone for finishing all of jōyō.
   Not vocab tiers or story levels, at least for this pass. Fires once per
   set ever — re-completing a lapsed set does not re-celebrate. Copy/tone
   to be drafted in the app's existing restrained style at build time, not
   a separate decision point.
5. **Leech handling in `srs.js`.** Confirmed 2026-09-03: no leech handling
   exists today. `lapses`/`incorrect` counters are tracked per item but are
   uncapped lifetime totals that never change scheduling — their only
   effect is `dueItems()` sorting higher-lapse items earlier within the
   same-day queue (`src/srs.js:646`). Every miss, however many times
   repeated, resets identically to box 0 / streak 0 (`src/srs.js:322-324`,
   `:858-860`). **Decided 2026-09-04:** cap how far a leech's interval can
   grow — even after an eventual correct answer, an item with a
   significant recent lapse history should not jump straight back to a
   long interval; it should climb back more slowly than a normal item
   until it's been right several times in a row. Exact threshold (how many
   recent lapses trigger the cap) and exact cap shape are implementation
   defaults to pick at build time, not separately decided here — flag them
   for the owner to react to once visible in practice.
6. **Duplicated furigana reveal-ladder logic.** `src/vocab.js`/`app.js`
   (`vocabHiddenState`) and `src/reader.js` (`isTokenFuriganaHidden`) each
   implement "kanji with optional ruby that reveals on tap" independently.
   The core "is this reading hidden" predicate is confirmed byte-identical
   between the two today (`reader.js:59-66` vs. `app.js:3584-3617`).
   **Decided 2026-09-04:** extract *only* that shared predicate into a new
   `src/furigana.js` — do **not** attempt the fuller unification
   `stories-plan.md` §5.7/`vocab-plan.md` phase 8 originally called for
   (merging the per-word vs. per-kanji aggregation and the two tap-state
   machines), since those two diverge by deliberate design, not drift.
7. **Kanji component breakdown + mnemonics.** Break each compound kanji
   into recognizable component parts with meanings, suggest an
   arrangement-aware mnemonic, surface it on the kanji detail page, the
   lesson/introduction flow, and a "Show hint" button on recognition/
   writing quizzes — without infringing James Heisig's "Remembering the
   Kanji." **Full plan at `kanji-mnemonic-plan.md`**, decisions in its §8:
   decomposition from KanjiVG's own metadata, component meanings from
   KANJIDIC2/traditional Kangxi radical names (never an RTK-style invented
   keyword), mnemonic text from arrangement-keyed templates. **Decided
   2026-09-04:** tone is deliberately wittier than the plan's own "safest"
   recommendation — this is the one choice in the whole plan with real
   copyright exposure per §2.4/§4.5, so the actual generated template
   output needs a real review (owner, ideally also an independent skim
   against RTK's real content) before it's wired into any UI, not treated
   as safe by default. First-pass coverage is kanji grades 1-3. The quiz
   "Show hint" button should be visually distinct from other hint-tier
   buttons (e.g. "Show next stroke") while still matching their family, so
   a learner can't mistake a memory nudge for the answer.
8. **In-app feedback channel.** `feedback-plan.md`, fully designed
   2026-08-24. Worth surfacing given the stated direction of shifting from
   building new major features toward responding to broader user feedback.
   **Decided 2026-09-04** (folded into `feedback-plan.md`'s own "Phase-0
   choices" section directly): private feedback inbox, not public issues,
   for child safety; no public attribution in v1; Lean track (free
   Cloudflare tier); triage-only automation, no auto-drafted fix PRs yet;
   moving GitHub Pages' deploy source to Actions (so a failing test
   actually blocks the live site) is explicitly deferred to a separate,
   later task despite CI now existing.
9. **FSRS-style scheduling.** Confirmed 2026-09-03: `srs.js` is a
   fixed-interval Leitner box scheduler (`BOX_INTERVALS_DAYS =
   [0,1,2,4,8,16,32]`, `src/srs.js:12`), not SM-2 or FSRS — no per-item
   difficulty/ease value, binary correct/incorrect grading only. Migration
   surface is moderate: two parallel record shapes (`grade()`'s box/due/
   lapses vs. `gradeYomi()`'s streak/correct/incorrect), several
   downstream consumers assume box/due fields directly, and true FSRS
   needs a graded response scale. **Spec'd 2026-09-04, but deliberately
   not scheduled yet** — the app owner chose to spec it now rather than
   defer the whole item, but the original review's "do after the above"
   ordering still holds for actually building it. Key decision made: no
   new UI to collect FSRS's 4-point grade — infer it from existing
   signals instead (first-attempt-correct = Good, correct-after-retry =
   Hard, wrong = Again; writing mode's existing 0-100 stroke-accuracy
   score maps naturally onto the same scale). Record migration should
   translate existing box/lapse history into starting FSRS estimates
   rather than resetting anyone's progress — an implementation default,
   not a separate open question.
10. **Contingent, low priority: import known words from Anki/WaniKani**
    (`external-import-plan.md`, currently pure aspiration, zero code).
    Only worth picking up if bulk "Mark as known" turns out to be
    insufficient for how advanced users actually arrive with prior
    knowledge — give it real usage first. Not part of the build order
    above; revisit only if that need actually shows up.

## Decided against / explicitly not needed

- Any points/currency/streak/store mechanic — deliberately rejected on the
  owner's stated philosophy; the restrained progress-bar-plus-mastery-grid
  design already works and should be protected, not diluted.
- A separate kid/adult tone toggle — the app's copy is already neutral
  enough; the emoji badge picker is the only kid-pitched moment and
  picking a plain emoji already solves it.
- Splitting the `app.js` monolith — not a problem at its current size and
  organization (consistent section banners, comments that explain
  rationale). Revisit only once a genuinely new major feature area lands,
  not preemptively.
- A "Change my level" re-entry point in Settings for onboarding placement
  (2026-09-04) — shelved; the existing forward-only "Mark as known" tools
  already cover the realistic case, and there's no clear use case yet for
  walking placement backwards.
