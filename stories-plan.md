# Stories — implementation plan

Status: **not started.** Named in `vocab-plan.md` §10 as the feature vocabulary
was partly built for; this is that feature written out.

A fifth thing to do in the app, and the first one that is not practice.
A learner opens a short story pitched at their level and **reads it**. They
scroll. Nothing is asked of them, nothing is scored, and the app forms no
opinion about how it went. A word they don't know is one tap for its
pronunciation, a second tap for what it means, and one more for the whole
sentence in English. From that card they can reach the word's, the kanji's or
the kana's own detail screen and add it to a study list **if they choose to** —
the app never does it for them.

That last point is the design. Reading is an end in itself: the way a
learner meets a reading for the fifth time and stops needing the furigana, the
way vocabulary stops being a list and starts being something people say. Every
temptation to instrument it — a comprehension question at the end, an
auto-enrolment of every word tapped, a reading streak — is a temptation to
turn it back into the quiz the rest of the app already is, and is refused
throughout.

The one thing the app **does** quietly keep is the exposure counter
`vocab-plan.md` §5.3 already built, because that is what makes furigana fade
out of a learner's stories on its own without anybody asking for it.

---

## 1. What this is, and what it is not

### 1.1 The shape of one reading session

1. Home screen → **Read**.
2. The library opens on the learner's own reading level, with the episode
   they are part-way through at the top.
3. They tap it. The reader is the story and almost nothing else: title, text,
   a thin progress line.
4. They scroll and read. Unknown word → tap → pronunciation. Tap again →
   definition, plus *Translate this sentence*, plus a way through to the
   word's or the kanji's full detail screen.
5. They stop wherever they stop. Reopening the library returns them there.
6. At the end: no quiz. A short end card listing what they tapped, each with
   an **Add** button they may or may not press, and the next episode.

### 1.2 What it is not

- **Not a test.** No comprehension questions, no "did you understand this",
  no self-grading, no score. The one time the app asks the learner anything
  is the end card's optional *Add to study list*.
- **Not a course.** Stories have no chunks, no Leitner boxes, no due dates,
  no "add 5 more". They are not a `kind` in the `MODES` table and they do not
  appear in the mode picker. Nothing in `srs.js` schedules them.
- **Not automatic enrolment.** Tapping a word for its meaning does not add it
  to anything. §7.5 is the whole list of things a tap deliberately does *not*
  do, and it is worth reading as a design statement rather than a limitation.
- **Not a dictionary reader.** The app cannot parse arbitrary Japanese pasted
  in — see §3.3. Every story is prepared at build time. This is a real
  constraint and it shapes §4 entirely.

### 1.3 The one architectural rule

> **A story is authored once, in ordinary Japanese, and rendered differently
> for every learner.**

There is no hiragana edition and kanji edition of the same episode. There is
one tokenised text, and a render pipeline (§5) that decides — from the
learner's own progress, on the fly, every time the reader opens — whether a
given word appears as `でんしゃ`, `でんしゃ` with spaces around it, `電車`
with furigana, or `電車` bare.

Everything in §5 and §6 follows from this, and so does the fact that the
level ladder in §2 is about **vocabulary and grammar only**. Script is not a
property of a story. It is a property of a reader.

The alternative — authoring an easy and a hard version of every text — was
rejected on three counts. It multiplies the authoring cost by the number of
script stages, exactly when §4 says authoring is the expensive part; it makes
"show me this in kanji now that I've started kanji" a different *file* rather
than a re-render; and it guarantees the two versions drift, because nothing
mechanical keeps a hiragana edition in step with an edit to the kanji one.

---

## 2. Levels

### 2.1 A level is vocabulary plus grammar, and nothing else

Two things make a text hard for a beginner and they move together:

- **Which words are in it.** Already a solved problem: every vocab entry
  carries `lv` (`f`/`h`/`a`) and a unit id (`vocab-plan.md` §2.1), and
  `src/data/vocab-lookup.js` maps a surface straight to its unit.
- **Which grammar is in it.** Not solved, and the user's instruction is
  explicit: *"Stories limited to simple vocab should have simpler grammar as
  well."* A text made only of Core words but written in the causative-passive
  with three subordinate clauses is not a beginner text, and a level that
  only counts vocabulary would happily pass it.

So a level is a **pair** — a vocabulary ceiling and a grammar tier — presented
to the learner as one number, and enforced at build time as two separate
checks (§4.6).

### 2.2 The ladder

| Level | Shown as | Vocabulary allowed | Grammar tier | Sentence length | Episode length |
| --- | --- | --- | --- | --- | --- |
| **L1** | First steps | Core (`C1`–`C6`) only | G1 | ≤ 8 tokens | 8–15 sentences |
| **L2** | Getting going | + themes 1.x–2.x, `lv:'f'` | G2 | ≤ 12 | 15–25 |
| **L3** | Everyday | + all `lv:'f'` | G3 | ≤ 16 | 25–40 |
| **L4** | Wider world | + all `lv:'h'` | G4 | ≤ 22 | 40–60 |
| **L5** | Confident | + all `lv:'a'` | G5 | unrestricted | 60–120 |
| **L6** | Unabridged | unrestricted | G6 | — | a real chapter |

Cumulative, like the vocab tiers themselves: L3 means "L2 and more", never
"instead of L2".

The `K*` kanji-words group (`vocab-plan.md` §13) is deliberately **not** part
of any level's allowance. It is a bonus group assembled from example words on
kanji pages rather than a curriculum, and letting it in would quietly widen
L1's ~110-word ceiling to several hundred.

### 2.3 The grammar tiers, concretely

A tier is a **whitelist of inflections and auxiliaries**, because that is what
a build-time check can actually verify (§4.6). Each is cumulative.

| Tier | Adds |
| --- | --- |
| **G1** | です/ます/ました/ません, は を に で と も, い- and な-adjectives in predicate position, あります/います, numbers and counters. One clause per sentence. |
| **G2** | て-form linking two clauses, 〜ている, 〜たい, 〜ましょう, から (reason), が (but), short quotations with と |
| **G3** | plain forms (dictionary, た, ない), short relative clauses, 〜ので/〜けど, 〜と思う, potential 〜える/〜られる, 〜たり |
| **G4** | conditionals (〜たら/〜ば/〜と/〜なら), 〜ながら, 〜そう/〜よう/〜らしい, 〜てしまう/〜ておく/〜てみる, comparatives |
| **G5** | passive, causative, 〜なければならない, 〜べき, polite honorific/humble forms, nested relative clauses |
| **G6** | unrestricted, including literary and pre-war forms (〜であった, 〜ぬ, 〜ざる) — this is the tier Aozora texts land in unedited (§4.2) |

The tiers are a **guide to authoring and a gate on import**, not a claim to
linguistic completeness. Their job is to stop an L2 episode from containing a
causative, and they do that.

### 2.4 Choosing a level, and moving between them

The learner picks a level once, and it sticks:

```js
profile.settings.readingLevel = 'L2';   // stamped via stampSetting()
```

Storing it in `settings` rather than in a new top-level field is deliberate —
it inherits the per-field, latest-wins settings merge (`sync-plan.md` §0.2)
with no new merge code at all, which is exactly the right rule for a
preference.

**The first time**, there is no setting, and asking a nine-year-old "what is
your Japanese reading level?" is a bad question. So the library **suggests**
one from what the app already knows (§5.1's script stage plus the vocab units
they have started), pre-selects it, and says so in one line: *"Starting you at
Getting going — you can change this any time."* The suggestion is a starting
point, never a ceiling.

**Every level is always reachable.** The library's header is a level strip:

```
   ‹  L1   [ L2 ]   L3  ›            First steps · Getting going · Everyday
```

