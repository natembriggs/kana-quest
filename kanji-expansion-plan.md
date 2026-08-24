# Kanji expansion — implementation plan

Status: phases 0-6 and 8 done (example-word ranking fix, study-list model and
scheduling, enrollment UI, review scope toggle, kanji search, lazy per-grade
data loading, all 2,136 jōyō kanji, and the beyond-jōyō "names & places" set),
plus two bug fixes (§4.3) and a placement test (§2.9) requested outside the
phase plan. Phase 7 (JLPT/frequency orderings) is next. Supersedes the kanji
bullet under *What is not built yet* in the README.

Three separable pieces of work, deliberately phased in this order:

1. **An explicit study list** — decide yourself which kanji you are learning
   and which of the three modes you want for each, instead of that being an
   implicit side effect of having been quizzed once.
2. **All 2,136 jōyō kanji**, up from the 1,026 elementary-school ones, which
   forces the data payload problem in §4.
3. **Orderings other than school grade** — JLPT level and raw frequency —
   with switching between them costing nothing.

The study list comes first because it is independent of the other two, is
the lowest-risk of the three, and is immediately useful on the kanji set that
already exists.

---

## 0. A bug found while investigating: example words are ranked badly

Not part of the three pieces above, but cheap, independent, and it improves
every one of the 1,026 kanji already shipped — so it goes first.

`choose_examples()` in `tools/build_kanji_data.py` ranks candidate example
words by **shortest reading**, on the theory that いち is a better first
example than いちばん. For 父 that produces:

```
  1 KEPT 義父 (ぎふ)   2k — father-in-law
  2 KEPT 祖父 (そふ)   2k — grandfather
  3 KEPT 父   (ちち)   2k — father
  4 KEPT 父子 (ふし)   2k — father and child
  ...
 19 cut  お父さん (おとうさん) 5k — father
```

The heuristic backfires: it keeps *father-in-law* and drops the single word a
child is most likely to already know. Length is a poor proxy for familiarity.

**Fix:** rank by actual commonness first, length only as a tiebreak. JMdict
already carries this — the `nf##` priority band, in units of 500 words by
corpus frequency. お父さん is `nf07` (top ~3,500 words); 義父 has no `nf`
band at all. Parse `<ke_pri>`/`<re_pri>`, sort by band ascending with
unbanded entries last, then by reading length.

This is a one-function change plus a regeneration of `kanji-data.js`, and it
silently improves example words across the whole set. Worth doing before
anything below multiplies the data by 2×.

**It does not fix the other half of the same report:** 父 has no とう
reading, and it never can. KANJIDIC lists exactly `ja_on: フ` and
`ja_kun: ちち` for it. とう exists only inside the fixed compounds 父さん /
お父さん — it is a property of those words, not of the character. The
aligner in `build_kanji_data.py` actually *does* resolve お父さん → 父 = とう
using its wildcard (the same one that makes 上海 → シャン work), and then
`credited_reading()` correctly rejects it because とう is not one of 父's own
listed readings. Quizzing readings KANJIDIC does not attest would undermine
the whole reading quiz, so this stays as it is.

---

## 1. The study list

### 1.1 What is wrong with the current model

There is no study list. "Am I learning this kanji?" is answered by *does a
progress record exist for it*, which conflates two different things:

- **Intent** — I have chosen to learn this.
- **History** — I have been quizzed on this at least once.

That is why there is currently no way to add a kanji you care about, no way
to drop one you do not, and no way to say "I want to be able to *write* 龍
but I do not care about its readings."

### 1.2 The model

One new field on the profile:

```js
study: {
  "漢": ["definition", "recognition", "writing"],
  "龍": ["writing"],
}
```

Absent key, or empty array, means not being studied. The three mode ids are
the existing ones from `MODES` in `srs.js` (`recognition` is Yomi).

Three states per (kanji, mode), which is what the detail screen surfaces:

| State | Condition | Meaning |
| --- | --- | --- |
| Not studying | not in `study`, or mode not listed | Never appears in any session |
| Waiting to learn | enrolled, no progress record | Queued to be taught |
| Learning | enrolled, has a progress record | On the review schedule |

**Progress records are never deleted when un-enrolling.** History is the real
record — that is already this app's stated position (see the header comment
in `srs.js`) — so removing a kanji and re-adding it a month later resumes
where it left off rather than starting from zero.

