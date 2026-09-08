# Review follow-ups (as of 2026-09-08)

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

**Sixth pass, 2026-09-08 (documentation audit, no new code):** this file's
own "Remaining" list below had gone stale — both items 1 and 2 were marked
"Not started" when a full week of real shipping (2026-09-05 through -08) had
actually landed on both. Every implementation plan in the repo (except
`external-import-plan.md`, deliberately skipped — still genuinely zero code)
was individually re-audited against current source and git history and
corrected in place where stale; see "Documentation audit findings" below for
what changed and what's still genuinely open.

**Seventh pass, 2026-09-08 (same day, three owner decisions plus one build):**
following the sixth pass's findings, the app owner (1) closed the kanji-
mnemonic copyright-review gap — satisfied the idea/expression reasoning is
adequate, no independent RTK skim needed; (2) shelved feedback Phase 7
(automated GitHub Actions triage/agent-fix) by explicit decision, wanting to
keep control over triage and fixes for now rather than hand it to
unattended automation — the manual `kanaquest-feedback-triage` skill stays;
(3) asked for sync Phase 4 to actually be built, which happened the same
day — see "Shipped this cycle"; and (4) asked for a plan (not yet a build)
to fix the colour-contrast gap `kanaquest-evaluation.md` flagged, drafted
the same day as **`contrast-plan.md`** — its own audit found the real
picture broader than that review's original two examples (a mastery-tier
*label* text pairing, never measured before, fails worse than the tile
background the review caught), and its recommended fixes deliberately
split "the app's own information" (mastery tiers — fix outright) from
"personalization" (the accent picker — keep all ten colours, make the
AA-passing ones findable, treat further narrowing as a real trade-off
rather than a given). Left explicitly for later, at the owner's direction:
kanji-expansion-plan.md's Phase 7 (JLPT/frequency orderings).

