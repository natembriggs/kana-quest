# Onboarding self-placement — implementation plan

Written 2026-09-04, spec dictated directly by the app owner in a planning
conversation (not inferred) — this is not a first draft to be redesigned,
it's a build brief. Where this doc says "verify against current code," the
building agent should confirm exact function names/line numbers itself
(app.js is large and shifts between sessions) rather than trust any line
number below as gospel; the *behavior* described is what's fixed.

## 1. Problem

A brand-new profile has no "where are you starting from?" step. An advanced
adult and a total-beginner kid both land on identical grade-1/L1 content.
The levelling machinery already exists (kanji grade filter, vocab
commonness/topic tiers, story levels, adaptive writing difficulty) and bulk
"Mark as known" already exists as a self-assessment mechanism — this plan
is entirely about adding a first-run entry point onto machinery that
already works, not building new levelling machinery.

## 2. Where this hooks in

`createProfile(name, emoji)` (`src/store.js:177`) is where a profile is
born. `openProfile(profile)` (`src/app.js:609`) is where an existing
profile's migrations already run on every open (study-list shape, exposure,
muted, stories — verify this list is still current) before `renderHome()`.
The onboarding flow described below should run **once**, gated on a new
profile-level flag (e.g. `profile.onboarded`, boolean, defaulted `true` for
any profile that predates this feature so existing learners never see it
retroactively — same defensive pattern the existing migrations in
`openProfile()` already use for other added fields). Set it `true` the
moment the flow completes OR is explicitly skipped — "skip" must not mean
"ask again next time."

## 3. Screen A — entry choice

Shown once, before `renderHome()`, when `profile.onboarded` is not yet
true. Three buttons, plus a small "skip straight to app" text link below
them (not a fourth button — visually secondary, since it's an escape hatch
not a real option):

1. **"Connect to existing Kana Quest profile"** → goes straight into the
   *existing* sync-pairing code-entry UI (the same one Settings already
   has — search for `sync-code-entry`, `sync-code-input`,
   `sync-pair-submit` in `src/app.js`/`index.html`; do not build a second
   pairing implementation). Add a short explanatory line above the code
   field the first time it's reached this way (where to find the code on
   the other device — Settings → Sync, on the device that already has the
   profile). Add a "Cancel" affordance that returns to Screen A (lost the
   code, or landed here by mistake) — the existing Settings pairing UI may
   not need a cancel today since it's already inside Settings with normal
   back-navigation; onboarding does need one since there's nothing to
   navigate back to otherwise.
2. **"New profile — complete beginner"** → Screen B (guide).
3. **"New profile — already learning"** → Screen C (screener).

## 4. Screen B — beginner guide

A skippable (has its own "Skip" / "Got it, let's start" dismissal, visible
immediately, not buried at the end) explainer, not a quiz. Content, in this
rough order:

- Start with hiragana **or** katakana — both are valid starting points, not
  "hiragana first, always." Explicitly mention the katakana-first case: an
  English speaker with no Japanese vocabulary travelling to Japan will
  actually recognize real words (loanwords) faster in katakana than
  hiragana, so it can be the more motivating starting point for that
  learner specifically. Don't force a choice here — this is framing, the
  learner picks a script from the home screen afterward as normal.
- What the study modes are, at a level someone who's never used the app
  needs (Review vs. Test unlearned vs. Learn new — these three already
  exist as a labelled ladder on the course screen per the shipped
  `e7ff9f9` change; this guide can reference that ladder rather than
  re-explain the whole system from scratch).
- The daily habit: review what's due before learning new material, if
  there's time — due items should come first.
- Point at Settings' difficulty/pace sliders as the place to go if the
  defaults feel wrong (verify current Settings has sliders matching this
  description before writing copy that names them specifically).
- Reading practice (Stories) and vocabulary can start any time, but kana
  recognition first is the recommended baseline before either.

