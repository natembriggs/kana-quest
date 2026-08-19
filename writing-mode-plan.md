# Writing mode — implementation plan

Status: plan only, nothing built yet. Supersedes the "Writing mode" bullet
under *What is not built yet* in the README.

Writing is the third mode for kana (after Reading) and kanji (after Definition
and Yomi). The learner is shown a prompt — romaji for kana, meanings and
readings for kanji — and draws the character on a quartered box. Strokes are
graded as they are drawn, against KanjiVG stroke data.

---

## 1. What already exists

Most of the data work is done and sitting untracked in the working tree.

| Piece | State |
| --- | --- |
| `src/stroke-data.js` | **Complete.** 1,174 characters — 148 kana + all 1,026 kyōiku kanji, **zero gaps**. 918 KB, one `0 0 109 109` viewBox throughout, 10,095 strokes. Untracked. |
| `tools/build_stroke_data.py`, `tools/fetch_kanjivg.sh` | Working. Untracked. |
| `src/strokes.js` | Builds the numbered stroke SVG and animates draw-in. Reusable as the guide layer and on the lesson card. |
| `src/srs.js:56` | `writing` mode already declared, with `comingSoon: true`. |
| `src/store.js` | `itemKey('writing', char)` and the Leitner `grade()` are mode-agnostic — **progress storage needs no changes at all**. |

Path data uses only `M/m/C/c/S/s` — cubic béziers and moveto, nothing else to
parse. Writing mode is therefore mostly UI and grading maths, not data work.

**On the handwriting-style requirement:** KanjiVG's paths are stroke
*centrelines* in the textbook (教科書体) style, which is the handwriting model
taught in Japanese schools. Rendering those paths with round line caps is what
gives a handwritten look. The system font is never used as a reference glyph —
it would render Mincho-style print shapes with serifs and modulated stroke
weight that nobody writes by hand. The only place a font glyph appears is the
existing `.stroke-fallback-glyph` path for characters with no stroke data,
which currently applies to none of them.

---

## 2. Grading — the design, and the numbers behind it

### 2.1 Design principle

**False positives are strongly preferred to false negatives.** This is
practice, not an exam. Being told "wrong" when you tried hard is
demotivating and is the main way an app like this gets abandoned. Being told
"right" when you were sloppy costs almost nothing, because the correct form
is shown afterwards either way and the learner still sees the mismatch.

Every threshold below was chosen to make a **sloppy 12-year-old essentially
never see a false "incorrect"**, and to keep a struggling six-year-old on the
gentlest setting almost always accepted, while still rejecting input that
shows no real attempt.

### 2.2 The checks, in order

Each drawn stroke is compared against the model stroke at the same index —
**stroke order is enforced**, which is the main thing writing practice is for.

1. **Direction.** Reject if pairing the drawn stroke to the model in reverse
   fits clearly better than forward — specifically if
   `d(u₀,mₙ) + d(uₙ,m₀) < d(u₀,m₀) + d(uₙ,mₙ) − max(0.25·L, 6)`.
   The margin matters: without it, a short near-symmetric stroke gets accused
   of being backwards about 1.3% of the time purely from wobble. Scale-free,
   so it keeps working at every strictness level — direction is the one thing
   never relaxed.
2. **Length.** Drawn path length must be between
   `(L < 15 ? 0.35 : 0.55)·L / slack` and `max(2.2·L, L + 26)·slack`.
   This gate exists solely to stop a stub or a runaway from passing on a
   short stroke, where the acceptance radius is necessarily larger than the
   stroke itself. The generous absolute upper slack (`L + 26`) is essential —
   19% of all strokes are shorter than 20 units, and children overshoot small
   strokes badly.
3. **Start point** within radius `R` of the model's start.
4. **End point** within radius `R` of the model's end.
5. **Mean deviation** across 48 arc-length-resampled point pairs ≤ `D_mean`.
6. **Max deviation** ≤ `D_max` — a scribble catcher, nothing more.
7. **Corners** (turning angle > 55° over a 6-point window) — **advisory
   only, never rejects.** Reported as "watch the corner here" in the
   feedback. 82% of strokes have no corner at all, so this was never going to
   be load-bearing; treating it as a gate would only add false negatives.

### 2.3 Tolerances

In the 109-unit KanjiVG coordinate space, so they are independent of screen
size. `L` is the model stroke's arc length; `m` is the strictness multiplier.