The learner's own level is the selected chip and the one the library opens on;
the neighbours are one tap away and every level is reachable by scrolling the
strip. Levels are **never locked** — a learner who wants to look at L5 may,
and a learner who finds L2 hard drops to L1 without the app having an opinion
about it. Changing the strip changes what the library lists; it does **not**
change `readingLevel` unless the learner confirms with a small *Make this my
level* affordance that appears when they have browsed away from their own.
Browsing and committing being different actions is the whole point of the
"defaults to their level, easier and harder easy to see" requirement.

### 2.5 Sizing, and what an "episode" is

Three nouns, one data shape:

- a **story** — self-contained, one sitting (a folk tale, a scene);
- a **chapter** — one part of something longer that was written whole;
- an **episode** — one part of something serialized, written to be read a
  part at a time.

All three are the same record (§3.1) with a different `series`/`part`. The
learner-facing word throughout the UI is **episode** for anything in a series
and **story** for anything standalone; nothing else distinguishes them.

The lengths in §2.2 are chosen so that one L1–L3 episode is **three to eight
minutes** of reading for someone at that level, tapping a few words. Short
enough to finish on a bus, which is where the resume feature (§9) stops being
theoretical and starts being the reason anybody finishes anything.

---

## 3. The data

### 3.1 One story

```js
{
  id:     'momotaro-1',
  title:  { ja: 'ももたろう', en: 'Momotarō' },
  series: { id: 'momotaro', part: 1, of: 4, name: 'Momotarō' },  // or null
  level:  'L2',
  gram:   'G2',                      // the tier it was checked against (§4.6)
  blurb:  'An old couple find a boy inside a peach.',
  source: {
    kind:  'public-domain',          // public-domain | original | adapted
    text:  'Aozora Bunko #12345',    // where it came from, or 'Kana Quest'
    by:    'Kusuyama Masao',         // author, or null
    notes: 'Adapted and abridged.',  // what we changed, honestly (§4.2)
    licence: 'Public domain (Japan, author d. 1954). Translation © Kana Quest.',
  },
  hash:   'f3c1a0',                  // content hash — see §3.5
  nw:     ['もも', 'おじいさん'],       // words above `level`, deliberately admitted (§4.6)
  body: [                            // paragraphs
    [                                // sentences
      {
        en: 'Long ago, in a certain place, there lived an old man and an old woman.',
        t: [ /* tokens — §3.2 */ ],
      },
    ],
  ],
}
```

`body` being paragraphs-of-sentences-of-tokens rather than one flat token
list matters twice over: the sentence is the unit the translation attaches to
(§7.3) and the unit a resume position points at (§3.5), and the paragraph is
the unit the reader lays out.

### 3.2 One token

```js
{
  s: '行きました',             // surface, as written in ordinary Japanese
  k: 'いきました',             // kana form, in NATIVE orthography (§5.3)
  d: '行く',                  // dictionary/vocab id to look up, or null
  ruby: [[0,'い']],           // per-kanji alignment, vocab-plan.md §3.2's shape
  pos: 'v',                  // n | v | adj | adv | part | aux | pn | punct | num
  g: 'went',                 // what it means HERE, in THIS form — always present
  df: '行く',                 // dictionary form, when this is an inflected form
  cf: 'polite past',         // what that form is, when df is present
}
```

Eight fields, and every one of them earns its place — see
`story-writing-guide.md` for the authoring rules that produce them:

- **`s`** is what a kanji-stage reader sees. **`k`** is what a kana-stage
  reader sees, and — critically — it is the *native* kana spelling, so
  コーヒー stays katakana and 電車 becomes ひらがな. A pure-hiragana reader
  gets `toHiragana(k)`, computed at render time, not stored (§5.6 is where
  that gets uncomfortable and is dealt with).
- **`d`** is the vocab id (`vocab-plan.md` §3.3: the dictionary surface form,
  `開く|ひらく` where a homograph forced it). `null` for particles,
  punctuation, and any word the vocab curriculum simply doesn't contain — a
  perfectly ordinary case, since the curriculum is ~1,900 words and a story
  is not written from a word list. §7.2 says what the definition card shows
  when `d` is null.
- **`ruby`** is the identical per-kanji alignment vocabulary already ships,
  produced by the identical `align_word()`. This is the single largest
  dividend of `vocab-plan.md` §3.2 having been built for stories from the
  start: story furigana needs no new alignment code and — because the third
  element is the credited base reading — reading a word can feed the same
  exposure keys a quiz answer does (§6.2).
- **`pos`** drives three things and nothing else: whether the token is
  tappable at all (`punct` is not), whether it gets a space in the
  hiragana-only rendering (§5.2), and whether the definition card says "a
  name" rather than looking up a gloss (`pn`).
- **`g`** is the token's meaning *in this context, in this form* — "went",
  not "to go". Required on every non-punctuation token, which is what lets a
  story use words the curriculum has never heard of and still explain every
  one of them. It is the card's headline, and the reason `d: null` is an
  ordinary case rather than a dead end.
- **`df` / `cf`** turn an inflected form into a lesson rather than a
  mystery: the card reads *"went — polite past of 行く — to go"*. They come
  as a pair; one without the other fails the build.

Inflected forms carry the surface as written, the dictionary form to look up,
and what the form *is*. The reader shows what was written; the card explains
the meaning in that form and then where it comes from — *"went / polite past
of 行く — to go"* — which is a genuinely useful thing for a learner to be told
and falls straight out of the format.

**Tokens are units a learner would look up, not morphemes.** 住んでいました is
one token, not 住んで + い + まし + た: four cards where one belongs, three of
them saying nothing usable. The full tokenisation rules — verb chains,
suffixes, idioms, proper nouns, and never splitting a word — are in
`story-writing-guide.md` §2.

### 3.3 Why the text is pre-tokenised

`vocab-plan.md` §10 already stated the constraint and it is worth restating
as the reason this whole feature has a build pipeline:

**A browser has no morphological analyser.** Nothing on the phone can tell
that 食べました is 食べる, that 電車で is two tokens, or where one word ends
and the next begins — and Japanese has no spaces to help. Shipping a
tokeniser and a dictionary to a phone is out of the question (MeCab plus
UniDic is tens of megabytes; the entire app today is a few).

Therefore: **every story is tokenised at build time**, by
`tools/build_story_data.py`, and the phone only ever renders a token array it
was handed. Three consequences, all of which are fine and one of which is
load-bearing:

1. The app cannot read arbitrary text. It reads *our* stories. That is the
   feature as specified.
2. Tokenisation errors are fixable in one place and ship as data.
3. The hiragana-with-spaces rendering the user asked for — the thing that
   makes a first story readable at all — is **free**, because tokenisation is
   exactly the operation that knows where the spaces go. It would be
   impossible without this.

### 3.4 Files and lazy loading

Exactly the pattern `kanji-expansion-plan.md` §4 established and
`vocab-plan.md` §3.4 reused, for the third time and for the same reasons:

| File | What's in it | Loaded |
| --- | --- | --- |
| `src/data/story-manifest.js` | `STORIES`: id → `{title, series, level, blurb, hash, length}` for every story | eagerly, small (~200 bytes each) |
| `src/data/story-<id>.js` | `STORY` — the full record above, body included | lazily, when the reader opens it |

The manifest carries everything the **library** needs and nothing the reader
needs, so browsing every level costs no fetches at all. An episode is roughly
40 bytes per token: an L2 episode of ~250 tokens is ~10 KB, an L6 chapter of
3,000 tokens is ~120 KB. Both are unremarkable next to the ~200 KB kanji
grade files already being fetched on demand.

`ensureStoryLoaded(id)` mirrors `ensureVocabUnitLoaded` down to the
in-flight-promise dedupe, and goes through the same `withLoading()` wrapper,
so a slow fetch shows the same spinner as everything else.

**Service worker:** `story-manifest.js` joins `SHELL` in `sw.js`; individual
stories do not, for exactly the reason the kanji grade files don't — they are
fetched lazily and land in the cache opportunistically the first time they're
read. Offline reading of an episode you have *not* opened before is an open
question (§11.6), not a phase-1 requirement.

