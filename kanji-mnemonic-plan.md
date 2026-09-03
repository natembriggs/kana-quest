# Kanji component mnemonics — implementation plan

Status: **not started — planning only.** No code has been written against
this plan. It proposes: breaking compound kanji into their component parts,
showing those parts and their meanings on the kanji detail page, generating
an original arrangement-aware mnemonic for the whole kanji, surfacing that
mnemonic in the lesson/introduction flow, and adding an on-demand "Show hint"
button in the recognition and writing quizzes.

**§2 (data sources and copyright) is the section to read most carefully.**
Everything downstream depends on getting that decision right, and getting it
wrong is the one mistake in this plan that can't be quietly patched later.

---

## 1. What exists today that this builds on

- `tools/build_kanji_data.py` reads KANJIDIC2 + JMdict and writes
  `src/data/kanji-manifest.js` (small, always loaded — `KANJI_UNITS`,
  `NO_YOMI_CHARS`, `NO_MEANING_CHARS`) plus one `src/data/kanji-grade-<unit>.js`
  per grade (readings, meanings, example words), loaded lazily by
  `ensureKanjiUnitLoaded()` in `src/kanji.js:220`. This plan's new data
  follows the exact same two-tier shape.
- `tools/fetch_kanjivg.sh` already downloads the **full KanjiVG SVG set**
  (~6,700 files, CC BY-SA 3.0) into `tools/data_src/kanjivg/kanji/`, and
  `tools/build_stroke_data.py` already reads it — but only for the `<path
  d="...">` stroke outlines. It currently **discards** the `<g kvg:...>`
  wrapper elements entirely. Those wrapper elements are, it turns out, the
  answer to most of §2 — see §2.2.
- `src/kanji.js`'s `kanjiInfo(course, char)` returns the per-kanji record
  (`on`, `kun`, `meanings`, `words`, `quizOn`, `quizKun`, `quizReadings`,
  `readingExamples`) that every screen already renders from. This plan adds
  fields to that same record rather than inventing a parallel lookup.
- The kanji detail screen is `renderCharacterDetail()` in `src/app.js:2324`,
  rendering into `#screen-character-detail` (`index.html:380-473`). It
  already has a stroke-order box (`#detail-stroke`/`#detail-play-strokes`,
  fed by `buildStrokeSVG()` in `src/strokes.js`), reading chips
  (`#detail-readings`), meanings (`#detail-meanings`) and example words
  (`#detail-example`, `#detail-general-words`).
- The lesson/introduction flow is `renderLesson()` in `src/app.js:2920`,
  rendering into `#screen-lesson`. For a kanji course it shows the glyph,
  reading chips (`#lesson-readings`) and meanings (`#lesson-meanings`)
  openly — no reveal ladder, because teaching (not testing) has nothing to
  protect. This is where an introduction-time mnemonic slots in.
- The recognition (Yomi) and Definition quizzes render into `#screen-quiz`.
  The relevant existing controls are `#quiz-kanji-actions` (`index.html:725`,
  currently holding `#quiz-advanced` and `#quiz-show-answers`) and
  `#quiz-info` (`index.html:700`, the post-answer meanings/example panel).
  Writing mode already has a hint affordance to match: `#writing-hints`
  (`index.html:587`) holds "Show next stroke" / "Show full character",
  hold-to-peek buttons wired in `src/app.js` around the writing pointer
  handlers. A kanji mnemonic hint is a new, independent control alongside
  these, not a replacement for either.
- `src/strokes.js` builds and animates the numbered-stroke SVG from KanjiVG
  path data; `src/stroke-geometry.js` and `src/stroke-grader.js`
  (`writing-mode-plan.md` §5) are pure geometry/grading modules with no
  notion of components. None of the existing writing-mode machinery knows
  anything about kanji structure above the single-stroke level — this plan
  is the first thing in the codebase to reason about kanji at the
  component level.

**No existing radical/component/decomposition data anywhere in the repo.**
A repo-wide grep for "radical", "component", "bushu" and "primitive" turns up
only: KANJIDIC's radical-*name* stripping in `build_kanji_data.py` (§93-98,
`RADICAL_MEANING` regex — this removes glosses like "one radical (no.1)" from
the *meanings* list, it does not decompose anything) and its one-line mention
in the README and `stories-plan.md`/`kanji-expansion-plan.md`/`test/smoke.js`
in unrelated contexts. This feature starts from nothing.

---

## 2. Data sources and the copyright decision

### 2.1 Why this needs care

James Heisig's *Remembering the Kanji* (RTK) assigns each of ~214 traditional
radicals (and many non-radical "primitives") an English **keyword**, and
builds a specific **mnemonic story** around each of ~2,000+ kanji from those
keywords. Two things about RTK are original creative work and therefore
copyrightable, independent of the underlying facts about kanji structure:

1. **The specific keyword assignments.** Many are Heisig's own invention, not
   standard dictionary glosses — famous examples: 女 as "woman" is fine (that
   is also the dictionary meaning), but 才 as "talent" as a *primitive*
   standing for "cape" or a assigned meaning like 心 as "heart" used
   consistently as "heart" even inside compounds where it functions
   phonetically, or 攵 arbitrarily keyworded "tap" — is Heisig's
   idiosyncratic choice, not a fact about the character. RTK's keyword list
   as a *whole, systematic assignment* is the expression that is protected,
   even where any one keyword individually resembles a dictionary meaning.