```
R      = clamp(0.45 · L, 17, 36) · m      # endpoint hit radius
D_mean = clamp(0.36 · L, 14, 30) · m      # mean deviation
D_max  = clamp(0.90 · L, 36, 74) · m      # scribble catcher
slack  = 1 + (m − 1) · 0.5                # milder multiplier, length gate only
```

**The floors are the important part and are deliberately absolute.** A purely
relative tolerance makes dense kanji impossible: stroke lengths run from 6 to
290 units (median 37), so `0.45 · L` on a 7-unit dot would be a 3-unit radius —
about 8 px on a phone, far beyond anyone's motor control, let alone a child's.
The floor of 17 units is ~16% of the box width, roughly 50 px on a 320 px
canvas, or about a fingertip. It never goes below that no matter how short the
stroke.

The cost, stated honestly: on characters with several small strokes packed
together (the four dots of 学, the stacked horizontals of 量), the floor is
comparable to the spacing between them, so a dot placed on its neighbour's
position is accepted. Stroke *order* is still enforced, so this shows up as
lenient placement rather than as accepting the wrong character. Given the
false-positive preference, that is the right trade.

### 2.4 Strictness ladder

Five levels, default **3 — Normal**, tuned for a sloppy 12-year-old.

| Level | Name | `m` |
| --- | --- | --- |
| 1 | Gentle | 1.50 |
| 2 | Easy | 1.22 |
| 3 | **Normal** (default) | **1.00** |
| 4 | Neat | 0.82 |
| 5 | Strict | 0.67 |

### 2.5 Measured behaviour

Simulated against all 10,095 strokes, with writers modelled as *smooth*
systematic error — offset, scale, tilt, low-frequency bow, endpoint
over/undershoot — plus light tremor, rather than white noise. (Per-point white
noise is not how sloppy handwriting fails, and it wrecks any length-based
check: it inflates measured path length by more than 2×. See §3.3 —
the capture pipeline must smooth before measuring.)

**Per-stroke acceptance (%)** — this is the number that governs frustration,
since a rejection interrupts stroke by stroke:

| Writer | Gentle | Easy | **Normal** | Neat | Strict |
| --- | --- | --- | --- | --- | --- |
| 12yo, neat | 100.0 | 100.0 | **100.0** | 100.0 | 100.0 |
| 12yo, sloppy | 100.0 | 100.0 | **99.9** | 98.7 | 93.5 |
| 9yo, rushing | 99.8 | 99.4 | **96.2** | 87.5 | 71.9 |
| 6yo, 20th pct motor control | 97.7 | 91.3 | **78.4** | 60.5 | 42.4 |
| 6yo, barely trying | 76.7 | 58.1 | **41.6** | 28.2 | 17.1 |

**Whole-character first-try pass (%)** — every stroke accepted, no retries.
Note how per-stroke error compounds: 10 strokes at 98% each is 82% per
character. This is why the per-stroke figure above had to be pushed so high.

| Writer | Gentle | Easy | **Normal** | Neat | Strict |
| --- | --- | --- | --- | --- | --- |
| 12yo, neat | 100.0 | 100.0 | **100.0** | 100.0 | 100.0 |
| 12yo, sloppy | 100.0 | 100.0 | **98.8** | 89.5 | 56.5 |
| 9yo, rushing | 99.2 | 92.5 | **73.0** | 40.8 | 16.5 |
| 6yo, 20th pct motor | 84.2 | 49.0 | **23.5** | 11.5 | 6.0 |
| 6yo, barely trying | 25.2 | 11.5 | **7.0** | 3.5 | 2.5 |

**Rejection of input that is genuinely wrong (% correctly rejected)** — proof
the loose settings are not a rubber stamp:

| Wrong input | Gentle | Easy | **Normal** | Neat | Strict |
| --- | --- | --- | --- | --- | --- |
| drawn backwards | 99.8 | 99.8 | **99.8** | 99.8 | 99.8 |
| scribble | 99.3 | 99.9 | **100.0** | 100.0 | 100.0 |
| shifted 30 units | 74.4 | 84.2 | **94.2** | 100.0 | 100.0 |
| shifted 20 units | 0.0 | 64.4 | **74.4** | 83.8 | 93.1 |
| mirrored left/right | 84.3 | 88.5 | **91.3** | 93.0 | 94.3 |
| only half drawn | 0.5 | 89.2 | **89.2** | 89.2 | 89.2 |

Gentle is close to position-blind (a 20-unit shift always passes, half-strokes
pass). That is intentional at that level: the bar is "made a real attempt in
roughly the right place, moving the right way". Direction and scribble
rejection still hold, and the correct form is shown after every character, so
learning still happens through the guide rather than through the verdict.

