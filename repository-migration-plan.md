# Kanji Trail repository migration and permanent recovery page

Status: **planned; implementation not started.** Agreed direction 1 October
2026. The full app repository will be named `kanji-trail`, matching the app's
name, **Kanji Trail**. The old GitHub Pages address will remain available as a
permanent migration page.

This expands the retirement work in
[`rename-and-hosting-plan.md` §9](rename-and-hosting-plan.md#9-phase-4--ending-the-dual-run)
and supplies the implementation and cutover sequence. The existing app rename,
Cloudflare hosting, and dual run remain in place until this plan is executed.

## Decision summary

Rename the existing full repository to `kanji-trail`, make it private, and
create a **fresh public `kana-quest` repository containing only the migration
page**. Preserve the full app's history and the old site's exact address.

| Repository | Visibility | Purpose |
| --- | --- | --- |
| `natembriggs/kanji-trail` | Private | Full app, history, tests, authoring tools, and deployment to `https://kanjitrail.com/` |
| `natembriggs/kana-quest` | Public | Permanent migration page at `https://natembriggs.github.io/kana-quest/` |

Deleting the app files in a new commit in the old public repository is not
enough: the full app would remain in its public history. The public placeholder
must start with fresh history, while the original history moves with the
private full repository.

The retirement condition is **known users confirmed, recovery page tested,
and deployment verified**, rather than proving that nobody will ever return
to the old address.

## 1. Establish the starting point and recovery options

Before implementation:

- Confirm that the latest app is deployed successfully at `kanjitrail.com`.
- Record the current GitHub Pages publishing source and settings. Do not
  assume that the Cloudflare workflow also manages the old Pages deployment.
  As checked on 1 October 2026: `build_type: legacy`, source branch `main`,
  path `/`, HTTPS enforced, no custom domain. Every push to `main` therefore
  rebuilds the old site as well as deploying Cloudflare (§7 changes this).
- Record Cloudflare deployment settings, repository secrets/variables by
  name, and integrations tied to the repository name (§8 step 3 lists the
  known ones). Never write secret values into this plan or a public staging
  directory.
- Check that `natembriggs/kanji-trail` is available (it was on 1 October
  2026; the repository had 0 forks).
- Save a recovery copy of the complete repository, including branches and
  tags, and record the last working app and Pages deployments. A
  `git clone --mirror` does not include untracked local files: back up
  `feedback-server/.dev.vars` (which holds `RELEASE_SECRET`) separately, to a
  private location, never into the repository.
- Identify working copies and active coding sessions using the old remote.
- Settle which local checkout is authoritative before editing. The personal
  file map identifies `~/Other/GitHub/kana-quest` as the current working copy;
  an older Dropbox checkout also exists. Preserve unrelated local work.
  Claude Code's per-project memory is keyed by checkout path, and this
  project's existing memory sits under the Dropbox path; move or copy it so
  sessions in the authoritative checkout see it.
- Actions minutes for the private repository are planned in §8.1: the
  current macOS `jsc` job alone would use about the whole free allowance.

**Exit condition:** the current app and deployment can be restored, and every
known connection to the old repository has been identified.

## 2. Build a small, independent migration page

Develop the migration page inside the full app repository, with a staging
tool that produces only the files needed for the public placeholder. Keep its
source and meaningful tests in the private repository; export a small,
explicitly reviewed public payload.

The page should offer:

- **Kana Quest has moved to Kanji Trail.**
- A list of learners saved on this browser/device.
- **Download everyone's progress** — the recommended first step for shared
  devices, covering every learner in one backup file.
- **Prepare this learner's sync code** — one learner at a time.
- Copy/share controls for the code, where supported, with readable text as
  the fallback.
- **Open Kanji Trail**, opening a new tab with migration instructions.
- Clear steps for importing a backup or entering a code on the new site.

There should be no lesson screens, new-learner creation, or option to continue
practising on the old site. Local progress remains available after downloading
or transferring it; success must not trigger deletion.

If no saved learners are found, explain that users should try the browser or
installed copy where they previously practised, or use an existing backup or
sync code. Distinguish an empty database from a storage-access failure. A
storage error must not look like an empty account or create replacement data.

Use relative paths so the page works under `/kana-quest/`. Handle both the
directory address and `/kana-quest/index.html`, including existing query
strings that old update flows may add.

**Exit condition:** users can retrieve their saved progress without loading the
full learning app.

## 3. Preserve the existing data and sync contract

| Identifier or behaviour | Requirement |
| --- | --- |
| IndexedDB database `kana-quest` | Keep the existing name and access the existing profile, sync, and remembered-code stores |
| Backup format `kana-quest-backup` | Preserve the importable format and version; the download filename may use Kanji Trail |
| Existing sync Worker address | Keep existing clients and codes working |
| Existing key derivation and encryption settings | Preserve salts, algorithms, code rules, and encrypted document compatibility |
| Profile identities and merge rules | Preserve learner identities, history, and concurrent updates |
| Existing storage keys | Leave saved preferences and pairing information intact |

Reuse the existing export, encryption, transport, and merge logic wherever
practical. Extract shared functionality from `src/app.js` if necessary rather
than importing the entire learning app into the placeholder. The relevant
modules are `src/store.js`, `src/merge.js`, `src/sync-protocol.js`, and
`src/sync-transport.js`.

Read stored profiles without discarding fields the page does not understand.
Opening the page must not create a replacement profile or unnecessarily
upgrade the database. Preserve the existing backup envelope produced by
`store.exportAll()` and verify compatibility with `store.importAll()` on the
new site.

Keep the existing sync service and its cross-origin access working. Do not
rename the stateful Workers, Durable Objects, or D1 databases as part of the
repository rename. The feedback service's separate repository and live data
are outside this migration. The recovery page has no feedback button, so it
does not need the feedback Worker; leave `https://natembriggs.github.io` in
that Worker's `ALLOWED_ORIGINS` and `TURNSTILE_HOSTNAMES` anyway, so an old
app still open on a device can submit feedback until it is replaced.

**Exit condition:** exporting and transferring preserve every learner's saved
fields, including study progress, history, settings, bookmarks, and
contributions.

## 4. Make the sync-code action verify the transfer

The current migration card can display an existing code without itself
confirming that the server has the latest local progress. The placeholder
must verify the transfer before describing the code as ready.

When someone selects **Prepare this learner's sync code**:

1. Read the latest saved profile and pairing information.
2. Reuse the current code, or a remembered code when appropriate. Generate
   one only when needed.
3. Fetch and merge remote progress using the existing sync protocol.
4. Upload any remaining local changes.
5. Show **Ready to use in Kanji Trail** only after a successful sync result
   establishes that the remote copy includes the saved local progress.

Do not require an unnecessary write when the protocol has verified that the
remote already contains the same progress. Do not treat possession of a code,
an old success timestamp, or a clean local flag alone as verification.

Handle connection failures, conflicts, oversized profiles, and decryption
errors explicitly. If a previously known remote profile has been deleted,
retain the existing protection against silently recreating it. Offer an
explicit recovery choice or the backup route.

Serialize operations for a learner and prevent switching learners from
showing one person's code under another person's name. Account for changes
saved by another open old-app tab during the transfer.

If syncing fails, keep **Download progress** available. An existing code may
still be shown, but its status must say that the latest progress has not been
verified. Preserve the local copy and pairing information on failure.

Codes are key material: keep them out of links, query strings, logs,
analytics, and error reports. The existing `?from=kq` arrival marker may be
used because it contains no code or profile data.

**Exit condition:** a successful code transfer brings across the latest saved
progress, including changes made since the previous sync.

## 5. Handle installed and cached copies

Keep serving an updated worker at `/kana-quest/sw.js`, with the existing
registration scope. A plain HTML replacement is insufficient for the whole
installed-app lifecycle.

The replacement worker should:

- Cache the migration page and its small dependency set for offline export.
- Serve the recovery page from its own cache whenever the network returns a
  non-OK response, not only when the fetch throws. The current app worker
  passes an HTTP error straight through (`sw.js` returns `fresh` whether or
  not `fresh.ok`), so during the §8 gap between renaming the old repository
  and publishing the new one, an installed copy would show GitHub's 404
  page. Because this worker is live from §7 onwards, well before the
  cutover, this one rule makes that gap harmless for every device that has
  opened the recovery page once. The payload is small and changes rarely,
  so cache-first for its own files with background revalidation is also
  acceptable; the app worker's network-first reasoning (stale files during
  development) does not apply here.
