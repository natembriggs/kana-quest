# Anonymous usage data implementation plan

**Status:** proposed 2026-09-20, nothing implemented. Phase 0 is the only
phase recommended for immediate build, and part of it lands anyway with the
wrong-answer tracking work (see *Relationship to confusion tracking*).
Phases 2-3 are deliberately gated on a user-count threshold that this app
does not currently meet.

**Scope:** answering three questions the owner asked — where learners spend
their time, what they consistently get wrong, and which functionality does
and does not get used — without collecting anything that identifies a child
or reconstructs one child's session.

**Not in scope:** crash/error reporting (a separate problem with a different
consent story), A/B testing, anything that changes what a learner is shown
based on what was measured.

---

## The constraint that drives every decision below

**The users are children, and there are currently about five of them.**

Both halves matter and they pull in different directions.

*Children* means this is not an ordinary analytics problem. In the UK the
ICO's Age Appropriate Design Code applies to any service likely to be
accessed by under-18s, and its relevant standards are not advisory: data
minimisation (collect only what is needed for the specific thing you said
you would do), high privacy by default (analytics off unless someone turns
it on), transparency in language the audience understands, and no nudge
techniques to obtain consent. Separately, PECR/ePrivacy treats storing or
reading anything on the device for analytics as needing consent — analytics
is not "strictly necessary" for delivering the service. If any US learners
under 13 appear, COPPA's verifiable-parental-consent rule attaches to
persistent identifiers as well as to names.

*About five of them* means that for the next while, every aggregate number
is one identifiable person. "One learner spent 40 minutes in Writing mode
on Tuesday" is not anonymous when there is one learner. This is the reason
Phases 2-3 below are gated rather than scheduled: the privacy properties of
an aggregate only exist at volume, and shipping the pipeline before the
volume is there produces a dataset that is both useless and re-identifying.

The conclusion is not "don't do this". It is: **build the measurement
locally first, where it needs no consent and is useful immediately, and make
transmission a separate, later, opt-in thing that turns on when the numbers
mean something.**

---

## What is already here to build on

Three existing pieces set the pattern, and the plan below deliberately
copies all three rather than inventing new ones.

1. **`collectDiagnostics()` (`src/feedback.js:100`)** is already an
   allowlisted bundle, not a dump. It sends `browser`, `platform`,
   `viewport` as *families* (`ios`, `small`) rather than a user-agent
   string or a pixel count. Every field is one a human wrote down on
   purpose. The stats payload follows the same rule.

2. **"Show exactly what that sends" (`#feedback-diag-toggle`)** renders the
   actual pending payload, not a prose description of it. This is the single
   best privacy affordance in the app and the stats toggle must have it too
   — a description of a payload can drift from the payload; a rendering of
   it cannot.

3. **`installId()` (`src/feedback.js:47`)** is the model for how *not* to
   build an identifier. Its own comment is the specification: "a property of
   this browser, not of the learner", deliberately kept out of the profile
   so it cannot travel by sync or land in a backup, used for exactly one
   purpose (rate limiting), and never stored server-side. Any id in this
   plan has to clear the same bar or not exist.

Also relevant: the two-Worker split (`feedback-server/`, `sync-server/`) is
load-bearing, not accidental. The sync Worker cannot read what it stores;
the feedback Worker can read text but holds the GitHub credential. Stats is
a third trust domain and gets a third Worker (§5).

---

## 1. What gets measured

Three counter families. All three are *counters accumulated on the device*,
never an event stream. This is the central design decision and everything
else follows from it: an event stream with timestamps is a behavioural log
that can be replayed into "what this child did on Tuesday evening", whereas
a counter that says `writing: 2140 seconds, 31 opens` over a fortnight
cannot be. The questions the owner actually asked are all counter questions.

### 1.1 Screen dwell — "where do people spend the most time"

`screen -> { seconds, opens }` over the ~18 named screens (`screen-home`,
`screen-quiz`, `screen-reader`, …). Accumulated in the existing
`show()` screen router (`src/app.js:534`, which already tracks
`currentScreenId`): start a clock on entry, bank it on exit, bank on
`visibilitychange` so a backgrounded tab does not record eight hours of
"reading".

Seconds are rounded to the minute on upload and any screen under a minute
for the whole period is dropped, not sent as a small number — a 3-second
visit to Settings is a fact about a person, a 40-minute total is a fact
about a screen.

### 1.2 Feature reach — "which functionality does and doesn't get used"

`featureId -> count` over a **closed, hand-written allowlist** in one file,
something like:

```
compare.open.quiz        compare.open.detail       compare.fulldetails
hint.show                mnemonic.write            mnemonic.reset
search.run               overview.open             overview.markknown
story.open               story.finish              story.bookmark.drag
writing.mode.free        writing.mode.trace        writing.replay
sync.pair                backup.export             backup.import
feedback.open            feedback.send             contributions.open
advanced.readings        placement.sweep           textsize.pinch
…
```

The closed allowlist is the privacy property, not bureaucracy. A new
measurement cannot appear without someone adding a line to that file, which
means it cannot appear without a code review and a changelog entry. It is
also what makes the *negative* answer possible: "which functionality doesn't
get used" is answered by the ids sitting at zero, which only works if the
list enumerates everything, including the things nobody has ever touched.

Rule for what may be a feature id: it names a control the learner operated.
It never names content (which story, which kanji, which search term).

### 1.3 Item difficulty — "what do they consistently get wrong"

`mode:item -> { seen, missed }`, plus confusion pairs
`mode:item > wrongAnswer -> count`. This is the family the wrong-answer
tracking work produces anyway, for its own local reasons.

This family is different in kind from the other two: it is a fact about the
*curriculum*, not about a person. "上 is missed 34% of the time it is asked"
is the single most useful thing on this page for improving the app, and it
is also the family most worth being careful with at low volume, because
combined with a grade and a time it narrows to one child fast. Hence the
suppression rule in §4.

---

## 2. What is never collected

This list is part of the design, not a disclaimer, and belongs in the
in-app disclosure verbatim.

- **No free text.** Ever. Not search queries, not written mnemonics, not
  profile names. The feedback form is the only route for text and it has
  its own consent, its own Turnstile and its own receipt model.
- **No IP address stored.** Cloudflare necessarily sees it in transit; the
  Worker must not write `cf-connecting-ip` (or a hash of it) to D1. This
  needs to be an explicit test, because it is one line of code away from
  being false.
- **No timestamp finer than the reporting period.** Uploads carry the period
  they cover, not when anything happened inside it. "What time of day do
  children use this" is a question this plan declines to answer.
- **No identity of any kind:** no profile id, name or emoji, no receipt
  token, no sync code, no `installId` (that one is the *rate-limit* key and
  must not be reused here — reusing it would link stats to feedback
  submissions).
- **No content identifiers outside §1.3's kanji/vocab items**, which are
  curriculum, not behaviour. Story ids are counted as "a story was opened",
  not "*this* story was opened", until there is volume to make the latter
  safe.
- **No per-question timing traces**, which are the closest thing in an
  education app to a keystroke log.

---

## 3. The identifier problem

Any stable id turns a series of counter uploads into a longitudinal profile
of one child, which is exactly the thing this plan exists to avoid. But with
*no* id at all the server cannot tell one install uploading twenty times
from twenty installs uploading once, so "how many people use this" — a
reasonable question — becomes unanswerable.

**Proposal: a period-scoped rotating id.** One upload per install per
14-day reporting period, carrying a random id generated fresh for that
period and thrown away at the end of it. Within a period the server can
dedupe and count distinct installs; across periods no linkage is possible,
because the id is not derived from anything and no mapping is kept
anywhere.

Alternatives considered and why not:

- *No id.* Simplest and strictly safest, but loses the install count, and
  loses protection against a single device's retries inflating every number
  it touches. Retained as the fallback if the rotation turns out to be
  fiddly.
- *Stable install id.* Gives retention curves and cohort analysis. Rejected:
  that is a profile of a child, and the value does not come close to
  justifying it for an app teaching a family's children kana.
- *Hashed IP.* Rejected outright. A hash of an identifier is an identifier.

---

## 4. Suppression, and the gate on switching transmission on

Two rules, both server-side, both tested:

1. **k-anonymity floor on every published cell.** Any aggregate derived from
   fewer than *k* distinct installs in the period is not reported at all —
   not rounded down, not shown as "<k", simply absent. Start at k = 20 and
   lower it only with a reason written down.
2. **Transmission stays off until there are enough installs for rule 1 to
   ever pass.** Concretely: do not build or deploy Phase 2 until there are
   at least 50 installs that could plausibly opt in. Before that the
   pipeline produces nothing publishable and the only thing it achieves is
   holding children's data on a server.

This second rule is the one most likely to be uncomfortable later, when the
app has thirty users and the temptation is "close enough". Writing the
number down now, before there is a specific question one wants answered, is
the whole point.