This is a single skippable screen or a short skippable sequence — verify
current screen/modal patterns in `index.html`/`app.js` (e.g. how the
existing lesson intro or a settings-explainer modal is structured, if one
exists) and reuse that pattern rather than inventing new screen-transition
plumbing for a one-time explainer.

After dismissal (skip or finish), `profile.onboarded = true`, go to
`renderHome()`.

## 5. Screen C — "already learning" screener

Four independent questions, each its own small control (not one giant
form) — script familiarity should not block filling in the others:

- **Hiragana**: none / some / read all / read and write all
- **Katakana**: none / some / read all / read and write all
- **Kanji**: none / some
- **Vocabulary**: none / some

Then a single **"Start learning!"** button that commits all four answers
at once and goes to `renderHome()`.

**"Read all" / "read and write all" → immediate mastery claim.** This maps
directly onto the existing bulk self-assessment machinery — `markKnownItems`
and the `KNOWN_CLAIM_SURE` claim tier (search `src/vocab.js`/`src/kanji.js`
for the exact exported signature via `isSelfAssessable`,
`KNOWN_CLAIM_SURE`, `KNOWN_CLAIM_THINK` — these are already imported into
`app.js`). "Read all" claims the whole *reading-side* modes for that script
(Reading for kana; Definition/Meaning-equivalent for the script, per
however "Mark as known" already scopes a claim to reading-only modes
today — verify against the shipped `7299835` implementation, don't assume).
"Read and write all" additionally claims the Writing mode with the same
`KNOWN_CLAIM_SURE` tier. This is calling the same bulk operation the set
overview's "Select known" already performs, just programmatically over an
entire script's units instead of a user-driven tile selection — do not
reimplement the claim logic, call into the existing function(s).

**"Some" → arm a nudge, don't claim anything.** No progress is marked yet.
Instead, record that this script/mode is "some known" so that the *first
time* the learner opens that unit's set overview, the existing "Select
known" entry point gets:
- extra visual emphasis (a highlight/pulse — reuse whatever emphasis
  pattern the app already has elsewhere, e.g. how the recommended action
  is already highlighted in the Review/Test-unlearned/Learn ladder from
  `e7ff9f9`, rather than inventing a new visual language for "look here"),
- an on-screen message explaining why it's highlighted (something like
  "You said you know some of this already — mark what you know so you
  don't re-learn it from scratch"),
- two dismissal options: **"Actually, I'd like to start fresh"** (clears
  the nudge for that unit permanently — no highlighting, no re-ask) and
  **"Maybe later"** (dismisses this instance but re-arms for the next 5
  sessions in that unit).

**Kanji/vocab "some" scoping**: kanji and vocab are asked as one yes/no
each (not per-grade/per-tier), but the app's units are per-grade
(kanji)/per-tier (vocab). The nudge should apply to *whichever unit the
learner opens first* within that script — i.e. "some kanji known" arms the
nudge on Grade 1 kanji's overview (the first unit they'll naturally reach),
not on every grade simultaneously, since claiming "grade 6 kanji known" via
a nudge before the learner has even reached grade 6 makes no sense. Kana
has no sub-grading, so "some hiragana" arms the nudge on hiragana's single
overview directly.

### 5.1 New profile state needed

Something like a `profile.placementNudge` map, keyed by script/mode-scope,
each entry holding at minimum: whether it's armed, and a remaining-sessions
counter (starts at 5 on "maybe later," decremented once per session
actually taken in that unit — not per screen view — cleared entirely on
"start fresh" or once "Select known" is actually used from a nudged
state). Exact shape is an implementation detail; the two behaviors above
(persist 5 sessions on "maybe later," clear permanently on "start fresh")
are the fixed requirement.

## 6. Skip behavior

The small "skip straight to app" link on Screen A always works, immediately
sets `profile.onboarded = true`, and goes straight to `renderHome()` with
zero progress claimed and zero nudges armed — equivalent to how the app
behaves today. Never block reaching the home screen on any choice here.

## 7. Explicitly out of scope