- Activate only after its essential files have been fetched successfully.
  This deliberately reverses the app worker's tolerant install (its note 2:
  a single failed file must not block an update). That trade is right for a
  large app and wrong for a recovery page that must work offline. If the
  strict install fails, the old app worker keeps serving the old app, whose
  migration notice still offers both routes, so failure is safe.
- Remove obsolete app caches only after the replacement is ready.
- Restrict cleanup to this application's recognised caches; preserve other
  applications sharing the GitHub Pages origin.
- Preserve IndexedDB, localStorage, saved codes, and unrelated storage.
- Handle an already-open old app without forcing a reload during practice.
- Preserve the installed app's entry points; include the manifest and icons
  needed for a working transition.

Test an old installed copy, an ordinary browser tab, and an offline launch.
An offline device may continue running its cached old app until it reconnects;
the transition must still retrieve its latest saved progress. Decide and test
how an open session finishes before it is replaced, and prevent partially
updated old pages from loading incompatible new dependencies. Specifically:
an old app left open loads per-grade data on demand
(`src/data/kanji-grade-*.js`, `stroke-grade-*.js`,
`kanji-components-*.js`), and none of those files will exist in the
recovery payload. Test that such a request, answered with a 404 or with the
new worker's fallback, fails visibly and leaves saved progress intact,
rather than the new worker substituting HTML for a script.

