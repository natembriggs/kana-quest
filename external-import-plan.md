# External kanji and vocabulary import — research and implementation plan

Status: research and scoping complete; implementation not started. The scope
was expanded to cover assessment modes and future vocabulary on 24 August
2026.

## Decision summary

Build this as a **one-time, additive migration tool**, separate from Kana
Quest backup/restore and separate from future device sync.

1. Add a source-neutral import pipeline and named kanji collections first,
   but make the interchange format subject-typed from day one so vocabulary
   does not require a breaking redesign.
2. Ship plain-text/CSV/JSON import as the universal route.
3. Add WaniKani next: its official API provides the cleanest kanji progress
   data and already exposes vocabulary subjects for a later phase.
4. Add renshuu after that: its official API exposes named lists, schedules,
   studied kanji/vocabulary and per-term mastery data.
5. Run a Skritter integration spike in parallel with those adapters. It is
   the best semantic match—separate Writing, Reading and Definition SRS
   items for characters and words—but its published API is a legacy v0 API
   whose browser compatibility and integration terms need confirmation.
6. Treat Anki package files and mobile-app backups as later adapters. They
   are valuable, but their schemas are either arbitrary, binary or
   undocumented.

An import must never overwrite progress earned in Kana Quest by default.
Foreign status can seed an otherwise-empty Kana Quest record, but it must not
be represented as fabricated Kana Quest answers. Definition, Yomi and Writing
remain separate, and Writing is not inferred from generic recognition data.
Vocabulary progress must likewise remain separate from the progress of the
kanji contained in the word.

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
| Collection | A named, ordered view such as “WaniKani started kanji”, “Anki RTK” or a renshuu list. One kanji or vocabulary item may appear in several collections. |
| Study enrolment | The existing `study[kanji][mode]` choice that makes a kanji eligible for Definition, Yomi or Writing sessions. |
| Progress | The existing `progress` records that control mastery and review timing. Kanji progress remains keyed by character and mode; future vocabulary progress will be keyed by a stable local term ID and mode. Neither is keyed by collection. |

Keeping these separate means that importing two overlapping lists does not
create two copies of a learner's progress. Removing a collection also must not
silently delete review history.

### 1.1 Scope for the first release

- Kanji import and study UI only. The normalization contract and collections
  model are vocabulary-ready; vocabulary study is a later product phase.
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
- Inferring knowledge of a whole word from knowledge of its component kanji,
  or the reverse.

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

There are two different questions: what a platform actually tests, and
whether that evidence can be taken out in a sufficiently clear form. A
platform showing a meaning, reading or stroke diagram is not evidence that
the learner recalled it.

| Platform | Kanji writing recall | English definition / meaning | Kanji reading / yomi | Vocabulary learning |
| --- | --- | --- | --- | --- |
| [WaniKani][wanikani-meaning-reading] | **No** | **Yes:** typed English meaning in a separate review question | **Yes:** typed Japanese reading, but statistics are aggregated per subject rather than per accepted reading | **Yes:** word meaning and reading are separately reviewed |
| [renshuu][renshuu-writing] | **Yes, configuration-dependent:** writing questions exist for kanji and vocabulary schedules; tracing/practice must be distinguished from recall | **Yes:** meaning vectors can test kanji or words; verify that the learner's quiz language was English | **Yes:** kanji on/kun vectors and word-reading vectors are distinct | **Yes:** multiple directions include kanji/kana → meaning, meaning → Japanese and writing/typing options |
| [Skritter][skritter-study] | **Yes:** stroke-level handwriting feedback and a separate Writing SRS item | **Yes:** a separate, normally self-graded Definition item; source language is configurable, so it is not necessarily English | **Yes:** a separate Reading item; Japanese reading prompts are normally self-graded rather than typed | **Yes:** single-character components and multi-character words have separate items |
| [Japanese Kanji Study][kanji-study-store] | **Yes:** recall-and-write challenges with stroke detection or self-assessment | **Yes:** configurable multiple-choice meaning quizzes; translation language is configurable | **Yes:** configurable reading quizzes, including on/kun study | **Partial:** extensive word search/examples and graded reading, but no independently scheduled vocabulary-item system was verified |
| [Ringotan][ringotan] | **Yes:** this is its core tested skill | No separate meaning test verified | No separate yomi test verified | No vocabulary-item study system verified |
| [Kanshudo][kanshudo-export] | No handwriting assessment verified | Flashcards and reverse study provide word/kanji meaning practice, but exported per-mode evidence is not documented | Typed word-reading answer mode is documented | **Yes:** mixed word and kanji flashcard sets with SRS |
| [Anki][anki-export] | User-defined | User-defined | User-defined | User-defined; depends entirely on note fields and card templates |