### 2.6 What is *not* graded

Pen speed, pen pressure, stroke thickness, aesthetics, and — deliberately —
corner accuracy. Also not graded: absolute size, beyond what the length gate
and the deviation checks already imply.

---

## 3. Modes

Three modes, chosen automatically from the SRS box (new → Trace, learning →
Guided, box ≥ 3 → Free), with a three-way toggle on the writing screen that
overrides for the session.

| Mode | Guide shown | Grading |
| --- | --- | --- |
| **Trace** | Full model, faint, with stroke numbers | Live per stroke, reject and retry |
| **Guided** | Nothing at first; after each **accepted** stroke, that stroke is redrawn properly underneath the learner's ink | Live per stroke |
| **Free** | Nothing | Captured silently, verdict shown at the end |

### 3.1 Guided mode draws the guide at its true position

The guide is rendered at the character's true coordinates, **not shifted to
match where the learner started**. If their first stroke sits high and left,
the guide will visibly disagree with their ink, and subsequent strokes placed
relative to the guide will not line up with their own earlier work.

That mismatch is the point. Placement within the quartered box is a real part
of Japanese orthography, not an artefact of the grading — a character whose
components drift out of the box is genuinely wrong, and seeing the
disagreement is the feedback that trains placement. It also supplies the
motivation to keep the whole character neat rather than merely correct
stroke-by-stroke.

The counter-argument — that an off-placed first stroke cascades into
rejections on every later stroke — is real, and it is what the tolerance
floors in §2.3 are for: at Normal a 20-unit misplacement is inside the
acceptance radius for most strokes, so drift produces *visible disagreement
with the guide* without producing rejections. The learner sees they are off
and is not punished for it.

If this turns out to be annoying or demotivating in practice, the relaxation
to add later is an option that shifts the guide into the learner's own frame
(bounded to ~10 units). The maths for it is the bounded least-squares offset
described in §3.2 — it is worth keeping that function available even though
nothing grades with it. **Not built now; try it this way first.**

### 3.2 Offset as feedback, not as leniency

The bounded best-fit offset between the finished character and the model is
computed and *reported* — "the whole character sat a bit left" — but never
subtracted before grading. It is a coaching hint, not a concession.

### 3.3 Capture

Pointer events, `touch-action: none`, primary pointer only, canvas scaled by
`devicePixelRatio`, re-measured on orientation change. `getCoalescedEvents()`
on move for accurate capture on high-refresh screens.

**Captured points are smoothed and resampled before anything is measured.**
This is not cosmetic: raw finger tremor at 120 Hz inflates measured path
length by more than 2×, which makes the length gate in §2.2 fire on
perfectly good writing. Two passes of a `[1,2,1]/4` smoothing kernel, then
arc-length resampling to 48 points, then measure.

---

## 4. Flow through a character

1. Prompt shown, canvas empty (plus guide, in Trace).
2. Learner draws a stroke → graded immediately.
   - **Accepted**: ink settles to the "accepted" colour. In Guided, the model
     stroke is drawn underneath at its true position. Move to the next stroke.
   - **Rejected**: the stroke fades out with a specific message — "start
     higher", "that one goes the other way", "too short", "that's stroke 4,
     stroke 2 comes first" (detected by scoring the drawn stroke against later
     model strokes). The learner tries again. Repeated failure offers *Show me*,
     which animates the correct stroke.
3. All strokes done → the character is complete.
4. **No automatic advance.** The result is shown with the model overlaid on
   their ink, and the learner chooses what happens next:
   - **Next** — go on.
   - **Write it again** — redo purely to improve the look and fit. Does not
     change the record, does not re-grade. Available after a *successful*
     character specifically, since wanting a neater attempt is the whole
     motivation the guide is meant to create.
   - **Mark as not known** — force it back into review even though it was
     marked correct. This is the manual correction channel for the
     false-positive bias: if the app was too generous, the learner says so.

Free mode inserts a **Done** step before 4, then shows every stroke coloured
by its verdict with the model overlaid, plus the self-grade yes/no from the
original spec, which overrides the automatic verdict before it is committed.

### 4.1 What goes into the SRS

`correct` = every stroke accepted on its **first attempt**, with no *Show me*
used — the same first-attempt-locks-the-record rule the reading and definition
quizzes already use. Retries and hints let the learner finish the character
without rewriting the record. *Mark as not known* overrides to `incorrect`;
Free mode's self-grade overrides either way. *Write it again* never touches it.