### 3.5 A saved position needs a content hash

A resume position is `{ p: 3, s: 1 }` — paragraph 3, sentence 1. It is
deliberately not a scroll offset: font size, script stage and furigana
visibility all change the pixel height of the same text, so a saved offset
points somewhere different the moment any of them changes, and they change
often.

But a sentence index has its own failure: **fix a typo in paragraph 1 and
split a sentence, and every saved position after it is now off by one.** For a
learner mid-way through an L6 chapter that is a genuinely annoying bug and an
invisible one.

So every story carries `hash` — a short hash of its `body`, computed by the
build script. A saved position stores the hash it was taken against. On
resume:

- hashes match → restore exactly;
- hashes differ → **clamp to the start of the saved paragraph** and show a
  one-line note (*this story has been updated — we've put you near where you
  left off*).

Paragraph-level clamping rather than restarting, because a paragraph index
survives most edits and being a paragraph out is a two-second inconvenience,
where being sent back to the start of a chapter is enough to stop someone
reading.

### 3.6 Translations

Every sentence has an English translation, and it is **sentence-for-sentence,
not word-for-word** — the user's requirement, and the right one: word-glossed
Japanese teaches people to read Japanese as badly-ordered English, which is
the single most common way self-taught readers get stuck.

Three authoring rules, which are also build-time checks:

1. **Every sentence has exactly one `en`.** No sentence may be left
   untranslated, and no translation may span two sentences — otherwise
   "translate this sentence" has nothing coherent to show. Where the natural
   English merges two Japanese sentences, the *authoring* splits the English
   too, even at some cost in elegance, because the alignment is what the
   feature is.
2. **Natural English, not glossed Japanese.** 「頭が痛い」is *"I have a
   headache"*, not *"as for head, it hurts"*. The word-level explanation is
   what the definition card is for; the sentence translation's job is to tell
   the learner what the sentence *means*.
3. **The translation is ours.** For a public-domain Japanese text, an existing
   published English translation is a separate copyrighted work and is not
   free to use just because the Japanese is (§4.2). Every translation in this
   app is written for it.

---

## 4. Where the stories come from

This is the long pole, exactly as `vocab-plan.md`'s phase 0 was, and mostly
not programming.

### 4.1 The honest summary

There is a **large** supply of free Japanese text and an almost **complete
absence** of free Japanese text at beginner level with a redistributable
licence. The two halves of the plan are therefore different in kind:

- **The top of the ladder (L5–L6) can be imported.** Public-domain literature
  exists in quantity, is genuinely good, and is already annotated with
  readings.
- **The bottom of the ladder (L1–L4) has to be written.** There is no corpus
  of licence-clean texts pitched at a 110-word vocabulary and G1 grammar,
  because that text only exists as a teaching product, and teaching products
  are not public domain.

Both halves are worth doing, and the second half is where the user's stated
long-term intention already points: *"Will eventually create a lot more of
our own stories, tailored to different levels and serialized."* Phase 1 does
what free sources can do; phase 2 does what only authoring can.

### 4.2 Aozora Bunko