For Kana Quest's current three modes, **Skritter is the strongest direct
semantic match**. WaniKani is the cleanest production API, but only supports
Definition and Yomi. Japanese Kanji Study and Ringotan are the most promising
backup sources for genuine Writing evidence, provided their backups can prove
which assessment generated each status.

| Platform | User-accessible data route | Lists | Exported learning evidence | Assessment |
| --- | --- | --- | --- | --- |
| [WaniKani][wanikani-api] | Official authenticated JSON API | No arbitrary custom lists; started assignments form useful sets | SRS stage, due date, and separate meaning/reading totals for kanji and vocabulary; no Writing | **Priority 1 service adapter** |
| [renshuu][renshuu-api] | Official bearer-token JSON API | Named lists/schedules and all studied kanji or vocabulary | Per-term correct/missed totals, average mastery and per-study-vector last/next quiz | **Priority 2 service adapter** |
| [Skritter][skritter-items] | Documented OAuth 2.0 legacy v0 JSON API; list CSV/TSV export | Custom, textbook and currently-studied vocabulary lists | Separate Writing/Reading/Definition items with due, interval, reviews and successes | **High-value API spike; integrate only after current support/terms/CORS checks** |
| [Anki][anki-export] | Plain-text, `.apkg` and `.colpkg` exports | Decks/subdecks | Scheduling can be included in packages; plain-text note export does not include it | **Text in the foundation; packages later** |
| [Kanshudo][kanshudo-export] | Flashcard-set download/export | Mixed word/kanji flashcard sets | Public documentation confirms export, but not a portable per-mode mastery schema | Vocab-list candidate; obtain a fixture before an adapter |
| [Japanese Kanji Study][kanji-study] | In-app progress backup | Custom sequences/sets | Backup contains progress, but no public file schema was found | High-value fixture candidate, especially for Writing |
| [Ringotan][ringotan-backup] | `Settings -> Advanced -> Export Backup`, producing a ZIP | Its curriculum/data | Writing SRS is explicit, but the ZIP schema is not public | Experimental after a fixture and permission check |
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

Relevant kanji reads are:

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

WaniKani is also a strong future vocabulary source. The same subject,
assignment and review-statistic endpoints support `vocabulary` and
`kana_vocabulary`. Vocabulary subjects provide a written form, accepted
readings and component kanji IDs; review statistics again separate meaning
from reading. Importing learner-owned assignment/statistic data is therefore
straightforward once Kana Quest has local vocabulary IDs. The adapter should
match each WaniKani subject to local JMdict-derived content and must not copy
WaniKani mnemonics, context sentences, audio or proprietary meanings.

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

The same API shape supports vocabulary: list/schedule endpoints accept the
vocabulary term type, and word records have their own user data and study
vectors. renshuu's quiz system is unusually expressive—word orthography,
kana, meaning and active production can be different vectors—so a future
vocabulary adapter must preserve the vector direction instead of collapsing
everything into one “knows word” score.

This is better than a flat export because source list names and status can be
retrieved in the same adapter. However, `study_vectors` are represented by
source-facing names in the published schema. The implementation must capture
real sanitized responses and prove which vectors correspond to Definition
and Kanji-to-reading before mapping them. Kana-to-kanji selection or typed
production is not automatically handwriting. Only a vector/fixture proving
that the learner had to draw the answer should seed Writing.

Before implementation, verify from the deployed Kana Quest origin that:

- CORS permits the `Authorization` header;
- pagination and daily quota metadata are handled; and
- a read-only API key cannot accidentally be used by code paths that mutate
  lists or schedules.

### 3.4 Skritter

[Skritter][skritter-features] explicitly separates Japanese study into
Writing (`rune`), Reading (`rdng`) and Definition (`defn`) parts. These parts
are independently scheduled for both single-character component entries and
multi-character vocabulary. Its writing prompt uses stroke-level grading;
reading and definition prompts normally use reveal-and-self-grade behaviour.
This distinction should remain visible in Kana Quest's import preview because
auto-graded and self-reported evidence are not equally strong.

