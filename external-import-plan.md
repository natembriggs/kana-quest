# External kanji import — research and implementation plan

Status: research and scoping complete; implementation not started. Sources
were checked on 24 August 2026.

## Decision summary

Build this as a **one-time, additive migration tool**, separate from Kana
Quest backup/restore and separate from future device sync.

1. Add a source-neutral import pipeline and named kanji collections first.
2. Ship plain-text/CSV/JSON import as the universal route.
3. Add WaniKani next: its official API provides the cleanest kanji progress
   data.
4. Add renshuu after that: its official API exposes named lists, schedules,
   studied kanji and per-term mastery data.
5. Treat Anki package files and mobile-app backups as later adapters. They
   are valuable, but their schemas are either arbitrary, binary or
   undocumented.

An import must never overwrite progress earned in Kana Quest by default.
Foreign status can seed an otherwise-empty Kana Quest record, but it must not
be represented as fabricated Kana Quest answers. Definition, Yomi and Writing
remain separate, and Writing is not inferred from generic recognition data.

The first useful release is therefore not “support every backup file.” It is:

- preserve a source list as a named collection;
- enrol its supported kanji in selected Kana Quest modes;
- optionally seed compatible status where Kana Quest has no existing record;
- preview every change before one atomic profile save; and
- report duplicates, unsupported characters and status that could not be
  mapped.

## 1. What is being imported

Three concepts need to remain distinct.

| Concept | Meaning in Kana Quest |
| --- | --- |
| Collection | A named, ordered view such as “WaniKani started kanji”, “Anki RTK” or a renshuu list. One kanji may appear in several collections. |
| Study enrolment | The existing `study[kanji][mode]` choice that makes a kanji eligible for Definition, Yomi or Writing sessions. |
| Progress | The existing `progress` records that control mastery and review timing. Progress remains keyed by character and mode, not by collection. |

Keeping these separate means that importing two overlapping lists does not
create two copies of a learner's progress. Removing a collection also must not
silently delete review history.

### 1.1 Scope for the first release

- Kanji only. Kana and vocabulary imports are separate product decisions.
- One-time imports initiated by the learner or parent.
- Named lists and their original order where the source provides both.
- Optional coarse learning status.
- Read-only access to external services.
- Local processing in the browser; uploaded files and API results are not
  sent to a Kana Quest server.

### 1.2 Explicitly out of scope

- Two-way or continuous synchronization with another learning service.
- Posting Kana Quest answers back to WaniKani or renshuu.
- Scraping a site's private pages or reverse-engineering an authenticated
  internal endpoint.
- Importing another service's mnemonics, definitions, example sentences,
  audio or other copyrighted teaching content. Kana Quest already has its
  own KANJIDIC2/JMdict/KanjiVG-derived content.
- Treating recognition of a kanji as evidence that it can be written.
- Reproducing a foreign scheduler exactly.

## 2. Fit with the current codebase

The existing design is unusually well placed for this feature:

- `profile.study` already separates intent from history per `(kanji, mode)`.
- `profile.unstudy` already carries timestamped removal tombstones.
- `profile.progress` is keyed by character, so imported orderings do not
  fragment progress.
- Synthetic multi-unit pools already power “Everything you're studying”. A
  collection can use the same pool shape.
- Session startup already loads every kanji unit touched by a cross-unit
  item list.
- “Test unlearned” already provides a placement path for someone who would
  rather verify an imported list than trust its status.
- Profiles are written as whole IndexedDB documents, so a prepared import can
  be applied atomically with one `saveProfile()` call.

The missing pieces are a collection model, a source-neutral normalization
layer, import-specific conflict rules and the wizard UI.

External data must **not** be passed to `store.importAll()`. That function
accepts Kana Quest backups and merges trusted Kana Quest profile records.
Foreign data needs validation and semantic conversion before it is allowed to
touch a profile.

## 3. Platform research

### 3.1 Summary

