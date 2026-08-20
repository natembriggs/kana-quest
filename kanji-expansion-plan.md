# Kanji expansion — implementation plan

Status: phases 0-4 done (example-word ranking fix, study-list model and
scheduling, enrollment UI, review scope toggle, kanji search). Phase 5 (the
data-payload split needed before full jōyō coverage) is next — the largest
and riskiest phase, see §4. Supersedes the kanji bullet under *What is not
built yet* in the README.

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
| 5 | Split `kanji-data.js` and `stroke-data.js` into lazily-loaded chunks (§4), still grade-only. The riskiest phase; nothing user-visible changes. | Not started |
| 6 | All 2,136 jōyō (§4), on top of the now-lazy loading. | Not started |
| 7 | JLPT and frequency orderings, ordering picker (§3). | Not started |
| 8 | Beyond-jōyō set (§5). | Not started |
| 9 | README, `APP_VERSION` / sw.js `VERSION` bump, service worker `SHELL` review. | Not started |

---

## 8. Open questions

- **Chunk size for later grades.** Sets of 5 suit a child meeting 一 for the
  first time. 2,136 kanji at 5 per set is 428 sets, which makes the set
  counter meaningless as a progress indicator. Larger sets higher up, or a
  different progress display, or both.
- **Whether "secondary" (jōyō grade 8) should be one unit.** It is 1,110
  kanji — over half the jōyō set in a single undifferentiated bucket. It may
  need sub-dividing by frequency to be usable, which effectively makes grade
  ordering a hybrid above grade 6.
- **What the study list should do when it is empty.** A learner who removes
  everything, or a brand-new profile that has not pressed "Add 5 more" yet,
  currently has nothing to review and no obvious next step. The course screen
  should probably say so explicitly rather than showing "Nothing to review".
- **Whether per-mode enrollment wants a bulk action.** Turning on Writing for
  every kanji already learned in Definition is a plausible thing to want, and
  doing it one detail screen at a time would be miserable.