Avoid instructions to clear site data or uninstall the old app before
transferring. Do not blanket-unregister service workers for the shared origin.

**Exit condition:** returning users reach a working recovery page through both
browser bookmarks and installed copies, with saved progress intact.

## 6. Test the complete migration before changing repositories

Use synthetic profiles with recognisable progress rather than real users'
data. Verify the result in Kanji Trail, not just the placeholder's status text.

| Scenario | Required result |
| --- | --- |
| One learner, never synced | New code transfers all saved progress |
| Existing code with unsent changes | Latest changes reach Kanji Trail |
| Several learners | Backup imports everyone correctly |
| Progress already exists on Kanji Trail | Merge preserves progress from both sites |
| Sync disabled, remembered code present | Existing pairing resumes appropriately |
| Remote document deleted | No silent resurrection |
| Offline or sync server unavailable | Backup download remains available |
| Conflict, oversized data, or decryption failure | Clear failure with local data preserved |
| Database cannot be opened | Clear storage error, without replacement data |
| Old installed app and cached worker | Safe transition to the placeholder |
| Interrupted worker update | Previously working recovery/app remains usable |
| Old address returns 404 (cutover gap) | Installed copy still shows the cached recovery page |
| Open old app requests a grade data file | Visible failure, no HTML-as-script, progress intact |
| Another tab saves progress during transfer | Latest saved changes can still be exported and synced |
| No local data | Helpful recovery instructions |
| Repeated transfer | No duplicate learners or lost progress |
| Older supported database/profile shape | Export and import preserve existing progress |

Run the existing storage, merge, sync, and worker suites, plus browser-level
checks for actual download/import and code-entry flows. Manually check iPhone
Safari and a home-screen installation where available.

Inspect the staged public payload and its import graph. It must contain no
stories, authoring notes, full app payload, secrets, or original Git history.
Keep meaningful transition tests in the private repository.

**Exit condition:** both routes work end to end, and existing Kanji Trail users
are unaffected.

## 7. Confirm known users and publish the holding page

The existing hosting notes record that Nathan knows the current users
personally. Use individual confirmation rather than adding migration
telemetry. For each known household/device, confirm:

- They can open Kanji Trail.
- Every learner has transferred.
- Expected progress is visible.
- They have saved a backup or recovery code.

Publish the migration page at the existing Kana Quest address first, while
the full repository still has its original name. Do not replace the full
app's `main` with the placeholder. Keep Cloudflare's app deployment intact.

Publish from an orphan `gh-pages` branch:

1. Create `gh-pages` with `git switch --orphan gh-pages`, so it shares no
   history with `main`.
2. Commit only the reviewed public payload from the §2 staging tool. Include
   `.nojekyll`: Pages uses the legacy (Jekyll) build, which skips files and
   folders beginning with `_`, and the current repository carries a
   `.nojekyll` for the same reason.
3. Push it, then switch the Pages source from `main` `/` to `gh-pages` `/`.
4. From then on, pushes to `main` deploy only Cloudflare; the old address
   changes only when `gh-pages` does.