The documented [Item endpoint][skritter-items] can return all items a learner
has created, with:

- the part tested;
- associated vocabulary and list IDs;
- `next`, `last` and `interval`;
- `reviews`, `successes` and `previousSuccess`; and
- related vocabulary records containing written form, reading, English or
  other source-language definitions, and whether the record is a character
  or word.

The authenticated User record exposes `sourceLang`, the language used for
Definition prompts. Fetch it with the item data and set `answerLanguage` from
that value; merely requesting an English gloss from the vocabulary endpoint
does not prove that English was the language the learner reviewed.

Skritter also documents studied/custom vocabulary-list endpoints and lets a
user [export the characters/words in a list as CSV or TSV][skritter-vocabulary].
A list export is a good membership-only fallback; the API is required for
per-mode status.

This is nearly an exact fit for Kana Quest's current modes and the proposed
vocabulary modes. However, the API documentation is explicitly a legacy v0
interface, examples still show legacy hosts and some HTTP URLs, browser OAuth
does not document PKCE, and the published [usage page][skritter-usage] says
commercial terms were still being worked out. More seriously, the v0
[overview][skritter-overview] explicitly says OAuth has **no scopes**, even
though the API includes mutation endpoints. If a secure code exchange cannot
be completed in a static PWA, do not use the implicit or password flows merely
to avoid adding an appropriately scoped backend. Before implementation:

1. ask Skritter whether new third-party integrations are supported and obtain
   a client registration;
2. confirm HTTPS endpoints, CORS and a modern OAuth redirect flow, and ask
   whether a read-only scope or replacement API is now available;
3. confirm acceptable use for a public Kana Quest deployment; and
4. capture a small Japanese fixture containing character and word items in
   all three parts.

If tokens remain unscoped, disclose that limitation, keep the token only in
memory, and ensure the adapter contains GET requests only. Do not describe
the credential itself as read-only.

Until those checks pass, rank Skritter as a high-value spike rather than a
committed service adapter.

### 3.5 Anki

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

### 3.6 Downloadable but undocumented mobile backups

Several apps clearly let users take their data out, which makes future
support possible:

- Japanese Kanji Study explicitly offers meaning/reading quizzes and
  recall-and-write challenges. Its official changelog also mentions a
  progress backup panel, custom kanji sequences, separate on/kun study and
  restored backup fixes.