[Aozora Bunko](https://www.aozora.gr.jp/) is the usable source, and it is
usable for a reason that is easy to miss:

**Its texts already carry ruby.** The Aozora file format marks readings
inline — `｜電車《でんしゃ》` — because the works were transcribed from
printed books that had furigana. That is a per-word reading, hand-checked by
a human transcriber, for a substantial fraction of the kanji in the corpus.
It does not replace tokenisation (it says nothing about word boundaries for
kana-written words, and nothing about dictionary forms) but it is an excellent
**check** on the tokeniser's output: where Aozora's ruby and UniDic's reading
disagree, a human looks. That check is worth building (§4.6).

What is actually there, for our purposes:

- **Children's stories and folk tales.** Kusuyama Masao's and Ogawa Mimei's
  fairy tales, Japanese retellings of Grimm and Andersen, 昔話 collections.
  Short, narrative, and the closest thing the corpus has to graded material.
- **Miyazawa Kenji.** Public domain, widely loved, written for children,
  and short. 「注文の多い料理店」 is a natural early import.
- **Akutagawa, Sōseki, Dazai.** L6 material, and the reason L6 exists.

**Licence.** Works whose author died more than 70 years ago are public domain
in Japan; Aozora states each work's status on its page and the site's own
terms permit reuse. Two things must be got right rather than assumed, and
both belong in `source.licence` per story:

1. **Status is per work, not per site.** Some Aozora works are hosted with the
   rights-holder's permission under specific conditions, including
   no-derivatives terms. Those are unusable here, because everything we do is
   a derivative: we abridge, we re-tokenise, we translate. **Only works marked
   public domain are imported**, and the build script refuses anything else
   rather than leaving it to a human to remember.
2. **The transcription is somebody's work too.** Aozora asks for
   acknowledgement of the transcribers. Every imported story credits the
   source file, the work and the author in `source`, and the reader screen
   shows it (§8.3) rather than burying it in a build script comment.

**Language.** Pre-war Japanese is not modern Japanese: 〜であった, historical
kana usage (旧仮名遣い) in older transcriptions, vocabulary that has shifted.
For L6 this is a feature. For anything below it, an Aozora text must be
**adapted** — modernised, abridged, simplified — at which point it is our
writing built on a public-domain skeleton, and `source.kind` says `adapted`
and `source.notes` says what we did. Being straightforward about that in the
data is cheaper than being vague about it and having to reconstruct it later.

### 4.3 What is not usable, and why it is worth writing down

Each of these looks like an answer and is not. Recording why saves the next
person the same afternoon:

| Source | Why not |
| --- | --- |
| **NPO 多読 (Tadoku) free graded readers** | Exactly the right level and exactly the wrong licence: the free readers are generally CC **BY-NC-ND**. *ND* forbids derivatives, and re-tokenising, re-rendering and translating are derivatives. Unusable no matter how well they fit. |
| **福娘童話集 and similar folk-tale sites** | Free to *read*, not freely licensed. Ordinary copyright. |
| **Textbook and JLPT practice readers** | Copyrighted teaching products. Also the exact market a free app should not be quietly copying. |
| **NHK News Web Easy** | Simplified Japanese with furigana, superb material, ordinary copyright, and explicit terms against redistribution. Linkable, not importable. |
| **Machine-translated or LLM-generated text, shipped unchecked** | Not a licence problem, a quality one. See §4.5. |
| **Japanese Wikipedia / Wikisource** | CC BY-SA, so usable, but not stories — and BY-SA is *viral*: importing it would make the containing work share-alike. Wikisource does hold some public-domain literature that overlaps Aozora; prefer the Aozora copy, which has the ruby. |

### 4.4 The gap at the bottom

Nothing free fills L1–L3, and it is worth being precise about why: an L1 text
has to be built from a **110-word vocabulary with one-clause sentences**, and
text like that is only ever produced deliberately, by a teacher or a
publisher, for money. It does not occur naturally and it does not fall out of
copyright, because it is recent by construction.

So L1–L3 is authored. That is not a setback — it is what the user already
planned to do, and doing it first at the bottom of the ladder is the right
order, because the bottom is where a learner is most likely to give up and
where a well-pitched story is worth the most.

### 4.5 Writing our own

The intended shape, once phase 1 has proved the pipeline:

- **Serialized.** A small cast, one setting, an episode that ends somewhere.
  Serialization is what makes a graded reader something a learner returns to
  rather than finishes: the vocabulary ceiling stops being a constraint the
  reader notices and becomes the reason the sentences feel easy.
- **One series per level band**, running for as many episodes as it stays
  good, with a natural progression: a series that starts at L2 may end at L3,
  and the level is per episode, so it can.
- **Written against the constraint, not trimmed to it.** The build gate (§4.6)
  reports every out-of-level word, so the loop is: draft, check, revise.
  Writing to a word list is a skill; the gate is what makes it learnable.
- **Drafting may be LLM-assisted; shipping is not.** A model is good at
  producing plausible Japanese to a word list and unreliable at the things
  that matter here — collocation, register, whether a sentence is actually
  something a person would say, and whether the English translation says what
  the Japanese says. Every episode is read by a person who knows Japanese
  before it ships. `source.kind: 'original'` is a claim about quality, not
  just provenance.
- **New words are declared, not smuggled.** A graded reader that never
  introduces anything teaches nothing; `nw` (§3.1) lists the words an episode
  uses above its level on purpose. The gate allows a handful — five is the
  proposed cap for L1–L3 — and fails the build on unlisted ones.

### 4.6 The build pipeline

`tools/build_story_data.py`, following `build_vocab_data.py`'s conventions
(same directory, same generated-file header, same "do not hand-edit"):

**Input** — one file per story in `tools/story_src/`, in a light markup that a
human can write and diff:

```
---
id: momotaro-1
level: L2
series: momotaro/1of4
source: aozora:12345 | adapted
title: ももたろう / Momotarō
---

むかしむかし、あるところに おじいさんと おばあさんが すんでいました。
> Long ago, in a certain place, there lived an old man and an old woman.

おじいさんは 山へ しばかりに いきました。
> The old man went to the mountains to cut firewood.
```

One Japanese sentence per line, its translation on the `>` line beneath it,
blank line between paragraphs. Text is written in **ordinary Japanese with
kanji** regardless of the level (§1.3) — the renderer handles the rest.

**Steps:**

1. **Tokenise** with `fugashi` + `unidic-lite`. Surface, lemma, reading and
   part of speech all come out of UniDic directly. New Python dependency,
   pinned in the build script's own header the way the existing tools pin
   theirs.
2. **Resolve** each content token's lemma against `VOCAB_LOOKUP` to fill `d`.
   Words absent from the curriculum get `d: null` and are counted in the
   level report.
3. **Align** each kanji token with `align_word()` — imported from
   `build_kanji_data.py`, the same function `build_vocab_data.py` imports, so
   story ruby and vocab ruby cannot disagree about 三十日. A failed alignment
   yields `ruby: null` (whole-word ruby), exactly as vocab does.
4. **Cross-check against Aozora ruby**, for imported texts: where the source
   file's `《》` reading and UniDic's reading disagree, fail the build with
   both readings printed. This catches the tokeniser mis-reading a name or
   picking the wrong homograph, which is the single most likely error in the
   whole pipeline and is invisible in the output.
5. **Level gate.** Every content token must be in the level's vocabulary
   allowance (§2.2), on the function-word whitelist, marked `pn`, or listed
   in `nw`. Report every failure with its sentence, and exit non-zero.
6. **Grammar gate.** Check UniDic's inflection type and auxiliary lemma per
   token against the tier's whitelist (§2.3). A causative auxiliary in a G2
   text fails the build. This is a coarse check and it is honestly labelled
   as one — it catches the inflectional half of grammar, not clause structure
   — with sentence length standing in for the rest.
7. **Emit** `story-<id>.js` and update `story-manifest.js`, with `hash`
   computed over the emitted body.

**Reproducibility.** The output is deterministic given the input — the
lesson `build_vocab_data.py` learned the hard way with its `set()`-before-
`shuffle` bug (see `vocab-plan.md` §12 phase 9). Nothing here iterates an
unordered collection into ordered output.

---

## 5. How one text is rendered for one learner

### 5.1 The script stage, derived rather than asked

```js
function scriptStage(profile)  // 'hira' | 'kana' | 'kanji'
```

- **`hira`** — the katakana course has no introduced items:
  `courseStats(getAnyCourse('katakana'), 'recognition', profile).started === 0`.
- **`kana`** — katakana started, no kanji started.
- **`kanji`** — any kanji has been enrolled in Definition, Yomi or Writing, or
  has a progress record in one of them.

The kanji test must use the `KANJI_STUDY_MODES` set already defined in
`app.js`, **never** a bare "is this key in `study`" check. `study` is keyed by
bare item with no mode namespacing, so a single-kanji vocab word (水, 船)
enrolled in `vmeaning` writes the very same key the kanji would — the exact
bug `vocab-plan.md` phase 3b found and fixed in `isKanjiKnown`. Repeating it
here would make a learner who studied the *word* 水 suddenly start seeing
kanji in every story.

For `kanji`, one more thing is derived — the **frontier unit**: the
furthest-along kanji unit with any introduced item, in `KANJI_UNIT_IDS` order.
`'1'`, `'2'`, `'3'`… `'8-1'`… That is what §5.4's window is measured from.

All of this is recomputed on entering the reader, not stored. It is cheap, and
storing it would mean a learner who has just started katakana keeps reading
hiragana-only stories until something remembers to invalidate a cache.

### 5.2 Stage `hira` — all hiragana, spaced

Every token renders as `toHiragana(k)`, with a space between tokens, sentence
punctuation attached to the preceding token with no space before it.

```
むかしむかし、 ある ところに おじいさんと おばあさんが すんで いました。
```

Spacing is per **token**, which puts particles as their own space-separated
units (`おじいさん は`) — and that is deliberately *not* what we want, because
Japanese children's books attach particles to their host (`おじいさんは`). So
the render pipeline applies one grouping rule: **a `part` or `aux` token joins
the preceding token without a space.** That reproduces 分かち書き as actually
printed in Japanese beginner books, and it costs one line.

Nothing is tappable-for-furigana here (there is no kanji), but every token is
still tappable: tap one gives romaji, tap two gives the definition (§7).

### 5.3 Stage `kana` — mixed kana

Every token renders as `k`, its **native** kana orthography: katakana words in
katakana, everything else in hiragana. Spacing continues, because word
boundaries are still the thing a learner at this stage most needs and
katakana does not supply them.

The moment katakana appears, some of it is loanwords the learner may not
recognise; that is what the definition card is for, and the *"said: kōhī"*
line `pronunciationFor()` already produces for vocab (long-vowel handling
included) is reused verbatim.

### 5.4 Stage `kanji`, frontier grades 1–3 — a window of two units

The rule the user specified: *show all non-studied kanji in the unit they are
learning plus the next one.* So while the frontier unit is `'1'`, `'2'` or
`'3'`:

- A word renders in **kanji** if every kanji in it belongs to the frontier
  unit or the next one, **or** is already studied (a studied kanji is never
  taken away, whatever unit it came from).
- Otherwise the word renders in **kana** (`k`), exactly as stage `kana` would
  have rendered it.

**Per word, not per character.** 電車 with 電 in the window and 車 outside it
renders as `でんしゃ`, never as `電しゃ`. Mixed kanji-kana inside a single word
is not something Japanese does, it makes the word unrecognisable, and it
teaches a shape the learner will never see anywhere else. The user's own
framing — *"decision made by word not kanji"* — points the same way, and §6
keeps the furigana decision per word for the same reason.

Spacing **stops** at this stage. Kanji does the job spaces were doing: it
marks where words begin. Continuing to space a kanji text would be the one
rendering in this plan that looks like nothing a learner will ever meet
outside the app.

Furigana on everything shown in kanji, subject to §6.

### 5.5 Stage `kanji`, frontier grade 4 and beyond — everything

From frontier unit `'4'` onward, the window is gone: **every** word renders in
its written form `s`, with furigana subject to §6. This is the user's
instruction and it is also simply what reading is. A learner at grade-4 kanji
who only ever saw grade-1-to-5 kanji in stories would be reading a Japanese
that does not exist.

The furigana rules do all the work from here on. Passive exposure to kanji
they have not formally studied is the point.

### 5.6 The one thing stage `hira` cannot render honestly

コーヒー in hiragana is こーひー, which is not a word anybody writes. The
choice-flavoured alternatives (こうひい, こおひい) are worse: they are
historical spellings that would actively mislead.

The resolution is an **authoring constraint, not a rendering trick**: L1 and
L2 stories contain no loanwords. The build script enforces it — any token
whose native orthography is katakana in an L1/L2 story fails the level gate
with a clear message. Above L2, the learner is at stage `kana` or beyond by
construction and the problem does not arise.

For an imported or higher-level story read by an early learner who has
browsed down a level, the fallback is: **katakana words stay katakana even at
stage `hira`**, with the romaji available on one tap. Showing a learner one
unfamiliar script inside a familiar one is a smaller harm than showing them a
spelling that is wrong.

### 5.7 The pipeline in one place

`src/reader.js`, pure and testable without a DOM:

```js
// view = { stage, frontier, studied, exposure, muted, settings }
export function renderSentence(sentence, view)   // -> [{ text, ruby, space, tappable, i }]
```

One function, no DOM, returns a flat list of render instructions per token.
`app.js` turns that into spans. Two payoffs, both real:

- **Testable.** The whole of §5 and §6 — every stage, every window edge, every
  furigana rule — is unit-testable against a synthetic profile with no
  browser, which is exactly how `test/store.js` already tests merge logic.
- **Cheap to re-render.** A tap patches one token's span in place, never the
  paragraph, so scroll position is untouchable by design. A settings change
  (§8.4) re-renders the visible paragraphs and re-anchors on the sentence the
  learner was reading.

`src/furigana.js` — the standalone reveal-ladder component `vocab-plan.md`
phase 8 calls for — is extracted as part of this work if it has not landed
already, and both the quiz and the reader render through it. Two
implementations of "kanji with optional ruby that reveals on tap" would drift
within a month.

---

## 6. Furigana: when it shows, when it stops

### 6.1 Four rules, one OR

Furigana on a word rendered in kanji is **hidden by default** if any of:

1. **Every kanji in it is in a study list** — any list, not just Yomi
   (`definition`, `recognition`, `writing`, and the vocab modes `vmeaning`,
   `vrecall`), or the word's own surface is enrolled as a vocab word. The
   user's instruction, and `vocab-plan.md` §5.2's principle: a learner with
   any claim at all on a character should get the chance to recall it, since
   a tap is cheap and a missed recall is not.
2. **The word has been seen four times in stories with its furigana showing**
   (§6.2, §6.3).
3. **The learner muted it by hand** — the existing `muted` map and its "hide
   furigana in future" affordance, reachable from the definition card.
4. It contains no kanji, in which case there is nothing to hide.

Otherwise furigana shows. A learner who has never met a kanji is never asked
to guess at it — that is the *"automatically show furigana if it's not in any
of their study lists"* half of the specification, and it is what makes stage
`kanji` safe to switch on the day a learner enrols their first kanji.

**Per word, all-or-nothing.** 電車 shows both readings or neither. This
diverges from the vocab quiz, which hides per kanji position — and it should,
because the two are doing different jobs. The quiz is *testing* precisely the
part the learner is supposed to know, so partial hiding is exactly right
there. A story is being *read*, and a word with one ruby on and one off is a
visual stutter mid-sentence for no teaching benefit at all.

### 6.2 Counting by word, and still feeding the quiz

The user's instruction is unambiguous: *"keep track of how many times each
word was viewed (decision made by word not kanji)"*. The vocab quiz counts
per (kanji, reading). Both are right for their own surface, and the resolution
is that they are **two readings of one shared ledger**:

The reader, on counting an exposure for a word, writes **both**:

- `word:電車` — the key the story's own §6.1 rule 2 reads. Already a legal key
  shape: `exposureWordKey()` exists and vocab uses it for jukujikun words.
- `電:でん` and `車:シャ` — one per ruby position, using the credited base
  reading `ruby[i][2]`, the currency the vocab quiz reads.

Each side then decides on its own key and neither has to understand the
other's. And the second half of that write is what delivers the promise
`vocab-plan.md` §10.5 made and could not keep on its own:

> *A learner who reads a lot should find furigana quietly disappearing from
> the words they have been reading, having never opened a quiz.*

Reading is where exposure happens at volume. Without the per-kanji write,
reading forty episodes would advance nothing in the quiz, and §10.5 would
have been an aspiration the feature it was written for didn't honour.

The cost is a larger `exposure` map — one extra key per distinct *word* met in
a story, on top of the per-reading keys. Bounded by the number of kanji words
a learner actually reads, each an 8-element list of integers. A heavy reader
might reach a few thousand keys, a few hundred KB. Watch it; §11.5 keeps the
cheaper alternative on the table.

### 6.3 What counts as a view

Inherited wholesale from `vocab-plan.md` §5.3, with one deliberate change:

- **Only where furigana was actually shown.** A word already hidden by rule 1
  or 3 accrues nothing — there was nothing to see.
- **A revealed ruby counts.** The learner tapped, the learner saw it. That is
  what an exposure is.
- **Frozen at the threshold.** Once promoted, a word's furigana is hidden, so
  by construction it stops accruing. The counter settles at four.
- **At most one per episode, per word.** *This is the change.* Vocab's rule is
  one per session, which is right for a quiz that shows a word once. A story
  may print 電車 nine times in one episode, and that is one encounter with
  the word, not nine. The dedupe set lives on the reader's own state,
  `reader.counted`, keyed by exposure key and cleared when a different story
  opens.

  There is a second, independent reason this cap has to stay, discovered
  while trying to lift it: `mergeExposure` (§6.4) collapses timestamps within
  a minute of each other as one event, because that is what stops two devices
  double-counting a synced encounter. Nine occurrences recorded seconds apart
  would therefore survive locally and then silently collapse to one on the
  first sync — a word promoted before syncing and demoted after it. Whatever
  in-story repetition earns, it cannot be earned by writing more timestamps.

#### Repetition inside one story

The episode cap above is right about *encounters* and wrong about *this
page*. Momotarō prints 鬼 eight times; a learner who has just been given
おに three times in the paragraphs above does not need it a fourth. So there
is a second rule, running alongside the exposure counter and never touching
it:

> **The fourth and later printings of a word within one story do not show
> furigana by default.**

- **Positional, not scroll-based.** The rule is about the *n*th occurrence in
  the text, computed once when the story opens (`storyOccurrenceIndex` in
  `reader.js`, pure and testable). So hiding begins on the fourth occurrence
  at the latest however the learner moves through the story — no dependency
  on what has been scrolled past, and no possibility of the same word
  flickering between states as they scroll back and forth.
- **It only ever adds hiding.** ORed with §6.1's rules: a word already
  studied, earned or muted is hidden from its *first* appearance, and this
  never un-hides anything.
- **Keyed by the exact surface on the page**, not the lemma — 鬼 and 鬼が島's
  島 count separately, and 帰り does not count toward 帰る.
- **It is display only.** It writes nothing to the profile and does not
  advance the exposure counter: a story that repeats a word is not the same
  as meeting it on four separate occasions, which is the thing §6.1's rule 2
  is measuring. Reading Momotarō leaves 鬼 with exactly one exposure, as it
  should.
- **The reader's own "Always show furigana" setting still wins** (§8.4) — an
  explicit choice beats an automatic rule.
- A tap reveals, as everywhere else.
- **Re-reading counts again.** Coming back to the same episode a week later is
  a genuine second encounter. The app-session dedupe (a `Set` that survives
  until the app is closed) stops a same-sitting re-scroll from counting twice,
  which is the only case worth guarding.
- **Exposure is recorded when a paragraph has been *read past*, not merely
  displayed.** A paragraph counts when it has been on screen **and then
  scrolled off the top** of it, via an `IntersectionObserver` on each
  paragraph. Both halves are required: a paragraph flicked past on the way
  to the bottom, or one sitting above where a resumed story reopens, is off
  the top of the screen without ever having been on it, and must not count.
- **The last screenful is counted by a "Finished reading!" button**, at the
  end of the text. Nothing at the bottom of a document can scroll off the top
  of the screen, so without this the final paragraphs could never accrue at
  all. Tapping it credits every paragraph that was actually displayed and no
  others — flicking to the bottom and tapping it does not credit the middle.
  It is also what opens the end card (§8.5).

  > **Reversed decision, and why.** The first implementation counted a
  > paragraph after two seconds at half-visible, on the reasoning that the
  > cost of a wrong call either way was one count out of four. That was wrong
  > in the direction that matters. Exposure **takes help away** — it is the
  > mechanism that stops handing a learner furigana — so its errors are not
  > symmetric: over-counting silently removes support from words nobody
  > looked at, while under-counting merely delays a convenience. Text
  > scrolled past on the way somewhere else, or left on screen while the
  > phone was put down, both cleared a two-second dwell bar. "I scrolled past
  > this" and "I say I finished this" are evidence a learner actually
  > produced; time-on-screen is a proxy for it, and a bad one.

### 6.4 Storage and merge: none of it is new

Story exposures go in the **same `profile.exposure` map**, through the same
`addExposure()`, and merge through the same `mergeExposure()` — union of
timestamp lists, 60-second dedupe window, newest 8 kept, tombstones honoured.
`vocab-plan.md` §8 did that work and property-tested it in `test/store.js`;
this feature adds keys to it and nothing else.

That is the argument, made concrete, for `EXPOSURE_THRESHOLD` and the whole
exposure mechanism having been put in `srs.js` rather than in the vocab
module. **Zero new merge code** is the headline number for this section.

### 6.5 When exposure was wrong

Vocab's demotion rule (two unambiguous reveals of a promoted reading clear its
evidence) applies unchanged, and in stories it is *more* reliable, not less:
because the story decision is per word, a reveal is **always** unambiguous —
it is about that word, full stop. There is no "which of the three hidden
readings failed" problem to worry about.

