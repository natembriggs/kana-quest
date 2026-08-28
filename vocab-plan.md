# Vocabulary — implementation plan

Status: **in progress** — phases 0-3 done (see §12's phase table). Word
selection (`tools/build_vocab_data.py`), courses/lazy loading (`src/vocab.js`),
and Meaning mode (four English options, the reveal ladder, the yomi
follow-up) are live behind the fourth "Vocabulary" script on the home
screen. Not yet built: Recall mode (§6, phase 4), exposure-based hiding
(§5.3, phase 3a), crediting a correct reading into the kanji course's own
records (§4.5, phase 3b), the word detail screen (phase 5), Higher/A level
(phases 6-7), and stories.

Phase 0 landed on the plan's own fallback (§3.5): JMdict's `nf` frequency
bands stand in for an official GCSE list, which this session had no way to
obtain and reproduce at the needed scale without exceeding what its
copyright rules allow. Units are named "Common words 1/2" (`lv: 'f'`/`'h'`)
accordingly, not "GCSE Foundation/Higher" — see the build script's own
module docstring for the full reasoning.

A fourth thing to learn, alongside hiragana, katakana and kanji: whole
**words**. Grouped for UK learners first — GCSE Foundation, GCSE Higher, then
A level — because that is who is using the app, with the grouping axis built
so that JLPT levels, raw frequency, or a bare thematic list can be added later
without re-cutting the data.

It is also the app's first piece of **passive** learning: §5.3 lets a reading
earn its way to "no furigana by default" just by having been met often enough,
with no enrolment and no quiz, and §4.5 feeds correctly-read words back into
the kanji course's own reading records. Both work for stories too.

The next feature after this one is **stories** — short graded episodes with
the same tap-for-furigana, tap-again-for-romaji, tap-for-definition
interaction. §10 lists the things this plan deliberately builds in a way
stories can reuse, and the one authoring decision stories force on the data
model now rather than later.

---

## 1. What this is, and what it is not

The existing app teaches **characters**: a kana makes a sound, a kanji has
meanings and readings and a shape. Nothing in it teaches that 電車 is a train,
that it is read でんしゃ, or that "train" is spelled with those two kanji and
not two others.

Vocabulary is a different kind of item with a different failure surface, and
the whole design follows from listing those failures honestly. For one word
there are four separable things a learner can not know:

| Can't do | Direction | Example failure |
| --- | --- | --- |
| Say what it means | JA → EN | sees 電車, no idea |
| Say how it's read | JA → EN | knows it's a train, can't produce でんしゃ |
| Produce the word at all | EN → JA | "train" → blank |
| Spell it in kanji | EN → JA | knows でんしゃ, writes 伝車 |

Each is worth its own record, and each is worth a different question. What
this plan does **not** do is fold them into one "do you know this word"
score — that is the same mistake the kanji reading quiz already avoids by
grading per reading rather than per kanji (see *Per-reading spaced
repetition* in the README).

### 1.1 The second reason this exists

Teaching words is the obvious purpose. The other one shapes half the decisions
below and should be stated up front:

**Vocabulary is meant to be a second, gentler route into the most common
readings.** The kanji Yomi course grades per reading and asks for a kanji's
whole reading list; a learner who knows plenty of common yomi can still be
stalled early in it by uncommon ones, which is a bad trade — the common
readings are the ones that pay. Meeting でん inside 電車, 電話 and 電気,
because those are words you wanted anyway, is how that reading gets learned
outside an app, and there is no reason the app should be worse at it.

Three parts of this plan follow from that and only from that:

- Furigana defaults to **hidden** wherever the learner has any claim at all on
  the kanji (§5.2) — a tap is cheap, a missed chance to recall is not.
- Readings can earn that hidden default purely by **being met often enough**,
  with no enrolment and no quiz (§5.3).
- A word's reading, answered correctly, **credits the constituent kanji's own
  reading records** (§4.5), so the kanji course advances as a by-product of
  vocabulary work.

Out of scope for now, listed so the data model does not accidentally
foreclose them: writing a whole word by hand (writing mode is per-character
today), sentence-level grammar, listening, and pitch accent.

---

## 2. How the words are divided up

### 2.1 Two axes, not one

Every word carries two independent tags:

- **Level** — how advanced it is: `f` (GCSE Foundation), `h` (GCSE Higher),
  `a` (A level). Cumulative: Higher means "on top of Foundation", not
  "instead of".
- **Theme** — what it is about: family, travel, school, food…

The **unit** a learner actually picks is one (level, theme) pair, e.g.
*Foundation · Travel and transport*. This is exactly the shape the kanji
courses already have — `KANJI_UNITS` keyed by unit id, grouped under a
heading in the grade picker (`KANJI_UNIT_GROUPS` in `app.js`) — so the
grade-picker, overview grid, quick-actions and lazy-loading machinery all
carry over with the group labels changed.

The alternative considered was **theme as the unit, level as a filter**: one
"Travel" tile whose contents grow when you switch tier. Rejected because a
course's chunk list would then depend on a per-profile setting, which every
piece of scheduling code in `srs.js` currently assumes is fixed — and because
"my Travel tile went from 40 words to 65 overnight" is worse to look at than
a new *Higher · Travel* tile appearing next to the one you finished.

The consequence worth stating plainly: **a Higher unit holds only the words
Higher adds.** *Higher · Travel* is not a superset of *Foundation · Travel*,
it is the difference. The unit tile says so ("+25 more").

### 2.2 Order is the learner's

Nothing enforces doing Foundation before Higher, or family before travel.
Every unit is a tile; tap any of them. This is already true of the kanji
grade picker and it should stay true here — "people might want travel or
school or family first" is the normal case, not an edge case, because vocab
units map onto whatever the learner has coming up at school.

The one place order is asserted is the **Core** group (§2.3), which is
offered first in the list and described as the spine. It is a suggestion, in
the same spirit as the app's existing *review first* nudge that never blocks.

### 2.3 The themes

Six groups. The five topic groups follow the standard UK GCSE MFL theme
structure so that a unit name means something to a teacher and a parent; the
sixth (Core) is ours, and exists because a specification's theme list is
organised for exam coverage, not for teaching order — question words,
counters and the fifty verbs that appear everywhere belong together at the
front, not scattered across five themes.

**Group C — Core** (the spine; offered first)

| Unit | Covers |
| --- | --- |
| C1 Classroom and survival | greetings, please/thank you, *how do you say…*, *I don't understand* |
| C2 Numbers, counters, time, dates | 一〜百, 〜人/〜つ/〜枚/〜本, days, months, clock time |
| C3 Question words and pointers | だれ・なに・どこ・いつ・どう, これ／それ／あれ, この／その／あの |
| C4 Joining words and particles | でも, そして, だから, から, まで, と, や |
| C5 The verbs you cannot avoid | する, ある, いる, 行く, 来る, 見る, 食べる, 飲む… |
| C6 The adjectives and adverbs you cannot avoid | 大きい, いい, 高い, とても, ちょっと, たくさん… |

**Group 1 — Identity and culture**

| Unit | Covers |
| --- | --- |
| 1.1 Me, my family and pets | family members, ages, pets |
| 1.2 Describing people | appearance, personality, character adjectives |
| 1.3 Friends, relationships, feelings | friendship, arguments, emotions |
| 1.4 Free time | sport, music, games, hobbies, instruments |
| 1.5 Phones, media, social media | apps, messaging, TV, film, streaming |
| 1.6 Food and drink | meals, ingredients, restaurants, ordering |
| 1.7 Clothes, shopping and money | garments, sizes, prices, paying |
| 1.8 Festivals and customs | 正月, 花見, birthdays, presents, manners |

**Group 2 — Local area, holiday and travel**

| Unit | Covers |
| --- | --- |
| 2.1 Home and my room | rooms, furniture, chores |
| 2.2 My town and the countryside | shops, buildings, city vs country |
| 2.3 Directions and getting around | left/right, near/far, asking the way |
| 2.4 Travel and transport | trains, stations, tickets, planes |
| 2.5 Holidays | booking, hotels, luggage, problems |
| 2.6 Weather and seasons | forecast vocabulary, the four seasons |

**Group 3 — School**

| Unit | Covers |
| --- | --- |
| 3.1 Subjects and the timetable | subject names, lessons, periods |
| 3.2 The school building and kit | classroom, gym, uniform, stationery |
| 3.3 School life and clubs | 部活, rules, break, lunch, the school year |
| 3.4 Exams and opinions about school | tests, grades, pressure, likes/dislikes |

**Group 4 — Future aspirations, study and work**

| Unit | Covers |
| --- | --- |
| 4.1 Jobs and workplaces | job names, offices, shops, hospitals |
| 4.2 Part-time work and work experience | アルバイト, hours, pay, duties |
| 4.3 After school | university, apprenticeships, applications |
| 4.4 Ambitions and plans | hopes, *I want to…*, *in the future…* |

**Group 5 — International and global dimension**

| Unit | Covers |
| --- | --- |
| 5.1 Japan and the UK | countries, nationalities, comparing daily life |
| 5.2 Environment and nature | recycling, pollution, animals, energy |
| 5.3 Global problems and helping | poverty, charity, volunteering |
| 5.4 Health and the body | body parts, illness, doctor, healthy living |

That is **28 Foundation units**. Higher reuses the same 28 slugs and adds
words to whichever of them the specification's Higher list touches — expect
maybe 18-22 of the 28 to have a Higher tile at all, and the Core group to
have almost none.

**A level** keeps the group/unit machinery but needs its own themes, because
the content is not "more of the same words":

| Unit | Covers |
| --- | --- |
| A1 Family and society changing | marriage, birth rate, the ageing population |
| A2 Work and the economy | employment, 終身雇用, women at work |
| A3 Education and young people | pressure, 塾, university entrance |
| A4 Media and the digital world | news, misinformation, online life |
| A5 Arts and popular culture | literature, film, manga, anime, music |
| A6 Regions, cities and depopulation | Tokyo vs the regions, 過疎, migration |
| A7 Environment and disaster | earthquakes, energy policy, climate |
| A8 Politics and civil society | government, elections, protest, rights |
| A9 Health, welfare and care | healthcare, welfare, care of the elderly |
| A10 Immigration and diversity | foreign workers, multiculturalism |
| A11 History and memory | post-war Japan, war memory, the constitution |
| A12 Writing and arguing | essay connectives, hedging, citing, abstract nouns |
| A13 The set text and film | vocabulary tied to whichever work is being studied |

A12 is the A-level counterpart of the Core group and should be offered first
in the same way. A13 is deliberately a stub — it only becomes real once a
particular text or film is chosen, and it is the obvious first customer for
"make your own unit", which is out of scope here but is the reason the unit
list is data rather than code.

### 2.4 Sizing

Aim for **30-60 words per unit**. Below 30 the tile isn't worth its own tap;
above 60 the overview grid stops being scannable and the unit stops feeling
finishable. Where a specification's theme is much bigger than that, split it
(1.6 Food is the usual offender — *food and drink* / *eating out* if needed).

Chunks within a unit stay at **5**, matching `CHUNK_SIZE` in `kanji.js` and
the kana courses, so "Add 5 more" means the same thing everywhere.

At 28 Foundation units × ~40 words that is ~1,100 Foundation words, with
Higher adding several hundred and A level another 1,000-1,500. The exact
totals come from the specification, not from this document — see §3.5.

---

## 3. The data

### 3.1 One entry

```js
{
  w:  '電車',                          // surface form, as normally written
  r:  'でんしゃ',                       // reading, kana
  en: ['train', 'electric train'],     // glosses, [0] is the quiz answer label
  ruby: [[0, 'でん', 'でん'], [1, 'しゃ', 'シャ']],  // per-kanji alignment + the
                                       // kanji reading it credits, or null (§3.2, §4.5)
  pos: 'n',                            // noun / verb-godan / adj-i / … (§5.5)
  uk: false,                           // "usually written in kana" (§3.3)
  lv: 'f',                             // f | h | a
  th: '2.4',                           // theme/unit slug
  mis: ['でんぐるま', 'てんしゃ', …],    // wrong readings, for the yomi stage (§5.4)
  sp:  ['汽車', '電話', '客車', …],      // wrong spellings, for the spelling stage (§6.3)
}
```

`mis` and `sp` are **precomputed at build time**, and that is the single most
important decision in this section. Both need things only the build script
has: every kanji's full KANJIDIC reading list, rendaku and gemination rules,
and — critically — the whole of JMdict, so a generated wrong spelling can be
checked against it and thrown out if it turns out to be a real word (§6.3).
Doing that at runtime would mean shipping JMdict to a phone. Doing it at
build time costs ~150 bytes per word and leaves the runtime with nothing to
do but filter a ready-made list.

Rough size: ~1,700 words × ~200 bytes ≈ 340 KB total, spread over ~50 unit
files, lazily loaded. For comparison the kanji data is already several times
that and loads fine.

### 3.2 Furigana has to be per-kanji

`ruby` maps each kanji **position** in the surface form to the kana it
contributes, plus the kanji reading that kana should be *credited to* (§4.5).
電車 → `[[0,'でん','でん'],[1,'しゃ','シャ']]`; 食べる → `[[0,'た','た.べる']]`.

The third element is not redundant with the second. What is *displayed* as
ruby is the kana actually appearing in this word — が in 学校 would surface as
が — while what gets *credited* is the kanji's own base reading in KANJIDIC's
notation, with rendaku and gemination undone and okurigana restored. The build
script's `credited_reading()` already computes exactly this, and emitting it
here is what lets a correct answer credit a kanji reading at runtime with no
lookup, no lazy load, and no chance of the runtime deriving it differently
from the way the kanji course did. The element is absent where no reading can
be credited (§4.5 safeguard 4).

This is not a nicety. Two features depend on it:

- **Partial hiding.** If 電 is on the study list and 車 is not, the question
  should show しゃ over 車 and nothing over 電 — testing precisely the part
  the learner is supposed to know, and not withholding a reading they have
  no way to have learned.
- **Stories** annotate individual kanji in running text, not whole words.

The alignment logic already exists: `align_word()` in
`tools/build_kanji_data.py` aligns a JMdict word against its reading, kanji
by kanji, handling rendaku (か→が) and gemination (がく→がっ). It is the same
machinery that makes 三十日 → 三=み, 十=そ, 日=か work. `build_vocab_data.py`
imports it rather than reimplementing it.

**Jukujikun words don't align, and that's fine.** 大人 (おとな), 今日 (きょう),
明日 (あした) have no per-kanji split because there isn't one. For those,
`ruby: null`, meaning "one ruby over the whole word". The consequences ripple
outward and are stated once here: a `ruby: null` word is **all-or-nothing** —
its furigana is hidden only if *every* kanji in it is on the study list, and
shown otherwise.

About 2% of words failed alignment in the kanji build. Those are dropped
there; here they are kept with `ruby: null`, because a jukujikun word is
often exactly the word a learner most needs.

### 3.3 Ids, keys, and the collisions to avoid

The **item id** is the surface form: `電車`, `食べる`, `コンピューター`.

Two things could go wrong, and both are handled at build time:

- **Homographs.** 開く is ひらく and あく; 空く is あく and すく. When a unit
  contains two entries sharing a surface, the id becomes `surface|reading` —
  `開く|ひらく`. Only then, so the common case stays readable.
- **A word that is also a kanji.** 水 is both a grade-1 kanji and a
  Foundation word. Progress keys are `${mode}:${item}` (`itemKey` in
  `srs.js`), so `definition:水` (the kanji) and `vdef:水` (the word) are
  already distinct as long as the **mode ids are vocab-specific**. They are —
  see §4.2. No other namespacing is needed, and none should be added.

Two existing pieces of code must be checked against the new key shapes before
this ships, because both parse progress keys generically:

- `rebuildYomiRollups` in `merge.js` treats **any** three-part key as a
  per-reading kanji record. Vocab keys are two-part, so it is safe — but
  nothing about vocab may introduce a three-part key without revisiting it.
- `deriveStudyList` in `srs.js` maps two-part keys to study entries when the
  item's first character is a kanji. `vdef:食べる` would derive
  `study['食べる'].vdef`, which is harmless (and arguably right), but it only
  runs on profiles predating study lists entirely. Assert the behaviour in a
  test rather than reasoning about it twice.

`createProfile()` in `store.js` gains `exposure: {}` alongside `study: {}` and
`unstudy: {}`, and for the same reason those two start as `{}` rather than
undefined: a missing field is the trigger for a migration, so a brand-new
profile must not look like an un-migrated one. Profiles saved before this
feature legitimately have no field, and read as "no exposures anywhere", which
is correct — there is nothing to migrate, only to start counting.

**Exposure keys** (§5.3) are a third namespace: `電:でん` for a (kanji,
reading) pair and `word:大人` for a jukujikun word. They live in their own
`exposure` map, not in `progress`, so they cannot collide with either — and
must not be moved into `progress` later, because they merge by a completely
different rule (§8).

`uk` (JMdict's "word usually written in kana" tag) marks entries like ある,
きれい, たくさん where a kanji spelling exists but nobody uses it. Those words
get **no spelling stage** (§6.2) and their surface form is the kana.

### 3.4 Files and lazy loading

Exactly the pattern `kanji-expansion-plan.md` §4 established, because it
works and because reusing it means `withLoading`/`ensureUnitReady` in
`app.js` generalise rather than fork:

| File | What's in it | Loaded |
| --- | --- | --- |
| `src/data/vocab-manifest.js` | `VOCAB_UNITS`: unit id → ordered word-id list, plus group/label metadata | eagerly, small |
| `src/data/vocab-<unit>.js` | `VOCAB_ENTRIES` for that unit — the full records above | lazily, first time the unit is opened |
| `src/data/vocab-lookup.js` | surface → unit id, for cross-unit lookup and (later) story annotation | eagerly, ~30 KB |

`vocab-lookup.js` is the one addition to the pattern. Kanji gets away with
`kanjiUnitFor()` built from the manifest because the manifest lists every
character; vocab words are longer, so a separate compact index is cheaper
than fattening the manifest. It is what lets a story resolve 電車 to its
entry without knowing which unit it lives in.

### 3.5 Where the words come from

Two different sources, kept strictly apart:

**Which words** — the exam board's published vocabulary list. That has to be
transcribed by hand into a seed file, one line per word, because no
machine-readable version exists:

```
tools/vocab_src/gcse-foundation.tsv     # surface <TAB> reading? <TAB> theme
tools/vocab_src/gcse-higher.tsv
tools/vocab_src/a-level.tsv
```

Reading is optional and only filled in to disambiguate a homograph. Theme is
the unit slug from §2.3 and is the **only genuinely manual work** — a
specification's list is ordered alphabetically or by theme-as-the-board-sees-
it, not as 28 teaching units. Expect to do this semi-automatically (keyword
rules over the JMdict gloss, then hand-correct) and to spend real time on it;
budget it as its own phase (§12, phase 0) rather than pretending it is part
of writing the build script.

**Everything else about each word** — reading, glosses, part of speech,
frequency band, `uk` tag, alignment — comes from **JMdict**, exactly as the
kanji data already does, under the same CC BY-SA attribution already in the
README. This keeps the hand-maintained surface tiny: a word list, and a theme
per word.

Two things to be careful about, both worth a line in the README when this
ships:

- **A specification's word list is its own document.** What goes in the repo
  is a list of Japanese words with a topic label — the same facts anyone
  compiling from the syllabus would arrive at — not the specification's
  presentation, its English glosses, or any of its surrounding text. The
  glosses in the app are JMdict's.
- **The lists drift.** Specifications get revised. The seed files are dated
  and the build script prints the counts it read, so a stale list is visible
  rather than silent.

**If the official list can't be used or obtained,** the fallback is a
defensible substitute rather than a blocked project: take JMdict's `nf`
frequency bands (the same signal `priority_rank()` already uses), cut at the
top ~1,200 words for Foundation and the next ~600 for Higher, and hand-assign
themes the same way. The result is not "the GCSE list" and must not be
labelled as such — it would be *Common words 1* / *Common words 2* — but it
is a working vocabulary course and it exercises every piece of this plan.
Deciding between these two is phase 0's job.

---

## 4. Courses, modes, and what gets recorded

### 4.1 A fourth card on the home screen

`SCRIPTS` in `app.js` gains `{ id: 'vocab', kind: 'vocab', name: 'Vocabulary',
native: '単語', sample: '語' }`. The course screen then works as it does for
kanji: a mode picker across the top, the unit picker below it (the existing
`grade-picker`, with group headings from §2.3), session actions under that.

`kind: 'vocab'` is a genuinely new course kind, not kanji with a longer item
string. Everywhere the code currently asks `course.kind === 'kanji'` needs
reading — most such places want "is this not kana", and a few genuinely want
kanji. That audit is part of phase 2 and is the main risk of regression in
the existing kanji flow.

### 4.2 Two modes the learner sees; four records the app keeps

The mode picker offers **two** things, because that is how a learner thinks
about it:

| Mode id | Label | Hint |
| --- | --- | --- |
| `vmeaning` | Meaning | See the word, tap what it means |
| `vrecall` | Recall | See the English, tap the Japanese |

Behind them sit **four** record streams, because a question has stages:

| Key prefix | Graded by | What it means |
| --- | --- | --- |
| `vdef:` | Meaning, stage 1 | I know what this word means |
| `vyomi:` | Meaning, stage 2 (or the reveal, §5.4) | I know how it is read |
| `vprod:` | Recall, stage 1 | I can produce it from English |
| `vspell:` | Recall, stage 2 | I know which kanji it's written with |

All four use the ordinary Leitner `grade()` from `srs.js` — not `gradeYomi()`.
A word has exactly one reading and one spelling, so there is nothing to
schedule per-sub-item; the multi-record complexity `gradeYomi` exists for
does not arise. This is a deliberate simplification and should be resisted
being "generalised" later.

The mode ids appear in `MODES` with `kinds: ['vocab']`, so they are invisible
to kana and kanji screens and vice versa. `modesForKind` already does this.

### 4.3 The study list

Vocab reuses the existing `study` / `unstudy` maps, keyed by word id under
the vocab mode ids. "Add 5 more" enrols the next five words in the unit,
exactly as it enrols kanji.

One change is needed. `eligibleItems()` in `srs.js` gates by
`isKanjiChar(item)` — literally "does this item start with a kanji" — which
is wrong for vocab twice over: 食べる would be gated and たべる would not.
Replace the per-item test with a per-course one:

```js
function gatesEnrollment(course, item) {
  if (course.kind === 'vocab') return true;   // every word is enrolled or not
  return isKanjiChar(item);                   // unchanged for kana/kanji
}
```

Kana keeps behaving as though everything is enrolled; kanji is untouched.

### 4.4 A word's own schedule

`courseStats`, `currentSetIndex`, `dueItems` and the overview colouring all
work off a single record per item per mode. For vocab, the record the mode's
own key names *is* that record — `vdef:電車` for Meaning, `vprod:電車` for
Recall. `vyomi:` and `vspell:` are bonus-stage records that do **not** drive
scheduling on their own.

That is a real decision with a visible consequence: a word whose meaning is
solid but whose spelling keeps failing will not, by itself, come back for
review. Two ways to fix it, and the recommendation is the first:

1. **Roll up, like kanji.** Recall's scheduling record is the *sooner* of
   `vprod:` and `vspell:`, and its box the *lower* of the two — the same
   rule `recomputeKanjiRollup()` already applies across a kanji's readings,
   for the same reason ("mastered" should mean every part is solid).
2. Leave stage 2 unscheduled and let it ride along.

Take (1), and write it as a shared helper rather than a second copy of
`recomputeKanjiRollup` — at that point three call sites want "roll several
sub-records into one schedulable card", which is enough to justify one
function in `srs.js` that both kanji and vocab call.

The same applies to Meaning: its card is the rollup of `vdef:` and `vyomi:`.

### 4.5 A correct word reading credits the kanji it is made of

This is the mechanism behind §1.1, and it is small: **when the learner reads
電車 correctly as でんしゃ, write a correct answer to `recognition:電:でん` and
`recognition:車:しゃ`** — the kanji Yomi mode's own per-reading records, via
the existing `gradeYomi()` and `recomputeKanjiRollup()`.

Everything needed is already there. `ruby` (§3.2) says which reading each kanji
contributed; `yomiKey(mode, kanji, reading)` is the existing key shape;
`quizReadings` on the kanji entry is the list of readings that mode considers
real. Nothing new is invented — vocabulary simply becomes a second thing that
can grade a kanji reading.

Five safeguards, each closing a way this could write something false:

1. **Correct answers only.** A missed word reading does not localise blame —
   でんぐるま tells you the learner failed, not which of the two kanji they
   failed on. Never credit a miss. The asymmetry is deliberate: this mechanism
   can only ever help a kanji's record, never hurt it.
2. **Only when the furigana was hidden and never revealed.** Otherwise the
   learner read the reading off the screen, and crediting it would be
   crediting the app.
3. **Only when `ruby` is non-null.** A jukujikun word (大人) has no per-kanji
   reading to credit, so it credits nothing.
4. **Only readings in that kanji's `quizReadings`.** These are KANJIDIC-
   attested *and* backed by a real example word. The build script's
   `credited_reading()` already maps rendaku and gemination back to the base
   reading, and already rejects readings a kanji does not genuinely have — it
   is what stops お父さん crediting 父 with とう. Reuse it rather than
   re-deriving the rule at runtime: ship the credit target on the `ruby` entry
   itself, so a runtime credit is a lookup and not a decision.
5. **Crediting does not enrol.** Writing `recognition:電:でん` gives 電 a
   record; it does not put 電 into a kanji session, because `eligibleItems()`
   gates on the study list, not on having a record. That distinction is the
   whole point of `kanji-expansion-plan.md` §1.1 and this must not blur it.
   What it does mean is that a learner who *later* enrols 電 finds it already
   part-known rather than starting from zero, which is exactly right.

**Cost:** crediting needs the kanji's grade data loaded to check
`quizReadings`. Point 4's "ship the credit target at build time" removes that
— the runtime reads `ruby[i].credits` and writes, with no lazy load and no
`await` in the middle of grading a question.

**Open sub-decision (§11):** whether a reading crossing the exposure threshold
(§5.3) should *also* credit, at lower weight, or whether only answered
questions count. The conservative answer — exposure changes what is displayed,
answers change records — is the one assumed everywhere else in this document.

---

## 5. Japanese → English (the Meaning mode)

### 5.1 What is on screen

```
                      電車
              (tap the word for help)

     ┌──────────────┐  ┌──────────────┐
     │    train     │  │   bicycle    │
     ├──────────────┤  ├──────────────┤
     │   station    │  │   airport    │
     └──────────────┘  └──────────────┘
```

**Four** English options, two columns × two rows — the same count and the same
layout kanji Definition mode already uses, for the same reason: English glosses
are long, and six of them is exactly the "does it fit on a small phone" gamble
the last three commits in this repo were all spent losing.

**The option count follows the label length, not a house style.** Short labels
can afford more options, and more options mean a lower chance of guessing
right:

| Question | Labels | Options |
| --- | --- | --- |
| Meaning, stage 1 (§5.1) | English glosses | **4** |
| Meaning, stage 2 — the yomi stage (§5.4) | kana readings | 6 |
| Recall, stage 1 (§6.1) | kana words | 6 |
| Recall, stage 2 — the spelling stage (§6.2) | kanji words | 6 |

That is the rule the existing app already follows without having written it
down — kana Reading offers ten romaji, kanji Definition offers four glosses.

Gloss length still needs a hard cap even at four. Enforce it at build time:
the answer label is `en[0]`, truncated to ~24 characters, and a word whose
shortest usable gloss is longer than that gets shortened by hand in the seed
file rather than wrapping to three lines on a phone.

### 5.2 The reveal ladder

The word itself is the tap target — nothing else on the card is tappable, so
a stray tap can't advance the question (the bug fixed in `c51d904`, which is
worth not reintroducing). It carries a visible affordance: a dotted underline
plus one line of hint text on the first question of a session.

**A word written with kanji:**

| Tap | Shows |
| --- | --- |
| — | 電車 — furigana hidden over every kanji the learner has any claim on (§5.2, §5.3) |
| 1 | でんしゃ as ruby over the kanji |
| 2 | `densha` underneath |

**A katakana word:**

| Tap | Shows |
| --- | --- |
| — | コンピューター |
| 1 | こんぴゅーたー |
| 2 | `konpyuutaa` |

**A hiragana word:** one tap, straight to romaji.

**Furigana is hidden over any kanji on the study list in _any_ mode** —
Definition, Yomi or Writing. Not Yomi alone.

The reasoning is worth writing down, because the narrower rule looks more
careful and is wrong. Studying a kanji for its *meaning* still means you have
some claim on it, and the app's Yomi mode is deliberately strict — it grades
per reading, so a learner who knows plenty of common yomi can still be stalled
early in that course by uncommon ones. Gating furigana on Yomi enrolment would
therefore hand the reading to precisely the learner with the best chance of
producing it.

The governing principle, which §5.3 then extends:

> **Default to hidden wherever there is any reasonable chance the learner
> would want to think of it themselves.** Furigana is always one tap away, so
> the cost of hiding it wrongly is one tap; the cost of showing it wrongly is a
> chance to recall that never happened.

This is also what makes the vocabulary section an *alternative route into the
common readings* rather than a parallel course: you meet a reading in the
handful of words you actually care about, instead of grinding a kanji's whole
reading list in order. §4.5 is the other half of that — those encounters
feeding the kanji's own reading records.

### 5.3 Earning the hidden default by exposure

The study list is not the only way a reading should stop being handed over.
Some readings are learned by *meeting them*, repeatedly, in words — no
enrolment, no quiz, just having seen 電 sitting over でん often enough to have
a decent stab at it. That is how most reading knowledge is actually acquired,
and nothing in the app currently makes room for it.

So there is a second rule alongside enrolment:

> **A reading whose furigana you have been shown four times is hidden by
> default from then on.**

The two rules are an OR. A kanji's ruby is hidden in a word if it is enrolled
in any mode **or** it has crossed the exposure threshold.

#### What counts as an exposure

Per **(kanji, reading)**, not per kanji. 生 met four times as せい in 先生,
学生, 生活, 一生 says nothing about なま, and hiding the ruby on 生ビール on
that basis is exactly the unfair withholding §5.2's principle is not asking
for. The `ruby` alignment (§3.2) already records which reading each kanji
contributed, so keying this precisely costs nothing extra.

Rules:

- Only accrues where a **single word is displayed with its ruby visible**: the
  Meaning-mode prompt, and later a story's running text. Not the Recall stages,
  where kanji flash past six-at-a-time as answer options.
- Only while the ruby was **actually shown**. Once a reading crosses the
  threshold and goes hidden it stops accruing — the counter freezes at four by
  construction, which is correct behaviour and not a bug to fix.
- A **revealed** ruby (the learner tapped) counts. They saw it; that is what an
  exposure is.
- **At most one per session per (kanji, reading).** Meeting 電車 five times in
  one sitting is one encounter with 電=でん, not five. A session is the app's
  natural unit of "an encounter".
- Jukujikun words (`ruby: null`, §3.2) have no per-kanji reading to key on, so
  they accrue against the **word** — 大人 is its own exposure key — and are
  hidden or shown as a unit.

#### Where it is stored, and why as timestamps

A new profile field, alongside `progress` / `study` / `unstudy`:

```js
exposure: {
  '電:でん':   [1756300000, 1756390000, 1756550000],
  'word:大人': [1756310000, 1756480000],
}
```

**A list of timestamps, not a count.** The count is `.length`. This looks like
overkill until sync is considered, and then it is the only shape that works:

- A **counter** merges wrongly in both available ways. Last-write-wins throws
  away one device's exposures; summing double-counts every exposure already
  synced once. Neither is fixable without per-device counters and a device id
  the app does not currently have.
- A **set of timestamps** merges by union, deduped within a one-minute window
  and truncated to the newest few. Union is commutative and idempotent, so the
  same merge run twice, or run in either direction, gives the same answer — the
  property `sync-plan.md` §0.1 went to real trouble to obtain for the study
  list, had here for free.

Keep the newest **8** rather than exactly the threshold, so the threshold can be
raised later without the evidence having already been discarded. Store seconds,
not milliseconds; the whole map for a heavy user is a few KB.

`EXPOSURE_THRESHOLD = 4`, one constant in `srs.js` — not in the vocab module,
because stories use the same counter. A per-profile setting is plausible later
and nothing here blocks it.

#### When exposure was not enough

A reading promoted by exposure is a guess about the learner, and sometimes it is
wrong. If they now tap for furigana every single time it comes up, the app has
made them worse off.

**Demotion:** when the learner reveals the ruby on a word in which an
exposure-promoted reading was the *only* hidden one — so the reveal is
unambiguously about that reading — count it against that reading. Two such
reveals demote it: the exposure list is cleared, its ruby shows again, and it
can re-earn the hidden default from scratch.

Restricting this to unambiguous cases matters. A reveal on a word with three
hidden readings says one of them failed and gives no way to tell which;
punishing all three would demote readings the learner actually knew. Ambiguous
reveals do nothing here — they are already recorded against the word's own
`vyomi:` (§5.4), which is where blame belongs when it cannot be localised.

**Enrolment-based hiding is never demoted.** That one is the learner's own
stated intent rather than the app's guess, and it is not the app's place to
overrule it.

#### Where it shows up

The kanji detail screen gains a line — *seen 6× in words* — under the readings,
and the reading chips mark which readings have crossed the threshold. It costs
almost nothing, and it is the only visible evidence that passive practice is
doing anything, which is worth a great deal for a mechanism whose whole pitch
is that it works without being asked for.

An obvious follow-on, deliberately left out of the first cut: offering *"add 電
to your kanji study list?"* on the summary screen when a reading crosses the
threshold. Good idea, separable, and it should not hold up the rest.

### 5.4 What a reveal costs, and the yomi stage

**Tapping for furigana grades `vyomi:` as a miss, immediately.** Not a
punishment — it is simply the honest answer to "do you know how this is
read?", asked and answered before the definition question is even resolved.
It follows the app's existing rule that the record is locked to what the
learner actually knew before being shown anything.

**Tapping again for romaji** grades nothing further. The word's reading was
already recorded as unknown; that the learner also needed the kana spelled
out is a fact about their kana, not about this word. It is surfaced on the
summary screen instead ("you needed romaji for 3 words — practise katakana?"),
with a link into the katakana course. Deliberately *not* wired into the kana
courses' own records: a word's romaji tap is weak evidence about which
specific characters were the problem, and inventing a miss on ン because it
happened to be in コンピューター would be worse than saying nothing.

**The yomi stage** then runs after a correct definition, and only when:

- at least one kanji had its furigana hidden, and
- the learner never revealed it.

Both conditions matter. The first means a word whose readings are all still
being shown — neither enrolled nor past the exposure threshold — never reaches
this stage, because there is nothing to test. The second is what "if you didn't
need the furigana" means.

It looks like this — the word, still bare, and six kana readings (short
labels, so six of them, per the table in §5.1):

```
                      電車

     ┌────────────┐  ┌────────────┐  ┌────────────┐
     │  でんしゃ   │  │  でんぐるま │  │  てんしゃ   │
     ├────────────┤  ├────────────┤  ├────────────┤
     │  でんくるま │  │  でんじゃ   │  │  てんくるま │
     └────────────┘  └────────────┘  └────────────┘
```

The wrong readings are `mis`, built at build time by taking the correct
alignment and **substituting another genuine KANJIDIC reading** for one of the
word's own kanji, plus rendaku/no-rendaku and voiced/unvoiced variants of the
correct reading. That produces distractors which are wrong for exactly the
reason the learner needs to notice — 車 is しゃ here, not くるま — instead of
being random kana that can be dismissed at a glance.

Build-time rules for `mis`:

- Never emit a string equal to the correct reading.
- Never emit the reading of another real word with the same surface — for
  homographs (開く ひらく/あく) the other reading is a *correct* answer to a
  different question and must not be marked wrong. Drop it, don't include it.
- Emit up to 8; the runtime picks 5. If fewer than 5 survive, fill from other
  words' readings in the same unit that are close in length.

**Every option must agree with the furigana still on screen.** This is the
part the first implementation got wrong. §5.2's whole point is that furigana
hides *per kanji*, so a partly-revealed word is a partly-revealed question:
質問 shown as 質(しつ)問 — 問 already known, its reading hidden — is asking
one thing only, whether the learner knows 問 reads もん. But `mis` varies
*any* position, so the options offered were じつもん, たちもん, ちもん,
しっもん — four of six contradicting the しつ printed above 質, eliminable
without knowing a thing about 問, leaving a six-way question that was
really a two-way one.

So the runtime filters `mis` down to candidates that differ from the correct
reading only inside a span whose furigana is hidden. `build_mis` splices
exactly one position and leaves the rest of the reading untouched, which
makes the test cheap: agree on the leading characters before the hidden
span and on the trailing ones after it (matched from the *end*, since a
substitution can change the word's length). The per-position spans are
re-derived at runtime from `w` + `ruby`, the same split `build_ruby` made at
build time — so no new data is needed. The cross-word top-up above is also
skipped whenever anything is visible: another word's reading has no reason
to match the visible furigana either, and would be one more free
elimination.

**A question that can't be filled fairly isn't asked.** Filtering this way
can leave very little — 曜 in 月曜日 has essentially no alternate reading to
offer, so hiding it yields one distractor. Below three options total the
yomi stage is skipped and the question simply ends after the definition,
which is the honest outcome: a two-way guess measures nothing, and padding
it back out to six is exactly the bug. Across the current data this skips
about 21% of partially-revealed scenarios and asks the other 79%. If that
ratio ever collapses, the fix is to enrich `mis` at build time — generating
and capping it *per position* rather than shuffling one global pool of 8 —
not to relax the filter. test/smoke.js guards both the invariant and the
ratio.

Getting it right or wrong grades `vyomi:` and ends the question either way —
no second chance on the yomi stage, because the definition attempt already
gave the learner the word.

### 5.5 The four English options

Runtime, from the unit currently loaded (like `buildDefinitionChoices` in
`kanji.js`), with three filters:

- **Same part of speech where possible.** A verb among three nouns is the
  answer by shape alone. `pos` is on the entry for this and nothing else.
- **No duplicate labels**, and no near-duplicate — build time computes a small
  "don't offer together" set per word for genuine synonym pairs in the same
  unit (電車/汽車 both glossing as "train"), because the runtime has no way to
  tell them apart and an unanswerable question is worse than a repeated one.
- **Prefer the same unit, fall back to the same level.** A unit of 40 words
  always has three to spare, so the fallback rarely fires; it exists for the
  first session of a small unit where only a handful are enrolled.

---

## 6. English → Japanese (the Recall mode)

### 6.1 Stage 1 — pick the kana

```
                     "train"

     ┌────────────┐  ┌────────────┐  ┌────────────┐
     │  でんしゃ   │  │  じてんしゃ │  │  でんわ    │
     ├────────────┤  ├────────────┤  ├────────────┤
     │   えき     │  │  くうこう   │  │  ちかてつ   │
     └────────────┘  └────────────┘  └────────────┘
```

Always **kana**, never kanji, at this stage — the question is "can you
produce the word", and showing kanji would let a learner who recognises 電車
answer without ever recalling でんしゃ. Katakana words are offered in
katakana.

Distractors: five other words from the same unit, ranked by how confusable
they are — sharing the first mora, or within one mora of the same length, is
better than random. Two hard rules:

- **Never two options with the same kana string.** はし (bridge) and はし
  (chopsticks) in one list is an unanswerable question. Dedupe by reading,
  the same rule the kana quiz already applies for じ/ぢ.
- **Never an option that is also a correct answer to the prompt.** If the
  English is "train" and the unit contains both 電車 and 列車, one of them has
  to go. This is the same synonym set §5.5 builds.

A wrong first tap gets one more try, then reveals — matching `chooseAnswer()`
exactly. The record is locked to the first attempt.

### 6.2 Stage 2 — pick the kanji spelling

Runs after a correct stage 1, when the word is written with at least one kanji
the learner is studying **in any mode** (`definition`, `recognition` or
`writing`) — the same test §5.2 applies to furigana, for the same reason:
caring about a kanji at all is enough reason to be asked how a word using it is
spelled.

Note what this does *not* include: the exposure threshold (§5.3). Having met 電
often enough to read it is no evidence at all that you could pick 電車 out of
six spellings — recognition and production come apart here more sharply than
anywhere else in the app. Exposure governs what is shown; enrolment governs
what is demanded.

Skipped entirely for kana-only words and for `uk` words (§3.3).

```
                でんしゃ  —  "train"

     ┌──────┐  ┌──────┐  ┌──────┐
     │ 電車 │  │ 汽車 │  │ 客車 │
     ├──────┤  ├──────┤  ├──────┤
     │ 貨車 │  │ 停車 │  │ 発車 │
     └──────┘  └──────┘  └──────┘
```

The reading stays on screen. The learner already produced it; hiding it would
turn one question into two.

### 6.3 Building the wrong spellings

Two shapes of word, two rules, both as specified.

**Mixed kanji + kana (食べる, 見る, 高い).** The wrong answers are the correct
word **with one kanji swapped out**: 食べる → 飲べる, 立べる, 田べる. The
okurigana is identical across all six, so it gives nothing away — which is the
whole point of the rule.

Choosing the substitute kanji, best first:

1. A kanji that **can genuinely be read the same way** — for 食べる (た), any
   kanji with た among its KANJIDIC readings: 田, 立, 手… The learner has just
   answered たべる, so a substitute that is also readable as た means the
   reading cannot be used to eliminate it. This is the strongest kind of
   distractor and should be preferred wherever it exists.
2. Failing that, a kanji from the same unit's other words.
3. Failing that, any kanji at the same or lower level.

And one absolute rule: **the result must not be a real word.** 会う → 合う is
a real, common, near-synonymous word, and offering it as "wrong" would be
teaching something false. Every generated spelling is checked against the
whole of JMdict at build time and discarded if it exists there at all with a
compatible reading. This check is *the* reason `sp` is precomputed rather
than generated on the phone.

**Kanji-only (電車, 学校, 新聞).** The wrong answers are **real other words with
the same number of kanji** — 電車 (2) gets 汽車, 客車, 貨車; never 車 or 自転車,
because a different length is a free elimination.

Rules:

- Same kanji count as the answer, exactly.
- Drawn from a build-time pool of common JMdict words (the top few thousand by
  `nf` band, the same signal `priority_rank()` already uses), so a distractor
  is always a word that genuinely exists.
- **Not a synonym of the prompt.** Checked at build time against the answer's
  own glosses.
- Prefer distractors sharing a kanji with the answer (汽**車**, 客**車**) —
  they look like plausible spellings of the same idea rather than unrelated
  noise.

Ship up to **16 candidates** per word in `sp`. The runtime needs the headroom
because it is about to throw a lot of them away.

### 6.4 The mastered-kanji exclusion — and its mirror image

**The rule, as specified:** a distractor spelling is dropped if it contains a
kanji the learner has mastered. If you know 汽 cold — steam — you know 汽車
isn't an electric train, and the question stops testing spelling and starts
testing kanji you already know.

"Mastered" means `masteryTier(record) === 4` (box ≥ 5) on that kanji's
**Definition** record. Meaning is what enables elimination; knowing only a
reading rarely does. Yomi mastery is a weaker secondary signal and is
deliberately not part of the test — noted here so the choice is visible rather
than accidental. The exclusion is per-word: if **any** kanji in a candidate
distractor is mastered, the whole candidate goes.

**The trap this opens, which the rule as stated does not close.** If every
distractor is built from kanji the learner has never met, while the answer is
built from kanji they know cold, then the answer is simply *the one that looks
familiar*. That is elimination again, running the other way, and it is
arguably easier than what the rule was protecting against.

So the distractor pool is **ordered**, not merely filtered:

1. Kanji the learner has **met but not mastered** (studied, tier 1-3) — these
   look exactly as familiar as the answer's kanji and cannot be ruled out by
   meaning. Best distractors by a distance.
2. Kanji the learner has **never met**.
3. Mastered kanji — never.

**When the pool runs dry.** For a learner deep into the kanji course, most
kanji are mastered and rule 3 can starve the question. The fallback ladder
degrades the *question*, never the rule:

1. Six options.
2. Four options.
3. Three options.
4. Fewer than three survive → **skip the spelling stage for this word this
   round**, and grade nothing.

Skipping is cheap because the stage is a bonus on an already-correct answer,
and it is far better than quietly serving a question that gives itself away.
Log the skip rate in the wiring test; if it is high in normal use, the answer
is a bigger candidate pool at build time, not a weaker rule.

---

## 7. Screens

Mostly reuse. What is new:

| Screen | Change |
| --- | --- |
| Home | A fourth script card, *Vocabulary · 単語* |
| Course | Unit picker groups become Core / the five GCSE themes / A level; mode picker shows Meaning and Recall |
| Quiz | A `choice-grid-vocab` layout for six options; the word is a tap target with a reveal ladder; a stage-2 panel that replaces the choices in place rather than navigating |
| Overview | Tiles show the **word**, not one character — a 3-column grid rather than the character grid's 6-8 |
| Word detail | New: the word, its reading, all glosses, its kanji as tappable chips into the existing kanji detail screen, and per-mode study toggles |
| Kanji detail | Gains a *seen 6× in words* line, and a marker on reading chips that have crossed the exposure threshold (§5.3) — the only place passive progress is visible |
| Summary | Adds the "you needed romaji N times" nudge from §5.4 |

The word detail screen linking each kanji through to the existing kanji detail
screen is the piece that makes the two halves of the app one app rather than
two. It should go in the same phase as the screen itself, not "later".

Two-stage questions need care in the progress bar: **the counter counts words,
not stages**, and the bar advances only when a word is finished with. A bar
that jumps by half is worse than one that pauses.

---

## 8. Sync, backup and merge

Almost free, by construction:

- Progress records are ordinary records under new key prefixes.
  `mergeProgress` is key-agnostic and needs no change.
- `rebuildYomiRollups` must keep ignoring vocab keys (§3.3) — and the vocab
  rollups from §4.4 must be rebuilt after a merge the same way kanji's are,
  or a merged profile carries a stale card until the next answer. **This is
  the one real piece of merge work**, and it is the same shared helper §4.4
  already calls for.
- `study` / `unstudy` merge per (item, mode) with no change; the mode ids are
  just new strings.
- **`exposure` needs a merge rule of its own, and it is the one genuinely new
  piece of merge code.** Union the two sides' timestamp lists per key, treat
  two timestamps within 60 seconds of each other as the same event, sort
  descending and keep the newest 8. That is idempotent and order-independent,
  so re-running a merge or merging in either direction gives the same list —
  which is what stops a three-device household inflating its own exposure
  counts. Note it is a **union, not last-write-wins**: an exposure map is
  evidence that accumulates, not a setting with a current value, and running
  `preferIncomingRecord` over it would silently discard practice.
- Demotion (§5.3) clears a key's list. A cleared list and a never-existed key
  are indistinguishable after a union with a device that still holds the old
  timestamps, so **demotion writes a tombstone** — `exposure['電:でん'] = { cleared: <ts> }`
  — and the union drops every timestamp older than `cleared`. Same shape of
  problem, and the same solution, as `unstudy` in `sync-plan.md` §0.1.
- Backup format version stays 1. Old backups load unchanged and simply have no
  vocab records; new backups load into old builds and the vocab keys sit inert.
  Worth confirming rather than assuming — a test.

Profile size grows: ~1,700 words × up to 4 records, plus an exposure map whose
worst case is one 8-element list per (kanji, reading) pair the learner has ever
met — bounded by the ~3,400 quizzable readings across the whole kanji set, and
in practice far smaller. Records are small, but
this roughly doubles a heavy profile. `MAX_HISTORY` (300 events per record)
already bounds it, and sync payloads are encrypted blobs whose size nobody is
paying per byte for. Watch it; don't pre-optimise it.

---

## 9. Testing

A new `test/vocab.js`, run the same way as the others, asserting the
invariants that are expensive to notice by hand:

- Every entry's `ruby` either aligns to the surface form exactly, or is
  `null`.
- No `mis` entry equals the correct reading, or the reading of a homograph of
  the same surface.
- No `sp` entry is a real JMdict word *(checked in the build script and
  asserted here against a sample)*, and every `sp` entry for a kanji-only word
  has the same kanji count as the answer.
- No option list ever contains a duplicate kana string or a duplicate English
  label.
- The mastered-kanji exclusion holds for a simulated profile with a large
  mastered set, and the fallback ladder terminates rather than looping.
- Every unit is between 20 and 70 words, and every word's theme slug exists.
- Every `ruby` entry's `credits` target is one of that kanji's `quizReadings`,
  or absent — the §4.5 safeguard, checked over the whole corpus rather than
  trusted.

And, for exposure (§5.3), the properties that are easy to get subtly wrong and
impossible to notice by hand:

- Merging two exposure maps is **idempotent** (merge(a, merge(a, b)) ==
  merge(a, b)) and **commutative** (merge(a, b) == merge(b, a)). Run it over
  generated pairs, not one hand-written example.
- A three-device round trip does not inflate a count above the number of real
  encounters.
- A demotion tombstone survives a merge with a device still holding the
  pre-demotion timestamps.
- One session showing the same word five times accrues exactly one exposure.
- A reading at the threshold stops accruing, and its ruby is hidden in every
  word that uses it with that reading — and *not* hidden for the same kanji
  under a different reading (the 生 せい/なま case).

Plus extensions to the existing suites: `test/wiring.js` plays a full vocab
session in each mode including both bonus stages; `test/store.js` round-trips
a profile with vocab records through backup and merge; `test/smoke.js` gains
the vocab course tables.

---

## 10. What stories will need from this

Stories are the next feature. Three things in this plan exist partly for them,
and one thing has to be decided now.

**Built for reuse:**

1. **Per-kanji ruby (§3.2).** Stories annotate kanji inside running text. If
   vocab shipped whole-word ruby only, stories would need the alignment work
   done again over a different corpus.
2. **`vocab-lookup.js` (§3.4).** Story text needs surface → entry without
   knowing which unit a word is in. Same need search already has for kanji.
3. **The reveal ladder as a component.** §5.2's behaviour — bare → furigana →
   romaji, with the studied-kanji rule deciding the starting state — should
   land in its own module (`src/furigana.js`) rendering a word into any
   container, not inline in the quiz. Stories then add a fourth rung, *tap for
   the definition*, without touching the first three.
4. **Levels as a filter (§2.1).** "A story using only Foundation vocabulary"
   is `lv <= 'f'`, already on every entry.
5. **The exposure counter (§5.3).** This is the piece stories benefit from
   most, and the reason it lives in `srs.js` rather than the vocab module.
   Reading is where passive exposure actually happens at volume: a story
   episode may put でん in front of the learner three times in a paragraph
   (once, by the one-per-session rule). A learner who reads a lot should find
   furigana quietly disappearing from the words they have been reading, having
   never opened a quiz — which is close to the whole point of adding stories.

**The decision stories force now:** a browser has no morphological analyser,
so nothing on the phone can tell that 食べました is 食べる. Story text must
therefore be **authored pre-tokenised** — a token array, or inline markup like
`[食べました|たべました|食べる]` — carrying the surface, the reading, and the
dictionary form to look up. That is a story-authoring format decision, but the
vocab entry has to be its lookup target, which is why the id scheme in §3.3 is
the dictionary surface form and nothing cleverer.

---

## 11. Open questions

**Settled** (kept here because the reasoning matters more than the answer):

- *Which mode hides furigana?* **Any mode** — see §5.2. An earlier draft
  recommended Yomi enrolment alone; that was wrong for the reason §1.1 gives.
- *Four options or six?* **Four for English glosses, six for kana and kanji
  labels** — see the table in §5.1.

**Still open:**

1. **Is four the right exposure threshold?** §5.3 uses it as specified, as a
   named constant, and keeps 8 timestamps so it can be raised without losing
   evidence. It is a guess until it has been lived with; expect to move it.
   Whether it should differ between a reading first met in a quiz and one
   first met in a story is a second-order version of the same question.
2. **Does a demoted reading need a cooling-off period?** §5.3 lets a demoted
   reading re-earn the hidden default immediately, which risks a reading
   oscillating between shown and hidden. A simple fix if it happens: require
   more exposures the second time round.
3. **Should crossing the exposure threshold also credit the kanji's reading
   record?** §4.5's sub-decision. Assumed no throughout: exposure changes what
   is *displayed*, answers change *records*.
4. **Does the official specification list get used, or the frequency-based
   substitute?** §3.5. Phase 0 decides, and it changes what the units are
   called.
5. **Should a needed-romaji tap feed the kana courses' records?** §5.4 says no
   and explains why. Revisit if the summary nudge turns out to be ignored.
6. **Does Recall need a typing mode later?** Everything here is multiple
   choice, matching the rest of the app (nothing is typed, so no keyboard
   appears and the layout never shifts). A kana-keyboard input for Recall is a
   plausible later addition and nothing here blocks it.

---

## 12. Phases

| Phase | What | Depends on | Status |
| --- | --- | --- | --- |
| 0 | **Sourcing.** Obtain or decide against the specification list; produce `tools/vocab_src/gcse-foundation.tsv` with themes assigned. The long pole, and mostly not programming. | — | **Done, on the fallback.** No official list was obtainable within this session's copyright limits, so `tools/build_vocab_data.py` uses JMdict `nf` frequency bands instead — Core hand-specified (113 words), 24 of 25 GCSE-style theme units populated by keyword classification (938 words total; `3.2` came in under `MIN_UNIT_SIZE` and was dropped). |
| 1 | **Build script.** `tools/build_vocab_data.py`: JMdict lookup, alignment reused from `build_kanji_data.py`, `mis`/`sp` generation with the real-word check, manifest + per-unit files + lookup index. | 0 | **Done.** Ruby/credits, `mis`, and `sp` all generated and invariant-checked (id uniqueness, credit-target validity, label length, no mis/sp equalling the correct answer). |
| 2 | **The `vocab` kind.** Courses from the manifest, lazy loading, the four modes, the `eligibleItems` gate (§4.3), the shared rollup helper (§4.4), the fourth home card, unit picker. No questions yet — the course screen counts to zero correctly. | 1 | **Done.** `src/vocab.js`, `gatesEnrollment`/`recomputeVocabRollup` in `srs.js`. |
| 3 | **Meaning mode.** Four English options, the reveal ladder, reveal-grades-yomi, the yomi follow-up stage. Hiding is enrolment-based only at this point. | 2 | **Done**, verified end-to-end in-browser against real IndexedDB state (rollup math, reveal-grades-a-miss, yomi-stage skip-on-reveal all confirmed). Enrolment-only hiding, as scoped — no exposure yet. |
| 3a | **Exposure tracking (§5.3).** The `exposure` map, the one-per-session rule, the threshold, demotion, the merge rule (§8) and its property tests, and the *seen 6×* line on the kanji detail screen. Separable from phase 3 and worth keeping separate — its correctness lives almost entirely in merge behaviour, which is testable without any UI. | 3 |
| 3b | **Crediting kanji readings (§4.5).** Build-time `credits` targets, and the write on a correct unrevealed yomi answer. | 1, 3 |
| 4 | **Recall mode.** Kana options, the kanji spelling stage, the exclusion rule and its fallback ladder. | 2 |
| 5 | **Word detail and overview screens**, including kanji chips linking into the existing kanji detail screen. | 2 |
| 6 | **Higher tier** — same units, added words. Largely a data phase. | 3, 4 |
| 7 | **A level** — the A-group units from §2.3. Data plus the group labels. | 6 |
| 8 | **Story hooks** — extract `src/furigana.js` as a standalone component if it hasn't already fallen out of phase 3, and confirm `vocab-lookup.js` answers what stories need. | 3 |

Phases 3 and 4 are independent of each other and can land in either order;
shipping 3 alone is a coherent, useful app on its own, which is the argument
for doing it first.

3a and 3b are the two halves of §1.1 and are what make this more than a word
quiz — but both need phase 3's questions to exist before they have anything to
observe or credit, and both are easier to get right in isolation than folded
into the phase that introduces the screen. Neither is optional; both are
separable.

**Per this repo's convention:** every phase that changes what a learner sees
bumps `APP_VERSION` in `src/app.js` and `VERSION` in `sw.js`, and adds a
plain-language entry to `src/changelog.js` in the same commit. Phases 0, 1 and
8 probably don't; 2 through 7, 3a and 3b all do. 3a in particular deserves a
plainly-worded entry — *"words you have seen a few times stop showing their
furigana"* is the kind of change that reads as a bug if it goes unannounced.
