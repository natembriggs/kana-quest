# KanaQuest evaluation

Date: 20 August 2026

**This is a historical review, kept as the record of the original audit and
its fixes.** For the current, actively-maintained punch list of outstanding
work, see `review-followups.md` (2026-09-03 as of this note) instead — several
items below (the accessibility pass, the home-screen kanji total) are still
open, but newer and higher-priority findings from later reviews live there,
not here.

## Executive summary

KanaQuest is already a strong, unusually thoughtful learning app. The core flows are clear on a phone, the visual language is consistent, the touch targets are generally generous, and the learning model goes well beyond a toy flashcard app. In particular, first-attempt grading, per-reading Yomi records, deliberate separation of learning and review, and the forgiving handwriting grader are all well reasoned and well tested.

The four JavaScriptCore test suites pass. A manual browser pass at 390×844 and 320×568 covered profile creation, script and mode selection, set overviews, character details, lesson cards, reading feedback, handwriting mode, kanji search, study enrollment, review scope, and settings.

The initial review found four high-priority engineering issues rather than problems with the visible learning flow. All four have now been addressed:

1. Backup merging could silently omit Yomi progress and study-list state; conflict-safe merging and tests are now in place.
2. Service-worker cleanup could delete caches and registrations belonging to other apps on the same origin; cleanup is now scoped to KanaQuest.
3. The page ran in browser quirks mode and disabled zoom; it now uses standards mode and permits user scaling.
4. More than 2 MB of generated data blocked the first useful screen; kanji and stroke data are now split and loaded by unit on demand.

## What is working particularly well

- The mobile UI is calm, legible, and visually coherent. At 390 px wide, all major screens feel purpose-built rather than adapted from desktop.
- The quiz mechanics preserve the pedagogically meaningful first attempt while still giving the learner a second chance.
- Kanji Definition, Yomi, and Writing progress are independent. Per-reading Yomi scheduling is a particularly good choice.
- The handwriting design explicitly minimizes discouraging false rejections, exposes strictness as a per-learner setting, and retains learner self-grading in Free mode.
- Kanji search, detail pages, example words, study enrollment, and “Study it now” form a coherent discovery-to-practice flow.
- Progress remains local, the app has no runtime dependency on a third party, and the README documents the data provenance and offline model well.
- The pure-logic and stub-DOM tests have broad coverage and useful explanatory failure messages.

## Prioritized fixes

### P0 — Make backup merging safe for every record type

Implementation status: fixed and committed on 20 August 2026, with focused coverage in `test/store.js`. The description below records the original failure and the rationale for the fix.

`src/store.js:141-164` compares records only by `history.length`. Yomi records, however, use `correct`, `incorrect`, `streak`, and `lastReviewed`; they have no `history`. Therefore:

- an incoming Yomi record missing from an existing profile compares as `-1` versus `-1` and is not imported;
- a newer Yomi record never replaces an older one;
- once ordinary histories reach their 300-entry cap, equal-length records no longer have a reliable tie-breaker;
- `study` and `settings` from the backup are ignored when a matching profile already exists.

This contradicts the UI promise that a backup moves all progress and can cause silent loss during repeated transfers.

Suggested fix:

- Give every record an `updatedAt`, or add event history to Yomi records too.
- When only one side has a key, always retain it.
- Resolve conflicts by the most recent grading event, not history length alone. If multi-device merging matters, merge and de-duplicate event histories before recomputing derived fields.
- Union per-mode study enrollment deliberately; define whether imported or local settings win and report that choice to the user.
- Validate imported profile shape and version before writing it.
- Add direct tests for first import, repeated import, missing local records, Yomi records, equal/capped histories, study state, and malformed backups.

### P0 — Restrict service-worker cleanup to KanaQuest

Implementation status: fixed in the working tree on 20 August 2026. Activation and Force refresh now affect only `kana-quest-` caches and KanaQuest's own registration; runtime writes are awaited; HTML fallback is navigation-only. `test/service-worker.js` and `test/wiring.js` cover the isolation paths.