**Shape changed 2026-08-24** (sync-plan.md §0.1): each mode's value is now
the timestamp it was enrolled, not just its presence in an array —
`"龍": {"writing": 1756...}` rather than `"龍": ["writing"]` — and a second
field, `unstudy`, holds the same shape for deliberate removals. A plain
union (this section's original design) can only ever add; the two-way,
timestamped version exists so un-enrolling a kanji actually survives a sync
merge instead of being silently undone by a device that still shows it
enrolled. `isStudying`/`setStudying`/etc. in `srs.js` still read as
described above — nothing that reads through them changed.

### 1.3 Migration

Profiles saved before this field exists have no `study`. On load, if
`study === undefined`, derive it from the progress keys: every `mode:kanji`
record enrolls that mode for that kanji. From then on `study` is
authoritative and is never re-derived.

`undefined` is the trigger, not falsiness — `{}` is a legitimate state (you
removed everything) and must not re-populate itself from history on the next
load.

This is the first real migration in the codebase; `strictness` and
`writingModePreference` both got away with a read-time fallback. A fallback
cannot work here, because "no entry" and "deliberately removed" have to be
distinguishable.

### 1.4 Kana are not affected

The study list is kanji-only. Kana courses are small, complete, and taught in
a fixed order; an enrollment UI over 104 characters would be noise. Kana keep
the current implicit model. The code path is shared, so kana simply behave as
though every character is enrolled in every applicable mode.

### 1.5 The pool refactor

Every function in `srs.js` currently derives its item list from
`course.chunks` via `allItems(course, mode)`. Reviewing across the whole
study list means reviewing across *several* courses (grades), which that
shape cannot express.

The change is smaller than it looks: nothing about the signatures needs to
move, because a course is already almost exactly the right shape. Introduce a
**pool** — anything with `.chunks` and `.excludeForMode` — and build a
synthetic single-chunk pool for the study list:

```js
{ id: 'study-list', chunks: [{ items: [...enrolled] }], excludeForMode }
```

`buildSession`, `dueItems`, `practiceItems` and `courseStats` then work
unchanged over either. `currentSetIndex` and `readyForMore` are meaningless
for a single-chunk synthetic pool, but they are only read by the course
screen, which never renders in study-list scope.

`excludeForMode` still matters and must be carried through: a handful of
kanji (媛/栃/茨 and friends) have no reading that appears in any common word,
so they have no Yomi question to ask even if you enroll them in it.

### 1.6 What "Add 5 more" becomes

Currently it teaches the next 5 never-seen kanji in course order. It keeps
doing exactly that, but now it also **enrolls** them — so the study list
stays an accurate description of what you are working on without you having
to curate it by hand.

`newItems()` splits into two ideas:

- `pendingItems(pool, mode, study, progress)` — enrolled but never taught.
  Manually-added kanji land here.
- `enrollNext(course, mode, study, n)` — enroll the next `n` unenrolled kanji
  in course order.

"Add 5 more" is `enrollNext(5)` followed by a `new` session over what is
pending. If you have manually added kanji, they are already pending, so the
course card can offer **Learn 3 waiting** before offering to add more —
otherwise manually adding a kanji would appear to do nothing until you
happened to reach it in grade order.

---

### 1.7 How phase 1 actually landed

Close to the design above, with one deliberate scope change and one piece of
the refactor that turned out to be much cheaper than expected.

**The pool refactor was almost free.** No signature moved. Every scheduling
function already took `(course, mode, progress)`, and the only change needed
was to accept *either* a whole profile or a bare progress map — `asContext()`
in `srs.js` normalises the two. A bare map means "no study list", which
switches enrollment filtering off and reproduces the original behaviour
exactly. That is what let ~20 existing pure tests, and all of kana, keep
working untouched instead of being rewritten. A study-list pool really is
just `{ chunks: [{ items }], excludeForMode }`, as §1.5 predicted.

**Enrollment filtering shipped in phase 1, not phase 2.** The plan put it
with the UI, on the grounds that nothing can un-enroll until there is a
button. But `newItems()` had to change to mean *pending* in the same breath,
and leaving those two out of step would have meant "Add 5 more" silently
returning nothing the moment migration ran. Doing both together also leaves
phase 2 as pure UI, which is a better seam. The consequence is that
`courseStats()` grew `pending` and `unenrolled` counts now rather than later;
`fresh` is unchanged and still equals `pending + unenrolled`.

**`startSession` is where "add more" enrolls.** For `kind === 'new'` it tops
up the study list only as far as the session cap, and only if fewer than that
many are already waiting — so a kanji added by hand from the detail screen
gets taught first, and course order fills whatever is left. Kana fall through
untouched, since `enrollNext` only ever enrolls kanji characters.

## 2. Screens

### 2.1 Character detail — the enrollment screen

Reached from the set overview (already) and from the session summary (new,
§2.3). Gains, above the existing stroke diagram and readings:

- The current state as a **button**, not a label: *Not studying* → tap to
  start; *Learning* / *Waiting to learn* → tap to stop. This replaces the
  passive mastery text that is there now, which becomes a subtitle.
- Three per-mode toggles — **Definition / Yomi / Writing** — each showing its
  own state, since the three schedules are genuinely independent. The
  headline button is the roll-up: enrolling turns on whichever modes apply to
  that kanji (all three, minus anything `excludeForMode` rules out),
  un-enrolling turns off all three.

Per-mode mastery is already tracked separately and already displayed
elsewhere; this is the first screen where it becomes editable.

### 2.2 Search

A search field on the kanji course screen, so a kanji can be found without
knowing which grade it is in. Matches on the character itself, on any English
meaning, and on any reading (kana or romaji, via `wanakana`). Results are the
same tiles as the overview grid, tapping through to the detail screen — so
search is purely a way *into* §2.1, with no enrollment UI of its own to keep
in sync.

### 2.3 Summary chips become links

The end-of-session summary already renders one chip per character with its
reading or meaning. Each becomes tappable, opening the detail screen for that
kanji — which is exactly where you want to go after seeing you missed
something, and now also where you would go to drop it or add writing practice
for it. Back returns to the summary rather than the course screen.

### 2.4 Review scope

Where the course screen currently offers **Review N**, it offers a scope
alongside it:

- **This set** — the current grade/level, as now.
- **Everything I'm studying** — the whole study list, across all grades.

Implemented as the pool choice from §1.5, so it is one argument, not a second
code path. The count next to each updates to match. Scope is remembered per
profile, like `writingModePreference`.

### 2.5 How §2.1 and §2.3 actually landed

Both shipped as designed, with the enrollment UI slightly simpler than
drafted: one headline button (bulk enroll/un-enroll every applicable mode)
above three independent per-mode toggles, rather than the button also trying
to summarise per-mode state in its own text — the three toggles already show
that directly, so the button only ever needs to say one of "Not studying",
"Waiting to learn", or "Learning".

The mastery label (`#detail-mastery`) was **not** repurposed into a subtitle
as originally drafted — it still shows the tier for whichever mode the
learner currently has selected on the course screen (`state.mode`), which
stayed independently useful, and conflating it with per-mode enrollment
state would have made one element try to mean two things. The two sit
stacked instead: mastery-for-current-mode above, the enrollment block below.

Getting to summary chips required one small structural change beyond §2.3
itself: the detail screen's back button had a single hardcoded destination
(the overview). It now remembers where it was opened from
(`state.detailReturn`, set by `openCharacterDetail()`'s new `returnTo`
parameter) and the action was renamed `go-overview` → `detail-back` to match
that it no longer always does that.

### 2.6 Two gaps found immediately after phase 2 shipped

Both reported from actually using it, both fixed the same day.

**The overview couldn't show "enrolled but not taught."** `masteryTier()`
only reads a progress record's box, and enrolling doesn't create one — so a
kanji just added from the detail screen looked exactly like one that had
never been touched at all, tier-0 either way. There isn't a clean way to
fold this into the tier ramp itself (tiers 0-4 are entirely about *progress*,
and "enrolled" is orthogonal to that — a fifth colour would have implied a
mastery level that doesn't exist yet). Overview tiles instead get an
`is-pending` class — a dashed accent-coloured border over the ordinary
tier-0 fill — computed as `tier === 0 && isStudying(study, item, mode)`,
which is exactly the condition that only a manual add can produce.

**Nothing let you act on a kanji the moment you enrolled it.** Newly-added
kanji correctly went into the pending queue, but the only way to actually
learn one was "Add more," which teaches from course order and might reach
several other pending kanji first. `startSession()` gained an optional
`items` parameter — when given, it bypasses course order and the enrollment
top-up entirely and just teaches/quizzes exactly that list. The detail
screen's new **Study it now** button calls it with `[char]`, and is shown
only when the kanji is enrolled-but-untaught *in whichever mode the learner
is currently browsing under* (`state.mode`) — a session can only run in one
mode at a time, so the button has to pick one, and the mode already implied
by how you got to this screen is the least surprising choice.

### 2.7 How phase 3 actually landed

Both pieces shipped roughly as designed, with one addition each.

**The review-scope pool needed a real cross-grade `kanjiInfo` lookup, not
just a cross-grade item list.** §1.5's synthetic pool
(`{ chunks: [{ items }], excludeForMode }`) is enough to *schedule* a
session — `dueItems`/`buildSession` only ever need `.chunks` — but
*rendering* one (quiz questions, lesson cards, summary chips) calls
`kanjiInfo(course, kanji)`, which reads `course.index`, and no single
grade's own index covers kanji from other grades. `studyListPool()` in
`app.js` therefore also carries a merged `index` — every `KANJI_COURSES[i]
.index` unioned into one `Map`, built lazily and cached (kyōiku kanji never
repeat across grades, so the union is exact and cheap: 1,026 entries, once).
The item list itself is rebuilt fresh on every lookup rather than cached
alongside it, so it can never go stale mid-session.

`excludeForMode` on the synthetic pool is deliberately left empty rather
than also merged — a kanji excluded from a mode can never be enrolled in it
to begin with (`applicableStudyModes()` hides that toggle), so nothing that
could ever reach this pool needs excluding.

**"Add more" needed a kana-specific carve-out for the new "Learn N waiting"
wording.** `stats.pending` (added in phase 1) is only a meaningful "you
chose this" signal for kanji — kana has no enrollment step, so every
never-seen kana counts as "pending" under the same definition, and without
gating on `course.kind === 'kanji'` the kana course card showed "Learn 5
waiting" for kana nobody had ever touched, which is exactly backwards. This
surfaced immediately in `test/wiring.js`, since the very first check in the
whole suite looks for an "add more" button by matching the word "more" in
its label.

### 2.8 How phase 4 actually landed

As designed, plus the tile-building code got a real refactor rather than a
copy-paste: the set overview's per-tile logic (mastery colour, the pending
marker from §2.6, the click handler) moved into a shared
`buildMasteryTile(course, item, returnTo)`, so search results and the
overview are provably the same tile rather than two implementations that
could quietly drift apart. The one new parameter, `returnTo`, exists because
search results and overview tiles now disagree about where "back" should
go — see below.

**Matching is entirely romaji-normalised, in both directions.** Both the
query and every candidate reading are run through `wanakana.toRomaji()`
before comparing, which is a no-op on text that's already romaji. That one
rule handles kana-typed queries, romaji-typed queries, on'yomi (stored as
katakana) and kun'yomi (hiragana, with `.`/`-` stripped for okurigana
markers) uniformly, without needing to detect which script anything is in
first.