2. **The specific per-kanji stories.** "An 田 rice field with 心 heart
   underneath it makes 思 think" (illustrative, not verbatim) is Heisig's
   authored sentence. Reproducing it, or closely paraphrasing its specific
   imagery, reproduces protected expression.

**What is *not* protected:** the underlying facts — that 思 is written with
田 over 心, that 雷 (lightning) is written with 雨 (rain) over 田 (field), that
村 (village) is 木 (tree) beside 寸 (measure/hand). Facts and standard
dictionary meanings are not copyrightable. The decomposition of a kanji into
its historical/orthographic components is a linguistic fact, catalogued in
dictionaries centuries before RTK existed (RTK was first published 1977).
The risk is entirely in *how meanings get assigned to components* and *how a
story is worded* — not in decomposing kanji at all.

**Conclusion for this plan:** it is entirely possible, and not even
difficult, to build this feature with zero exposure — by sourcing
decomposition from a source independent of RTK, sourcing component meanings
from standard dictionary/radical glosses rather than invented keywords, and
generating mnemonic prose by template rather than by hand-authoring anything
resembling Heisig's sentences. §2.2-§2.4 make each of those three choices
explicit and conservative.

### 2.2 Decomposition + arrangement: KanjiVG's own `kvg:` metadata

**Recommendation: use KanjiVG's `kvg:element`/`kvg:position`/`kvg:radical`/
`kvg:part`/`kvg:phon` attributes, already sitting in the SVG files this repo
already downloads.**

KanjiVG SVGs are not just stroke paths. Each character's strokes are grouped
into nested `<g>` elements, and the DTD (embedded in every file) defines:

```
kvg:element   — the character or component this group represents
kvg:position  — how it sits in its parent: top | bottom | left | right |
                kamae (enclosure) | tare | nyo | ... (KanjiVG's own position
                vocabulary, not RTK's)
kvg:radical   — "general" | "tradit" | "jis" | "nelson" when this group is
                a traditional radical
kvg:part      — disambiguates repeated components (e.g. 林 has two 木, part 1
                and part 2)
kvg:phon      — marks a component as (also) phonetic, not semantic
kvg:variant / kvg:original — this group is a graphical variant of another
                character, with the canonical form named
```

Verified directly against the live KanjiVG source (fetched during this
planning session, not assumed from memory):

```
096f7.svg (雷, lightning):
  <g kvg:element="雷">
    <g kvg:element="雨" kvg:position="top" kvg:radical="general">   (rain)
    <g kvg:element="田" kvg:position="bottom" kvg:phon="畾T">        (field)

06751.svg (村, village):
  <g kvg:element="村">
    <g kvg:element="木" kvg:position="left" kvg:radical="general">  (tree)
    <g kvg:element="寸" kvg:position="right" kvg:phon="寸">          (measure)

056fd.svg (国, country):
  <g kvg:element="国">
    <g kvg:element="囗" kvg:position="kamae" kvg:radical="general"> (enclosure)
    <g kvg:element="玉" kvg:phon="或V">                              (jewel)
      <g kvg:element="王" kvg:partial="true">
      <g kvg:element="丶">

05b66.svg (学, study):
  <g kvg:element="学">
    <g kvg:element="⺍">
    <g kvg:element="冖">
    <g kvg:element="子" kvg:position="bottom" kvg:radical="general"> (child)
```

This is exactly the two things items 1-3 of the user's spec ask for:
component identity (what the parts are) and arrangement (how they sit —
top/bottom/left/right/enclosure, in KanjiVG's own vocabulary, with no
Heisig-derived terminology involved at all).

**Why this is safe:** KanjiVG's decomposition is Ulrich Apel's own scholarly
work, drawing on standard reference decomposition (it explicitly documents
using established kanji dictionaries and the Kanjidic radical data as its
basis, not RTK), licensed CC BY-SA 3.0, and completely independent in
authorship and lineage from Heisig's book. Using it does not touch RTK's
expression in any way — it isn't derived from RTK and doesn't reproduce
anything RTK wrote. Attribution is already in this repo's README credits
pattern (§6 below).

**Why this is practical:** the repo already fetches every file this needs
(`fetch_kanjivg.sh`); `build_stroke_data.py` is already parsing this exact
XML for the `<path>` elements sitting right next to the `<g kvg:...>` ones it
currently throws away. No new dependency, no new download, no new license to
vet — just reading more of a file already open.

**Coverage and limits, stated honestly:**
- KanjiVG decomposes down to individual strokes for genuinely atomic
  characters/radicals (e.g. 木, 人) — a group with no further `kvg:element`
  children **is** the atomic case the user's spec asks to exclude ("not the
  ~214 traditional radicals themselves, which are usually atomic"). §3.2
  defines the exact rule for when a kanji counts as "compound" vs atomic
  using this structure.
- Not every group carries `kvg:position` — deeply nested sub-parts inside a
  component (like 王/丶 inside 玉 inside 国 above) often don't, because they
  are internal to a component rather than positioned against a sibling. The
  mnemonic generator only needs the **top-level** groups (direct children of
  the outermost `<g kvg:element="{kanji}">`), which are exactly the ones
  KanjiVG reliably annotates with position. Depth-2+ nesting is available
  for a future "component's own components" drill-down, out of scope here.
