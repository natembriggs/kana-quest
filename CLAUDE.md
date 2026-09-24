# Working in this repo

## Push and deploy

Once a change on a feature/session branch is committed and its tests pass,
push it to `main` and let CI deploy it — don't stop and ask first. Pushing
to `main` triggers `.github/workflows/test.yml`: the `test`/`test-node`
jobs re-run every suite, and if they're green, `deploy` ships straight to
kanjitrail.com and verifies the live `sw.js` version matches. This is the
normal, low-ceremony path for this one-owner repo, not a special
occasion — treat "implement X" as including "and ship it," not just "and
leave it on a branch."

Exceptions — stop and ask instead of pushing straight to main:
- The user says otherwise for that change (e.g. "just commit, don't push").
- You have strong doubts about the change itself: tests are red, the fix is
  speculative/unverified, or the blast radius is unclear (e.g. a full
  regeneration of a large generated dataset — diff it and read the diff
  before pushing, same as any other change, but don't withhold the push
  once you're actually confident).
- The change is to something other than this repo's own `main` (someone
  else's PR, force-pushing, rewriting history) — the usual git safety
  rules still apply on top of this.

A push to `main` should be a fast-forward whenever possible (fetch
`origin/main` first) — if it isn't, resolve normally rather than force-push.