The orphan branch already has exactly the fresh, public-only history that
the new public repository needs, so §8 step 6 publishes this same branch
rather than rebuilding the payload. Updates before the cutover are new
commits on `gh-pages`, produced by the staging tool and inspected before
each push.

This separates the user-facing retirement from the repository move and
allows problems to be caught before the final cutover.

**Exit condition:** known users have confirmed their transfers, and the page
works at the real old address. It remains available for anyone missed.

## 8. Move the repositories in a coordinated cutover

The fresh placeholder history already exists: it is the orphan `gh-pages`
branch from §7, with only reviewed public files. Then:

1. Pause app pushes and deployments briefly; coordinate active sessions.
2. Switch CI to the private-repository shape in §8.1, push it to `main`, and
   confirm that a deploy succeeds with it while the repository is still
   public and minutes are still free.
3. Disable GitHub Pages on the full repository. Doing this before the rename
   stops it from briefly publishing a second copy under `/kanji-trail/`. The
   gap at the old address starts here; §5's fallback covers installed copies.
4. Rename the existing full repository from `kana-quest` to `kanji-trail`.
5. Update every known integration to
   `https://github.com/natembriggs/kanji-trail.git`. Audit repository-name
   references individually; do not globally replace storage/protocol names.
   Known integrations, as of 1 October 2026:
   - Git remotes in every checkout: `~/Other/GitHub/kana-quest`, the older
     Dropbox checkout, and any `.claude/worktrees/*` worktrees.
   - Claude Code web environments and cloud sessions bound to the repository.
   - Scheduled cloud routines: the daily feedback-triage routine and the
     reminder routines that chain it.
   - The Claude GitHub app's repository access. A rename keeps the
     repository's id, so access should follow, but check that the renamed
     repository is listed.
   - Notes that name the repository: the personal file map
     (`knowledge-base/file-map.md`), Claude Code project memory, and the
     README's `https://<user>.github.io/kana-quest/` setup text.
   - Anything in the `kana-quest-feedback` inbox repository that links to
     commits or issues in the app repository.

   This step must be finished before step 7, not just eventually. The
   moment a new public `kana-quest` exists, anything that still finds the
   repository by name resolves to the placeholder: it carries on without
   error against the wrong repository instead of failing.
6. Make the full repository private.
7. Create the fresh public `kana-quest` repository, push the orphan branch
   as its `main` (`git push <new-remote> gh-pages:main`), and enable Pages
   from `main` `/`. Do not copy the full app's workflows or Cloudflare
   deployment credentials into it.
8. Verify the exact old address, including `index.html`, the worker,
   dependencies, and installed-app entry points.
9. Verify tests and a Cloudflare deployment from private `kanji-trail`,
   including the existing live-version check.
10. Resume normal development with only `kanji-trail` deploying the full app.