**"Change my level" in Settings — shelved, do not build.** No persistent
re-entry point into this flow from Settings. The existing "Mark as known"
tooling already covers "I know more than the app thinks I do" going
forward; there's no clear case yet for needing to walk placement backwards.
If this changes later it's a new, separate decision — don't preemptively
design for it here (e.g. don't add a "re-run onboarding" flag/button "just
in case").

## 8. Build order

1. `profile.onboarded` flag + gating in `openProfile()`/wherever a new
   profile actually first reaches `renderHome()` — confirm the exact
   integration point by reading `createProfile()`'s callers.
2. Screen A (entry choice + skip link) and its three branches' navigation,
   with Screens B/C as placeholders that just set `onboarded = true` — get
   the gating and navigation skeleton correct and tested before content.
3. Screen B (beginner guide) content and dismissal.
4. Screen C (screener) UI for the four scales + "Start learning!" wiring
   into `markKnownItems`/`KNOWN_CLAIM_SURE` for the "know all" branches.
5. The "some" → nudge-arming state, and the nudge UI on each unit's set
   overview (highlight + message + two dismissals + 5-session persistence).
6. Wire "Connect to existing profile" into the existing sync-pairing UI
   with the added cancel affordance and explanatory copy.
7. `test/wiring.js`-style coverage for: a fresh profile reaches Screen A;
   skip reaches home with nothing claimed; "read all" claims correctly via
   the existing self-assessment path; "some" arms a nudge that appears on
   first overview visit and correctly persists/clears per the two
   dismissal paths; an existing (pre-feature) profile never sees Screen A.

## 9. Open questions / judgment calls left for whoever builds this

- Exact wording throughout (button labels, guide copy, nudge message) —
  the content outline above is fixed in substance, but final phrasing
  should match the app's existing plain, unpatronizing tone (see
  `src/changelog.js` for calibration) and ideally get a real-phone look
  before considering it final, same caveat every other plan in this repo
  carries.
- Whether the four Screen C scales render as a single scrollable list or
  some other layout — a real-phone layout call, not fixed here.
- Exact visual treatment of the nudge highlight — reuse an existing
  emphasis pattern (see §5), but the specific implementation (CSS class,
  animation, placement of the dismiss buttons) needs an eye on a real
  screen.

## 10. Screen D — the guided "tick what you already know" walkthrough