So: revealing furigana on a word that was hidden **by exposure** is a
demotion strike against `word:<surface>`; two strikes clear it and the word
shows its furigana again. Revealing a word hidden by **study enrolment** or by
**manual mute** does nothing — those are the learner's own stated intent, and
overruling them is not the app's business.

The per-kanji keys are not struck in stories. A story reveal is evidence about
the word; blaming one of its kanji's readings would be the ambiguous case
vocab already declines to act on.

---

## 7. Tapping

Three rungs, then a door out. The first two are `vocab-plan.md` §5.2's ladder,
reused as a component; the third and fourth are new and are what makes a story
readable without a dictionary in the other hand.

### 7.1 Tap one — pronunciation

What that means depends on the stage, which is the user's own specification:

| Stage | Tap one shows |
| --- | --- |
| `hira`, `kana` | **romaji** beneath the word — `toRomaji(k)`, plus the *said:* line where it differs (`pronunciationFor()`) |
| `kanji`, furigana currently hidden | **furigana** — the ruby appears over the word |
| `kanji`, furigana already showing | **romaji**, for the learner whose kana is the problem rather than the kanji |

Rendered in place, under or over the word, without a card and without moving
anything: the line box is sized for ruby from the start so revealing one never
reflows the paragraph. A paragraph that jumps as you tap through it is
unreadable.