**Search needed its own cross-grade `course.index`**, reusing exactly the
merged index built for §2.4's review pool (`allKanjiIndex()`) rather than
duplicating it — the two features turned out to share the same underlying
problem (something that can't assume a single grade) even though they don't
otherwise overlap. A small new helper, `kanjiCourseFor(char)`, finds which
grade's own course object a matched character actually belongs to, since
`openCharacterDetail()` needs a real course for `kanjiInfo()` to resolve
later, not just the merged index.

**The detail screen's `returnTo` grew a third destination, `'course'`.**
Opening a search result and backing out returns to the course screen with
the query still in the box (the `<input>` element is never removed from the
DOM, only hidden, so its value simply survives) — not the set overview,
which would be a different grade's overview for most search results and
therefore the wrong screen entirely.

**An active search visually replaces the grade card, not just supplements
it.** Grade picker, review-scope picker, and writing-mode picker all step
aside while a query is active, since none of them describe something that
spans every grade the way search results do — showing them alongside search
results would silently imply the results were scoped to whichever grade
happened to be selected, which is exactly backwards from the point of not
needing to know that in the first place.

### 2.9 Placement test: "test out" of items an existing learner already knows

Requested directly, outside the phase plan: an existing learner picking this
app up mid-way through their own study shouldn't have to sit through a
lesson card for every item they already know just to get it correctly
scheduled. A button, right of **View set overview** on the course card, both
kana and kanji: **🎯 Test unlearned**, drawing on every never-seen item in
the current unit (grade/sub-unit, or the kana script itself).

- **Unlimited, on purpose.** "No reason to do just 5 if you're not
  learning" — the quiz covers every never-seen item in the unit in one go,
  not a session-sized batch the way "Add more" caps ordinary teaching. The
  learner stops whenever they want via the ordinary quit action; nothing
  about the session itself is capped.
- **No lesson step.** `buildSession`'s `'placement'` kind returns
  `{ lesson: [], quiz: neverSeenItems(...) }` — straight to the quiz, nothing
  shown first, and (unlike every other session kind) not shuffled: teaching
  order shows where a learner's knowledge actually runs out, which a
  scattered order would blur. For Writing mode specifically this also forces
  the session's sub-mode to **Free**, overriding even a fixed Trace/Guided
  preference: Trace shows the whole character before a stroke is drawn and
  Guided reveals each stroke the instant it's accepted, both of which defeat
  "without being shown the answers first." The learner can still switch away
  mid-attempt via the ordinary toggle.
- **A correct answer jumps straight to the top box**, not the usual
  one-box-at-a-time climb — `grade()` (kana/Definition/Writing) and
  `gradeYomi()` (per-reading Yomi records, which `recomputeKanjiRollup`
  aggregates as `min(streak, MAX_BOX)`) both gained a `{ placement }` option
  that does this on a hit; a miss is graded exactly like an ordinary first
  miss either way — testing something you don't actually know should just
  start it normally, at box 0, not somehow be worse than never testing it.
  `session.placementTest` carries the flag from `startSession()` through to
  `recordResult()`/`recordYomiResult()`.

#### 2.9.1 A bug from real use: enrolling the whole batch upfront was wrong

Shipped first the way "Add more" does it: `enrollNext(..., Infinity)` in
`startSession()`, enrolling every never-seen kanji in the unit into `study`
*before* the first question even rendered. Reported immediately: quitting
after one kanji left every OTHER kanji in that unit marked "waiting to
learn" in the overview, despite never having been shown, let alone
attempted. The fix (per the report): **"only the ones I actually try — click
an answer, or write at least one stroke — count as tried."**

This meant reversing the enrollment model, not just tuning it:

- **`neverSeenItems(course, mode, ctx)`**, new in `srs.js`, is the pool a
  placement session's quiz now draws from — every item with no progress
  record yet, *regardless of enrollment*. Unlike `pendingItems` (which
  requires a kanji to already be `isStudying` before it counts as
  "pending"), this can reach a kanji that was never enrolled at all, which
  is the whole point: nothing gets enrolled until it is actually attempted.
- **`startSession()` no longer enrolls anything for `kind === 'placement'`.**
  The quiz queue is built entirely from `neverSeenItems`, untouched by
  enrollment.
- **`ensurePlacementEnrolled(item)`**, new in `app.js`, enrolls exactly one
  item, called from wherever "actually tried" happens per mode:
  `recordResult()`/`recordYomiResult()` (a choice was clicked — grading
  happens in the same breath there, so this is also where Definition/Yomi/
  kana enrollment happens) and `writingPointerUp()` (a real stroke was
  drawn — even one that gets rejected in Trace/Guided counts, matching
  "write at least one stroke," but merely having the question on screen does
  not). Idempotent and a no-op for kana (no study list to enroll into) or
  outside a placement session, so it costs nothing to call defensively from
  both `recordResult` and the stroke handler for Writing.
- **The button lost its count.** It used to read "Test *N* unlearned," where
  *N* was how many would be enrolled by tapping it — accurate under the old
  upfront-enrollment model, dishonest under this one, since tapping the
  button no longer enrolls anything by itself. It now just reads "Test
  unlearned."
- **Kana gained the same button** in the same pass, since the fix happened
  to make it nearly free: kana has no study list, so `neverSeenItems` for a
  kana course is identical to "no progress record yet" with no enrollment
  concept in play at all — the button only needed the `course.kind ===
  'kanji'` UI gate removed, nothing in the session/grading logic changed.

#### 2.9.2 A second report: a miss shouldn't come back later in the SAME test

Requested directly: "gauge my level" and "review what I don't know" are
different activities, and the placement test was quietly doing the second
one. `chooseAnswer()`'s single-answer path and `markKanjiError()`'s Yomi
multi-select path both reinsert a missed item a few questions ahead
(`session.queue.splice(...)`) so it comes back for another attempt later in
the *same* session — sensible for `new`/`review`/`practice`, where the point
is to actually learn the thing, but backwards for a placement test: if a
learner knows 20% of a unit, they end up sitting through most of the other
80% a second time just to finish, when the entire point of "test unlearned"
was to find out *quickly* what they don't know yet, not to be taught it on
the spot.

**Fix:** both reinsert sites now check `session.placementTest` first and
skip the splice entirely when true. Nothing else about grading changes — a
miss is still graded as an ordinary first miss (unaffected by this, see
§2.9's `placement` option), it just doesn't get a second appearance in the
queue. Verified structurally: running a placement test to completion visits
every never-seen item in the unit exactly once, whether answered right or
wrong.

**The other half: testing shouldn't be a dead end.** A test that finds gaps
and then does nothing with that information just moved the "now what"
question to the learner. The session summary (§2.3) already lists every
character attempted with a right/wrong chip; `finishSession()` now also
collects the wrong ones into `state.summaryMissed` when `session.
placementTest` is true, and a new button — **Study *N* missed**, shown above
the existing "Add more"/"Review due" pair and carrying the primary style
whenever it's offered — starts an ordinary `'new'`-kind session over exactly
that list (`startSession(courseId, 'new', state.summaryMissed)`). Passing
`kind: 'new'` rather than `'placement'` is what makes this a real teaching
session: lesson cards first (unlike a placement test, which has none), and
ordinary box-by-box grading (unlike a placement-test correct answer's jump
to the top box) — appropriate now that the point actively is to learn these,
not test them. Every character reaching this button was already enrolled by
`ensurePlacementEnrolled()` the moment it was first attempted (§2.9.1), so
`startSession`'s `items` path — "teach and quiz exactly this list, caller
guarantees enrollment" — applies unchanged; no new enrollment logic was
needed.

#### 2.9.3 A third report: the whole app, not just placement, should work this way

Requested directly, and broader than §2.9.2 originally scoped it: silently
reinserting a miss mid-session isn't only wrong for a placement test — an
ordinary `new`/`review`/`practice` session doing it meant the visible
"N of M" progress counter could credit a not-yet-resolved miss as done, and
a miss just vanished back into the flow with no visible acknowledgement that
it would need another look. The fix generalizes §2.9.2's placement-only
behaviour to every session kind:

- **The `session.placementTest` guard around both reinsert sites
  (`chooseAnswer()`, `markKanjiError()`) is gone outright** — a miss never
  reinserts, full stop, regardless of session kind. `session.queue` is now
  always exactly the original, distinct item list; `sessionProgress()` (the
  shared counter helper) simplifies back down to plain
  `{ done: session.position, total: session.total }`, since the "distinct
  characters still pending a repeat" complication it existed for can no
  longer happen.
- **`state.summaryMissed` in `finishSession()` is computed for every
  session**, not gated on `session.placementTest` — any miss, from any
  session kind, surfaces on the summary.
- **The follow-up action now branches on what the misses actually need.**
  A placement miss was never taught at all, so it still gets the lesson
  step (`kind: 'new'`, unchanged from §2.9.2). Everything else was already
  taught — either moments earlier in the same session's own lesson step, or
  long before — so re-showing a "new character" card would be redundant;
  those go straight to a quiz-only `'practice'` session instead.
  `startSession()` gained a `{ skipLesson }` option for this (the `items`
  branch normally always includes a lesson step); `state.
  summaryMissedIsPlacement`, captured alongside `state.summaryMissed`,
  is what the 'study-missed' action switches on to pick kind + skipLesson.
- **Button wording follows the same split**: "Study N missed" (placement,
  since it teaches) vs. "Practise N missed" (everything else, since it
  doesn't) — both still outrank "Learn N new" as the summary's primary
  action whenever anything was missed, exactly as §2.9.2 already had it for
  placement alone.
- **"Add N more" became "Learn N new"** (course card and summary alike):
  "Add" read as accumulation, not learning, and didn't match "Learn N
  waiting" (the manual-add variant) or the quick-action "Learn N next" it
  sits next to.

---

## 3. Orderings

### 3.1 Progress is already ordering-independent

The single most important fact for this whole section: progress is keyed
`mode:kanji` — never by course, grade, or position. Switching from grade
order to JLPT order therefore cannot lose or reshuffle anything already
learned; the same records simply get grouped differently. Nothing about the
storage format needs to change.

What a "course" becomes is a *view*: an ordering plus a chunking of the same
underlying kanji set.

### 3.2 The three orderings

| Ordering | Source | Units |
| --- | --- | --- |
| School grade | KANJIDIC `<grade>` | 1–6, then "secondary" (grade 8 = the rest of jōyō) |
| JLPT level | Community list (§3.3) | N5 → N1 |
| Frequency | KANJIDIC `<freq>` | Bands of 100 or 250 |

Sets of 5 stay the chunking unit within whichever ordering is active.

### 3.3 JLPT needs a data file, and it will not be official

KANJIDIC carries only the **pre-2010 JLPT**, a 4-level scheme (levels 4/3/2/1,
2,230 kanji tagged) that was retired when the exam moved to N5–N1 in 2010.
The modern JLPT has published **no official kanji list at all** since then —
this is a deliberate policy of the organisers, not a gap in KANJIDIC.

So the N5–N1 grouping will be community-derived, as it is in every other app
that offers one. It ships as a committed data file (roughly 2,200
kanji → level), since unlike everything else in `kanji-data.js` it cannot be
derived from the sources in `tools/data_src/`. The README and the level
picker should both say plainly that the levels are estimates.

Rejected alternative: relabelling the old levels (4→N5, 3→N4, 2→N2, 1→N1).
It needs no new data, but it produces no N3 at all and the bands are badly
lumpy — 1,207 kanji in old-level 1 alone. Worse than an unofficial list that
is at least the right shape.

### 3.4 Robustness to switching

The ordering picker sits next to the existing mode picker. Switching it
re-groups the same kanji and the same records; the only per-ordering state is
which unit you are currently on, stored per ordering so switching to JLPT and
back does not lose your place in grade order.

---

## 4. The data problem

Doubling the kanji count runs straight into a payload wall that is already
close:

| File | Now | 2,136 jōyō | + beyond-jōyō (§5) |
| --- | --- | --- | --- |
| `kanji-data.js` | 1,210 KB (1,026 kanji) | ~2.5 MB | ~3.1 MB |
| `stroke-data.js` | 897 KB (1,174 chars) | ~1.7 MB | ~2.1 MB |

That is roughly **5 MB of JavaScript**, all of it currently listed in the
service worker's `SHELL` and precached on install, and all of it parsed at
startup because `kanji.js` builds every course eagerly at module load.

**Both files get split per unit and loaded on demand** (`import()` per grade
or level), with the service worker caching chunks as they are fetched rather
than precaching all of them. `KANJI_COURSES` stops being a module-level
`const` and becomes something async, which is the main non-obvious cost of
this phase — `renderCourse`, `courseStats`, the overview grid and the summary
all currently assume the whole set is in memory synchronously.

Stroke data splits the same way and is only ever needed for the character
actually on screen, so it is the easier of the two.

This work is why the data expansion is phased *after* the study list despite
being the headline request: it is the part most likely to go wrong, and the
study list is worth having whether or not this lands cleanly.

### 4.1 How phase 5 actually landed

Close to the design above, with `KANJI_COURSES` staying a synchronous
module-level `const` after all — the part flagged above as "the main
non-obvious cost" turned out to be avoidable by splitting what a course
*needs* into two tiers rather than splitting the course object itself:

**A tiny always-loaded manifest carries everything `renderCourse`,
`courseStats`, the grade picker and the overview grid actually touch** —
each grade's ordered character list, and (new, not in the original design)
which characters have no quizzable Yomi reading. That second field matters
because `srs.js` reads `excludeForMode` during scheduling, before a grade's
real data may ever have loaded; moving it into the manifest means every one
of those screens stays exactly as synchronous as it always was — none of
them needed touching. `KANJI_COURSES` is built from the manifest at module
load, same ids/chunks/teaching order as before; each course's `.index` Map
just starts empty.

**Only three call sites in `app.js` actually need a grade's heavy per-kanji
data and became `async`**: `openCharacterDetail`, `startSession` (which
resolves every grade touched by the session's item list — the "everything
I'm studying" pool can span several at once), and kanji search on its first
non-empty query (which needs every grade, since it doesn't know which one to
look in). Each awaits `ensureKanjiUnitLoaded`/`ensureStrokeUnitLoaded`
(`kanji.js`/`strokes.js`, both memoized dynamic `import()`s) before running
its existing render code unchanged. A small "Loading…" pill appears only if
a fetch takes long enough to notice.

**Stale-response guard.** An async screen transition can be overtaken by a
faster one — tap a kanji tile, then tap "back" before its data finishes
loading. A single `navSeq` counter, bumped inside `show()` (the one function
every navigation path already runs through), lets both async call sites
detect "the user has moved on" generically and skip rendering rather than
forcing a stale screen onto someone who has already left it.

Both files split one-for-one by grade (`kanji-grade-N.js` / `stroke-grade-N.js`
under a new `src/data/`), plus the manifest and an always-loaded
`stroke-kana.js` (kana strokes are needed by every writing screen,
kanji or kana, so there is no reason to lazy-load them). Verified
content-neutral against the previous monolithic files before deleting them —
same 1,026 kanji, same readings/meanings/examples/stroke paths, just
re-chunked.

### 4.2 How phase 6 actually landed

As designed — all 2,136 jōyō kanji, on top of phase 5's lazy loading, with
zero further architectural change needed. Verified against the downloaded
KANJIDIC2 source that grades 1-6 + grade 8 sum to exactly 2,136 — **the count
was right, the set wasn't quite**; see §4.3.

**§8's open question is resolved: grade 8 ships sub-divided, not as one flat
unit.** At 1,110 kanji, KANJIDIC's grade 8 alone is over half the jōyō set —
one lazy-loaded chunk that size, and a 222-set course with a meaningless "N
sets left" counter, was judged worse than a small amount of extra work now.
`build_kanji_data.py` splits it into six ~185-kanji sub-units
(`8-1`..`8-6`) by KANJIDIC's own newspaper-frequency rank — most useful
first, unranked kanji last — the same signal §3.2 already earmarked for the
frequency ordering in phase 7. Each sub-unit is a fully independent teaching
unit and lazy-loaded chunk, with its own grade-picker tile
("Secondary 1".."Secondary 6"); `kanji.js`'s unit-key handling
(`compareUnits`, `unitLabel`) was written generically enough from phase 5
that a dash-separated sub-unit key needed no special-casing beyond the label
formatter.

**`state.grade` (a plain number) generalizes to `state.kanjiUnit` (a unit-key
string).** The only other `app.js` changes were `KANJI_GRADES` becoming
`KANJI_UNIT_IDS` (derived from `KANJI_COURSES` itself, not hardcoded numbers)
and the grade-picker badge text (`unitBadge`: `"1"`.."6" as-is, `"8-N"` →
`"SN"`, short enough for the same tile size). Nothing about the lazy-loading
mechanism itself changed — a secondary sub-unit loads exactly the way an
elementary grade does.

**Word alignment now runs against the full 2,136-kanji "known" set, not just
the grades being built** — `parse_jmdict_words()`'s `known_kanji` parameter
was already grade-agnostic, so grades 1-6 pick up a few more/better example
words than phase 5's byte-identical output (more kanji are "known," so more
compound words qualify), which is expected and not a regression: only §0's
ranking logic and the grade/reading data itself were ever meant to stay
frozen, not the word pool a wider vocabulary naturally draws from.

The unquizzable-Yomi set grew from 3 to 30 kanji (still a small fraction of
2,136) — treated as expected at the time, since secondary jōyō includes many
more obscure characters whose only common uses are as name/place components.
**That call is reversed in §4.3: every kanji now has at least one quizzable
reading, that 30 included.**

### 4.3 Two bugs found from a user report: 叱 (しかる, "to scold") had no yomi

Both bugs, and the fix for each, in `tools/build_kanji_data.py`:

**Bug 1 — four jōyō kanji were being taught at the wrong Unicode code
point.** A handful of jōyō kanji exist at two code points: the one
KANJIDIC's `<grade>` field tags as jōyō (a legacy pre-Unicode-consolidation
glyph form), and a second, visually near-identical one that is what every
IME, font, and real dictionary entry actually uses. 叱 was the reported
case — KANJIDIC grades 𠮟 (U+20B9F) as jōyō, but 叱る (U+53F1) is the
everyday spelling, and JMdict's word list lives almost entirely on the
everyday form: 𠮟 has **zero** JMdict entries, so no word could ever align
to it. The same split exists for 剝/剥 (peel), 塡/填 (fill), and 頰/頬
(cheek). Confirmed against the downloaded sources that both code points in
every pair have KanjiVG stroke data, so which one gets taught was free to
change. `UNICODE_VARIANT_SUBSTITUTIONS` transplants the `grade` tag from the
rare code point onto the common one before anything else runs — the common
code point's own KANJIDIC entry (on/kun/meanings) is used as-is, and the
rare entry is kept in `kanjidic` (for word alignment on the off chance some
unrelated word uses it as a non-target character) but permanently loses the
grade tag, so it can never be taught again. This is also why the §4.2 count
check was a false positive: 2,136 was always the right total, because the
four missing (common) code points and the four wrongly-included (rare) ones
canceled out in the sum.

Found by diffing the shipped 2,136-character set against an independent
plaintext jōyō list
([gist](https://gist.github.com/fasiha/4988a6701487d28d5b12d22af6593f67)) —
a `count == 2136` check can never catch a same-size wrong SET, which is
exactly what happened here.

**Bug 2 — 30 kanji (§4.2) had no quizzable reading at all, by design, and
that design was wrong.** `excludeForMode` was built specifically to handle
this: a reading with no JMdict-common word backing it got silently dropped,
and a kanji left with zero readings got excluded from Yomi entirely. Correct
per the original spec (`quiz_readings` was never meant to include a reading
with no example to show), but the user's report reframed the requirement:
every kanji should have *something* to quiz, and a reading whose only
example is obscure beats a reading nobody can ever be asked about.

Fix: after the normal common-word pass, collect whichever kanji still ended
up with zero quiz readings (four fewer than before, once bug 1 is fixed),
and run one more pass over JMdict for just that small set, with the
common-word (`ke_pri`/`re_pri`) gate dropped. `parse_jmdict_words` gained
two parameters for this — `require_priority` (the gate itself) and
`targets` (which kanji are worth aligning a word to at all) — rather than a
second, duplicated scanning function. Restricting `targets` to the ~20-30
kanji that need it, instead of relaxing the gate for the full 218K-entry
JMdict pass, is what keeps this cheap: the `kanji_in_word & targets` check
still throws out the vast majority of entries before the expensive part
(`align_word`'s backtracking search) ever runs. Measured: +0.4s on a ~2.5s
full build. `NO_YOMI_CHARS` in the manifest is now empty, and
`excludeForMode`'s Yomi-exclusion path is consequently dead code that
nothing currently populates — left in place rather than removed, since nothing
guarantees some future data refresh won't produce a genuinely unfixable
case.

Both bugs required regenerating `stroke-*.js` too (`build_stroke_data.py`
reads its character list from the manifest `build_kanji_data.py` just
wrote), since bug 1 changes which literal characters are taught.

### 4.4 A third bug, found while building phase 8: the uncommon-word fallback could clobber an unrelated kanji's good example with an inappropriate one

Not from a user report this time — caught by diffing phase 8's regenerated
jōyō-grade files against their previous, unrelated-in-principle content
before committing, on the theory that grades 1-6/8 shouldn't change at all
from adding a new unit group. They did: ~600 `readingExamples` entries
changed across grades 1-6/8 alone.

**The bug.** §4.3's uncommon-word fallback pass (`needs_uncommon` /
`parse_jmdict_words(..., targets=needs_uncommon)`) finds words for kanji with
zero common-word-backed reading by dropping the priority-tag gate. Its
`targets` parameter controls which *words are attempted* (`kanji_in_word &
targets` must be non-empty) — but `align_word` credits **every** kanji in
that word, not just the target one. For 三十日 (a real fallback candidate for
a genuinely needy neighbour elsewhere in the word), the merge step —

```python
for kanji, readings in uncommon_by_reading.items():
    words_by_reading.setdefault(kanji, {}).update(readings)
```

— iterated every kanji `uncommon_by_reading` happened to touch, not just the
ones actually in `needs_uncommon`, and `.update()` unconditionally
overwrote that kanji's existing, perfectly good, common-word-backed entry
for that reading with whatever the no-priority-gate pass found instead —
which, priority-tag dropped, is frequently a far worse pick. Concretely: 六's
reading example became 六淫 ("six lascivious/pathogenic factors," a TCM
term), 手's became 手淫 (masturbation), 声's became 淫声, 心's became 淫心 —
`淫` ("lewd, obscene") is not a character any of grades 1-6's own kanji
should ever surface, and it was showing up as the reading example for
grade-1 六/手/声/心 purely because those kanji happened to share a JMdict
entry with some unrelated needy kanji.

**Why phase 8 exposed it rather than caused it.** The bug is in `parse_
jmdict_words`/the merge loop, not in anything phase 8 added — `needs_uncommon`
already existed and was already non-empty (26 kanji, per §4.3) in the
pre-phase-8 codebase, so this was already live and already capable of
corrupting a jōyō reading example before any of phase 8's code existed. It
just wasn't *caught*, because nobody had diffed a full regeneration against
the previous one since §4.3 shipped — every previous kanji-data change also
changed which characters were being taught, so "did an unrelated kanji's
example silently get worse" was never a meaningful diff to check. Phase 8
adding ~900 new candidate kanji to `needs_uncommon` (523, up from 26) made
the blast radius large enough (~600 changed entries, several genuinely
inappropriate for the app's audience) to be obvious on inspection, but the
mechanism was already there.

**Fix:** skip any kanji in the merge loop that isn't actually in
`needs_uncommon`:

```python
for kanji, readings in uncommon_by_reading.items():
    if kanji not in needs_uncommon:
        continue
    words_by_reading.setdefault(kanji, {}).update(readings)
```

Safe unconditionally for a kanji genuinely in `needs_uncommon`, since by that
set's own definition every one of its readings had zero backing beforehand —
there is nothing there to clobber. Verified afterward: regenerating with this
fix produces **zero** diff in grades 1-6/8 versus a jōyō-only (no beyond-jōyō
set at all) run, i.e. the fix fully isolates the fallback pass's effect to
kanji that actually needed it, exactly as originally intended.

---

## 5. Beyond jōyō

Adding "common kanji beyond jōyō" means, concretely:

- **464** non-jōyō kanji that carry a KANJIDIC `<freq>` rank (i.e. appear in
  the top 2,500 of newspaper frequency).
- **863** jinmeiyō — the official supplementary set legally permitted in
  personal names (KANJIDIC grades 9 and 10).

Deduped, about **1,000** characters. Worth being clear-eyed about what they
are: overwhelmingly name and place kanji. The most frequent non-jōyō
characters are 伊智弘彦阿李浩菱煕宏幌之梶昌靖渕也旭磯孜 — useful for reading
埼玉, 岐阜 or somebody's surname, and close to useless for general vocabulary.

They therefore go in their own ordering unit ("Names and places") rather than
being mixed into the frequency bands, so nobody works through them expecting
everyday words. Many will also have thin data — fewer meanings, fewer example
words, and some with no quizzable reading at all.

### 5.1 How phase 8 actually landed

Close to the design above, with the actual candidate counts turning out
different from the estimate (this section's own numbers were written before
checking the source data): **989 raw candidates** (863 jinmeiyō ∪ 126
non-jōyō-with-freq, not 464 — the discrepancy is `<freq>` being scarcer than
expected outside jōyō: only 2,501 kanji carry a rank at all, and jōyō itself
consumes most of them), landing on **897 taught** after one filter not in
the original design.

**A KanjiVG-stroke-data filter, not a hand-audited substitution table.**
UNICODE_VARIANT_SUBSTITUTIONS (§4.3) fixed four *jōyō* kanji taught at the
wrong Unicode code point by hand, found by diffing against an independent
list — that doesn't scale to auditing ~1,000 candidates by hand. Instead,
`select_beyond_joyo()`'s raw candidate set is filtered to characters KanjiVG
actually has a stroke diagram for (a kanji this app can't draw can't be
taught at all, regardless of jōyō status). This turned out to double as the
audit: all 89 dropped candidates are legacy kyūjitai forms or CJK
Compatibility Ideographs (U+F900–FAFF) of a kanji already taught elsewhere
under its modern code point — 神/海/難/社/... at a second, defunct code
point KanjiVG never drew a duplicate diagram for. Confirmed by hand for a
sample: none were real characters this app would otherwise be missing.

**Reuses the split_grade_8 pattern verbatim, one synthetic "grade" up.**
`select_beyond_joyo()` + `split_beyond()` produce "9-1".."9-6" sub-units —
897 kanji, ~150 per unit, frequency-ordered exactly like secondary jōyō's
"8-N" units. Choosing the "9-" prefix (rather than e.g. "names-") meant
`compareUnits` in `kanji.js` needed no change at all — it already generalizes
to "however many dash-separated parts a unit key gains later," which turned
out to include a whole new group, not just more sub-units of an existing
one. `unitLabel`/`unitNative`/`unitBadge` gained one more `startsWith` branch
each ("Names & places N" / 人名・地名N / "NN"), and `build_stroke_data.py`
needed *no* changes whatsoever — it already reads whichever units the
manifest lists.

**A second exclusion joined `excludeForMode`, not just `NO_YOMI_CHARS`.**
Filtering to stroke-drawable candidates left every one of the 897 with at
least one meaning and one on/kun reading — except two (舛, 禾) whose *only*
KANJIDIC gloss is their own radical name ("dancing radical (no. 136)"),
which the existing `RADICAL_MEANING` filter correctly strips, leaving zero
real definitions. Rather than drop two otherwise-fine kanji, `NO_MEANING_CHARS`
was added to the manifest alongside `NO_YOMI_CHARS`, and `buildKanjiCourse()`
in `kanji.js` now populates `excludeForMode.definition` from it — the
mechanism needed no new plumbing in `srs.js` or `applicableStudyModes()`
(app.js), since both were already written generically over "whichever mode
key the course happens to exclude," never hardcoded to `recognition`.

**The unquizzable-Yomi fraction is real, not a bug.** 208 of the 897 (~23%)
have no reading backed by any JMdict word, even after the uncommon-word
fallback pass (§4.3) — up from 0 in jōyō, which stays exactly 0 (the
fallback pass runs generically over the combined jōyō+beyond `graded` dict,
so jōyō's guarantee is untouched). This is expected, not a data-quality
problem: purely-decorative or single-surname jinmeiyō characters can
legitimately have no reading in common use at all. `excludeForMode` already
handled this per-kanji, so the fraction being an order of magnitude higher
than jōyō's needed no new mechanism, only a looser test bound for this
subset specifically.

**Three UI labels shipped alongside**, requested together with the data
expansion: the grade picker's rows gained plain-text headings — "Primary
school grade" above "1".."6", "Secondary school" above "8-N", "Names &
places" above "9-N" — as grid children spanning every column
(`grid-column: 1 / -1`), interleaved with each group's buttons in DOM order.
Grouping is computed from the unit-key prefix (`KANJI_UNIT_GROUPS` in
`app.js`), so it needs no separate list to stay in sync with whatever units
`KANJI_COURSES` actually contains.

---

## 6. Tests

The existing split holds: pure logic in `test/smoke.js`, whole-app flows
against the stub DOM in `test/wiring.js`.

New pure tests:

1. Migration derives `study` from progress keys exactly once, and leaves an
   existing `{}` alone.
2. Enroll/un-enroll round-trips without touching progress records.
3. `pendingItems` / `enrollNext` produce the right items in course order.
4. A study-list pool spanning several grades builds a session containing
   items from each.
5. `excludeForMode` is honoured through a study-list pool, not just a course.
6. Every ordering covers every kanji exactly once, with no gaps or repeats —
   run over all three, this is the guard against a bad JLPT data file.

New wiring tests: enrolling from the detail screen changes the course
screen's counts; a summary chip opens the detail screen and back returns to
the summary; the review-scope toggle changes which items a session contains.

---

## 7. Phasing

Each phase leaves both test suites green and is independently shippable.

| Phase | Work | Status |
| --- | --- | --- |
| 0 | Example-word ranking fix (§0) and regenerate `kanji-data.js`. | **Done** |
| 1 | Study list data model, migration, pool refactor in `srs.js` (§1). Pure logic and tests only, no UI. | **Done** — see §1.7 |
| 2 | Detail screen enrollment UI (§2.1) and clickable summary chips (§2.3). | **Done** — see §2.5 |
| 3 | Review scope toggle (§2.4) and "N waiting to learn" on the course card (§1.6). | **Done** — see §2.7 |
| 4 | Kanji search (§2.2). | **Done** — see §2.8 |
| 5 | Split `kanji-data.js` and `stroke-data.js` into lazily-loaded chunks (§4), still grade-only. The riskiest phase; nothing user-visible changes. | **Done** — see §4.1 |
| 6 | All 2,136 jōyō (§4), on top of the now-lazy loading. | **Done** — see §4.2 |
| 7 | JLPT and frequency orderings, ordering picker (§3). | Not started |
| 8 | Beyond-jōyō set (§5). | **Done** — see §5.1 |
| 9 | README, `APP_VERSION` / sw.js `VERSION` bump, service worker `SHELL` review. | Not started |

---

## 8. Open questions

- **Chunk size for later grades.** Sets of 5 suit a child meeting 一 for the
  first time. 2,136 kanji at 5 per set is 428 sets, which makes the set
  counter meaningless as a progress indicator. Larger sets higher up, or a
  different progress display, or both.
- **What the study list should do when it is empty.** A learner who removes
  everything, or a brand-new profile that has not pressed "Add 5 more" yet,
  currently has nothing to review and no obvious next step. The course screen
  should probably say so explicitly rather than showing "Nothing to review".
- **Whether per-mode enrollment wants a bulk action.** Turning on Writing for
  every kanji already learned in Definition is a plausible thing to want, and
  doing it one detail screen at a time would be miserable.
