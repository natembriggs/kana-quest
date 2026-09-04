# Review follow-ups (as of 2026-09-04)

Consolidated punch list from the 2026-09-02/03 review (codebase map, code
health, pedagogy research, hands-on UI walkthrough, synthesis, plus two
rounds of live-usage feedback on the first feature it produced). Full raw
reports aren't kept in the repo; this file is the durable reference — read
it fresh in a new session rather than assuming anything below is still
accurate without checking the current code first.

**Fifth pass, 2026-09-04 (same day, build queue completed):** every item
from the build order below except the feedback channel and kanji mnemonics
was actually implemented, tested, and shipped in one sequential queue —
onboarding (by an Opus agent), then story word-lookups → SRS, a live
mid-queue bug fix (writing-mode hint buttons), chunk-relative home
progress, milestone celebration, leech handling, furigana-ladder dedup, and
finally FSRS-style scheduling. See "Shipped this cycle" for what each one
actually did, and the note at the end of that section for one real,
flagged gap in the FSRS work that still needs a decision.

## Remaining (not built this pass)

Only three items from the original build order were deliberately left out
of this pass, at the app owner's explicit request:

1. **Kanji component breakdown + mnemonics.** Full plan and decisions at
   `kanji-mnemonic-plan.md` (§8 has the resolved decisions: witty tone
   flagged for a copyright-safety review before shipping, grades 1-3 first
   pass, distinct-but-quiet "Show hint" button). Not started.
2. **In-app feedback channel.** Full plan and decisions folded into
   `feedback-plan.md`'s own "Phase-0 choices" section (private inbox, no
   attribution, Lean Cloudflare track, triage-only automation). Not
   started — this is genuinely new infrastructure (a Cloudflare Worker, a
   GitHub App), not in-app learning UX, so it's a different kind of task
   from the rest of this list.
3. **Contingent, low priority: import known words from Anki/WaniKani**
   (`external-import-plan.md`, pure aspiration, zero code). Only worth
   picking up if bulk "Mark as known" turns out to be insufficient in
   practice — not scheduled, no decision pending.

**One real follow-up surfaced by the FSRS work** (not in the original
list, spawned as its own task chip, `task_efdca0ca`, during this pass):
the FSRS migration's 4-point grading (Again/Hard/Good/Easy) is fully
implemented and tested in `src/fsrs.js`/`src/srs.js`, but two of its four
inputs are currently unreachable in practice — Writing mode has no 0-100
accuracy score to grade Easy/Hard from (grading there is qualitative/
binary today), and multiple-choice quizzes only ever grade on the first
attempt (`chooseAnswer` deliberately never re-grades a retry), so "correct
after a retry = Hard" never actually fires. Functionally, FSRS is live and
mathematically validated against reference test vectors, but is currently
operating on Good/Again only, not the full four-point scale it was
designed for — worth a real decision on whether to add a writing-mode
accuracy score and/or let retries reach grading, both of which are UX
questions (does a "Hard" answer need to look different mid-quiz?), not
pure implementation ones.

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
  screen itself. **Long-press verified working on a real Android device
  2026-09-04** — closes the one open question from the original round-2
  review about Chrome's `contextmenu` timing vs. the app's own long-press
  threshold.
- `7445c96` — Extracted a shared `addChoiceButton()` helper, replacing six
  duplicated ~7-line button-creation call sites across the quiz renderers
  in `app.js`. Same-behavior refactor, no visible change.
- `0c79c49` — Added `test/reader.js`: 38 direct unit tests for
  `renderSentence`, `tokenAtLevel`, `storyOccurrenceIndex`,
  `isTokenFuriganaHidden`, `exposureTargetsForToken`, and `tokenHasKanji`.
- `1de948a` — Accessibility pass: `role="tab"`/`aria-selected` on the five
  genuinely tab-like segmented controls, `aria-pressed` on two
  non-exclusive toggle groups, and `aria-live="polite"` on the app's
  real-time feedback regions. No visible change.
- `51f0da3` — CI workflow: `.github/workflows/test.yml` runs every
  `test/*.js` suite on push/PR against `main`, fails the job on any
  non-zero exit.
- `be762e7` — Copy fix: vocab Recall's spelling follow-up stage said "Now
  choose how it's spelled" / "spell it", which reads like typing when the
  step is picking the right kanji spelling from multiple-choice options.
  Now says "Now choose the correct kanji" / "pick the kanji".
