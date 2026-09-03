# Review follow-ups (as of 2026-09-03)

Consolidated punch list from the 2026-09-02/03 review (codebase map, code
health, pedagogy research, hands-on UI walkthrough, synthesis, plus two
rounds of live-usage feedback on the first feature it produced). Full raw
reports aren't kept in the repo; this file is the durable reference — read
it fresh in a new session rather than assuming anything below is still
accurate without checking the current code first.

**Third pass, 2026-09-03 (same day):** dedicated code-verification subagents
independently re-checked the four items below that were genuinely open
questions rather than confirmed facts (old items 3/6/7/8) — findings below
are now definitive, with file:line citations, not "unclear"/"may be"/
"confirm whether". A build-planning subagent then turned every remaining
actionable item into a concrete plan (size, files, approach, open
questions); the four items with no real design/copy decision left
(duplicated choice-button rendering, `reader.js` tests, an accessibility
pass, and CI) were implemented, tested, and shipped in this same pass — see
"Shipped this cycle". The rest (onboarding, chunk-relative progress,
milestone celebration, the feedback channel, and the furigana-ladder
extraction) all involve a real UX/copy/architecture call and were left for
a human to decide before building; their entries below now carry a short
"Build plan" note instead of a full re-explanation.

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
  in `app.js` (old item 9). Same-behavior refactor, no visible change.
- `0c79c49` — Added `test/reader.js`: 38 direct unit tests for
  `renderSentence`, `tokenAtLevel`, `storyOccurrenceIndex`,
  `isTokenFuriganaHidden`, `exposureTargetsForToken`, and `tokenHasKanji`,
  per the spec `stories-plan.md` §10 already laid out (old items 3 and 13 —
  now resolved and merged into this one entry). All passed against actual
  `reader.js` behavior on the first real run; no spec/behavior mismatches
  turned up.
- `1de948a` — Accessibility pass (old item 14): `role="tab"`/
  `aria-selected` on the five genuinely tab-like segmented controls,
  `aria-pressed` on two non-exclusive toggle groups (per-mode study
  toggles, the story-level browse strip) where tab semantics would have
  misrepresented them to a screen reader, and `aria-live="polite"` on
  `#quiz-feedback`, `#writing-feedback`, `#sync-status`, `#transfer-status`.
  No visible change. Not necessarily an exhaustive audit of every toggle in
  the app — worth a second look if a screen-reader user reports a gap.
- `51f0da3` — CI workflow (old item 15): `.github/workflows/test.yml` on
  `macos-latest`, runs every `test/*.js` suite on push/PR against `main`,
  fails the job on any non-zero exit. The push initially needed a
  `workflow`-scoped GitHub token (`gh auth refresh -h github.com -s
  workflow`) — now resolved and live on `origin/main`.
- `be762e7` — Copy fix, flagged live during this session: vocab Recall's
  spelling follow-up stage said "Now choose how it's spelled" / "spell it",
  which reads like typing when the step is actually picking the right kanji
  spelling from multiple-choice options. Now says "Now choose the correct
  kanji" / "pick the kanji". `test/wiring.js` had the old strings
  hardcoded and was updated to match.

The `50675f0`/`7299835` pair was implemented by Claude Fable 5.1 as a
deliberate trial (reviewed, tested, and verified live by Claude Sonnet 5
both times) — it went well; nothing wrong was found that needed more than
one small copy fix. No standing reason to prefer or avoid Fable for the
items below on that basis alone.

## Remaining, roughly in priority order

1. **Onboarding self-placement.** Still the biggest gap from the original
   review: a new profile has no "where are you starting from?" step, so
   an advanced adult and a beginner kid land on identical grade-1/L1
   content. The levelling machinery already exists (kanji grade filter,
   vocab commonness/topic tiers, story levels, adaptive writing
   difficulty) — this is about surfacing it at profile creation, plus a
   "Change my level" entry in Settings so it isn't a one-shot choice.
   Bulk "Mark as known" (shipped) is a partial substitute but doesn't
   replace a first-run prompt telling people it exists. **Build plan
   drafted 2026-09-03:** size L; the levelling machinery needs no new data
   model, just a first-run entry point (gate on `profile.progress` being
   empty) most plausibly reusing "Mark as known" as the actual placement
   mechanism, wrapped in first-run framing. **Needs a human decision**
   on: exact first-run copy/question order (script first vs. one combined
   question), default behavior if skipped, and whether "Change my level"
   re-runs the same flow or a lighter one that preserves existing progress.