**Eighth pass, 2026-09-08 (same day, live bug report against §7's own
build).** The app owner hit a real regression while using the sync-Phase-4
build above: 出 was still quizzable on its スイ reading with no recognizable
common word behind it, even after `fd6bd2b` (2026-09-07) was supposed to
have fixed exactly this class of bug. Full investigation, the rejected
fix, the shipped fix, and a dataset-wide sizing of the same category (580
"strong" readings backed only by written- not spoken-commonness, plus
1,047 already-known fallback-tier readings) are recorded at
`kanji-expansion-plan.md` §4.5, including two words flagged for the
owner's own review (扶/フ, 喚/カン) and one unrelated content-
appropriateness finding (淫/イン's only example is "prostitution") — none
of the three acted on yet, deliberately. The owner is now using the app
normally to surface anything else that still feels wrong, rather than
this being chased further by more dataset scans.

## Remaining (not built this pass)

Two items from the original 2026-09-04 build order were deliberately left
out of that day's pass, at the app owner's explicit request — but both have
since shipped (see below and "Documentation audit findings"):

1. **~~Kanji component breakdown + mnemonics. Not started.~~ Shipped
   2026-09-05, extended 2026-09-06.** Full plan and decisions at
   `kanji-mnemonic-plan.md` (§8 has the resolved decisions: grades 1-3 first
   pass, distinct-but-quiet "Show hint" button, plus §9-§10 for what was
   built beyond the original plan, including learner-editable hints).
   Component breakdowns and mnemonic hints exist for all 1,026 grade 1-6
   kanji (`35ab2a5`, `0cf0f82`), wired into the detail screen, the lesson
   card, and both the Yomi/Definition and Writing quiz hint buttons.
   **The copyright-safety review this file used to flag as an open gap is
   closed, 2026-09-08:** the app owner reviewed it and is satisfied the
   idea/expression reasoning (kanji-mnemonic-plan.md §2.6, §9.1) is
   adequate on its own, with no independent RTK skim needed. Grades/units
   8-N (secondary jōyō) and 9-N (beyond-jōyō names & places) still have no
   component/mnemonic data — not tracked as a gap, just not built yet.
2. **~~In-app feedback channel. Not started.~~ Live in production since
   2026-09-06.** Full plan and decisions folded into `feedback-plan.md`'s
   own "Phase-0 choices" section. The 💬 button, the report form (since
   simplified to a single message box, `847fb5a`), the Worker/D1 backend,
   GitHub issue creation, the private inbox repo and webhook, My
   contributions with report badges, and the release thank-you are all
   live and verified end to end (`feedback-server/README.md`). All five
   Cloudflare secrets are set, including `GITHUB_TOKEN` and a real
   `TURNSTILE_SECRET` (`59f30d9`, 2026-09-06) — the two items this file and
   `feedback-plan.md` both used to list as still needed. Phase 6's non-UI
   exit items (a "your contributions live in this profile, sync/backup
   carries them" disclosure, optional private milestones, and a real
   accessibility audit of the feedback/contributions screens — reduced-
   motion is done, the rest isn't) remain a genuine gap. **Phase 7
   (automated GitHub Actions triage + agent-fix workflows) is shelved by
   explicit owner decision, 2026-09-08** — not merely unbuilt: the owner
   wants to keep control over triage and fixes for now rather than hand
   either to unattended automation. The lighter, human-in-the-loop
   substitute already in place — the `kanaquest-feedback-triage` Claude
   Code skill (`e2656f0`, 2026-09-07), which drafts a triage plan for the
   owner to review by hand, applies no labels, and starts no agent-fix
   workflow — stays exactly as it is; that was never in question.
3. **Contingent, low priority: import known words from Anki/WaniKani**
   (`external-import-plan.md`, pure aspiration, zero code). Only worth
   picking up if bulk "Mark as known" turns out to be insufficient in
   practice — not scheduled, no decision pending. Confirmed still
   accurate 2026-09-08 — this is the one plan deliberately not re-audited
   in the documentation-audit pass, since there is nothing in it to check
   against code.

**One real follow-up surfaced by the FSRS work** (not in the original
list, spawned as its own task chip, `task_efdca0ca`, during this pass):
the FSRS migration's 4-point grading (Again/Hard/Good/Easy) is fully
implemented and tested in `src/fsrs.js`/`src/srs.js`, but two of its four
inputs were unreachable in practice — Writing mode had no 0-100 accuracy
score to grade Easy/Hard from (grading there was qualitative/binary), and
multiple-choice quizzes only ever grade on the first attempt
(`chooseAnswer` deliberately never re-grades a retry), so "correct after a
retry = Hard" never fires.

**2026-09-05, `1f08609`, reverted same day: an inferred-signal attempt,
tried and rejected.** First attempt at the writing-mode half: derived a
0-1 `accuracy()` fraction from each attempt's real stroke accept/reject
outcome (`createWritingAttempt()`/`createFreeAttempt()` in
`src/writing.js`) and mapped it onto Easy/Hard automatically. On review,
this was judged the wrong shape of fix and dismantled before it reached
real usage: stroke-grader.js's own tolerances are deliberately loose
("a false incorrect is far more costly than a false correct" — see its
module comment) to swallow ordinary motor/touchscreen noise, and that same
looseness is exactly what a scheduling-difficulty signal cannot afford to
inherit — a rushed or jittery stroke on a character the learner knows
perfectly would have counted as evidence of difficulty it never was.
Worse, Trace mode's guide is fully visible the whole time, so a "flawless"
Trace pass mostly measures tracing precision, not recall — mapping that to
Easy every time would have systematically over-promoted the easiest mode's
reviews. And Free mode's Hard path could silently schedule a
self-graded-"correct" answer *sooner* than before with nothing on screen
explaining why, which is the exact "why does this keep coming back"
confusion spaced-repetition apps are supposed to avoid, not introduce.

**Current plan: explicit self-report, not an inferred proxy, across every
graded mode.** Rather than guessing at Hard/Easy from indirect signals,
`grade()`/`gradeYomi()`'s existing `rating` override (unchanged, still
real, still tested in `test/smoke.js`) will instead be fed by the learner
directly: the single shared `#quiz-ok` "Next" button (one element,
`nextQuestion()`, reused across every non-writing quiz mode) becomes a
three-way bar — Easy / OK / Hard — shown only on a correct answer, with OK
centered, highlighted, and bound to Enter, matching today's default
behavior for anyone who just presses through. An incorrect answer keeps a
plain Next; FSRS's Again isn't a self-report choice, it's automatic. This
is a bigger change than it looks: every one of the ~8 grade()/gradeYomi()
call sites (`chooseAnswer`, `recordVocabYomi`, `recordVocabDef`,
`recordVocabProd`, `recordVocabSpell`, `recordYomiResult`, plus writing's
own Trace/Guided/Free flows) currently commits its grade the instant the
answer is chosen, well before Next/quiz-ok ever appears — deferring that
commit to the button press, for the correct-path only, without disturbing
the first-attempt-locks-the-record rule, is the real work here, not the
button itself. Explicitly deferred: any inferred/derived rating signal
(handwriting accuracy, response time, retry count) — correlating those
against real explicit ratings, if anonymous usage data is ever collected,
is future work, not a substitute for asking.

**2026-09-06: shipped.** `#quiz-ok`/`#writing-next` now yield to a
`#quiz-rate`/`#writing-rate` Easy/OK/Hard bar (`showRatingBar()` in
`src/app.js`) on every correct answer across `chooseAnswer`,
`chooseVocabMeaning`/`finishVocabDefinitionStage`, `chooseVocabYomi`,
`chooseVocabProd`/`finishVocabProdStage`, `chooseVocabSpell`, and writing's
Trace/Guided/Free flows — each grade defers into `session.pendingGrade`
(a closure) until the learner presses one, via a new shared
`rateAndAdvance()`. OK commits `RATING.GOOD`, i.e. exactly today's old
default, so anyone who just keeps pressing through sees no change at all.
Two cases keep the OLD immediate-commit, plain-Next behavior instead of
deferring — `isRatableCorrectAnswer()`'s own docstring has the reasoning:
a recovery on attempt 2+ (already locked as Again on attempt 1 — nothing
left to rate) and a placement-test answer (`grade()`'s `placement` branch
ignores `rating` entirely, jumping straight to the top box regardless, so
the bar would visibly do nothing). A `settlePendingGrade()` safety net
(committing whatever's pending as GOOD) runs on every path that could
otherwise abandon a correct-but-unrated answer — `finishSession()`,
`quit-session`, `writingRetry()`, and `writingSetSubMode()` (reachable
straight off a still-unrated pass via "Try harder/easier mode"). Verified
end-to-end in the browser (real Easy/Hard/OK presses producing box
4/1/2 as designed) and in `test/wiring.js` (same assertions, plus the
recovery/placement plain-Next paths and the writing mark-as-bad/bonus-
round flows that depend on the settle net). The kanji reading quiz stays
untouched, exactly as decided.

**Resolved without new code: the retry-grading question for multiple-
choice modes.** `chooseAnswer`'s "first attempt locks the record" rule
stays as-is — a wrong-then-corrected answer still just grades Again, since
FSRS's Again has no Hard/Easy variant to self-report either way. This
closes the "retry = Hard" half of the original gap by deciding retries
stay out of the picture, not by wiring anything new for them.

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
- `1f08609` (2026-09-05) → **reverted same day, see the "Remaining"
  section above** — an inferred stroke-accuracy signal for Writing mode's
  Hard/Easy rating, tried and then judged the wrong approach (conflated
  motor noise with recall difficulty, over-rewarded Trace mode, and could
  silently reschedule a self-graded-"correct" Free answer sooner with no
  on-screen explanation). Superseded by the explicit Easy/OK/Hard control
  below.
- (2026-09-06) — **Explicit Easy/OK/Hard rating, across every graded
  mode.** The real fix for the gap above: `#quiz-ok`/`#writing-next` yield
  to a rating bar on every correct answer (kana/kanji recognition and
  definition, both vocab Meaning sub-stages, both vocab Recall sub-stages,
  and writing's Trace/Guided/Free), which the learner presses themselves —
  no inferred signal anywhere. OK reproduces the exact old default
  (`RATING.GOOD`), so nothing changes for anyone who just presses through.
  See "Remaining" above for the full design (the deferred-commit mechanism,
  the placement/recovery exceptions, the settle-on-escape safety net) and
  its own end-to-end verification. The kanji reading quiz is untouched,
  by design — see "Remaining" for why.
- (2026-09-08) — **Sync Phase 4**: clock correction, remote delete on
  profile deletion, the 404-means-deleted safeguard, and backoff — full
  detail in `sync-plan.md` §4.6-§4.8 and §8. Found still unbuilt by this
  same day's documentation audit, then built the same afternoon at the
  app owner's explicit request. In short: a device's clock is now
  corrected against every sync response's `Date` header before grading
  anything, so a badly-wrong clock can no longer win or lose every merge
  conflict forever; deleting a profile now deletes its remote copy too
  (best-effort, never blocking the local delete); a profile deleted on
  another device is detected and explained in Settings rather than
  silently recreated by an unattended sync; and a persistently-conflicting
  push now backs off exponentially rather than retrying every ten minutes
  forever. `test/sync.js` grew from 24 to 28 checks; verified live in the
  browser that the new Settings message renders correctly, with no
  console errors.

The `50675f0`/`7299835` pair was implemented by Claude Fable 5.1 as a
deliberate trial (reviewed, tested, and verified live by Claude Sonnet 5
both times) — it went well; nothing wrong was found that needed more than
one small copy fix. No standing reason to prefer or avoid Fable for the
items below on that basis alone.

## Documentation audit findings, 2026-09-08

Every implementation plan in the repo except `external-import-plan.md` was
individually re-read against current source and git history and corrected
in place; each plan file itself now carries the detailed evidence and
commit citations. This section is the short version, for the doc that's
supposed to be current without opening eight other files.

- **`sync-plan.md`** — phases 0-3 re-confirmed accurate by a source-level
  grep (not just re-reading the plan's own claim). **Phase 4 was found
  unbuilt during this pass and then implemented the same day** — see
  "Shipped this cycle" below for what actually landed (clock correction,
  remote delete on profile deletion, the 404-means-deleted safeguard, and
  backoff). Also noted: the onboarding flow's "I already use Kana Quest"
  path (`d6cee72`) reuses this same pairing UI rather than building a
  second one, which is corroborating evidence sync is genuinely live, not
  just wired.
- **`kanji-expansion-plan.md`** — phases 0-6, 8 re-verified against the
  actual generated data (2,136 jōyō + 897 beyond-jōyō kanji, exact phase
  counts match). **Phase 7 (JLPT/frequency orderings) confirmed still
  unbuilt.** One stale claim fixed: the "one headline bulk-enroll button
  above three toggles" enrollment UI described in §2.5 was replaced
  2026-09-07 with one spelled-out button per mode and no bulk control on
  the detail screen — though a *different* bulk enrollment tool (a set
  overview "＋ Choose what to study" sweep) shipped the same day, resolving
  §8's open question about wanting one at all.
- **`vocab-plan.md`** — the furigana.js extraction this file listed as "did
  not happen" actually happened **partially**: `6f5394d` (2026-09-04)
  shares the "is this reading hidden" predicate between `app.js` and
  `src/reader.js`, but the surrounding per-word/per-kanji aggregation and
  the two tap-state machines remain deliberately separate. A13 ("the set
  text and film") is still a genuine, deliberate stub. Also fixed: §7.5's
  claim that the end-of-story list is "the only place a reading session
  turns into study" — a one-tap add on the gloss card itself shipped
  2026-09-04 (`a27a9cf`) as an earlier, optional opportunity to do the same
  thing.
- **`stories-plan.md`** and **`story-continuity-audit.md`** — the story
  count is **30, not 24** (a fifth story was added at every level,
  `29cef88`); two of the 30 now carry a non-null `series` tag (naming the
  canonical work they adapt) though neither is actually serialized
  (`of: 1`) — Phase 9 (real multi-episode serialization) is still
  genuinely unbuilt. The continuity audit's revisions were spot-checked and
  genuinely applied (typos and unmotivated details gone, sentence counts
  match). Its scope is now six stories behind the current count — the six
  added since are all Claude Opus 5.0-credited like the two originally
  excluded, so they're out of scope by the audit's own different-author
  logic, but none has actually been continuity-checked.
- **`writing-mode-plan.md`** — two genuine follow-ups from real use since
  this doc was last touched, now recorded as new §7.10/§7.11: hint-button
  crowding/sizing fixes, and a real behavior change worth knowing about —
  **the default Writing-mode preference switched from Dynamic to Guided**
  (`f08d488`, 2026-09-06), and a kanji's first-ever writing appearance now
  always runs a fixed Trace/Trace/Guided drill regardless of the learner's
  chosen mode.
- **`feedback-plan.md`** and **`kanji-mnemonic-plan.md`** — see "Remaining"
  above; both had their top-level status corrected there.
- **`onboarding-plan.md`** needed no correction — it was kept current by
  whoever made the 2026-09-06/07 commits that extended it (§10, §11).

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