Added 2026-09-06, after a learner reported (feedback issue #5, "Onboarding
flow improvements") that *"after selecting I know some kanji the flow to
selecting known kanji should be much more clearly guided. Preferably a
dedicated screen where I can go through all the units and mode til I'm
done."* Walking a fresh profile through the shipped flow confirmed three
distinct failures, all of them in §5's answer to "some of it":

1. **The offer was made and then not kept.** Screen C says the app "will
   offer to let you tick off exactly which, later on", then lands on the
   home screen. The offer existed only on one unit's set overview, three
   navigations in, with nothing on the route there naming it.
2. **The route there pointed the other way.** On the course screen a nudged,
   brand-new learner's accent-coloured button was "Learn 5 next", at the top
   of the screen; "✓ Mark as known…" was fourth in the ladder and below the
   fold, and the nudge card did not render on that screen at all. Learning
   from scratch is the one thing this learner should not have been doing
   first.
3. **The nudge was one unit, one mode, one shot.** `clearPlacementNudge`
   deletes a script's whole nudge the first time anything is marked, so
   kanji grades 2-6, Yomi and Writing were never offered, and kana got
   Reading but never Writing.

**What shipped.** A checklist screen (`screen-known-check`, built by
`renderKnownCheck()`), which is where "Start learning!" now lands whenever
any scale was answered "some". One card per unit, one row per mode inside
it, each row showing how much of that unit the mode has never asked about.
A row hands over to the set overview in select mode, on that mode's grid,
with a step bar ("Step 3 of 5 — Kanji · Grade 1, Definition") carrying two
exits; marking known ticks the row and returns to the list with the next one
already wearing the recommended-action colour. Nothing about claiming is
new — it is `markSelectedKnown` and `markKnownItems` throughout.

`profile.knownCheck` is `{ scripts, done, reach }`; `reach` is how many units
deep into kanji/vocabulary the learner has asked to go, defaulting to one and
growing one unit at a time from an explicit "＋ Also check …" row. §5's
per-overview nudge is unchanged and still runs — it is now the fallback for a
learner who left the list, not the whole of the answer.

Three entry points, none of them a gate: the end of the screener, a
home-screen card while the list has anything outstanding (which the sync
nudge yields to), and the course screen's own nudge card, which also makes
"Mark as known…" the ladder's recommended action and takes the accent off
both Learn buttons for as long as that script has a step waiting.

**§7 is still respected.** There is no Settings re-entry point and no way to
re-run the screener. The home card and the course nudge both disappear the
moment the list is finished or dropped, so nothing here is a permanent
"change my level" affordance — they are the same one-time flow, made
findable for as long as it is still unfinished.

Fixed alongside it: `state.onboardingAnswers` was never cleared on the way
out of the flow, and the screener only seeds it when it is null — so a
second learner created in the same sitting opened Screen C with the first
learner's answers already selected, and "Start learning!" would have claimed
a whole script for somebody who had never said they knew it.

## 11. The per-script offer and the sweep (supersedes §5 and §10)

Written 2026-09-07, after the app owner tried §10's checklist and reported it
"too onerous". Both earlier answers to "I know some of it" were wrong, in
opposite directions, and §11 is the correction:

- **§5** put the offer on ONE unit's set overview, in ONE mode, three
  navigations from the home screen. Findable only by accident.
- **§10** fixed the finding by putting a checklist of every unit and mode
  between the screener and the app. A learner who answered about kanji but
  installed the app to learn katakana had to dismiss a kanji screen to get
  started, and the checklist's per-unit rows still meant ticking one grade at
  a time.

**What ships instead.** The screener goes straight to `renderHome()`. Each
"some" answer arms `profile.knownCheck = { scripts, offered }`, and the offer
surfaces as a banner on that script's OWN course screen, in whichever mode is
selected — so it appears when the learner opens Kanji of their own accord,
and again when they switch to Yomi, and again for Writing. `offered` is keyed
`"<scriptId>|<mode>"`; `undefined` offers the sweep, `'swept'` owes the
follow-up line, `true` is finished. `startSession()` retires a `'swept'`, so
the follow-up line lasts exactly until its advice is taken.

**The sweep** (`screen-sweep`, `renderSweep*` in app.js) is the offer's
destination and the real change. One continuous list of the entire script in
teaching order, in two phases:

1. Tap the first item whose meaning/reading/writing you *don't* know.
   Everything before it goes green and is claimed on confirm. For a learner
   who did kanji in school order elsewhere this is one gesture for hundreds
   of characters, which no amount of per-unit ticking could match.
2. Tap any exceptions past that boundary, individually.

It then lands on the course screen with "Learn next" highlighted. The claim
tier follows `isSelfAssessable` exactly as the set overview's does — full for
Definition/Reading/Meaning, "I think I know this" (with the double-check note
shown under the button) for Yomi/Writing/Recall — and the button's own
wording changes to match, at the app owner's explicit request.

Units load one at a time, as the list is scrolled or from a "＋ Show <unit>"
button at the bottom. Vocabulary is 156 lazily-fetched units and kanji is
3,033 tiles; neither should be paid for by a learner who stops after one
screenful.

**Implementation notes worth keeping.** IntersectionObserver was tried first
for the load-on-scroll and produced no callbacks at all in an embedded
preview browser, with the sentinel plainly inside the viewport — hence the
plain scroll listener, and hence the "＋ Show <unit>" button being a real
button rather than a bare sentinel. Sweep tiles carry one click listener
each and deliberately not the set overview's `bindLongPress`, whose six
listeners each would be twenty thousand across a full kanji sweep.

Fixed alongside §10: `state.onboardingAnswers` was never cleared on the way
out of the flow, so a second learner created in the same sitting opened the
screener with the first learner's answers already selected.
