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

2. **Evaluate each new/unlabeled issue:**
   - Read the title and body. Diagnostics (app/sw version, screen, course,
     mode, platform, viewport) are often embedded in the body — use them to
     judge reproducibility.
   - Check for **duplicates**: search open and recently-closed issues
     (`gh issue list --repo natembriggs/kana-quest-feedback --search "<terms>"
     --state all`) for the same underlying report.
   - Judge **severity/impact**: does it block core functionality (answering,
     progress saving, sync) vs. a cosmetic or edge-case issue.
   - Judge **clarity**: is it actionable as written, or does it need a
     clarifying comment before anyone can act on it?
   - Rough **effort estimate** (small/medium/large) — skim the relevant area
     of the app (`src/`) if it helps place the report, but don't go deep;
     this is triage, not implementation.
   - Recommend a next `status:*` label and, for anything you'd propose
     closing as `not_planned`, a one-line reason that would read kindly if
     it were ever paraphrased back to the reporter (see
     `feedback-release-credit-message-style` in memory for the tone this
     app uses toward learners).

3. **Draft the plan**, grouped for easy scanning:
   - **Quick wins** — small, clear, worth doing next.
   - **Needs a decision** — ambiguous scope, or a product call only Nathan
     can make.
   - **Larger effort** — clear but non-trivial; candidates for a future
     session, not this morning.
   - **Possible duplicates** — paired with the issue they duplicate.
   - **Candidates for not-planned** — with the kind, one-line reason.
   - Already-in-progress issues — one line each, no action needed.

4. **Stop there.** Present the plan and end by asking which items Nathan
   wants actioned — implementation, labeling, and any learner-facing
   comment/release message all follow `feedback-coding-workflow` afterward,
   starting with a real implementation plan for whichever items he picks.