- `74ca2cc`…`d6cee72`, `164e1f2` — **Onboarding self-placement** (full
  build brief at `onboarding-plan.md`, implemented by an Opus agent): a
  new profile's first run offers three routes — connect to an existing
  profile via the existing sync-pairing UI, a skippable complete-beginner
  guide (including the katakana-can-come-first-for-travellers framing),
  or a four-scale "already learning" screener. "Know all" answers claim
  mastery immediately via the existing bulk self-assessment machinery;
  "some" answers arm a highlighted nudge on that unit's "Select known"
  entry point the first time it's opened (persists 5 sessions if
  deferred, clears if declined). Skip always available, defaults to zero.
  Existing profiles never see any of this. Caught and fixed 4 real layout
  bugs via actual browser testing (bottom-bar overlap on two screens, a
  clipped Skip button, the nudge highlight painting accent-on-accent, and
  the overview's auto-scroll pushing the nudge off screen).
- `a27a9cf` — **Story word-lookups now feed spaced review**: a one-tap
  "+ Add" button on the story reader's gloss card itself, at the moment
  of lookup, alongside the existing end-of-story "+ Add" button. Shows
  "Studying" (disabled) if already enrolled, shows neither control for a
  word with no vocab-curriculum entry.
- `372ddd3` — **Writing-mode hint buttons repositioned**, fixing a live
  bug report: "Show next stroke"/"Show full character" used to occupy the
  same screen position the "Next" button lands in once a character is
  finished, so a fast tap meant for Next could land on a hint button
  instead. Both hints now sit stacked on the left, clear of wherever Next
  appears.
- `07fd5ed` — **Chunk-relative progress on home tiles**: kanji shows
  "Grade N: X/Y" against the learner's current grade while it's
  unfinished, switching to "Jōyō kanji: X/2136" once that grade is done
  (rather than the full extended corpus, which includes
  `kanji-expansion-plan.md`'s beyond-jōyō additions). Vocab shows its
  current commonness tier the same way, falling back to the full vocab
  total once a tier is finished (no smaller natural target exists for
  vocab the way jōyō exists for kanji). Kana was already chunk-relative
  and is unchanged.
- `2a15151` — **Milestone celebration**: a new card on the "Session done"
  screen the first time a learner finishes a whole kana script, a whole
  kanji grade, or all of jōyō (the last supersedes the per-grade one when
  that grade was the final piece). Fires once per set ever — a later
  lapse-and-recover doesn't re-trigger it. Not built for vocab tiers or
  story levels this pass.
- `284d9a5` → **superseded same day, see `44ad3d3` below** — leech
  handling originally shipped as its own capped-interval mechanism, then
  removed hours later once FSRS landed and made it redundant (FSRS's
  difficulty parameter already handles "this item is hard for this
  learner" continuously). Left in this log for the record; the actual
  current leech behavior is whatever FSRS does natively, not this commit.
- `6f5394d` — **Furigana-ladder dedup**: extracted the byte-identical
  "is this reading hidden" three-way check (known / exposure-promoted /
  muted) out of `src/reader.js` and `src/app.js`'s `vocabHiddenState` into
  a new `src/furigana.js`, shared by both. Deliberately did **not** unify
  the two callers' surrounding aggregation (per-word vs. per-kanji) or
  their separate tap-state machines, which diverge by design. Confirmed
  zero behavior change across all 7 test suites.
- `0d9cdd6`, `44ad3d3` — **FSRS-style scheduling**: `src/srs.js`'s fixed
  Leitner-box scheduler (`BOX_INTERVALS_DAYS`) is replaced by a real
  FSRS-6 implementation (`src/fsrs.js`, transcribed directly from
  `open-spaced-repetition/ts-fsrs`'s actual source and validated against
  its own reference test vectors to 4-decimal precision — not
  reconstructed from memory). The two existing record shapes (`grade()`'s
  box/due/lapses, `gradeYomi()`'s streak/correct/incorrect) were kept
  parallel rather than unified — both gained `stability`/`difficulty`
  fields, with `box`/`streak` now *derived* from stability for backward
  compatibility with every existing downstream consumer, which needed
  zero changes as a result. Existing progress migrates lazily on a
  record's first post-upgrade grade, seeding stability from the old
  box/interval discounted by lifetime lapse count rather than resetting
  anyone's progress. **See "Remaining" above for the one real gap this
  surfaced**: two of FSRS's four grade inputs (Hard, Easy) are currently
  unreachable given how quizzes and writing mode actually grade today.

The `50675f0`/`7299835` pair was implemented by Claude Fable 5.1 as a
deliberate trial (reviewed, tested, and verified live by Claude Sonnet 5
both times) — it went well; nothing wrong was found that needed more than
one small copy fix. No standing reason to prefer or avoid Fable for the
items below on that basis alone.

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
- Keeping the explicit leech-cap mechanism (`284d9a5`) alongside FSRS
  (2026-09-04) — removed same day once FSRS landed, since FSRS's own
  difficulty parameter already answers the same question continuously
  rather than needing a bolted-on cap-and-recover state machine.