- Ringotan explicitly teaches and tests kanji writing with SRS and documents
  a timestamped `Ringotan_backup_...zip` export. Separate meaning, yomi and
  vocabulary tests were not verified, so its status should map only to
  Writing unless a fixture proves otherwise.
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
    {
      externalId,
      name,
      items: [
        { kind: 'kanji', key: '日' },
        { kind: 'vocabulary', key: 'jmdict:<entry-seq>:日本:にほん' }
      ]
    }
  ],
  subjects: {
    kanji: {
      '日': { character: '日', sourceRef: 'external-subject-id' }
    },
    vocabulary: {
      'jmdict:<entry-seq>:日本:にほん': {
        entrySeq: '<entry-seq>', written: '日本', reading: 'にほん',
        sourceRef: 'external-subject-id'
      }
    }
  },
  evidence: {
    'kanji:日': {
      definition: {
        practiced, strength, due, sourceLabel,
        grading: 'typed', answerLanguage: 'en'
      },
      yomi: {
        practiced, strength, due, grading: 'typed', answerLanguage: 'ja',
        readings: { 'ニチ': { practiced, strength, due } }
      },
      writing: { practiced, strength, due, grading: 'stroke' }
    },
    'vocabulary:jmdict:<entry-seq>:日本:にほん': {
      definition: {
        practiced, strength, due, grading: 'self', answerLanguage: 'en'
      },
      reading: {
        practiced, strength, due, grading: 'typed', answerLanguage: 'ja'
      },
      writing: { practiced, strength, due, grading: 'stroke' }
    }
  },
  warnings: []
}
```

Rules:

- `strength` is normalized to `0..1`; it is evidence, not a Kana Quest box.
- `due` is an ISO date or `null`.
- `grading` is `typed`, `choice`, `self`, `stroke` or `unknown`. It records
  the kind of evidence shown in preview; it does not alter the scheduler by
  itself.
- `answerLanguage` is a BCP 47 language tag where language matters. Kana
  Quest Definition status can be seeded only from English (`en`) meaning
  evidence; another or unknown source language remains membership-only.
- Omitted modes/readings mean “the source supplies no compatible evidence”,
  not “the learner is weak”.
- Adapters preserve source order. Normalization removes duplicate subject
  references within a collection while keeping the first occurrence.
- Strings are Unicode-normalized before character extraction.
- In the kanji release, only characters for which `kanjiUnitFor(char)`
  returns a unit are importable. In the vocabulary release, a source term
  must resolve to one stable local term key. Everything else appears in the
  report.
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
`kind`, `collection`, `kanji`, `term`, `reading`, `gloss`,
`definition_status`, `reading_status`, `writing_status`, `status`, `strength`
and `due`. Status values are `new`, `learning`, `known` or `mastered`;
`strength` may instead be `0..1` or `0..100`. Explicit mode columns override
the aggregate `status`. `gloss` may help disambiguate a term in preview but
foreign glosses are not saved as Kana Quest teaching content.

Use a real quoted-field parser. Splitting lines on commas is not adequate for
definitions or list names containing commas.

### 5.2 Vocabulary identity and local catalogue

Do not key vocabulary by written form alone. `生`, for example, can represent
different words/readings, and many terms have kana-only or alternate-kanji
spellings. A vocabulary progress key should identify:

```text
local dictionary entry + selected written form + selected reading
```

Use a key such as `jmdict:<entry-seq>:<written>:<reading>` after Unicode and
kana normalization. Preserve the JMdict entry sequence during data generation
and treat the written/reading pair as the studied orthography. Kana-only words
use their kana form as both the display form and reading where appropriate.

The current `words` arrays in `src/data/kanji-grade-*.js` are intentionally
small display examples. They omit JMdict entry IDs and duplicate words under
different kanji, so they are not a safe vocabulary catalogue or progress key.
Before vocabulary study, extend the build pipeline to emit a deduplicated,
lazily loaded vocabulary index with at least:

- stable local term ID and JMdict entry sequence;
- written form and normalized kana reading;
- concise local English glosses and part of speech;
- component kanji; and
- search indexes for written form and reading.

Matching rules:

1. exact local written-form + reading match is safe to apply;
2. written form alone may auto-match only when it has one local candidate;
3. a source-native stable ID may be stored as provenance, but never replaces
   the local term ID;
4. multiple local candidates require a preview choice; and
5. unmatched terms may remain in an import report/collection receipt, but do
   not receive progress until local content exists.

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

### 6.5 Skritter mapping

Map only reviewed items (`reviews > 0`) and preserve the `part` boundary:

| Skritter part | Character subject | Vocabulary subject |
| --- | --- | --- |
| `defn` | Kana Quest Definition | Vocabulary Definition/Meaning |
| `rdng` | Kana Quest Yomi, only where a local reading can be matched | Vocabulary Reading |
| `rune` | Kana Quest Writing | Vocabulary Writing |

Use the source interval in days to select the nearest conservative Kana Quest
interval/box and retain `next` as the source due date subject to the common
due-date cap. Show `successes / reviews`, `previousSuccess` and whether the
prompt was auto- or self-graded in preview, but do not copy them into Kana
Quest counters.

A multi-character word's Writing item is evidence for writing that word, not
for independently recalling every component kanji. Seed kanji Writing only
from explicit single-character `rune` items. Likewise, a word Reading item is
not evidence that every component kanji reading is known in isolation.

### 6.6 Evidence-direction rule

Every adapter must map the **question direction and response type**, not just
the content visible on the answer screen:

- seeing `日` and choosing “day” can seed Definition;
- seeing `日` and entering `にち` can seed the matched Yomi reading;
- seeing a meaning/reading and drawing `日` can seed Writing;
- tracing a visible `日`, choosing it from alternatives or typing it with an
  IME cannot seed Writing; and
- answering a word question cannot automatically seed any component-kanji
  mode.

Definition evidence also needs the answer language. WaniKani meaning reviews
are explicitly English. renshuu, Skritter and Japanese Kanji Study can use
other learner/source languages; if the export cannot prove English was being
tested, do not seed Kana Quest Definition progress.

When an export cannot distinguish these cases, import membership only and
offer Kana Quest placement testing.

## 7. Future vocabulary learning support

Vocabulary should be designed as a sibling subject type, not as another
property of a kanji. A word can contain several kanji, a kanji can occur in
many words with different readings, and kana-only words must work normally.

### 7.1 Recommended first vocabulary release

Start with two independently scheduled modes:

| Mode | Prompt | Expected knowledge |
| --- | --- | --- |
| Definition/Meaning | Local written form, optionally with sentence-free reading reveal after answer | Recognize the word's English meaning |
| Reading | Local written form | Supply its normalized kana reading |

Reuse the current SRS record shape and scheduling logic, but keep records
under the stable vocabulary term ID. Unlike kanji Yomi, a vocabulary term has
one selected orthography/reading pair, so it does not need a per-reading
rollup.

Defer these modes until the basic word model is proven:

- **Production:** English meaning or context → Japanese. Synonymy makes typed
  marking and prompts more ambiguous than recognition.
- **Vocabulary Writing:** meaning/reading prompt → handwritten complete word,
  including mixed kanji and kana. This is distinct from knowing each kanji's
  standalone stroke form.
- **Listening:** audio → word/meaning. This adds audio licensing, download and
  offline-cache decisions.
- pitch accent, conjugation, sentence cloze and grammar-linked progress.

### 7.2 Profile shape

Keep vocabulary state separate from the existing character-keyed maps:

```js
vocabulary: {
  study: {
    [termId]: {
      definition: { value: true, updatedAt },
      reading: { value: true, updatedAt }
    }
  },
  unstudy: { [termId]: { [mode]: updatedAt } },
  progress: { [termId]: { definition: record, reading: record } }
}
```

Collections use typed references and can therefore be kanji-only,
vocabulary-only or mixed. A session entry point should filter the selected
collection by subject kind and mode rather than silently extracting kanji
from its words.

### 7.3 Relationship between word and kanji progress

Do not propagate mastery in either direction. Knowing `学校 / がっこう` does
not prove all readings or meanings of `学` and `校`; knowing both characters
does not prove the word. The product may offer explicit conveniences without
claiming progress:

- “also enrol component kanji” during vocabulary import;
- suggest words containing recently learned kanji; and
- show local vocabulary examples on a kanji detail page.

These are enrolment/recommendation links only. Each subject's answers drive
only its own SRS records.

### 7.4 Import implications

WaniKani, renshuu and Skritter can all provide useful word-level Definition
and Reading evidence through official APIs. Skritter can additionally provide
word Writing evidence, although that mode is deferred in Kana Quest. Anki and
Kanshudo exports are strong sources for word-list membership but need field or
fixture-based interpretation for status.

The vocabulary release should extend the generic import wizard rather than
create a second importer:

1. detect/select `kanji`, `vocabulary` or mixed input;
2. map surface and reading fields to the local catalogue;
3. show exact, ambiguous and unmatched terms;
4. choose vocabulary modes independently of kanji modes; and
5. apply collections, enrolment and compatible status atomically.

## 8. Profile and backup changes

Add optional profile fields with read-time empty fallbacks:

```js
collections: {
  [id]: {
    id, name, items, modes, // items are { kind, key } references
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

### 8.1 Apply, conflicts and undo

Apply an import to a deep clone, validate the resulting profile, and save it
once.

For each `(subject kind, subject key, mode)` supported by the installed Kana
Quest study model:

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

## 9. Suggested module boundaries

Keep the source adapters pure and small:

```text
src/import/core.js             normalization, validation, preview, apply/undo
src/import/collections.js      collection pools and profile merge helpers
src/import/text.js             text, CSV/TSV and interchange JSON
src/import/wanikani.js         paginated read-only API adapter
src/import/renshuu.js          list/schedule/read-only API adapter
src/import/skritter.js         conditional OAuth/list/item API adapter
src/import/anki.js             later package adapter
src/vocabulary.js              later local term catalogue and study helpers
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

## 10. Delivery phases

### Phase 0 — fixtures and contract

- Finalize the normalized import schema and validation errors.
- Create tiny synthetic interchange fixtures.
- Obtain sanitized WaniKani and renshuu responses for known characters,
  words and statuses.
- Ask Skritter about current API support/terms and, if supported, obtain one
  fixture covering character/word × Writing/Reading/Definition.
- Obtain one Anki text export.
- Verify API CORS, auth failures, pagination and rate/quota behaviour.
- Decide the exact renshuu vector and Definition-language mapping from real
  data.

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
- Map proven Definition/Yomi vectors, verify the Definition answer language
  and surface ambiguous vectors.
- Respect API quota metadata and retry rules.

**Exit criterion:** named source lists retain their names/order and a fixture
covering unstudied, learning, mastered and due items maps predictably.

### Phase 4 — Skritter, conditional on the API spike

- Complete client registration and a secure OAuth flow without embedding a
  reusable client secret in the PWA; explicitly handle the documented lack
  of scopes if it still applies.
- Fetch studied/custom lists and all Japanese items with related vocabulary.
- Preserve character versus word and `rune`/`rdng`/`defn` boundaries.
- Surface self-graded versus stroke/typed evidence in preview.
- Keep list CSV/TSV import as the membership-only fallback.

**Exit criterion:** a fixture proves that each imported mode and subject kind
comes from its own Skritter item, and the production integration uses current,
permitted HTTPS endpoints.

### Phase 5 — Anki packages

- Spike browser-side package/database parsing and measure added payload.
- If acceptable, add deck/note/card selection and semantic field mapping.
- If not, add a documented offline converter to interchange JSON instead.
- Test current and legacy package variants with and without scheduling.

**Exit criterion:** arbitrary note types cannot silently map to the wrong
Kana Quest mode, and package parsing does not compromise the app's small
no-build/offline design.

### Phase 6 — fixture-driven mobile adapters

- Prioritize Japanese Kanji Study and Ringotan because their handwriting
  status could fill Kana Quest's otherwise-unserved Writing mode.
- Add Kanjiru, Kanshudo or Japanese/Renzo only when a stable, permitted
  fixture demonstrates useful data beyond generic text import.
- Label undocumented formats experimental and fail closed on unknown schema
  versions.

### Phase 7 — vocabulary foundation and import expansion

- Extend the JMdict build step with stable entry IDs and emit a deduplicated,
  lazy vocabulary catalogue.
- Add vocabulary study/enrolment/progress state with Definition and Reading
  sessions.
- Activate the vocabulary subject references reserved in collections, merge,
  backup and import preview.
- Enable generic text/CSV vocabulary matching first.
- Then enable vocabulary branches in the proven WaniKani, renshuu and
  conditional Skritter adapters.
- Add a collection option to enrol component kanji without transferring
  progress.

**Exit criterion:** homographs and alternate readings remain distinct; an
imported word affects only its own selected modes; and vocabulary state
survives backup, sync, re-import and safe undo.

## 11. Test plan

Pure tests should cover:

- UTF-8, Unicode normalization, variation selectors and multi-code-point
  input;
- quoted CSV/TSV fields, byte-order marks and different line endings;
- stable order with duplicate kanji across rows and collections;
- unsupported characters and kanji absent from Kana Quest;
- exact-only versus extract-from-word behaviour;
- normalized status bounds and due-date clamping;
- Definition evidence with English, non-English and unknown answer language;
- WaniKani stage mapping and on'yomi katakana normalization;
- per-reading Yomi matching and rollup recomputation;
- renshuu ambiguous-vector handling;
- Skritter subject-kind/part mapping and zero-review handling;
- exact, unique, ambiguous and unmatched vocabulary resolution;
- homographs, alternate orthographies/readings and kana-only vocabulary;
- proof that word progress never seeds component-kanji progress or vice
  versa;
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

## 12. Risks and decisions to revisit

| Risk/question | Current answer |
| --- | --- |
| A foreign “mastered” state is not equivalent to Kana Quest mastery | Use a documented coarse seed or placement test; never copy a foreign scheduler wholesale. |
| Yomi is per reading in Kana Quest but usually per kanji elsewhere | Seed only readings explicitly matched; report the remainder as new. |
| Imported status could erase evidence of a Kana Quest lapse | Never overwrite an existing local record. |
| Re-import sounds like sync | State clearly that v1 is additive one-time migration. Continuous reconciliation needs a separate provenance/conflict design. |
| Custom collections add sync/backup state | Give them timestamped LWW merge and a backup-format bump from the start. |
| Direct APIs may change or block browser requests | Fixture-test versioned fields; detect CORS/auth errors; keep interchange JSON as the fallback. |
| Skritter's API is semantically excellent but legacy and unscoped | Do not promise an adapter until Skritter confirms current endpoints, client registration, browser auth, token permissions and acceptable use. |
| Undocumented backups may change silently | Require fixtures, schema sniffing and fail-closed version checks; mark adapters experimental. |
| Large imports could trigger an immediate review avalanche | Seed future due dates from Kana Quest intervals and preserve an earlier real source due date; preview how many are due now. |
| External teaching content has licensing restrictions | Import characters, membership and learner-owned status only. |
| Self-graded and automatically graded reviews are not equivalent | Preserve `grading` provenance, show it in preview and default ambiguous evidence to membership-only. |
| “Meaning” may have been tested in a language other than English | Preserve `answerLanguage`; seed Kana Quest Definition only from proven English evidence. |
| A written vocabulary form is not a unique identity | Resolve to local dictionary entry + orthography + reading; require a choice when multiple entries match. |
| Word and component-kanji mastery can disagree | Keep separate SRS records and never propagate imported or locally earned status between them. |

## 13. Definition of done for the overall feature

- A learner can import a list without editing JSON by hand.
- WaniKani and renshuu users can use official read-only data routes directly
  from the app; Skritter can do so only if the integration spike passes.
- Source list names and order survive as Kana Quest collections.
- Definition, Yomi and Writing enrolment/status are never conflated.
- Unsupported and ambiguous data is visible before apply.
- Existing Kana Quest progress is unchanged unless the learner subsequently
  answers a Kana Quest question.
- Import is atomic, repeatable, backup-safe and safely undoable.
- Credentials and raw third-party data do not persist.
- All source adapters target one documented interchange model, so adding a
  future platform does not require another set of profile mutation rules.
- Vocabulary subjects resolve to stable local term IDs, retain separate
  Definition/Reading progress and never alter component-kanji mastery.

## Sources

- [WaniKani API v2 reference][wanikani-api]
- [WaniKani explanation of separate meaning and reading reviews][wanikani-meaning-reading]
- [Anki manual: Exporting][anki-export]
- [renshuu API Swagger documentation][renshuu-api] and the developer's
  [API announcement/discussion][renshuu-api-thread]
- [renshuu writing questions for kanji/vocabulary schedules][renshuu-writing]
- [Skritter study/API semantics][skritter-study], [Item API][skritter-items],
  [features][skritter-features], [API overview][skritter-overview],
  [User settings schema][skritter-user], [API usage terms][skritter-usage] and
  [vocabulary/list export guide][skritter-vocabulary]
- [Kanshudo flashcard export announcement][kanshudo-export]
- [Japanese Kanji Study feature listing][kanji-study-store] and
  [changelog][kanji-study]
- [Ringotan writing/SRS description][ringotan] and
  [backup instructions][ringotan-backup]
- [Kanjiru export statement][kanjiru-export]
- [Japanese app sharing and backup features][japanese-app]
- [jpdb homepage][jpdb] and [changelog][jpdb-changelog]

[wanikani-api]: https://docs.api.wanikani.com/20170710/
[wanikani-meaning-reading]: https://knowledge.wanikani.com/wanikani/japanese/readings-vs-meanings/
[anki-export]: https://docs.ankiweb.net/exporting.html
[renshuu-api]: https://api.renshuu.org/docs/
[renshuu-api-thread]: https://www.renshuu.org/forums/topics/11824/Interested_in_working_with_a_renshuu_API%3F
[renshuu-writing]: https://www.renshuu.org/forums/topics/9139/renshuu_news_for_August_2021_%28New_game_%2B_Sale%21%29/platest
[skritter-study]: https://skritter.com/api/v0/docs/studying
[skritter-items]: https://skritter.com/api/v0/docs/endpoints/items
[skritter-features]: https://skritter.com/features/
[skritter-overview]: https://skritter.com/api/v0/docs
[skritter-user]: https://skritter.com/api/v0/docs/entities/users
[skritter-usage]: https://skritter.com/api/v0/docs/usage
[skritter-vocabulary]: https://docs.skritter.com/article/207-vocabulary-faq
[kanshudo-export]: https://www.kanshudo.com/blog/2017-10-flashcard-improvements
[kanji-study-store]: https://play.google.com/store/apps/details?id=com.mindtwisted.kanjistudy
[kanji-study]: https://mindtwisted.com/changelog.html
[ringotan]: https://www.ringotan.com/
[ringotan-backup]: https://www.patreon.com/RingotanApp/posts/july-2025-update-133523845
[kanjiru-export]: https://kanjiru.app/en/
[japanese-app]: https://www.japaneseapp.com/features/
[jpdb]: https://jpdb.io/
[jpdb-changelog]: https://jpdb.io/changelog