| Platform | User-accessible data route | Lists | Learning status useful to Kana Quest | Assessment |
| --- | --- | --- | --- | --- |
| [WaniKani][wanikani-api] | Official authenticated JSON API | No arbitrary custom kanji lists; started assignments form a useful set | Strong kanji-level SRS stage, due date, meaning totals and reading totals; no Writing and not per individual reading | **Priority 1 service adapter** |
| [renshuu][renshuu-api] | Official bearer-token JSON API | Named lists and schedules, plus all studied kanji | Per-term correct/missed totals, average mastery and study-vector data including last/next quiz | **Priority 2 service adapter** |
| [Anki][anki-export] | Plain-text, `.apkg` and `.colpkg` exports | Decks/subdecks | Scheduling can be included in packages; plain-text note export does not include it | **Text in the foundation; packages later** |
| [Kanshudo][kanshudo-export] | Flashcard-set download/export | Flashcard sets | Public documentation confirms export, but does not document a portable mastery schema | List candidate; obtain a fixture before an adapter |
| [Japanese Kanji Study][kanji-study] | In-app progress backup | Custom sequences/sets | Backup clearly contains progress, but no public file schema was found | High-value fixture candidate, especially for Writing |
| [Ringotan][ringotan-backup] | `Settings -> Advanced -> Export Backup`, producing a ZIP | Its curriculum/data | Writing progress is likely valuable, but the ZIP schema is not public | Experimental only after a fixture and permission check |
| [Kanjiru][kanjiru-export] | In-app file export/import | JLPT-focused kanji data | Site says data can be exported, but does not publish the schema | Experimental only after a fixture |
| [Japanese (Renzo)][japanese-app] | Share lists; in-app backup/restore | User lists | Backup status format is undocumented | List candidate after a fixture |

`jpdb` was also checked. Its site documents that it can import Anki and its
changelog refers to a public API, but no publicly documented route for
downloading a user's learning state was found. Keep it on a watchlist rather
than depending on an unofficial endpoint. Kitsun is similar: import is well
supported, but a reliable user-progress export could not be verified.

### 3.2 WaniKani

The [WaniKani API v2][wanikani-api] is the most implementation-ready source.
It uses a personal bearer token over HTTPS and returns paginated JSON. The
official documentation includes browser `fetch()` examples, documents a
60-request-per-minute limit, and provides rate-limit response headers.

Relevant reads are:

- `GET /v2/subjects?types=kanji` — joins a subject ID to the actual character
  and its accepted readings;
- `GET /v2/assignments?subject_types=kanji` — `started_at`, `srs_stage`,
  `available_at`, `passed_at`, `burned_at` and reset state;
- `GET /v2/review_statistics?subject_types=kanji` — separate aggregate
  correct/incorrect/current-streak fields for meaning and reading; and
- `GET /v2/spaced_repetition_systems` — the start, pass and burn stage
  positions, so the adapter need not assume that every subject uses one
  hard-coded ladder.

Default list membership should be assignments with `started_at != null`.
Unlocked-but-unstarted subjects can be offered as an optional second group,
not quietly counted as learned.

Limitations:

- WaniKani has one assignment stage for the subject as a whole.
- Reading statistics are per kanji, not per individual reading.
- Only WaniKani readings marked as accepted and also present in Kana Quest's
  `quizReadings` can seed Yomi. Other Kana Quest readings remain new.
- It contains no handwriting evidence, so Writing is enrol-only.
- WaniKani's documentation distinguishes user progress from WaniKani's
  copyrighted subject content and requires third-party tools to respect
  subscription access. Kana Quest should import only character identifiers
  and progress—not WaniKani mnemonics, hints or meanings.

### 3.3 renshuu

The current [renshuu OpenAPI/Swagger documentation][renshuu-api] describes a
bearer-token API intended for registered users to access their own dictionary
and personal data. The key is available inside renshuu under its API tool.

Useful endpoints are:

- `GET /v1/lists` and `GET /v1/list/{id}` for named user lists;
- `GET /v1/schedule` and `GET /v1/schedule/{id}/list` for schedules and
  groups such as `studied`, `notyetstudied`, `review_today` and mastery 1–9;
- `GET /v1/list/all/kanji` for all kanji studied by the user; and
- kanji records containing `user_data.correct_count`, `missed_count`,
  `mastery_avg_perc` and `study_vectors` with per-vector mastery and quiz
  dates.

