---
name: kanaquest-feedback-triage
description: Check the open KanaQuest feedback backlog, evaluate each report, and draft a prioritized triage plan for Nathan to review. Use each morning (via the scheduled task) or any time on demand to process the feedback inbox. Produces a plan only — never applies labels, comments, or code changes itself.
---

# KanaQuest feedback triage

Reads open issues from the private feedback inbox and turns them into a
reviewable plan. This is a **report-and-propose** step only — see
`feedback-coding-workflow` in memory: the plan needs Nathan's approval before
any label, comment, or code change happens. Never call `gh issue edit`,
`gh issue comment`, or the release API from this skill.

## Posture: steelman every report

Default to **the reporter is right and their suggestion is useful**. Not
"they misunderstood", not "they're holding it wrong", not "we already have
that".

Why this is the standing default:

- Writing feedback costs effort. A learner only spends that effort when they
  feel something is genuinely worth saying.
- For every learner who reports something, assume several more hit the same
  thing and said nothing.
- "The feature already exists" is not a rebuttal — it's evidence of a
  discoverability or affordance failure, which is itself a real defect.
- Track record so far: **zero** reports have turned out to be unwarranted.
  Triage that opens with a reason not to act has been wrong every time.

So the output of triage is **never "no action"**. Every report gets *something*
in the app: the feature, a smaller version of it, better discoverability of the
existing feature, clearer wording, or a fix to whatever made the learner reach
for feedback in the first place. The only question is *what* and *how big* —
not *whether*.

Before writing any recommendation, do this explicitly:

1. **Restate the request in its strongest form.** Assume the reporter has a
   real use case you haven't pictured yet. Invent the scenario that makes the
   request obviously correct, and write it down. (Example: "the app already
   restores your scroll position" ignores a learner on a large screen facing a
   wall of kanji — re-finding your exact place could mean re-reading dozens of
   characters. An explicit, draggable marker is plainly better.)
2. **Assume the existing feature is insufficient, not the reporter.** If
   KanaQuest already does something adjacent, ask what the reporter's version
   does that ours doesn't — granularity, visibility, control, precision,
   confidence.
3. **Only then** size the work and propose scope.

Never open a recommendation with "this isn't really a missing feature" or
similar. If the honest conclusion after steelmanning is that the existing
feature covers it, the proposal is a **discoverability/UX change**, not a
close.

`not_planned` is reserved for spam, incoherent reports, and things that are
technically impossible on the platform — not for "we already do that" or
"low value". If a report genuinely lands there, say so plainly and still
propose the nearest thing that *can* be done.

(This posture may need revisiting if the feature set ever gets bloated. Until
Nathan says otherwise, always try.)

## Where things live

- Inbox repo (private, issues only — never the public `kana-quest` repo):
  `natembriggs/kana-quest-feedback`
- Label vocabulary and status ladder: `feedback-server/src/config.js`
  (`CATEGORY_GITHUB_LABEL`, `LABEL_STATUS`, `STATUS_RANK`). A label outside
  `LABEL_STATUS` (`status:reviewing`, `status:planned`, `status:in-progress`,
  `status:not-planned`) never reaches the learner — only those four do.
- Design background: `feedback-plan.md` and `feedback-server/README.md`.

## Steps

1. **Pull the open backlog:**
   ```
   gh issue list --repo natembriggs/kana-quest-feedback --state open \
     --json number,title,body,labels,createdAt,comments --limit 100
   ```
   Every issue carries a `kind:*` label (`kind:bug`, `kind:idea`,
   `kind:content`, `kind:other`) from `CATEGORY_GITHUB_LABEL`, plus
   `from:kanaquest-app`. Note which ones already carry a `status:*` label —
   those are already mid-triage; report their state but don't re-propose
   them unless something about the plan should change.

2. **Quote every report verbatim.** For each issue, reproduce the learner's
   own words **exactly as written** in a blockquote — full text, original
   spelling, punctuation, capitalisation and line breaks, no trimming, no
   tidying, no paraphrase. Never substitute a summary for the quote; a summary
   may follow it, never replace it. Nathan reads the raw text himself and
   judges it himself, so it must reach him unfiltered.

   Quote the learner's message only. The auto-appended diagnostics block
   (app/sw version, screen, course, mode, platform, viewport) goes in a
   separate one-line note, not inside the quote.

3. **Evaluate each new/unlabeled issue**, after the steelman pass above:
   - Read the title and body. Diagnostics are often embedded in the body —
     use them to judge reproducibility.
   - Check for **duplicates**: search open and recently-closed issues
     (`gh issue list --repo natembriggs/kana-quest-feedback --search "<terms>"
     --state all`) for the same underlying report. Duplicates are a strength
     signal, not a reason to dismiss — they raise priority.
   - Judge **severity/impact**: does it block core functionality (answering,
     progress saving, sync) vs. a cosmetic or edge-case issue. Remember that
     friction a learner noticed enough to report is rarely cosmetic to them.
   - Judge **clarity**: if it's underspecified, propose the most useful
     reading and design a concrete version of it — don't park it on a
     clarifying comment unless the request is genuinely unreadable.
   - Rough **effort estimate** (small/medium/large) — skim the relevant area
     of the app (`src/`) if it helps place the report, but don't go deep;
     this is triage, not implementation.
   - Recommend a next `status:*` label and the specific app change you'd make.
     Where a request is large, propose a smaller first slice that still gives
     the reporter something real, rather than deferring it entirely.
   - For anything you'd genuinely propose closing as `not_planned` (rare —
     see the posture section), give a one-line reason that would read kindly
     if it were ever paraphrased back to the reporter (see
     `feedback-release-credit-message-style` in memory for the tone this app
     uses toward learners).

4. **Draft the plan**, grouped for easy scanning. Every entry leads with the
   verbatim quote, then the steelmanned reading, then the proposal:
   - **Quick wins** — small, clear, worth doing next.
   - **Needs a decision** — genuine product forks (which of two good designs),
     not "should we act at all".
   - **Larger effort** — clear but non-trivial; candidates for a future
     session, each with the smaller first slice named.
   - **Discoverability fixes** — where KanaQuest already does the thing but
     the learner couldn't find or trust it.
   - **Possible duplicates** — paired with the issue they duplicate, with
     priority raised accordingly.
   - Already-in-progress issues — one line each, no action needed.

5. **Stop there.** Present the plan and end by asking which items Nathan
   wants actioned — implementation, labeling, and any learner-facing
   comment/release message all follow `feedback-coding-workflow` afterward,
   starting with a real implementation plan for whichever items he picks.