---

## 5. Where it runs

**A third Worker, `kana-quest-stats`, with its own D1.** Not a route on the
feedback Worker.

The reason is the same one that already splits `sync-server` from
`feedback-server`: what a Worker *can* read is the security argument, and
adding a route to an existing Worker silently widens it. The feedback Worker
holds a GitHub credential and the receipt pepper; a stats endpoint that
accepts unauthenticated bulk uploads from every install is exactly the
surface one does not want sharing a process with those. The stats Worker
holds no credential, has no GitHub access, cannot read the feedback D1, and
its only write path appends counter rows.

The cheaper alternative — a `/v1/stats` route on the existing Worker —
saves perhaps a day of setup and is worth taking *only* if the separate
Worker is what stops this shipping at all. Note it as a conscious downgrade
if so, in `feedback-server/README.md`, next to the existing split rationale.

**Retention:** raw uploads roll up nightly into per-period totals and the
raw rows are deleted at 35 days. Rollups keep only cells that passed §4's
floor.

**Abuse:** the endpoint is unauthenticated by necessity, so it needs the
same origin allowlist and rate limiting the feedback endpoint already has,
plus a hard cap on payload size and on the number of distinct keys in one
upload (a malicious client should not be able to create a million counter
rows).

---

## 6. Consent

**Off by default, per device, set by an adult, in Settings.**

- A single toggle in Settings — adult territory, alongside sync and backup —
  worded for a parent, not a child. Never a mid-session prompt, never a
  modal on first run, never a second ask after a decline. (ICO Standard 13:
  no nudging toward the less private option.)
- Beneath it, the same **"Show exactly what that sends"** disclosure as the
  feedback form, rendering the real pending payload.
- Turning it off stops the next upload and deletes the local counters. It
  cannot retract what was already sent, because after §4's rollup there is
  nothing left that is about that device — the disclosure must say that
  plainly rather than implying a delete-my-data button exists.
- The setting is **per device, not per profile, and does not sync.** A
  parent enabling it on the family iPad has not spoken for the laptop.
  (This is a deliberate departure from how every other setting works.)

Phase 0 needs none of this, because nothing leaves the device.

---

## 7. Relationship to confusion tracking

The wrong-answer tracking being built now is Phase 0's §1.3 counter, arrived
at from the other direction: it exists to make "kanji I tend to get mixed
up" literal on the compare screen, and it happens to be the hardest of the
three counter families to collect.

That dovetail is worth naming because it is also the honest argument for
Phase 0 in general: **each of the three families is independently useful to
the learner on their own device, with no server involved.**

- §1.3 powers the compare feature and a "what you keep missing" view.
- §1.1 powers an honest "you have spent 4 hours reading this month".
- §1.2 powers nothing for the learner directly, and should therefore be the
  last thing built and the first thing cut.

If Phases 2-3 never happen, Phase 0 is still worth having shipped.

---

## 8. Phases

**Phase 0 — local counters, nothing transmitted.** The three counter
families, the caps, the merge rules, and a learner-facing view of §1.3 and
§1.1. No endpoint, no consent UI, no identifier. Partly lands with the
confusion-tracking work. *Recommended now.*

**Phase 1 — the payload, still going nowhere.** The allowlist file, the
payload builder, and the "show exactly what that sends" renderer wired to
it. Produces a payload one can read in Settings and send to nobody. Cheap,
and it makes the privacy review concrete: one can look at the real bytes
before deciding whether they should ever leave. *Recommended now, as the
forcing function for the §2 list.*

**Phase 2 — Worker, D1, consent toggle, upload.** Gated on §4's install
threshold. *Not yet.*

**Phase 3 — rollup and a small dashboard.** A scheduled query and a static
page. Gated on Phase 2 producing cells that pass the floor. *Not yet.*

---

## 9. What this will and will not tell you

Worth stating before any of it is built, so the result is not a surprise.

**It will answer well:** which screens have long total dwell; which
allowlisted features have a zero; which kanji and vocabulary items are
missed most often, and what is picked instead.

**It will answer badly or not at all:** *why* anything happens; whether a
feature is unused because it is undiscoverable or because nobody wants it
(the two have identical signatures in this data); anything about an
individual's progress over time (deliberately designed out by §3); time of
day (§2); the difference between one enthusiastic user and twenty casual
ones in a period where the floor was not met.

The second list is why the feedback loop stays the primary instrument. A
count tells you a door is never opened; only a child telling you "I did not
know that was a button" tells you which of the two doors it is.