This is better than a flat export because source list names and status can be
retrieved in the same adapter. However, `study_vectors` are represented by
source-facing names in the published schema. The implementation must capture
real sanitized responses and prove which vectors correspond to Definition
and Kanji-to-reading before mapping them. Kana-to-kanji recall is not the
same as handwriting and must not seed Writing.

Before implementation, verify from the deployed Kana Quest origin that:

- CORS permits the `Authorization` header;
- pagination and daily quota metadata are handled; and
- a read-only API key cannot accidentally be used by code paths that mutate
  lists or schedules.

### 3.4 Anki

The [Anki manual][anki-export] documents two materially different exports:

- **Notes in Plain Text** are tab-separated note fields. This is suitable for
  list import but does not carry scheduling.
- **Deck (`.apkg`) and collection (`.colpkg`) packages** may include
  scheduling information when that export option is enabled.

Anki has no universal “kanji field” or “this card tests a reading” concept.
Note types, fields and card templates are user-defined. A safe adapter needs
field selection and a preview rather than guessing from one sample row.

The first release should accept Anki's plain-text export through the generic
parser. Direct `.apkg`/`.colpkg` support is a later spike because it requires
ZIP/database parsing in a no-build browser app and still needs semantic field
mapping after the package is opened. If that spike is not worth the payload,
a small offline converter targeting Kana Quest's interchange JSON is the
clean fallback.

### 3.5 Downloadable but undocumented mobile backups

Several apps clearly let users take their data out, which makes future
support possible:

- Japanese Kanji Study's official changelog mentions a progress backup
  panel, custom kanji sequences, separate on/kun study and restored backup
  fixes.
- Ringotan documents a timestamped `Ringotan_backup_...zip` export.
- Kanjiru states that all local learning data can be exported to and imported
  from a file.
- Japanese (Renzo) documents list sharing and backup/restore.

None publishes a stable interchange schema. Do not implement a parser from
guesswork. Ask for a small, user-created fixture containing a known set of
characters in several states, inspect it locally, confirm that parsing the
format is permitted, and mark the adapter experimental until two app
versions produce compatible fixtures.

## 4. Product behaviour

### 4.1 Entry point and wizard

Add **Import learning data** under Settings, next to but visibly separate
from **Restore Kana Quest backup**.

The wizard has five steps:

1. **Choose source** — Text/CSV/JSON, WaniKani, renshuu, Anki text, or an
   explicitly experimental backup adapter.
2. **Choose data** — select a file or temporarily enter an API token, then
   select source lists/schedules/decks.
3. **Choose interpretation** — exact single-kanji fields or extract all
   supported kanji from vocabulary/text; choose Kana Quest modes.
4. **Choose status handling** — list only, use compatible source status, or
   import the list and verify it with a placement test.
5. **Preview and apply** — no write occurs before this screen.

The preview must show:

- source collection name and unique supported kanji count;
- new versus already-enrolled items per mode;
- status records to be seeded versus existing Kana Quest records left alone;
- Yomi readings matched and source readings not represented in Kana Quest;
- unsupported characters and duplicates;
- items extracted from multi-kanji words, separately from exact kanji rows;
- warnings caused by malformed rows or an unknown status; and
- the fact that API credentials will be discarded.

For large imports, show counts first and make the detailed exceptions list
expandable. A 2,000-kanji WaniKani import should not render 2,000 DOM rows by
default.

### 4.2 Mode defaults

- Definition: selected by default when the source contains kanji.
- Yomi: selected by default, but status is applied only where compatible
  reading evidence exists.
- Writing: off by default. It can be selected for enrolment, but status is
  seeded only by a source explicitly measuring handwritten recall.

If a kanji has no quizzable meaning or Yomi in Kana Quest, the corresponding
mode remains unavailable exactly as it is on the detail screen today.

### 4.3 Status choices

**List only** preserves membership and enrols selected modes, leaving every
new item “Waiting to learn”. This is the safe default for generic files and
undocumented backups.