This is where §6.3's reveal accounting happens, and it is the **only** thing
tap one records.

### 7.2 Tap two — the definition card

A small card anchored under the word (a bottom sheet on a narrow phone),
holding:

```
  電車  でんしゃ  densha
  train, electric train                                   noun

  食べました — from 食べる                    ← when the surface is inflected

  [ Translate this sentence ]
  [ Word details ]  [ 電 ]  [ 車 ]          ← chips: the word, then its kanji
  [ Hide furigana for this word in future ]
```

- **Glosses** come from the vocab entry via `d` → `VOCAB_LOOKUP` → lazy-load
  that unit → `wordGlossSummary()`, the same multi-sense summary the word
  detail screen shows (`vocab-plan.md` §5.6).
- **`d: null`** — the word is not in the curriculum. The card still shows the
  surface, reading, romaji and part of speech, and says so plainly: *"not one
  of the words this app teaches"*. It still offers the sentence translation
  and the kanji chips, which are the two things that actually help. Guessing
  a gloss the app does not have would be worse than admitting it, and the
  kanji chips mean the card is never empty.
- **Inflected forms** name their dictionary form. Small, and one of the more
  useful things a beginner can be told.
- The card is dismissed by tapping anywhere else, and **at most one card is
  open at a time**.

**The word you last tapped stays marked.** A soft tint on the token itself,
which does two jobs: it says which word the card — a bottom sheet, well away
from the text — is actually about, and it survives a trip out to a kanji's
own detail screen, so coming back is a glance rather than a re-read. It
persists until a different word is tapped, because "where was I?" outlives
"what does this mean?".

**Tapping away clears both**, together: they go up on the same gesture and a
learner thinks of them as one thing, so leaving a word marked with no panel
to explain it would be the wrong half to keep. "Away" means anywhere that
isn't a word or a control — including the page margins and the empty space
below the last paragraph, which is exactly where a thumb lands for "never
mind". That is why the listener sits on `document` behind a
current-screen guard rather than on the reader section, which does not extend
into `#app`'s own side padding.

### 7.3 Translate this sentence

The user's requirement: *"an option next to the definition that pops up to tap
to translate entire sentence."* It lives on the card, one tap from any word in
that sentence.

Tapping it **closes the card** and inserts the English inline, directly beneath
the Japanese sentence, in a visually distinct block (indented, lighter, a left
rule). It stays until tapped, so a learner can read the Japanese again against
it — which is the actual use, and would be defeated by a translation that
vanished.

Two supporting affordances, both small:

- The sentence's **final punctuation** is itself a tap target for the same
  action, so translating a sentence you understood no individual word of does
  not require picking a word first.
- Reader settings (§8.4) has **Show every translation**, off by default, which
  renders every sentence's English inline throughout. It is the right tool for
  a second pass through a story already read, and the wrong default for a
  first.

### 7.4 Getting out to a detail screen

From the card: a chip for the word itself, and one per kanji in it. At stage
`hira`/`kana`, chips for the individual **kana** instead, since that is what
the learner is learning and the kana detail screen exists and is useful.

These reuse `openCharacterDetail(course, char, returnTo)` unchanged, with a
new return target `'reader'` that comes back to the reader **at the same
sentence** — the resume position (§9) is already exactly the right thing to
restore, so this costs nothing beyond adding the case.

`buildWordRow()`'s existing tray behaviour (word → kanji chips → detail,
with an inline Add) is the same interaction one level shallower, and the same
`vocabTargetForWord`/`fillWordKanjiChips` helpers do the work. The detail
screen's own per-mode study toggles then do exactly what they already do.
**That is the whole "add to study list" story: existing screens, reached from
a new place.**

### 7.5 What a tap does not do

Worth stating as a list, because each was considered:

- It does **not** enrol the word in anything.
- It does **not** grade anything. There is no `vyomi` miss for tapping in a
  story, unlike the quiz — the quiz was asking a question, and a story is not.
- It does **not** mark the word "difficult", build a personal difficult-words
  list, or feed a recommender.
- It does **not** count toward any streak, total, or reading statistic beyond
  §6's exposure counter.

The end card (§8.5) offers the tapped words for adding **once**, in a list, at
the end, as a considered choice. That is the only place a reading session
turns into study, and the learner does it with their thumb.

---

## 8. Screens

Stories follow their own logic and borrow from the rest of the app only where
borrowing is genuinely right — which turns out to be the detail screens
(§7.4), the loading wrapper, and nothing else.

### 8.1 Where it hangs off the home screen

**Not a fifth script card.** The four cards are courses: they have modes, a
progress bar, a due count, and an SRS behind them. Stories have none of those,
and dressing them up as a fifth would promise a progress bar that would then
have to mean something.

Instead, below the script grid, one wide **Read** card:

```
┌────────────────────────────────────────────┐
│ 📖  Read                    Getting going  │
│     Momotarō · episode 2 — half way        │
└────────────────────────────────────────────┘
```

