# Review follow-ups (as of 2026-09-03)

Consolidated punch list from the 2026-09-02/03 review (codebase map, code
health, pedagogy research, hands-on UI walkthrough, synthesis, plus two
rounds of live-usage feedback on the first feature it produced). Full raw
reports aren't kept in the repo; this file is the durable reference — read
it fresh in a new session rather than assuming anything below is still
accurate without checking the current code first.

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

The last two were implemented by Claude Fable 5.1 as a deliberate trial
(reviewed, tested, and verified live by Claude Sonnet 5 both times) — it
went well; nothing wrong was found that needed more than one small copy
fix. No standing reason to prefer or avoid Fable for the items below on
that basis alone.

## Remaining, roughly in priority order

1. **Onboarding self-placement.** Still the biggest gap from the original
   review: a new profile has no "where are you starting from?" step, so
   an advanced adult and a beginner kid land on identical grade-1/L1
   content. The levelling machinery already exists (kanji grade filter,
   vocab commonness/topic tiers, story levels, adaptive writing
   difficulty) — this is about surfacing it at profile creation, plus a
   "Change my level" entry in Settings so it isn't a one-shot choice.
   Bulk "Mark as known" (shipped) is a partial substitute but doesn't
   replace a first-run prompt telling people it exists.
2. **Chunk-relative progress on home tiles.** Home screen shows e.g.
   "0/2825" against the whole kanji corpus — demoralizing for a beginner,
   uninformative for an advanced learner. Show progress against the
   current grade/tier ("Primary 1: 12/80") with the corpus total
   secondary. Grade/tier boundaries already exist in the data.
3. **`reader.js` (Stories) has zero test coverage.** Its exported
   functions — the furigana-reveal ladder, per-occurrence hiding, the
   exposure-key computation that feeds SRS — appear in no test file,
   despite Stories being the most actively developed feature. Verify this
   is still true before writing tests; it may have changed.
4. **Verify long-press on a real Android device.** Flagged by Fable during
   round 2: Chrome's own `contextmenu` timing on a long touch is roughly
   the same ~500ms as the app's long-press threshold, and was only
   verified against desktop-Chrome pointer-event semantics. Worth one real
   on-device check before trusting it fully on Android.
5. **Milestone celebration.** Nothing marks completing a full set (all
   hiragana, a kanji grade, a first L3 story) — only a per-session
   "Session done" screen. A single screen naming the milestone, no
   fireworks, fits the app's existing restrained-feedback style.
6. **Leech handling in `srs.js`.** Unclear whether persistently-missed
   items get any different treatment from ordinary review scheduling.
   Worth an audit regardless of SRS algorithm — a small set of leeches can
   dominate review time, especially for the larger item counts advanced
   users now carry.
7. **FSRS-style scheduling.** `srs.js`'s Leitner-box scheduler may be
   SM-2-like rather than difficulty-adaptive. A migration is a real
   project with a real payoff (roughly 20-30% fewer reviews for equal
   retention in published comparisons) that scales with queue size — do
   this after the above, not before, and only after confirming what's
   actually implemented today.
8. **Feed story word-lookups into spaced review.** Tapping an unknown word
   in a story currently gives a gloss, not a retrieval opportunity.
   Confirm whether looked-up words already feed the SRS queue (the
   pedagogy research assumed not, but this was never independently
   verified against the code) — if not, this is the single highest-value
   pending pedagogy fix per the retrieval-practice research.
9. **Minor: duplicated choice-button rendering in `app.js`.** The same
   ~8-line "create a choice button" pattern is repeated across several
   quiz-question renderers. Not a bug, just a footgun for future
   agent-driven edits — worth a small shared helper next time something
   nearby is being touched anyway, not its own task.
10. **Contingent, low priority: import known words from Anki/WaniKani**
    (`external-import-plan.md`, currently pure aspiration, zero code). Only
    worth picking up if bulk "Mark as known" turns out to be insufficient
    for how advanced users actually arrive with prior knowledge — give it
    real usage first.

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