**Use source status** seeds only missing progress records. It never changes a
Kana Quest record that already exists, even when the foreign source reports a
higher level. Imported totals do not become Kana Quest `seen`, `correct`,
`lapses` or `history` values.

**Verify with placement test** imports and enrols the collection but does not
seed status. It then offers the existing cold-test behaviour scoped to that
collection and mode. Correct answers become real Kana Quest placement
records; misses become the existing “Study missed” path.

### 4.4 Collections in everyday use

An imported collection is a synthetic pool made from its ordered `items`,
using the same cross-unit loading path as the current study-list pool. Its
screen should offer:

- browse the collection;
- learn waiting items;
- review due items in this collection;
- test unlearned items; and
- rename or remove the collection.

The main daily review remains “Everything you're studying”, so the learner
does not have to remember which source list a due kanji came from.

Removing a collection removes only the view. It does not delete progress or
un-enrol its kanji. Bulk un-enrolment is a separate, explicit action with its
own preview; otherwise deleting one of two overlapping lists could silently
remove material still wanted by the other.

## 5. Source-neutral import contract

Every adapter should return the same normalized structure before any profile
mutation:

```js
{
  format: 'kana-quest-import',
  version: 1,
  source: { type, label, exportedAt },
  collections: [
    { externalId, name, items: ['日', '月', '火'] }
  ],
  evidence: {
    '日': {
      definition: { practiced, strength, due, sourceLabel },
      recognition: {
        practiced, strength, due,
        readings: { 'ニチ': { practiced, strength, due } }
      },
      writing: { practiced, strength, due }
    }
  },
  warnings: []
}
```

Rules:

- `strength` is normalized to `0..1`; it is evidence, not a Kana Quest box.
- `due` is an ISO date or `null`.
- Omitted modes/readings mean “the source supplies no compatible evidence”,
  not “the learner is weak”.
- Adapters preserve source order. Normalization removes duplicate characters
  within a collection while keeping the first occurrence.
- Strings are Unicode-normalized before character extraction.
- Only characters for which `kanjiUnitFor(char)` returns a unit are
  importable. Everything else appears in the report.
- Raw payloads and credentials never enter this structure when a smaller
  derived value will do.

The public JSON shape doubles as a documented interchange format. Small
converter scripts and future platforms can target it without becoming part
of the app.

### 5.1 Generic text and CSV

Support these inputs without a platform-specific adapter:

- plain text containing kanji;
- newline-separated kanji or words;
- UTF-8 CSV/TSV with an interactive field selector; and
- `kana-quest-import` JSON.

Offer two extraction policies in preview:

- **Exact characters only** — accept rows/cells whose chosen field is one
  supported kanji; or
- **Extract kanji from words/text** — `学校` contributes `学` and `校`.

Define optional canonical CSV headers for portable status:
`collection`, `kanji`, `definition`, `yomi`, `writing`, `status`, `strength`
and `due`. Status values are `new`, `learning`, `known` or `mastered`;
`strength` may instead be `0..1` or `0..100`. Explicit mode columns override
the aggregate `status`.

Use a real quoted-field parser. Splitting lines on commas is not adequate for
definitions or list names containing commas.

## 6. Translating foreign status into Kana Quest

### 6.1 Conservative common mapping

For a practiced item with normalized strength `s`, calculate:

```text
box = clamp(round(s * MAX_BOX), 1, MAX_BOX)
```

Then create a **synthetic seed**, not a fake answer history:

- Definition/Writing record: the mapped `box`, corresponding Kana Quest
  `intervalDays`, zero attempts, empty `history`, and `updatedAt` equal to
  the import time.
- Yomi record: mapped `streak`, zero correct/incorrect counts, corresponding
  interval, and `updatedAt` equal to the import time.
- `due`: the earlier of a valid source due date and `importedAt +` Kana
  Quest's interval. An overdue source item is due now. With no source due
  date, use the Kana Quest interval.
- `importedBy`: the immutable import-receipt ID, so a safe undo can identify
  an untouched seed without confusing it with local work.

This retains coarse spacing without claiming that foreign reviews happened
inside Kana Quest. The first Kana Quest answer updates the ordinary record
normally.