2. **Chunk-relative progress on home tiles.** Home screen shows e.g.
   "0/2825" against the whole kanji corpus — demoralizing for a beginner,
   uninformative for an advanced learner. Show progress against the
   current grade/tier ("Primary 1: 12/80") with the corpus total
   secondary. Grade/tier boundaries already exist in the data. **Build
   plan drafted 2026-09-03:** size S; `frontierKanjiUnit(profile)` already
   computes the learner's current kanji grade, so this is a display change
   using data that already exists, not new plumbing. **Needs a human
   decision** on exact label/copy per script/kind and where the
   corpus-wide total goes visually (secondary line, tooltip, omitted for
   beginners) — a real hierarchy call on a highly visible screen, even
   though the data-fetch itself is small.
3. **Milestone celebration.** Nothing marks completing a full set (all
   hiragana, a kanji grade, a first L3 story) — only a per-session
   "Session done" screen. A single screen naming the milestone, no
   fireworks, fits the app's existing restrained-feedback style. **Build
   plan drafted 2026-09-03:** size M; hook `finishSession()` to compare
   `courseStats()` before/after a session and detect a transition into
   "started === total" for a whole set. **Needs a human decision** on
   which set-completions actually count as milestones (the doc names three
   examples but doesn't commit to the full list), copy/tone, and whether
   re-completing a lapsed set re-celebrates.
4. **Leech handling in `srs.js`.** **Confirmed 2026-09-03 (was previously
   just "unclear"):** there is no leech handling today. `lapses`/
   `incorrect` counters are tracked per item but are lifetime totals with
   no cap, never used to change scheduling — their only effect is
   `dueItems()` sorting higher-lapse items earlier within the same-day
   queue (`src/srs.js:646`). Every miss, however many times repeated,
   resets identically to box 0 / streak 0 (`src/srs.js:322-324`,
   `:858-860`) — a character missed 20 times gets exactly the same
   treatment as one missed once. Worth a design decision on what leech
   handling should actually do (cap interval growth past N lapses? flag
   for distinct review treatment? surface a count in the UI?) before
   building it — not a no-brainer, since "what should happen to a leech"
   is itself a design call.
5. **FSRS-style scheduling.** **Confirmed 2026-09-03 (was previously "may
   be" SM-2-like):** `srs.js` is a fixed-interval Leitner box scheduler —
   `BOX_INTERVALS_DAYS = [0,1,2,4,8,16,32]` indexed by a box that resets on
   any miss (`src/srs.js:12`, `:290-337`). The kanji-reading path
   (`gradeYomi()`) adds a monotonic "experience" multiplier derived from
   lifetime correct count, but it can only grow, never shrink, so it's
   still not a genuinely adaptive per-item difficulty value — no ease
   factor, no FSRS-style stability/retrievability model, binary
   correct/incorrect grading only (no graded response scale). Migration
   surface is moderate, not trivial: two parallel record shapes (`grade()`'s
   box/due/lapses vs. `gradeYomi()`'s streak/correct/incorrect), several
   downstream consumers assume box/due fields directly, and true FSRS needs
   a 4-point grade scale — a quiz-flow/UI change, not just new stored
   fields. Real project; do after the above per the original priority
   ordering, now that what's actually implemented today is confirmed
   rather than assumed.
6. **Feed story word-lookups into spaced review.** **Confirmed 2026-09-03
   (was previously "never independently verified"):** tapping a word in a
   story does **not** feed the SRS due-date queue. It only updates a
   separate `exposure`/`muted` bookkeeping structure that drives the
   furigana reveal ladder (`recordReaderExposure`, `src/app.js` ~6416/6778)
   — this is a genuinely different mechanism from the `progress` records
   that `dueItems()`/`grade()` actually read. The only bridge is a manual
   "+ Add" button on the story's end-card (`src/app.js` ~7002) that
   requires the learner to opt in after finishing the *whole* story, not
   at the moment of lookup. This remains the single highest-value pending
   pedagogy fix per the original retrieval-practice research — what
   changed is it's now proven, not assumed. A fix would likely mean
   auto-enrolling (or offering a lighter, one-tap add) directly from the
   gloss card rather than only at the end-card, which is itself a UX call
   worth deciding deliberately rather than defaulting to "auto-enroll
   silently."
7. **Minor: duplicated choice-button rendering in `app.js`.** ~~Not a
   bug, just a footgun...~~ **Shipped 2026-09-03** — see `7445c96` above.
8. **Contingent, low priority: import known words from Anki/WaniKani**
   (`external-import-plan.md`, currently pure aspiration, zero code). Only
   worth picking up if bulk "Mark as known" turns out to be insufficient
   for how advanced users actually arrive with prior knowledge — give it
   real usage first.
9. **In-app feedback channel** (`feedback-plan.md`, fully designed
   2026-08-24, zero code — confirmed 2026-09-03, no `feedback-server/`
   directory exists). Worth surfacing given the stated direction of
   shifting from building new major features toward responding to broader
   user feedback — this plan's own "Lean track" recommendation (free tier,
   `waitUntil` + cron, ~9-17 developer days for the full first release,
   less for just a submission form and GitHub issue creation) is a
   reasonable place to start. **Build plan drafted 2026-09-03:** size L
   (~2-3 developer days for Phase 0 + the Lean Phase 1 MVP alone, per the
   plan's own estimate). **Needs a human decision** — the plan itself
   flags its own Phase-0 choices as still open, plus entry-point placement
   and submission-form copy; not something to build without those calls
   first.
10. **Duplicated furigana reveal-ladder logic.** `src/vocab.js`/`app.js`
    (`vocabHiddenState`) and `src/reader.js` (`isTokenFuriganaHidden`) each
    implement "kanji with optional ruby that reveals on tap" independently
    — `stories-plan.md` §5.7 called for extracting a shared
    `src/furigana.js` and it never happened (`vocab-plan.md` phase 8, still
    unstarted). Minor today; worth doing before either renderer's tap
    behaviour changes again. **Build plan drafted 2026-09-03:** the core
    "is this reading hidden" predicate is confirmed byte-identical between
    the two implementations today (`reader.js:59-66` vs. `app.js:3584-3617`)
    and is a clean, mechanical extraction (size M) — but the plans call for
    fully unifying the per-word vs. per-kanji aggregation and the two
    tap-state machines too, and those two diverge by *deliberate design*
    (different granularity, a quiz-specific override reader.js has no
    equivalent for), not by drift. **Needs a human decision** on whether to
    stop at the safe predicate-only extraction or take on the larger,
    riskier unification the original plans wanted.
11. **Kanji component breakdown + mnemonics.** New, requested by the user
    mid-session on 2026-09-03: break each compound kanji into its
    recognizable component parts with their meanings, suggest an
    arrangement-aware mnemonic for the whole kanji, and surface it in three
    places — the kanji detail page, the lesson/introduction flow for a new
    kanji, and a "Show hint" button on recognition/writing quizzes for a
    learner who's stuck. Explicit constraint: must not infringe James
    Heisig's "Remembering the Kanji" (its primitive-keyword glosses and
    per-kanji stories are original copyrighted work). **Plan drafted
    2026-09-03** at `kanji-mnemonic-plan.md`: decomposition + arrangement
    data would come from KanjiVG's own `kvg:element`/`kvg:position`
    metadata (already fetched into this repo via `tools/fetch_kanjivg.sh`
    but currently discarded — only stroke paths are parsed today, CC
    BY-SA 3.0, independent of RTK); component meanings from a two-tier
    lookup that reuses KANJIDIC2's own meaning when a component is itself
    a jōyō character, falling back to the traditional 214 Kangxi radical
    names (public reference material predating RTK by roughly 260 years) —
    deliberately never inventing an RTK-style idiosyncratic keyword;
    mnemonic text generated from a small, fixed set of arrangement-keyed
    sentence templates rather than hand-authored per-kanji prose, which is
    the actual structural safeguard against drifting toward anything
    resembling Heisig's stories. **Needs a human decision** on several
    things the plan calls out explicitly, most importantly how far to push
    template "wittiness" in later iterations — starting flat/plain is safe,
    but making templates progressively more vivid is the one direction
    that could start resembling authored RTK-style stories rather than
    filled-in sentences, worth a second look before iterating past a plain
    first version. Also open: visual placement on the detail page, and how
    many kanji to cover in a first pass. Not yet reviewed by a human at
    all — read the plan doc fresh before acting on it.
12. **Accessibility pass.** ~~still outstanding...~~ **Shipped 2026-09-03**
    — see `1de948a` above. Not necessarily exhaustive; worth a second pass
    if a real screen-reader user reports a gap.
13. **No CI.** ~~Confirmed 2026-09-03: no `.github/` directory exists...~~
    **Shipped 2026-09-03** — see `51f0da3` above. `feedback-plan.md`
    phase 4 designs a further step — switching Pages' deploy source from
    "deploy from branch" to "deploy via Actions" so a failing test actually
    blocks the deploy, not just flags it after the fact — which remains a
    separate, later decision.

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