GitHub redirects repository links after a rename, but project Pages addresses
are excluded. Reusing the old repository name also removes the repository
redirect. Every old Git remote must therefore be updated before the
placeholder takes that name. See
[GitHub's repository-renaming documentation](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository).

Allow for a brief interruption, from step 3 until Pages has published the
replacement in step 7. Renaming the repository does not remove users' browser
data. A device that has already loaded the recovery page's worker (§5)
serves the cached recovery page throughout. A device still running the old
app worker sees GitHub's 404 page and recovers on its next visit, minutes
later. Keep steps 3–7 together in one sitting. Staging the old path through a
user-level Pages site is no longer proposed: no `natembriggs.github.io`
repository exists, and §5's fallback makes it unnecessary.

### 8.1 CI after the repository goes private

**Why it has to change.** Actions is free without limit for public
repositories. As understood on 1 October 2026 (check current pricing before
step 2), a private repository on GitHub Free includes 2,000 minutes a month.
Each job is rounded up to a whole minute, and macOS minutes count ten times.
`test.yml` ran 201 times between 1 September and 1 October 2026:

| Job | Runner | Typical run | Billed per push | September total |
| --- | --- | --- | --- | --- |
| `test` (`jsc`) | macOS | ~35 s | 10 min | ~2,010 min |
| `test-node` | Linux | ~25 s | 1 min | ~200 min |
| `deploy` | Linux | ~30 s | 1 min | ~200 min |

That is about 2,400 minutes against 2,000. With GitHub's default $0
spending limit, Actions stops when the allowance runs out, and with it the
automatic deploy to `kanjitrail.com`, part-way through a busy month.

**Why `jsc` can move off the deploy path.** Both jobs run the same 11
`test/*.js` suites. `jsc` is Safari's engine and stays the reference runner
for local work (README); `test-node` additionally catches unhandled promise
rejections that the `jsc` shell drops. Since `test-node` was added, CI has
failed three times, and both jobs failed every time: `jsc` has not caught
anything Node missed. The six earlier `jsc`-only failures happened before
`test-node` existed. Local sessions on a Mac also keep running `jsc` before
they push.

**New shape of `test.yml`:**

- `test-node` (Linux): on every push to `main`, every pull request, the
  nightly schedule, and manual runs.
- `deploy` (Linux): `needs: [test-node]` only, on pushes to `main`. Keep its
  `concurrency` group and the live-version check unchanged. A push is still
  live about a minute later, so phone testing after a push works as now.
- `test` (`jsc`, macOS): on pull requests, a nightly `schedule` (for example
  `cron: '30 3 * * *'`, UTC), and `workflow_dispatch`, which adds a "Run
  workflow" button. Not on pushes to `main`. A nightly failure does not undo
  a deploy; GitHub emails the failure, and the fix goes forward as a normal
  push.
- Optional refinement: a cheap Linux step before the nightly `jsc` job skips
  it when `main` has not changed since its last successful run, so quiet
  days cost nothing.

**Expected cost:** about 2 minutes per push (~400 a month at September's
pace) plus at most ~300 for the nightly job: roughly 700 of 2,000. Review
actual usage after the first private month (§9).

**Manual fallback:** `tools/deploy-site.sh` still deploys from the Mac
without CI if Actions is ever unavailable.

Public GitHub Pages is supported for public repositories on GitHub Free, so
the small public placeholder avoids depending on private-repository Pages
support. Private app hosting remains on Cloudflare. See
[GitHub's Pages documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site).

**Exit condition:** the full history is private under `kanji-trail`, the fresh
public `kana-quest` serves the recovery page, and normal app deployment works.

## 9. Verify privacy, rollback, and long-term recovery

Final checks:

- The full repository requires authorised access.
- The public placeholder has fresh history containing only migration files.
- `kanjitrail.com` still serves the full app and its expected version.
- The old address exports local progress and prepares working codes.
- Private-repository Actions usage matches §8.1's estimate; recheck the
  billing page after the first full private month.
- The placeholder has its own documented maintenance and publishing steps.
- A failed placeholder deployment can be rolled back without touching user
  data or exposing the full repository's history.

Keep the recovery page indefinitely. Check it whenever backup or sync
compatibility changes, and preserve older import support on Kanji Trail. A
failed new-site deployment can be rolled back using the recorded app version;
a failed placeholder deployment should use the previous known-good public
payload. Do not use restoring full public history as the normal rollback.

A permanent page preserves the opportunity to recover; it cannot guarantee
recovery after a browser has erased local data. The current sync server also
removes documents five years after their last successful write; reads alone
do not renew that period. Backups remain the independent fallback.

Making the repository private removes direct public access to its history
and authoring material. It does not hide assets and JavaScript delivered by
the live app, or recall copies/forks already obtained while it was public.

## Implementation checklist

- [ ] Baseline, publishing configuration, recovery copies, and remotes recorded.
- [ ] Independent migration page and explicit public staging tool built.
- [ ] Existing database, backup, identity, and encryption contracts preserved.
- [ ] Sync-code preparation verifies the remote copy and handles failures.
- [ ] Installed-app and offline transitions implemented safely.
- [ ] Synthetic-profile and real-browser checks pass.
- [ ] Public payload inspected for unwanted app/source material.
- [ ] Known users confirm every learner's progress on Kanji Trail.
- [ ] Holding page deployed from an orphan `gh-pages` branch and verified at
      the old address.
- [ ] CI switched to the §8.1 shape and a deploy verified while still public.
- [ ] Full repository renamed to `kanji-trail` and made private.
- [ ] All known remotes and integrations (§8 step 5) updated before name reuse.
- [ ] Fresh public `kana-quest` created and Pages verified.
- [ ] Private-repository tests and Cloudflare deployment verified.
- [ ] Recovery-page maintenance and rollback documented.