Add `seedRecordFromStrength()` and `seedYomiRecordFromStrength()` beside the
scheduler rather than reproducing private interval constants in each
adapter.

### 6.2 WaniKani mapping

Use the subject's own SRS definition:

```text
strength = (stage - startingStage) / (burningStage - startingStage)
```

Clamp a started/reviewed item to at least the first Kana Quest box; stage 0
has no progress record. For WaniKani's documented default positions this
maps stages 1–9 approximately to Kana Quest boxes
`1, 1, 2, 2, 3, 4, 5, 5, 6`.

- Seed Definition only when meaning review statistics show that meaning was
  practised.
- For Yomi, convert accepted on'yomi to Kana Quest's katakana convention,
  normalize kun'yomi consistently, and seed only exact matches in the local
  `quizReadings` list.
- Recompute the kanji Yomi rollup from the imported per-reading records and
  stamp that parent rollup with the import time for deterministic merges.
- Enrol but do not seed readings the source cannot map.
- Never seed Writing.

### 6.3 renshuu mapping

Where an unambiguous mode vector exists, use its `mastery_perc / 100` and
`next_quiz`. Otherwise:

- use aggregate `mastery_avg_perc` only when the learner explicitly accepts
  a coarse Definition/Yomi mapping; or
- import the list without status and offer placement testing.

Do not copy renshuu correct/missed totals into Kana Quest attempt counters.
Keep them only in the transient preview if they help the learner understand
the mapping.

### 6.4 Anki mapping

Plain-text exports provide membership only unless the learner included an
explicit status field.

For a future package adapter, map a card's interval/due state only after the
user maps its note/card type to Definition, Yomi or Writing. Multiple cards
for one kanji/mode should be combined conservatively by the **weakest**
mapped state, not the strongest. Suspended, buried and leech handling must be
shown in preview rather than silently treated as mastery.

## 7. Profile and backup changes

Add optional profile fields with read-time empty fallbacks:

```js
collections: {
  [id]: {
    id, name, items, modes,
    source: { type, label, externalId },
    createdAt, updatedAt, deletedAt
  }
},
imports: {
  [id]: {
    id, sourceType, sourceLabel, collectionIds,
    strategy, importedAt, counts
  }
}
```

Collection IDs are local IDs. An external ID is metadata used to offer
“update existing collection” on a later manual import; it is not a global
identity claim.

Merge collections per ID using last-write-wins over `updatedAt`/`deletedAt`,
matching the timestamped study-list approach already being introduced for
sync. Import receipts are immutable and merge by ID.

No IndexedDB version bump is needed because profiles remain documents in the
same object store. The Kana Quest backup format should, however, move to
version 2 when collections ship:

- export version 2;
- continue accepting version 1 and fill missing fields;
- validate the optional collection/import shapes; and
- make old clients reject version 2 instead of accepting it while silently
  discarding collection data during a merge.

### 7.1 Apply, conflicts and undo

Apply an import to a deep clone, validate the resulting profile, and save it
once.

For each `(kanji, mode)`:

- add enrolment with the import timestamp if it is not already enrolled;
- clear an older `unstudy` tombstone because this import is a deliberate new
  enrolment;
- create progress only if that progress key is absent; and
- never replace, upgrade or downgrade an existing Kana Quest progress record
  in the first release.

A repeated import is therefore additive and safe, but is not synchronization:
new collection items and empty modes can be added; existing Kana Quest
learning remains authoritative. Items missing from a later source export are
not removed from the collection in version 1; removal requires an explicit
edit or bulk action with its own preview.

Offer **Undo this import** from its collection/receipt. Undo may remove only:

- synthetic progress whose `importedBy` still matches and whose `updatedAt`
  is still the import timestamp; and
- enrolments in the collection whose timestamp is still the import
  timestamp.

Anything reviewed, edited or re-enrolled since the import is left in place.
The collection itself receives a deletion timestamp so that a later device
merge cannot resurrect it.

## 8. Suggested module boundaries

Keep the source adapters pure and small:

```text
src/import/core.js             normalization, validation, preview, apply/undo
src/import/collections.js      collection pools and profile merge helpers
src/import/text.js             text, CSV/TSV and interchange JSON
src/import/wanikani.js         paginated read-only API adapter
src/import/renshuu.js          list/schedule/read-only API adapter
src/import/anki.js             later package adapter
test/import.js                 pure parser/mapping/apply tests
test/import-wiring.js          wizard and profile-save flows
test/fixtures/import/          small sanitized source fixtures
```

Load service adapters dynamically when their source is selected. The service
worker already ignores cross-origin requests, which is the right behaviour:
authenticated API responses must never enter Kana Quest's asset cache. Add
only the local import modules needed offline to the shell/runtime cache.

API tokens:

- live only in the wizard's memory;
- are sent only in an `Authorization` header to the selected official API;
- are never put in URLs, IndexedDB, `localStorage`, logs, backups, sync
  documents or service-worker caches; and
- are cleared on success, cancel, error and navigation away.

## 9. Delivery phases

### Phase 0 — fixtures and contract

- Finalize the normalized import schema and validation errors.
- Create tiny synthetic interchange fixtures.
- Obtain sanitized WaniKani and renshuu responses for known characters and
  statuses.
- Obtain one Anki text export.
- Verify API CORS, auth failures, pagination and rate/quota behaviour.
- Decide the exact renshuu vector mapping from real data.

**Exit criterion:** every status mapping in code can be explained by a
fixture and a source field; no mapping depends on UI text guessed from a
screenshot.

### Phase 1 — collections plus universal file import

- Add the profile collection/import fields and merge rules.
- Add collection pools and a minimal collections screen.
- Implement plain text, quoted CSV/TSV and interchange JSON.
- Implement mode selection, preview, additive apply and safe undo.
- Add “Verify with placement test” scoped to the imported collection.
- Bump Kana Quest backup export to version 2 while retaining version-1
  import.

**Exit criterion:** a file containing duplicate single kanji and compounds
can create one ordered collection, enrol chosen modes, make no unintended
progress changes, survive backup/restore, and be safely undone.

### Phase 2 — WaniKani

- Add transient token entry and connection test.
- Fetch/paginate subjects, assignments, SRS definitions and review
  statistics.
- Preview started and optionally unlocked-unstarted groups.
- Implement definition and accepted-reading mappings.
- Handle resets, hidden subjects, unavailable subscription content, 401/429
  responses and partial network failure.

**Exit criterion:** a known fixture and a real account import produce the
same collection/status summary; no token or WaniKani content appears in a
Kana Quest backup.

### Phase 3 — renshuu

- Add transient read-only key entry.
- Fetch lists, selected list/schedule pages and studied kanji.
- Map proven Definition/Yomi vectors and surface ambiguous vectors.
- Respect API quota metadata and retry rules.

**Exit criterion:** named source lists retain their names/order and a fixture
covering unstudied, learning, mastered and due items maps predictably.

### Phase 4 — Anki packages

- Spike browser-side package/database parsing and measure added payload.
- If acceptable, add deck/note/card selection and semantic field mapping.
- If not, add a documented offline converter to interchange JSON instead.
- Test current and legacy package variants with and without scheduling.

**Exit criterion:** arbitrary note types cannot silently map to the wrong
Kana Quest mode, and package parsing does not compromise the app's small
no-build/offline design.

### Phase 5 — fixture-driven mobile adapters

- Prioritize Japanese Kanji Study and Ringotan because their handwriting
  status could fill Kana Quest's otherwise-unserved Writing mode.
- Add Kanjiru, Kanshudo or Japanese/Renzo only when a stable, permitted
  fixture demonstrates useful data beyond generic text import.
- Label undocumented formats experimental and fail closed on unknown schema
  versions.

## 10. Test plan

Pure tests should cover:

- UTF-8, Unicode normalization, variation selectors and multi-code-point
  input;