Continue-where-you-left-off as the card's own subtitle, because that is the
single most valuable thing it can say, and *"Something new to read"* when
there is no story in progress.

### 8.2 The library — `screen-stories`

- **Level strip** across the top (§2.4): the learner's level selected,
  neighbours visible, all levels reachable, with the level's name spelled out
  beneath.
- **Continue reading**, when something is in progress: one card, the story's
  title, series and position, at the top and visually distinct.
- **Series** as horizontal rows of episode chips — `① ② ③ ④` with the read ones
  filled, the in-progress one ringed, the unread ones outlined. A series is
  read in order and looks like it.
- **Standalone stories** as a plain vertical list of cards: title, one-line
  blurb, length in minutes, and a read tick.
- **Nothing is locked.** Episode 4 is tappable before episode 1 has been read.
  A learner who wants to skip ahead in a story they can't yet follow will find
  that out in about ten seconds, which is a better teacher than a padlock.
- Browsing a level that is not the learner's own shows the *Make this my
  level* affordance (§2.4).

Reading time is `Math.ceil(tokens / 60)` minutes at the low levels, from the
manifest — no fetch — and honest enough for its purpose.

### 8.3 The reader — `screen-reader`

Everything on this screen that is not the story is a failure of nerve. What
survives:

- A minimal top bar: back, the title, and a **⋯** for reader settings.
  It hides on scroll-down and returns on scroll-up.
- A **hairline progress line** at the very top, filled by paragraph.
- The story: generous line height (furigana needs the room whether or not it
  is showing), a comfortable measure, large type by default. Vertical
  scrolling, horizontal text. Vertical *writing* (縦書き) is not in scope; it
  is beautiful, it is what a Japanese book does, and it fights every
  interaction in §7 — noted in §11.7 rather than attempted.
- At the end: the source and licence line (§4.2), then the end card.

The reader **must not reflow on interaction**. Ruby space is reserved
whether ruby is showing or not; the definition card is an overlay, never
inserted into the flow; a sentence translation *is* inserted, but always
below the reader's current line, never above it.

**Rendering cost:** an episode is a few hundred spans, well inside what a
phone renders without thinking. Long L6 chapters render paragraph-by-paragraph
as they approach the viewport, using the same `IntersectionObserver` §6.3
already needs.

### 8.4 Reader settings

Small, and reachable from the ⋯ only:

| Setting | Default |
| --- | --- |
| Text size | 3 of 5 |
| Furigana | **Smart** (§6) / Always / Never |
| Show every translation | Off |
| Read in kana | Off — forces stage `kana` for a learner who wants a break |

*Always* and *Never* are escape hatches for the times §6's rules are wrong for
this learner today, and they are **per device**, not per profile, and not
synced: they are a "right now" preference like text size, not a fact about the
learner. *Never* does not accrue exposures, since nothing was shown.

They do **persist on that device**, in `localStorage` — a learner who needs
32-point text needs it in the next story too, and being made to set it again
every time is a bug, not a fresh start. `localStorage` rather than the profile
for the same reason they are not synced, plus one more: a shared tablet's two
learners should not fight over one text size.

The text-size ladder tops out well past a normal reading size (32px) rather
than at a polite maximum. Large print is the whole point of the setting for
anyone who needs it, and a slider whose top end is merely "a bit bigger" is
no use to them.

### 8.5 The end card

```
   You finished  ももたろう · episode 2

   You looked up 6 words
   [ もも  peach            + Add ]
   [ しばかり  gathering firewood  + Add ]
   ...
   [ Add all 6 ]

   [ Read episode 3 → ]     [ Back to stories ]
```

The words the learner tapped for a *definition* — not for pronunciation, which
is a much weaker signal — in the order met, each with a one-tap add to the
vocabulary study list, using the same `setStudying` path the detail screens
use. Words with no vocab entry (`d: null`) are shown but not addable, with
their kanji chips instead.

This is the whole of the app's attempt to turn reading into study, and it is
opt-in, at the end, and skippable by walking away. It is offered because the
alternative — a learner who tapped six words and has no way to keep them
without writing them down — wastes the best signal a reading session produces.

### 8.6 Every screen at a glance

| Screen | New / changed |
| --- | --- |
| Home | A **Read** card below the script grid, showing what's in progress |
| `screen-stories` | **New.** Level strip, continue, series rows, story list |
| `screen-reader` | **New.** The story, the reveal ladder, the definition card, sentence translations |
| Reader settings | **New**, a small sheet over the reader |
| End card | **New**, the tail of the reader screen |
| Character detail | Unchanged, plus a `'reader'` return target |
| Word detail | Unchanged, plus the same |
| Settings | One card: reading level, and a line about where the stories come from — the same shape as vocabulary's "word lists" card |

---

## 9. What gets recorded

### 9.1 All of it

```js
profile.stories = {
  // Read at all, and finished. Merged by union / earliest-first / max.
  read: {
    'momotaro-1': { first: 1756300000, last: 1756480000, done: 1756310000, passes: 2 },
  },
  // Where to resume. One entry per story; only the current one matters, but
  // keeping them all is a few bytes and means going back to episode 1 lands
  // where you stopped rather than at the top.
  pos: {
    'momotaro-2': { p: 4, s: 1, h: 'f3c1a0', at: 1756480000 },
  },
};
```

Plus `profile.settings.readingLevel` (§2.4) and the additional keys in the
existing `profile.exposure` and `profile.muted` maps (§6). That is everything.

`stories: {}` is added to `createProfile()` for the same reason `study`,
`unstudy`, `exposure` and `muted` all start as `{}` rather than undefined: a
missing field is the signal for a migration, so a brand-new profile must not
look like an un-migrated one. A profile saved before this feature has no
field, reads as "has read nothing", and needs no migration — only to start
recording.

### 9.2 Sync and merge

| Field | Rule | New code? |
| --- | --- | --- |
| `stories.read[id].first` | **min** — earliest wins | one small merge function |
| `stories.read[id].last`, `.done` | **max** | same |
| `stories.read[id].passes` | **max**, not sum — summing double-counts every pass already synced once, the exact trap `vocab-plan.md` §5.3 avoided for exposure counters | same |
| `stories.pos[id]` | latest `at` wins; **tie broken by the further position** | same |
| `settings.readingLevel` | existing per-field settings merge, unchanged | none |
| `exposure`, `muted` | existing `mergeExposure` / muted merge, unchanged | **none** |

One new function in `merge.js`, `mergeStories`, about twenty lines, all of it
min/max over integers — commutative and idempotent by construction, which is
the property `sync-plan.md` §0.1 cares about and the reason none of these
fields is a counter that increments.

The one judgement call is `pos`: latest-write-wins is right (it is a cursor,
and the last device you read on is where you are), but a stale write from a
device with a skewed clock could pull a learner backwards. The tie-break on
further position costs one comparison and removes the worst case.

Backup format version stays 1. Old backups load and simply have no stories;
new backups load into an older build and the field sits inert. Asserted in a
test rather than assumed, exactly as `vocab-plan.md` §8 required for vocab.

### 9.3 What is deliberately not recorded

- **Time spent reading.** Not needed for anything here, and the moment it
  exists somebody will want to show it, and then reading has a score.
- **Which words were tapped**, beyond the end card's in-memory list for the
  current session.
- **Reading speed, streaks, words-read totals.**
- **Comprehension of any kind.** Nothing measures it because nothing asks.

Each of these is cheap to add later if a real need appears. None is cheap to
remove once a learner has seen it.

---

## 10. Testing

A new `test/stories.js`, run the way the others are, over the whole shipped
corpus — the corpus is small enough that "over a sample" is not an excuse:

**Data invariants**

- Every token's `k` is kana only; `toHiragana(k)` is defined for all of it.
- Every `ruby` aligns to its `s` exactly, or is `null` — the same assertion
  vocab already makes, over a different corpus.