Original finding: `sw.js:60-64` deleted every cache on the origin except the current KanaQuest cache. `forceRefresh()` in `src/app.js` similarly deleted every Cache Storage entry and unregistered every service worker registration on the origin.

On GitHub Pages, separate project sites share an origin such as `https://user.github.io/`. Updating or force-refreshing KanaQuest can therefore remove offline data belonging to unrelated PWAs under sibling paths.

Suggested fix:

- In activation, delete only keys beginning with `kana-quest-` and not equal to the current key.
- In Force refresh, delete only KanaQuest cache keys and unregister only the registration for KanaQuest’s scope.
- At `sw.js:81`, await `cache.put(...)`; otherwise the worker may be terminated before runtime caching completes.
- Return `index.html` as an offline fallback only for navigation requests. A missing script, image, or data chunk should not receive HTML.
- Add a worker test that creates a sentinel cache for another app and proves KanaQuest leaves it untouched.

### P1 — Put the document in standards mode and restore zoom

Implementation status: fixed in the working tree on 20 August 2026. The document now has a doctype, explicit English language, proper head/body structure, an unrestricted viewport, and Japanese language annotations on the main glyph/reading regions. Real-browser checks confirmed `CSS1Compat`, no horizontal overflow, and no console warnings/errors at both 320×568 and 390×844.

Original finding: `index.html` started directly with `<meta>` and had no doctype, `<html>`, `<head>`, or `<body>`. The browser reported `document.compatMode === "BackCompat"`, so KanaQuest was running in quirks mode. This made cross-browser layout behavior less predictable.

The viewport also set `maximum-scale=1`, preventing users with low vision from zooming.

Suggested fix:

- Add `<!doctype html>`, `<html lang="en">`, a proper `<head>`, and `<body>`.
- Remove `maximum-scale=1`.
- Mark Japanese glyph/readings with `lang="ja"` where practical so assistive technology pronounces them appropriately.
- Recheck the 320 px and 390 px layouts after standards mode changes, because box metrics may shift slightly.

### P1 — Finish the in-progress lazy data loading

Implementation status: completed in the Phase 5/6 work committed on 20 August 2026. The app now keeps a small manifest in the shell and loads kanji/stroke data by unit on demand, with test coverage for manifest integrity, memoized loading, and session gating.

Before Phase 5, initial boot imported about 1.2 MB of `kanji-data.js` and 900 KB of `stroke-data.js` before the profile screen became useful. This penalized learners who only wanted Kana Reading and, because the service worker is network-first with `cache: "no-store"`, could recur while online.

The completed split follows the recommended direction:

- Always load only the small course manifest and kana essentials.
- Load a grade’s full dictionary data when that grade, its search result, or a session needs it.
- Load stroke paths only on a detail or writing screen.
- Preserve cross-grade meaning/reading search with a compact search index; otherwise the first search will have to download every grade and negate much of the split.
- Do not precache every lazy chunk in `SHELL`, or the install still downloads the full dataset.
- Show a scoped loading/error state for a grade or detail page if its chunk cannot be fetched.

### P1 — Correct accessibility state, announcements, and contrast

The DOM uses several `role="tablist"` containers, but their children remain ordinary buttons without `role="tab"` or `aria-selected`. Similar selected states—badge choice, grade, review scope, writing mode, and reading chips—are conveyed mainly through colour and CSS classes. Quiz feedback is not an `aria-live` region, and `#quiz-choices` is always labelled “Click the readings that apply,” even for single-answer Kana and Definition questions.

Colour contrast also needs a pass. In the light theme:

- accent `#e8553d` on the page background is about 3.38:1;
- white on the accent is about 3.62:1;
- white on mastery tier 3 (`#5cb663`) is about 2.52:1.

Those combinations miss WCAG AA for several text sizes currently used.

Suggested fix:

- Implement correct tab semantics and keyboard behavior, or use `aria-pressed` for controls that are really toggle-button groups rather than tabs.
- Add `aria-live="polite"` to feedback/status areas and update the choice-group label by mode.
- Expose selected badge, mode, grade, reading, and enrollment state programmatically.
- Move focus to the new screen heading when the SPA changes screens, while retaining sensible focus when returning from Detail.
- Darken the light-theme accent and tier-3 green, then add automated contrast/accessibility checks.
- Respect `prefers-reduced-motion` for the splash spinner, progress transitions, and looping stroke animation.