- quoted CSV/TSV fields, byte-order marks and different line endings;
- stable order with duplicate kanji across rows and collections;
- unsupported characters and kanji absent from Kana Quest;
- exact-only versus extract-from-word behaviour;
- normalized status bounds and due-date clamping;
- WaniKani stage mapping and on'yomi katakana normalization;
- per-reading Yomi matching and rollup recomputation;
- renshuu ambiguous-vector handling;
- existing Kana Quest progress always winning;
- timestamped study/unstudy interactions;
- idempotent repeated import;
- safe undo after no activity and safe refusal after later activity;
- collection last-write-wins merge and deletion tombstones;
- version-1 and version-2 backup handling; and
- proof that profiles/backups/import receipts contain no API token or raw
  authenticated payload.

Wiring tests should cover cancel-without-write, preview counts, source errors,
one atomic save, collection-scoped sessions and large-preview rendering.

Manual checks on iOS/Android installed PWAs should include file picking,
large WaniKani imports, leaving the app mid-import, offline errors, API token
keyboard/autofill behaviour and returning to the app after an external file
share.

Add `test/import.js` to the README's documented test commands and keep all
existing smoke, wiring, store and service-worker tests passing.

## 11. Risks and decisions to revisit

| Risk/question | Current answer |
| --- | --- |
| A foreign “mastered” state is not equivalent to Kana Quest mastery | Use a documented coarse seed or placement test; never copy a foreign scheduler wholesale. |
| Yomi is per reading in Kana Quest but usually per kanji elsewhere | Seed only readings explicitly matched; report the remainder as new. |
| Imported status could erase evidence of a Kana Quest lapse | Never overwrite an existing local record. |
| Re-import sounds like sync | State clearly that v1 is additive one-time migration. Continuous reconciliation needs a separate provenance/conflict design. |
| Custom collections add sync/backup state | Give them timestamped LWW merge and a backup-format bump from the start. |
| Direct APIs may change or block browser requests | Fixture-test versioned fields; detect CORS/auth errors; keep interchange JSON as the fallback. |
| Undocumented backups may change silently | Require fixtures, schema sniffing and fail-closed version checks; mark adapters experimental. |
| Large imports could trigger an immediate review avalanche | Seed future due dates from Kana Quest intervals and preserve an earlier real source due date; preview how many are due now. |
| External teaching content has licensing restrictions | Import characters, membership and learner-owned status only. |

## 12. Definition of done for the overall feature

- A learner can import a list without editing JSON by hand.
- WaniKani and renshuu users can use official read-only data routes directly
  from the app.
- Source list names and order survive as Kana Quest collections.
- Definition, Yomi and Writing enrolment/status are never conflated.
- Unsupported and ambiguous data is visible before apply.
- Existing Kana Quest progress is unchanged unless the learner subsequently
  answers a Kana Quest question.
- Import is atomic, repeatable, backup-safe and safely undoable.
- Credentials and raw third-party data do not persist.
- All source adapters target one documented interchange model, so adding a
  future platform does not require another set of profile mutation rules.

## Sources

- [WaniKani API v2 reference][wanikani-api]
- [Anki manual: Exporting][anki-export]
- [renshuu API Swagger documentation][renshuu-api] and the developer's
  [API announcement/discussion][renshuu-api-thread]
- [Kanshudo flashcard export announcement][kanshudo-export]
- [Japanese Kanji Study changelog][kanji-study]
- [Ringotan backup instructions][ringotan-backup]
- [Kanjiru export statement][kanjiru-export]
- [Japanese app sharing and backup features][japanese-app]
- [jpdb homepage][jpdb] and [changelog][jpdb-changelog]

[wanikani-api]: https://docs.api.wanikani.com/20170710/
[anki-export]: https://docs.ankiweb.net/exporting.html
[renshuu-api]: https://api.renshuu.org/docs/
[renshuu-api-thread]: https://www.renshuu.org/forums/topics/11824/Interested_in_working_with_a_renshuu_API%3F
[kanshudo-export]: https://www.kanshudo.com/blog/2017-10-flashcard-improvements
[kanji-study]: https://mindtwisted.com/changelog.html
[ringotan-backup]: https://www.patreon.com/RingotanApp/posts/july-2025-update-133523845
[kanjiru-export]: https://kanjiru.app/en/
[japanese-app]: https://www.japaneseapp.com/features/
[jpdb]: https://jpdb.io/
[jpdb-changelog]: https://jpdb.io/changelog