- Every `d` that is non-null resolves in `VOCAB_LOOKUP`.
- Every sentence has a non-empty `en`; no story has a sentence without one.
- Every story's `level` and `gram` are known values, and its content passes
  the level gate (§4.6) recomputed in the test, not merely trusted from build
  time.
- Every `source.licence` is non-empty, and every `kind: 'public-domain'` or
  `'adapted'` story names its source.
- `hash` matches the body it is stored with.
- Every manifest entry has a story file and vice versa.

**Rendering (`src/reader.js`, pure — no DOM)**

- Stage `hira` output contains no kanji and no katakana except where §5.6's
  fallback applies.
- The particle-joining rule (§5.2) produces `おじいさんは`, not `おじいさん は`.
- The stage-`kanji` window (§5.4) is per word: a word straddling the window
  edge renders wholly in kana. Checked at every boundary — frontier `'1'`
  through `'4'`, and the transition out of the window at grade 4.
- A studied kanji outside the window still renders as kanji.
- Furigana hiding obeys the four-way OR (§6.1) for a matrix of synthetic
  profiles: studied / exposure-promoted / muted / none, crossed with the
  stages.

**Exposure**

- One episode showing a word nine times accrues exactly one exposure.
- Re-reading the episode in a new app session accrues a second.
- A word at the threshold stops accruing, and its furigana is hidden.
- A story exposure writes **both** the `word:` key and the per-kanji keys
  (§6.2), and the per-kanji keys are the ones the vocab quiz then reads —
  asserted end-to-end against a synthetic profile, since this is the whole
  claim of §6.2 and it spans two features.
- A reveal of an exposure-promoted word records a strike; two demote it; a
  reveal of a study-hidden word records nothing.

**Persistence**

- `test/store.js` gains a stories round-trip through backup and merge, and
  property tests for `mergeStories`: idempotent, commutative, `passes` never
  inflated by a three-device round trip.
- A resume position whose `h` no longer matches clamps to the paragraph start
  and does not throw.
- `test/wiring.js` opens a story, taps through all three rungs, translates a
  sentence, reaches a detail screen and comes back to the same sentence.
- `test/smoke.js` gains the story manifest.

---

## 11. Open questions

1. **Is the level ladder six rungs or four?** Six is proposed because the gap
   between "110 words" and "unabridged Sōseki" is enormous. But every rung
   needs stories in it, and an under-populated level is worse than a coarse
   one. Expect L1–L3 to be where the writing goes and L4–L5 to feel thin for a
   while. Merging L4 and L5 is the obvious first correction.
2. **Does the grammar gate earn its keep?** §4.6 step 6 checks inflections and
   auxiliaries, which is the tractable half of grammar, and uses sentence
   length as a proxy for the rest. It will pass texts that are too hard and
   fail texts that are fine. The alternative — a human deciding — is what
   actually happens anyway; the question is whether the automated half catches
   enough to be worth maintaining.
3. **Should the reading level be per profile or derived?** §2.4 makes it a
   stored setting with a derived first suggestion. The alternative — always
   derive it from vocab progress — is tempting and wrong: a learner's reading
   level and their quiz progress are genuinely different things, and someone
   who reads well above their quiz level exists and should not be dragged back.
4. **Is four the right exposure threshold *for reading*?** `vocab-plan.md`
   §11.1 already flagged this as open for quizzing, and reading is the
   second-order version: meeting a word four times over four episodes is a
   thinner experience than meeting it four times in four quiz questions, or a
   richer one, and nobody knows which. Same constant, same
   raise-it-without-losing-evidence property, expect to move it.
5. **Word-keyed exposure, or per-kanji only?** §6.2 writes both. If the map
   turns out to be too large in practice, the fallback is dropping the `word:`
   key and deciding a word's furigana as "all its readings are promoted",
   which is the same decision by a slower route and costs nothing but this
   plan's own simplicity.
6. **Offline reading of unopened episodes.** §3.4 leaves stories out of the
   precache. A *Keep this series offline* toggle that fetches a level's
   episodes is easy and obviously wanted by anyone reading on a train with no
   signal; it is not phase 1.
7. **Vertical text (縦書き).** `writing-mode: vertical-rl` is one CSS line and
   about thirty interaction problems: ruby placement, the definition card's
   anchoring, the progress line's axis, and scroll direction on a touch
   device. Worth revisiting once the horizontal reader is solid, and worth
   not attempting before.
8. **Audio.** Every sentence read aloud is the single most requested feature
   any reading app has, and there is no free, offline, redistributable
   Japanese TTS of acceptable quality. The Web Speech API's Japanese voices
   exist on iOS and Android and vary from good to unusable. Not in scope; the
   data model does not block it (a per-sentence audio id would slot in).
9. **Does the end card's Add list want the kanji too?** It offers words. A
   learner who kept tapping the same kanji across three words might reasonably
   be offered that kanji. Deferred: the word list is the clear case, and
   adding a second list to that card risks it becoming the homework page a
   reading session is supposed not to have.

---

## 12. Phases

| Phase | What | Depends on | Status |
| --- | --- | --- | --- |
| 0 | **Sourcing and licence audit.** Confirm the Aozora public-domain subset and its terms in writing; pick the first six imports and the first original series; settle the L1–L3 word ceilings against the real vocab data. Mostly not programming, and the long pole — same shape as `vocab-plan.md` phase 0. | — | |
| 1 | **The build pipeline.** `tools/build_story_data.py`: fugashi/UniDic tokenisation, `align_word()` reuse, `VOCAB_LOOKUP` resolution, the Aozora ruby cross-check, the level and grammar gates, manifest + per-story files. Prove it on one imported story and one written one. | 0 | |
| 2 | **The renderer.** `src/reader.js` pure, `src/furigana.js` extracted (`vocab-plan.md` phase 8), all four stages of §5 and the §6.1 hiding rules, unit-tested with no DOM. No screens yet. | 1 | |
| 3 | **The reader screen.** `screen-reader`, scrolling, the top bar, the progress line, tap-one pronunciation. Readable end to end. First user-visible phase. | 2 | |
| 4 | **The definition card**, tap two, sentence translation, kanji/kana/word chips through to the detail screens and back (§7). | 3 | |
| 5 | **The library**, the level strip, series and episodes, the home-screen **Read** card, the level suggestion and the *make this my level* commit. | 3 | |
| 6 | **Exposure and progress.** §6.2's dual write, the intersection-observer accrual, `profile.stories`, resume with the hash clamp, `mergeStories`, and the property tests. Separable from the screens above and worth keeping separate — its correctness lives in merge behaviour, which is testable without any UI. Exactly the argument `vocab-plan.md` phase 3a made, and it was right there. | 4, 5 | |
| 7 | **The end card**, reader settings, and the source/licence line. | 4, 6 | |
| 8 | **Content: the free corpus.** Import and adapt the phase-0 shortlist, translate every sentence, run the gates, review by a human. Data, not code, and the phase that decides whether any of the above was worth building. | 1, 7 | |
| 9 | **Content: our own series.** The first serialized L2 run, then L1 and L3. Ongoing, and the point of the whole feature. | 8 | |

Phases 3 and 5 can land in either order, but 3 first makes a better demo of
itself: one hard-coded story that reads beautifully is more informative about
whether this feature is any good than a library with nothing in it.

Phase 6 is the one that could be tempting to fold into 3 and 4. It should not
be — a reader that renders correctly and records nothing is a coherent, useful
thing to have shipped, and the recording half is where the subtle bugs live.

**Per this repo's convention:** every phase that changes what a learner sees
bumps `APP_VERSION` in `src/app.js` and `VERSION` in `sw.js`, and adds a
plain-language entry to `src/changelog.js` in the same commit. Phases 0, 1, 2
and 6 mostly don't; 3, 4, 5, 7, 8 and 9 all do. Phase 6 has one
learner-visible consequence that needs saying out loud in the changelog for
the same reason `vocab-plan.md` phase 3a did — *"words you've read a few times
stop showing their furigana"* reads as a bug if it arrives unannounced.