In free mode, drawn strokes are paired to model strokes sequentially. A count
mismatch marks the surplus as extra or the shortfall as missing. (A
best-alignment pairing would handle a skipped middle stroke more gracefully;
sequential is enough to start.)

---

## 5. Screens and files

### New modules

| File | Contents | Pure? |
| --- | --- | --- |
| `src/stroke-geometry.js` | bézier parser → polyline, smoothing, arc-length resampling, stroke length, corner detection, bounded best-fit offset | ✅ no DOM |
| `src/stroke-grader.js` | tolerance formula, strictness ladder, per-stroke verdict, character verdict, out-of-order detection | ✅ no DOM |
| `src/writing.js` | canvas widget: capture, ink rendering, guide layers, the three modes | DOM |

Parsing happens at runtime, cached per character — roughly 10 strokes × 5
béziers, negligible. Precomputing polylines at build time would multiply the
918 KB data file several-fold for no gain.

### `index.html`

A new `#screen-writing` section with a topbar and progress bar mirroring
`#screen-quiz`, rather than branching `renderQuestion()` a fourth time. The
session state machine, `recordResult`, `finishSession` and the summary screen
are all reused unchanged.

- Square canvas box with the four quadrants marked by dashed lines.
- Kana prompt: the romaji, plus an explicit script label — "write this in
  **katakana**" — since romaji alone does not say which script is wanted.
- Kanji prompt: on'yomi, kun'yomi, example words in kana, and English
  meanings in a side panel; stacked above the canvas in portrait, beside it
  in landscape.
- **Example words must be masked.** They contain the target kanji, which
  gives the answer away — 学校 has to render as ○校 until the character is
  graded. The same applies to any reading chip or detail view reachable
  mid-question.
- Lesson cards for writing mode reuse `animateStrokes()`: watch it drawn,
  trace it once, then get quizzed.

### Settings

Strictness is a 5-position slider added to `defaultSettings()` in
`src/store.js:60`, defaulting to 3. Per profile, so two children on one device
can have different settings.

---

## 6. Tests

The geometry and grader modules are pure, so they run under JavaScriptCore in
`test/smoke.js`. The audits used to derive §2.5 become permanent regression
tests:

1. Every one of the 10,095 model strokes is accepted against itself, at all
   five strictness levels.
2. Reversed strokes rejected ≥ 99% at every level.
3. Scribbles rejected ≥ 99% at Normal and above.
4. A seeded sloppy-writer simulation is accepted ≥ 99.5% per stroke at Normal
   — this is the false-negative guard, and the number the whole design turns
   on.
5. Half-length strokes rejected ≥ 85% at Easy and above.
6. Bézier parser round-trips against known endpoints; smoothing plus
   resampling preserves measured length within 2%.

`test/wiring.js` needs its stub element to grow a no-op `getContext('2d')`,
in the same spirit as its deliberate non-implementation of SVG geometry.

---

## 7. Phasing

Each phase leaves both test suites green.

| Phase | Work | Status |
| --- | --- | --- |
| 0 | Commit the three untracked stroke-data files as they stand. | Done |
| 1 | `stroke-geometry.js` + `stroke-grader.js` + the tests in §6. No UI. | Done |
| 2 | Canvas widget + **Trace mode, kana only**, wired end-to-end through a real session. First point a child can use it. The result step (§4: no auto-advance, *Write it again*, *Mark as not known*) was pulled forward into this phase rather than phase 3, since it's core UX independent of which sub-mode is active. | Done |
| 3 | Guided and Free modes, plus the three-way toggle on the writing screen (manual only — automatic selection by mastery is still phase 5). | Done |
| 4 | Kanji prompt panel and example-word masking. | Not started |
| 5 | Automatic mode selection by mastery, strictness slider, summary and detail-screen integration, drop `comingSoon`. | Not started |
| 6 | README, `APP_VERSION` and sw.js `VERSION` bump, new files added to the service worker `SHELL` list. | Not started |

### 7.1 A correction from phase 2/3: the message is not the record

Phase 2 tied the completion message to the same `correct` value that gets
recorded for spaced repetition — a character finished after any stroke
needed a retry showed "Good try — here's how it goes.", the same wording as
a genuine miss. That's wrong: a kid who gets every stroke right eventually
watched themselves successfully write the character, and telling them
"good try" reads as a rejection of something they just did correctly.