- Component identity is a **character**, not a gloss — 雨, 田, 木, 寸 are
  themselves Unicode characters (often also jōyō kanji already in this
  repo's own data). Meaning still has to come from somewhere else: §2.3.

### 2.3 Component meanings: dictionary glosses, not invented keywords

**Recommendation: two-tier lookup, both independent of RTK.**

1. **When the component is itself a character already in KANJIDIC2** (this
   repo's existing kanji-meaning source, already fetched and parsed by
   `build_kanji_data.py`) — reuse **that character's own real dictionary
   meaning**. 雨 → "rain", 田 → "rice field", 木 → "tree, wood", 寸 → "inch,
   a little". This is the same data this repo already ships and already
   attributes (KANJIDIC2, CC BY-SA 4.0) — no new source, no new license, and
   pedagogically the strongest option requested in the brief's point (c):
   a learner meeting 雨 as a component sees the *same* meaning they'd see if
   they studied 雨 as its own kanji, rather than two different, conflicting
   glosses for the same character depending on context.
2. **When the component is a traditional radical with no independent
   KANJIDIC entry of its own** (e.g. 氵 the water radical, 忄 the heart
   radical, 阝 the mound/village radical, 囗 the enclosure) — use the
   **standard Kangxi radical meaning**, from the traditional 214-radical
   table. This table predates RTK by roughly two and a half centuries (the
   Kangxi Dictionary was published in 1716; RTK in 1977), is universally
   reproduced without attribution concern in dictionaries, textbooks and
   software (it is the "water radical", "heart radical" naming already
   familiar to any dictionary user), and KANJIDIC2 itself ships exactly this
   table as its own `radical` element data — see the note in
   `build_kanji_data.py:93-98`, which already strips radical-name glosses
   *out* of kanji meanings; this plan reuses that same underlying table for
   the opposite purpose, presenting a radical's name deliberately rather than
   filtering it out. No transcription of RTK's book is needed anywhere: a
   plain "kangxi radical name" table is a standard reference artifact,
   available from KANJIDIC2's own radical field or Unicode's public
   `kRSKangXi`/`kRadical` Unihan properties (both public-domain-adjacent,
   Unicode Consortium data files under the permissive Unicode license,
   already the kind of source this repo's tooling already trusts).

**Explicit contrast with RTK, stated once, since it is the crux of the whole
plan:** RTK assigns 心 the keyword "heart" everywhere, including inside
compounds where a native dictionary would gloss the same graphic element
differently or not gloss it as a standalone word at all; RTK gives 攵 (the
"radical of striking/tapping") the invented keyword "tap" rather than
anything a dictionary would call it. This plan never invents a keyword. Every
component meaning traces to either (a) that same component's own KANJIDIC2
entry, already in this repo, or (b) the traditional Kangxi radical name,
already public reference material older than RTK. If a component has neither
— rare, but possible for obscure historical variant forms `kvg:variant`
sometimes introduces — it is simply omitted from the mnemonic rather than
given a made-up gloss (§4.4).

### 2.4 Mnemonic generation: template, not hand-authored prose

This is the section where the plan could accidentally recreate RTK's actual
risk (a specific memorable story per kanji) even while using clean data. The
mitigation is structural, not just a promise to write differently:

**Recommendation: mechanically generate mnemonic text from
`(arrangement, component meanings)` via a small, fixed set of sentence
templates keyed only on arrangement shape — never hand-author individual
per-kanji prose.**

- The generator input is exactly the data in §2.2/§2.3: an ordered list of
  `{meaning, position}` for a kanji's top-level components, plus the whole
  kanji's own English meaning (already in `kanjiInfo().meanings`).
- The generator output is built from a **small, closed set of sentence
  frames**, one per `kvg:position` value (`top+bottom`, `left+right`,
  `kamae` enclosure, three-or-more parts, etc. — see §4.3 for the exact
  list), each frame taking the component meanings and the kanji's own
  meaning as slot fillers. E.g., the `top+bottom` frame might read:
  *"{TOP} sits above {BOTTOM} — put them together and you get {MEANING}."*
  applied mechanically to any top/bottom kanji, not composed per-kanji.
- **This is deliberately NOT trying to be as vivid, surprising or memorable
  as a hand-written RTK-style story.** That is the correct trade, not a
  regrettable one: a formulaic "{TOP} above {BOTTOM} gives {MEANING}"
  sentence cannot resemble Heisig's specific creative sentences (which lean
  on invented scenarios, characters, and dramatic imagery) because it never
  reaches that level of individual authorship — it's closer to a filled-in
  form than a story. §8 flags tone/voice as an open question precisely
  because there is a real design choice about how far to push template
  richness before it starts drifting toward "an authored story," and that
  line is worth a second, careful look at the copyright question *if* the
  templates are later made much more elaborate than the flat example above.
- Hand-authoring ~1,000+ individual mnemonics was considered and rejected
  for this plan, for three independent reasons, not just the copyright one:
  it is the single largest content-authoring effort in this repo's history
  (`story-writing-guide.md`/`stories-plan.md` show what hand-authoring even
  a few dozen stories costs); it does not regenerate when the data pipeline
  re-runs (`build_kanji_data.py` is designed to be safely re-run against a
  refreshed KANJIDIC/JMdict, and hand text sitting outside that pipeline
  would rot or need manual reconciliation); and it reintroduces exactly the
  copyright risk surface this plan exists to avoid, since a large hand-
  authored per-kanji story corpus is structurally the same kind of artifact
  RTK is, just written by someone else, and would be prone to unconscious
  convergence with RTK content for any author who has read RTK (endemic in
  the kanji-learning-app community — RTK is the best-known kanji-learning
  book in English, so it should be assumed template authors will have seen
  it).

### 2.5 Summary table

| Need | Source | License | Independent of RTK? |
| --- | --- | --- | --- |
| Which kanji are "compound" vs atomic | KanjiVG group nesting (§3.2) | CC BY-SA 3.0 | Yes — different author, predates nothing about RTK but shares no content |
| Component identity | KanjiVG `kvg:element` | CC BY-SA 3.0 | Yes |
| Arrangement (top/bottom/left/right/enclosure) | KanjiVG `kvg:position` | CC BY-SA 3.0 | Yes — KanjiVG's own vocabulary |
| Component meaning (character case) | KANJIDIC2 (already in repo) | CC BY-SA 4.0 | Yes |
| Component meaning (radical-only case) | Traditional Kangxi 214-radical names (via KANJIDIC2's radical field / Unicode `kRSKangXi`) | Public/permissive reference data, predates RTK by ~260 years | Yes |
| Mnemonic sentence | Original template code, this repo | N/A (original work) | Yes, by construction (§2.4) |

All three real data sources are ones this repo already fetches and already
credits (KanjiVG, KANJIDIC2). No new external dependency is introduced.

---

## 3. Data model

### 3.1 Where it lives: a new generated file, following the stroke-data split

Mirrors the existing `stroke-kana.js` / `stroke-grade-<unit>.js` split
(`writing-mode-plan.md` §1, §5) exactly, because the loading story is
identical (needed lazily, per grade, alongside the kanji a learner is
actually studying):

| File | Contents | Loaded |
| --- | --- | --- |
| `src/data/components.js` | `COMPONENT_MEANINGS`: component-char → short English meaning (§2.3's two-tier lookup, flattened to one map at build time) — small (a few hundred entries: every distinct top-level component across all compound jōyō kanji), shared across all grades | eagerly, small, same tier as `kanji-manifest.js` |
| `src/data/kanji-components-<unit>.js` | Per-kanji decomposition + arrangement + generated mnemonic text for that grade's kanji | lazily, alongside that grade's existing `kanji-grade-<unit>.js` |

A shared `COMPONENT_MEANINGS` map (rather than repeating a component's
meaning inline in every kanji that uses it) is worth the extra indirection:
氵 (water) appears as a component in dozens of kanji across every grade, and
inlining its meaning that many times would both bloat the data and risk the
two-tier lookup (§2.3) drifting out of sync with itself across grades if it
is ever hand-corrected.

### 3.2 The atomic/compound line

A kanji counts as **compound** (gets decomposition + mnemonic) when its
KanjiVG entry has **two or more top-level `<g kvg:element>` children with
distinct `kvg:element` values**, at least one of which is not itself the
whole character's own stroke set. Concretely, in `build_kanji_components.py`
terms: walk the outermost group's direct children; if there are ≥2 children
each carrying their own `kvg:element` (ignoring bare `kvg:part`-only splits
of a *single* repeated component, e.g. 林's two 木 count as one "component
type: 木, appears twice" rather than two components), the kanji is compound.
Otherwise (0 or 1 meaningful child) it is atomic and gets no entry — this is
precisely how the traditional radicals themselves (木, 水, 人, ...) and other
irreducible shapes fall out of scope, matching the user's spec.

Component **repetition** (林 = 木+木, 品 = 口×3) is represented once with a
count, not duplicated, both because it is cheaper and because "two of the
same tree" reads better in a template than "wood, wood."

### 3.3 One entry

```js
// src/data/kanji-components-<unit>.js
{
  k: '雷',                                    // the compound kanji
  parts: [
    { c: '雨', pos: 'top',    meaning: 'rain'  },
    { c: '田', pos: 'bottom', meaning: 'field' },
  ],
  arrangement: 'top-bottom',                  // one of ARRANGEMENT_TYPES (§4.2)
  mnemonic: 'Rain sits above field — put them together and you get lightning.',
}
```

- `c` is the component character itself, so the UI can render it directly
  (`lang="ja"`, same as every other glyph in this app) without a second
  lookup — `meaning` is duplicated here (rather than requiring a join
  against `COMPONENT_MEANINGS` at render time) for the same reason
  `readingExamples` duplicates data onto the kanji record instead of making
  the UI join two tables at runtime (`src/kanji.js:89-93`'s own comment
  makes exactly this trade for the same reason).
- `arrangement` is redundant with the shape of `parts[].pos` but named
  explicitly so the UI's layout code (§5.1) can switch on one string rather
  than re-deriving the shape from positions every render.
- `mnemonic` is precomputed at **build time**, not generated in the browser.
  Same reasoning as `mis`/`sp` in `vocab-plan.md` §3.1: the template
  substitution needs nothing dynamic (no per-learner state), so paying the
  cost once at build time and shipping a plain string is strictly better
  than shipping template code and reassembling it in every browser — cheaper
  at runtime, and trivially inspectable/auditable by a human reading the
  generated `.js` file directly, which matters given §2.4's requirement that
  every mnemonic be verifiably template-shaped and never hand-touched.

### 3.4 Extending `normalizeEntry()` / `kanjiInfo()`

`src/kanji.js`'s `normalizeEntry()` (line 73) shapes one `KANJI_ENTRIES`
record into what `course.index` stores. This plan adds a sibling loader
rather than folding into the existing one, because components load from a
**different file** on a different (smaller, shared) cadence than the rest of
the kanji record:

```js
// new: src/kanji-components.js — component-specific loading, parallel to
// the existing kanji.js loader, not merged into it
export async function ensureComponentUnitLoaded(unit) { ... }  // mirrors
  // ensureKanjiUnitLoaded(), same memoization pattern (loadedUnits Set,
  // loadingUnits Map keyed by unit)
export function kanjiComponents(unit, char) { ... }  // returns the §3.3
  // record or null (atomic kanji, or not yet loaded)
```

Kept as a **separate module** rather than added fields on `kanjiInfo()`'s
existing record for two reasons: (1) atomic kanji have no component record
at all, which is an awkward "sometimes present" field to bolt onto a
record whose other fields are always present; (2) it keeps
`ensureKanjiUnitLoaded()` — already a hot, frequently-awaited path — free of
a second file fetch that most call sites (anything not touching the detail
screen, lesson screen, or hint button) never need. A screen that wants
components awaits both loaders; screens that don't want them are unaffected
and pay nothing.

### 3.5 Build script

`tools/build_kanji_components.py`, new, following the existing scripts'
established shape (`build_stroke_data.py` is the closest template — same
input directory, same manifest-driven scoping):

1. Read `src/data/kanji-manifest.js` for the exact character set to cover
   (only jōyō + the beyond-jōyō names/places kanji this app actually teaches
   — never KanjiVG's full ~6,700, same scoping rule every existing build
   script applies).
2. For each character, parse its `tools/data_src/kanjivg/kanji/<hex>.svg`
   (already fetched by the existing `fetch_kanjivg.sh` — no new fetch
   script needed) and extract the top-level `kvg:element`/`kvg:position`
   children per §3.2's rule.
3. For each distinct component character encountered, resolve its meaning
   via §2.3's two-tier lookup: check whether it has its own entry in the
   already-parsed KANJIDIC2 data (this script runs in the same process as,
   or right after, `build_kanji_data.py` — reuse its KANJIDIC parsing rather
   than re-implementing it); else look it up in a small hand-transcribed
   `tools/data_src/kangxi-radicals.tsv` (214 rows: radical char, standard
   English name — a one-time, purely factual transcription of the public
   Kangxi radical table, not of anything from RTK).
4. Apply the arrangement templates (§4.3) to produce `mnemonic`.
5. Write `src/data/components.js` + `src/data/kanji-components-<unit>.js`,
   printing summary counts the way every existing build script does
   (`build_kanji_data.py`'s "N kanji have no non-radical meaning" pattern) —
   here: how many kanji were classified compound vs atomic, and how many
   components fell back to the radical table vs a KANJIDIC self-entry, so a
   change in KanjiVG's data is visible rather than silent.
6. **A residual manual pass is expected and should be budgeted for, not
   treated as a bug in the script.** KanjiVG's decomposition is a linguistic
   judgement call in places (it records some components as `kvg:variant`
   graphical forms, and old/new character forms sometimes decompose
   differently) — a human spot-check of a sample, especially the highest-
   frequency early-grade kanji where a bad mnemonic would be seen most,
   belongs in the phase 1 checklist (§7).

`tools/data_src/kangxi-radicals.tsv` is the one new hand-maintained seed file
this plan needs, in the same spirit as `tools/vocab_src/*.tsv`
(`vocab-plan.md` §3.5) — small, factual, and not derived from any
copyrighted secondary source (the 214-radical table is reproduced, in full,
in essentially every dictionary and on Wikipedia's own "Kangxi radicals"
page; transcribing radical-name-to-English-gloss pairs from it is exactly
the kind of "the same facts anyone compiling from the source would arrive
at" transcription `vocab-plan.md` §3.5 already treats as safe for the GCSE
word lists).

---

## 4. Mnemonic generation — the template rules

### 4.1 Inputs

For a compound kanji: its own `meanings` (already in `kanjiInfo()`), and its
`parts` list of `{c, pos, meaning}` (§3.3), where `pos` is one of KanjiVG's
own position vocabulary (§2.2), normalized to the smaller set in §4.2.

### 4.2 Arrangement types

KanjiVG's raw `kvg:position` values are collapsed to a fixed set the
template layer switches on:

| Normalized `arrangement` | Raw `kvg:position` values folded in | Example |
| --- | --- | --- |
| `top-bottom` | `top` + `bottom` (2 parts) | 雷 = 雨(top) + 田(bottom) |
| `left-right` | `left` + `right` (2 parts) | 村 = 木(left) + 寸(right) |
| `enclosure` | `kamae` (fully surrounds) | 国 = 囗(kamae) + inner parts |
| `partial-enclosure` | `tare` (hangs over top-left), `nyo` (wraps bottom-left) | 病-type / 道-type shapes |
| `stacked` | 3+ parts with `top`/`bottom`/`middle` | rarer, e.g. 慕-type |
| `side-by-side` | 3+ parts all `left`/`right`/`middle` horizontally | rarer |
| `unpositioned` | parts present but KanjiVG gives no `kvg:position` on them | fallback, §4.4 |

### 4.3 Sentence frames

One frame per arrangement type, each a plain JS template function taking
the ordered part meanings and the kanji's own meaning, e.g.:

```js
const FRAMES = {
  'top-bottom': (parts, meaning) =>
    `${cap(parts[0].meaning)} sits above ${parts[1].meaning} — put them ` +
    `together and you get ${meaning}.`,
  'left-right': (parts, meaning) =>
    `${cap(parts[0].meaning)} stands beside ${parts[1].meaning} — together ` +
    `they make ${meaning}.`,
  enclosure: (parts, meaning) =>
    `${cap(parts[0].meaning)} surrounds ${joinRest(parts.slice(1))} — ` +
    `together they make ${meaning}.`,
  // ...one frame per row in §4.2's table
};
```

This is deliberately the entire creative surface of the feature — a handful
of short, generic sentence shapes, reused mechanically across every kanji
that shares an arrangement. No frame references any specific kanji, story,
character, or scenario; nothing here is more "authored" than a mail-merge
template. See §2.4 for why that flatness is the point, not a shortcoll.

### 4.4 Fallbacks

- **A part with no resolvable meaning** (§2.3's two-tier lookup misses,
  which the build script's summary counts, §3.5 step 5, make visible): drop
  that part's clause and fall back to a shorter frame — for two parts where
  one has no meaning, no mnemonic is generated at all (`mnemonic: null`) and
  the UI falls back to showing just the component breakdown with no sentence
  (§5.4).
- **`unpositioned` arrangement:** a generic frame that lists parts without
  claiming a spatial relationship: `"Made from {A} and {B}: {meaning}."`
- **More than ~4 parts:** template falls back to a plain enumeration rather
  than trying to force a natural-sounding sentence out of an arrangement the
  fixed frame set doesn't cover well — correctness (never implying a false
  arrangement) matters more than every kanji getting an equally polished
  sentence.

### 4.5 Tone

Kept plain and functional in this plan's own draft frames — no attempt to be
clever, funny, or vivid, which is both the safest posture relative to §2.4
and the most defensible starting point for phase 1. §8 flags voice/tone as
an open question because it is genuinely subjective and worth a second look
once real examples are on screen, not because this plan is unsure the
draft frames are legally fine (they are — see §2.4).

---

## 5. UI: three touchpoints

### 5.1 Detail page — the reference view

`renderCharacterDetail()` (`src/app.js:2324`), inside the existing
`course.kind === 'kanji'` branch (line 2387-2400), additive to the existing
stroke/readings/meanings/examples stack, not a redesign of it.

**Placement:** a new block **between the stroke-order box and the reading
chips** — i.e. right after `$('detail-stroke-wrap')` (line 2348-2357) and
before `$('detail-unit')`/readings. Reasoning: stroke order and component
structure are both "what does this kanji look like and how is it built"
questions, answered before the reading/meaning quiz-relevant content below;
putting components immediately after strokes keeps the "shape" information
grouped, rather than interleaving it with reading chips.

```
[glyph]                              existing
[▶ Play stroke order] [stroke SVG]   existing
──────────────────────────────────── NEW
  雨        田
 rain      field
──────────────────────────────────── NEW
"Rain sits above field — put them
 together and you get lightning."
────────────────────────────────────
[unit label]                         existing
[study status button]                existing
[reading chips]                      existing
...
```

New DOM, `index.html`, inside `#screen-character-detail`, mirroring the
existing `detail-stroke-wrap` pattern (a wrapper div, hidden by default,
shown/hidden per-kanji from `app.js`):

```html
<div id="detail-components-wrap" class="detail-components-wrap" hidden>
  <div id="detail-components" class="component-row" lang="ja"></div>
  <p id="detail-mnemonic" class="mnemonic-text" hidden></p>
</div>
```

`#detail-components` holds one small tile per part — the component glyph
large enough to read, its meaning underneath, small enough that 2-4 tiles sit
in a row without wrapping on a phone (same width budget `.reading-chips`
already solves for kanji reading chips, so reuse that flex/wrap pattern
rather than inventing new CSS). Each component **tile is tappable** exactly
like the existing kanji↔word chip pattern (`fillWordKanjiChips`,
`src/app.js:2453`): if the component itself is a kanji this app teaches
(`kanjiCourseFor(component)` resolves), tapping it drills into *that*
kanji's own detail screen via the same `drillIntoDetail`/detail-stack
mechanism already built for vocab word→kanji chips (`src/app.js:2474`'s
`detailStack`) — 雷's detail screen tile for 雨 opens 雨's own detail screen,
consistent with how a vocab word's kanji chips already work. A component
that is *not* independently taught (a bare radical like 氵) renders as a
plain, non-interactive tile.

**Hiding rule:** `#detail-components-wrap` stays `hidden` for atomic kanji
(no component record, §3.2) and for kana/vocab entirely — set once at the
top of the `course.kind === 'kanji'` branch, mirroring how `detail-mastery`
is conditionally hidden today.

### 5.2 Lesson/introduction — taught alongside readings and meanings

`renderLesson()` (`src/app.js:2920`), inside the `course.kind === 'kanji'`
branch (lines 2931-2948), which currently shows reading chips and meanings
openly (no reveal ladder — teaching, not testing, matching the vocab lesson
card's own stated reasoning at line 2951-2953).

**Placement:** directly under `$('lesson-meanings')`, before
`$('lesson-hint')`. A brand-new kanji is exactly when the mnemonic earns its
keep — this is the one moment a learner has never seen the character before,
so a memory aid is doing real work rather than just decorating something
already familiar (contrast with the detail screen, which is more often
opened by a learner who already half-knows the kanji and is checking a
reading).

```html
<!-- new, inside #screen-lesson, mirroring lesson-meanings' placement -->
<div id="lesson-components" class="component-row" lang="ja" hidden></div>
<p id="lesson-mnemonic" class="mnemonic-text" hidden></p>
```

Same tappable-component-tile behavior as §5.1, via `openFromLesson` (the
existing lesson-screen drill-in handler already used for reading chips at
line 2941 and vocab kanji chips at line 2968) rather than `drillIntoDetail` —
consistent with how every other lesson-card interactive element already
routes back to the lesson card afterward rather than to whatever screen
opened the session.

For an atomic kanji, both elements stay hidden and the lesson card is
unchanged from today.

### 5.3 Quiz hint — "Show hint" in recognition and writing

Two quiz surfaces, two different existing hint idioms to slot into rather
than inventing a third:

**Recognition (Yomi) and Definition quizzes**, `#screen-quiz`. New button
inside the existing `#quiz-kanji-actions` row (`index.html:725-727`,
currently `[Advanced] [Show answers]`), added as a third button, **before**
those two (a struggling learner wants a nudge before they want the answer
outright):

```html
<div id="quiz-kanji-actions" class="row" hidden>
  <button id="quiz-show-hint" class="btn btn-quiet" type="button" hidden>Show hint</button>
  <button id="quiz-advanced" class="btn" type="button" hidden>Advanced</button>
  <button id="quiz-show-answers" class="btn btn-quiet" type="button">Show answers</button>
</div>
```

Tapping it reveals the same components-and-mnemonic block as §5.1, inline in
the card (below `#quiz-choices`, above `#quiz-kanji-actions`, in a new
`#quiz-hint-panel`, `hidden` until tapped) — not a navigation away from the
question, since the whole point is staying put and getting a nudge, unlike
`quiz-info-more`'s existing "Full details →" link which *does* navigate
away (that one is post-answer review, this is mid-question help). Hidden
entirely for atomic kanji (nothing to show) and for kana questions
(`#quiz-kanji-actions` is already kanji-only). **Does not affect grading** —
unlike stroke `Show me` in writing mode, which visibly costs the "no hints
used" first-attempt-clean condition (`writing-mode-plan.md` §4.1), tapping
"Show hint" here is closer to the existing `Show answers` button, which
likewise doesn't retroactively change what was already clicked correctly;
it only forecloses nothing that hasn't happened yet, since Yomi/Definition
grading resolves on the first wrong click or explicit reveal regardless.

**Writing quiz**, `#screen-writing`. New button inside the existing
`#writing-hints` row (`index.html:587-589`, currently "Show next stroke" /
"Show full character", both hold-to-peek and both about stroke shape, not
meaning). Add "Show hint" as a third, ordinary tap-to-toggle button (not
hold-to-peek, since a mnemonic sentence needs to be *read*, not glanced at):

```html
<div id="writing-hints" class="row writing-hints" hidden>
  <button id="writing-peek-next" class="btn btn-quiet" type="button">Show next stroke</button>
  <button id="writing-peek-full" class="btn btn-quiet" type="button">Show full character</button>
  <button id="writing-show-hint" class="btn btn-quiet" type="button" hidden>Show hint</button>
</div>
```

Reveals into the existing `#writing-kanji-info` panel (`index.html:552-556`,
already the kanji-only info panel next to the writing prompt) rather than a
new panel — that panel already holds readings/meanings/example word for
writing mode's kanji prompt (`writing-mode-plan.md` §5, `renderWritingKanjiInfo`
in `app.js:4372` onward) and the components/mnemonic block belongs with that
existing content, appended at its end. Hidden for atomic kanji and for kana
writing, same rule as everywhere else.

**A hint tap should not silently launder into "didn't need help."** Mirror
writing mode's own precedent exactly: a stroke `Show me` already costs the
first-attempt-clean condition that gates the SRS `correct` record
(`writing-mode-plan.md` §4.1's "no *Show me* used" rule). "Show hint" should
cost the same thing, for the same reason — a learner who needed a meaning
nudge to write the character correctly did not, in fact, know it cold. This
is the one place this plan changes existing grading logic rather than only
adding new UI, and it should be implemented as one more condition alongside
the existing `Show me` flag in `finishWritingCharacter()`
(`writing-mode-plan.md` §7.1's reference point), not a parallel mechanism.
Recognition/Definition mode has no equivalent "clean pass" concept to
protect (per-reading-click grading already resolves the moment a reading is
clicked or revealed, per `src/kanji.js`'s `pickBaseCorrectReadings` design),
so there "Show hint" costs nothing beyond what tapping into any reading
chip already costs today — nothing, by design.

### 5.4 One shared rendering helper

All three touchpoints render the same two things (component tiles,
mnemonic sentence) into slightly different containers. One function,
`renderComponentBreakdown(containerEl, mnemonicEl, course, kanji, openHandler)`,
shared by `renderCharacterDetail`, `renderLesson`, the quiz hint panel and
the writing hint panel — same pattern as `renderReadingChips` and
`fillWordKanjiChips`, which are already shared exactly this way across
detail/lesson/quiz. Kept in `src/kanji-components.js` alongside the loader
(§3.4), not in `app.js`, so the DOM-adjacent formatting logic lives with the
data it formats.

---

## 6. README / credits update

Alongside whatever ships from this plan, the README's existing Credits
section (the KANJIDIC2/JMdict/Tanaka Corpus block, `README.md` lines
~592-600) gains one line for KanjiVG's decomposition/position data — it
already ought to be credited for the stroke SVGs and currently is not
mentioned there at all (only `writing-mode-plan.md`'s own text references it
by name; the top-level Credits list does not). This plan is a natural place
to fix that gap, not just add to it:

```
Kanji stroke order and component decomposition come from
[KanjiVG](http://kanjivg.tagaini.net) by Ulrich Apel, CC BY-SA 3.0.
```

And a one-line note on the traditional Kangxi radical names, e.g. "component
meanings for radicals with no independent dictionary entry use the
traditional 214-radical names" — enough for a reader to see the provenance
chain without the README turning into a legal memo.

---

## 7. Phased build order

| Phase | Work |
| --- | --- |
| 0 | Write `tools/data_src/kangxi-radicals.tsv` (214 rows, hand-transcribed from public reference material). Write `tools/build_kanji_components.py`: parse KanjiVG `kvg:` metadata, classify atomic/compound (§3.2), resolve component meanings (§2.3 two-tier), write `src/data/components.js` + `src/data/kanji-components-<unit>.js`. No mnemonic text yet — just decomposition + meanings. No UI. |
| 1 | Add the sentence-frame templates (§4.3) to the build script; regenerate with `mnemonic` populated. Spot-check a sample (§3.5 step 6) — particularly grade-1/2 kanji, which are both highest-traffic and where a bad mnemonic is most visible. Pin regression coverage in `test/smoke.js`: every generated mnemonic references only meanings that trace to §2.3's two sources (no silent third fallback), every compound kanji has a non-null `arrangement`, and atomic kanji have no component record. |
| 2 | `src/kanji-components.js` loader (`ensureComponentUnitLoaded`, `kanjiComponents`) + `renderComponentBreakdown()` shared helper (§5.4). Wire into the **detail screen only** (§5.1) — the lowest-stakes surface, reference material a learner opts into, nothing SRS-relevant riding on it. |
| 3 | Wire into the **lesson/introduction screen** (§5.2). |
| 4 | Wire into the **quiz hint buttons**, both recognition/definition (§5.3, `#quiz-show-hint`) and writing (§5.3, `#writing-show-hint`), including the writing-mode grading change (a hint tap costs the first-attempt-clean condition, mirroring `Show me`). |
| 5 | Service worker `SHELL` list, `APP_VERSION`/`VERSION` bump, `changelog.js` entry, README credits update (§6) — same housekeeping pattern as every other feature in this repo (`writing-mode-plan.md` §7.7). |

Each phase should leave `test/smoke.js` and `test/wiring.js` green, matching
this repo's existing phasing discipline.

---

## 8. Open questions for a human to decide

- **Mnemonic tone/voice.** §4.5's draft frames are plain and functional on
  purpose, as the safe starting point. Whether to push them toward more
  personality (still template-driven, still arrangement-keyed, just wittier
  phrasing) is a real editorial choice, and — per §2.4 — the *only* place in
  this plan where pushing too far in that direction would be worth a second
  legal look before shipping, since "more vivid template" is exactly the
  direction that eventually starts to resemble authored stories rather than
  filled-in sentences. Recommend starting flat (phase 1) and revisiting
  tone only after real output is visible on a phone screen.
- **How many kanji to cover in a first pass.** This plan covers the full
  jōyō set the app already teaches, since the build script has no reason to
  stop short once written — but it may be worth shipping grade 1-3 first
  (or even just grade 1) to get real usage feedback on the templates before
  the full set locks in, the same staged-rollout instinct
  `kanji-expansion-plan.md` applied to grades generally.
- **Visual design of the component tiles.** §5.1/§5.2 propose small
  glyph-over-meaning tiles reusing `.reading-chips`-style flex/wrap CSS, but
  the actual sizing/spacing/color choice needs an eye on a real phone,
  not a written spec — same caveat every other plan in this repo (e.g.
  `writing-mode-plan.md` §7.2's two real-phone layout passes) has needed in
  practice.
- **Whether "Show hint" should be visually distinct from "Show answers"/
  "Show next stroke" enough that a learner doesn't confuse "a nudge" with
  "the answer."** Proposed as a `btn-quiet` matching the existing hint-tier
  buttons (§5.3), but the exact wording/icon is a UX call, not a technical
  one.
- **Whether atomic kanji (radicals themselves) should eventually get their
  *own* explanatory content** (e.g. "this is one of the 214 traditional
  radicals" framing) rather than simply having no component block at all.
  Explicitly out of scope for this plan — the brief scoped this to compound
  kanji only — but worth flagging as the natural next question once this
  ships, since a learner will encounter atomic kanji with no block right
  next to compound kanji with one, and may wonder why.
- **Should the "seen N× in words" exposure line (`vocab-plan.md` §5.3) and
  this feature's component tiles ever cross-reference** — e.g. showing a
  component's meaning is also reinforced by a vocab word using that same
  kanji? Interesting, not assumed, and not needed for a first version.
- **Whether to expose depth-2 decomposition** (a component's own
  sub-components, available in KanjiVG's nesting per §2.2 but not surfaced
  by this plan) as a future drill-down. Deliberately left for later; the
  top-level breakdown is very likely sufficient for the stated goal.