### P2 — Clarify the home-screen Kanji total

The home card reports statistics for the global `state.mode`. In the original pre-expansion browser pass, a fresh profile showed `0 / 1023` because the initial mode was Yomi, but opening Kanji reset the course to Definition and showed totals adding to 1,026. The exact totals are now larger after full jōyō coverage, but the underlying issue remains: switching Kanji modes can make the home total change without the card saying which mode it represents.

Choose one stable home metric, or label the metric explicitly—for example, “Yomi: 0 / 1023.” A compact per-mode summary would be even clearer once learners have progress in all three modes.

### P2 — Tighten the smallest-screen layout

At 320 px wide, the six grade buttons are about 43 px wide, just below the usual 44 px minimum touch target. The overview legend allows a colour swatch and its label to wrap independently, and the overview produced a one-pixel horizontal overflow in the test browser.

Suggested fix:

- Wrap each legend swatch and label in one non-breaking flex item.
- Use a 3×2 grade grid below 360 px, or allow a horizontally scrolling row with 44–52 px cells.
- Add an `overflow-x` regression assertion and screenshots at 320, 360, and 390 px.

### P2 — Add real-browser tests and CI without changing the runtime architecture

The current tests are excellent for logic and wiring, but `test/wiring.js` explicitly has no layout engine. There is no checked-in CI workflow, so regressions depend on someone running the macOS-only JavaScriptCore commands locally.

Keep the production app build-free, but add development-only browser coverage for:

- profile → lesson → quiz → summary;
- a real pointer-driven writing stroke;
- backup export/import round trips;
- service-worker install, offline reload, update, and cache isolation;
- standards mode, no horizontal overflow, and accessible selected states;
- parity between `APP_VERSION` and the service-worker `VERSION`.

A small Playwright suite in GitHub Actions would cover this without introducing a production build step.

### P3 — Bring the documentation back in sync

Implementation status: completed as part of the Phase 5/6 work. The README now identifies the explicit study list, lazy per-grade loading, and full jōyō coverage as shipped, while retaining JLPT/frequency grouping and beyond-jōyō support as future work. The backup description was also updated after the safe-merge fix.

Original finding: the README said the explicit study list was not built, while `kanji-expansion-plan.md` correctly recorded phases 0–4 as complete and said it superseded that README section. Some source comments also described Kanji Writing as inert even though it had shipped.

## Product improvements after the fixes

1. Add pronunciation playback on lesson and answer screens. Reading practice currently teaches visual-to-romaji mappings but supplies no authoritative Japanese sound. This is likely more valuable than speech input as a first audio feature.
2. Add a consolidated “My kanji” view with filters for waiting, due, difficult, and mode. Enrollment exists, but management still requires search/detail navigation one kanji at a time.
3. Add bulk enrollment by mode, especially “add Writing for everything already learned in Definition.” This is already identified as an open question in the expansion plan and will matter more with 2,136 kanji.
4. Add a local-only learner/parent snapshot: minutes or questions practiced, troublesome characters/readings, and upcoming reviews. The necessary history already exists; no analytics service is required.

## Verification performed

- `test/smoke.js`: all checks passed.
- `test/wiring.js`: all wiring checks passed; 50 records saved in the simulated sessions.
- `test/store.js`: all 12 backup/import checks passed.
- `test/service-worker.js`: all 8 cache-isolation and fallback checks passed.
- `git diff --check`: passed.
- Shell scripts passed `sh -n`.
- Manual browser review at 390×844 and 320×568.
- Confirmed `CSS1Compat` standards mode, `lang="en"`, an unrestricted viewport, and no horizontal overflow at both browser sizes.
- Measured the major generated payloads and light-theme contrast ratios.

Physical-device handwriting ergonomics, installed-PWA update behavior on iOS/Android, true offline reloads, and backup import/export were not end-to-end tested on hardware. Those are the highest-value targets for the proposed browser/device test pass.