The fix, applied in phase 3: **the completion message and the SRS record
are allowed to disagree.** Trace and Guided always show "Nicely done!" once
every stroke is accepted, regardless of retries — the record alone (via
`correct` in `finishWritingCharacter()` in `src/app.js`) quietly reflects
whether it was a clean first-try pass, which is what still gates *Write it
again* and *Mark as not known* and what the Leitner box actually moves on.
Free mode is the one exception: its message DOES follow `correct`, because
there `correct` is the learner's own yes/no self-grade, not an automatic
verdict being softened at them — echoing back what they just told the app
isn't the same problem as the app unilaterally judging them.

### 7.2 A second layout pass: reclaiming space, a difficulty ladder

Real phone use surfaced two more problems, both fixed within phase 3 rather
than deferred:

- **The Trace/Guided/Free toggle, sitting above the canvas, pushed Next off
  the bottom of a phone screen** before a character was even finished. Fixed
  by moving it to the very bottom of the screen, under a "Difficulty level"
  label, deliberately last in DOM order — it's fine for it to be pushed
  below the fold once other content fills the screen, since it matters far
  less than whatever's currently in front of the learner.
- **The result message ("Nicely done!") added a whole new line below the
  canvas.** It now appears ABOVE the canvas instead, in the same slot the
  prompt and stroke counter occupy while drawing — exactly one of
  {prompt+counter, result message} is visible at a time, so finishing a
  character replaces rather than adds.

Two more pieces landed alongside those:

- **Hold-to-peek**, for Guided/Free where the guide is otherwise hidden:
  "Show next stroke" reveals whichever stroke the attempt is currently
  waiting on (moves on as strokes are accepted — not stuck on stroke 1) and
  "Show full character" reveals everything, both only while held down. Gone
  entirely once a character is finished, alongside the rest of the
  in-progress-only controls, since neither is useful once there's nothing
  left to peek at.
- **A difficulty ladder**, not just a toggle: a clean pass offers "Try
  harder mode" right next to Next; a miss offers "Switch to easier mode" in
  the hint row. Both reuse the exact same mode-switch path as the toggle
  itself — redoing the SAME character at the new level, not skipping ahead
  to a new one — and neither writes a second, conflicting record on top of
  one already committed (bonus practice at a different difficulty is
  practice, not a re-grade). The labels deliberately never name the target
  mode ("Try harder mode", never "Try Free") — Trace/Guided/Free mean
  nothing to a first-time reader out of context.

**"Mark as not known" was folded into "Try again"** rather than kept as a
separate button, to hold the finished-state controls to three: Try again,
the (conditional) switch-mode button, and Next. Retrying something already
recorded correct now ALSO quietly applies the old override (box back to 0,
due now) — the reasoning being that wanting to redo something you just
passed is itself a signal you don't fully trust the grade. Retrying
something already recorded wrong is a no-op for the record; there's nothing
left to override.

### 7.3 A reversal: folding it into "Try again" cost too much

In practice, wanting a neater second attempt at something you just got right
(the *Write it again* motivation from §4) is common and has nothing to do
with distrusting the grade — but §7.2's fold made every such redo quietly
reset the box anyway. That's the wrong default: it punishes the exact
behaviour the guide is designed to encourage.

**"Try again" is back to being a pure redo — it never touches the record.**
The override is still available, but now as an explicit, opt-in action: a
clean redo of an already-recorded character shows a **"Mark this attempt as
bad"** button instead of the "Nicely done!" text, in the same slot above the
canvas (`writing-mark-bad` in `index.html`/`app.js`). It only appears on a
redo — the first pass through a character has nothing to mark bad yet — and
only replaces the positive message, since a redo that itself goes badly
already shows "Okay — marked for more practice." with nothing further to
opt into. Clicking it applies exactly the same schedule correction as
before (box back to 0, due now, `seen`/`lapses`/history untouched), then
swaps back to that same confirmation text.

---

## 8. Open questions

- **Scale error resists correction.** A child writing consistently 15–20%
  too large is caught by the deviation checks rather than by anything that
  names the actual problem. The fix, if it shows up in practice, is to detect
  it and say so ("try writing a bit smaller") rather than to loosen further.
- **Gentle is nearly position-blind** (§2.5). If it proves too generous to
  teach anything, the lever is raising the floor from 17 units rather than
  changing the multiplier, since the multiplier also controls the shape
  checks.
- **Stroke-order enforcement on visually ambiguous characters.** 層, 量 and
  friends have near-identical stacked horizontals; the grader cannot tell
  which one you meant, only which one comes next. Enforcing order is what
  makes this well-defined, so no change is planned — noting it because it
  will look like a bug when someone draws them bottom-up and is accepted.
