# Writing a Kana Quest story

How to author a story so the reader can do its job. `stories-plan.md` is the
design of the *feature*; this is the working guide for the *content*, and it
is the document to read before writing a single sentence.

The rule everything below serves:

> **A learner reading a Kana Quest story should never hit something the app
> cannot explain.** Every character belongs to a word, every word says what
> it means *here*, every sentence has an English translation. No dead ends.

Every shipped story must also identify the writer of the exact text the
learner is reading. Set `source.by` to that person or model and
`source.credit` to `Written by`, `Retold by`, `Adapted by`, or `Translated
by`. Put the older tale or source author in `source.text`; do not let that
stand in for authorship of the Kana Quest version. Human submissions follow
the same rule and use the contributor's chosen display name. Both the story
card and the attribution at the end of the story display this credit.

---

## 1. Before you write

Pick the level first, and write to it — don't write freely and grade it
afterwards, which produces a text that fails the vocabulary gate in fifty
places and is easier to rewrite than to fix.

| Level | Vocabulary ceiling | Grammar | Sentence | Episode |
| --- | --- | --- | --- | --- |
| L1 | Core (`C1`–`C6`) | G1 | ≤ 8 tokens | 8–15 sentences |
| L2 | + `lv:'f'` themes 1.x–2.x | G2 | ≤ 12 | 15–25 |
| L3 | + all `lv:'f'` | G3 | ≤ 16 | 25–40 |
| L4 | + all `lv:'h'` | G4 | ≤ 22 | 40–60 |
| L5 | + all `lv:'a'` | G5 | — | 60–120 |
| L6 | unrestricted | G6 | — | a real chapter |

The grammar tiers are in `stories-plan.md` §2.3. The short version: G1 is
です/ます and one clause; G2 adds て-form, 〜ている and simple reasons; G3 adds
plain forms and short relative clauses; G4 adds conditionals; G5 adds passive,
causative and keigo; G6 is anything.

**Write in ordinary Japanese, with kanji, always** — even for L1. A story is
authored once and *rendered* per learner (`stories-plan.md` §1.3): the app
downgrades 洗濯 to せんたく for someone who hasn't started kanji. Writing
せんたく yourself throws away the kanji version for everyone who *has*.

Two exceptions, both because the kanji spelling is not what anyone writes:
words normally written in kana (きびだんご, ゆっくり, おじいさん), and
onomatopoeia (どんぶらこ, にっこり).

**No loanwords in L1 or L2.** A learner at that level reads in pure hiragana,
and コーヒー has no honest hiragana spelling (`stories-plan.md` §5.6).

---

## 2. Every character belongs to a word

Tokenisation is not splitting into morphemes. It is splitting into **the
units a learner would look up**, because every token is a tap target and
every tap must produce something worth reading.

**Merge a verb with everything hanging off it.** The whole chain is one
token, glossed as one idea:

| Write as one token | Not as |
| --- | --- |
| 住んでいました | 住んで + い + まし + た |
| 作ってくれました | 作って + くれ + まし + た |
| 歩きつづけました | 歩き + つづけ + まし + た |
| 切ろうとすると | 切ろう + と + する + と |
| 休まずに | 休ま + ず + に |

Four tokens where one belongs gives four cards, three of which say nothing a
learner can use. まし is not a word anybody looks up.

**Never split a word across tokens.** An early draft of うさぎとかめ had
本当に as 本 + 当 + に — three tokens, none of them the word actually on the
page. If two characters only mean something together, they are one token.

**Merge suffixes into their host** where the result is what a reader would
look up: 鬼たち ("the ogres"), 三匹 ("the three animals"), ももたろうたち.

**Merge idioms** whose parts don't add up: 力を合わせて ("joining forces"),
あっという間に ("in an instant"). Yes, this puts a particle inside a token.
That is correct — the idiom is the unit of meaning.

**Keep particles separate**, and let them be tapped. は, を, に and friends
get functional glosses ("topic marker", "object marker") rather than being
silently unexplainable.

**Proper nouns are single tokens**, including compound place names:
鬼が島 is one word, not 鬼 + が + 島.

---

## 3. Every word says what it means *here*

Every non-punctuation token carries `g`: its meaning **in this context**, in
**this form**.

- 行きました → `"went"`. Not "to go".
- 怒った (modifying かめ) → `"angry, annoyed"`. Not "got angry".
- ある (before 村) → `"a certain, some"`. Not "to exist" — that is a
  different word that happens to be spelled the same.

This is what makes it safe for a story to use words the vocabulary
curriculum has never heard of. **Every word gets a definition, whether or
not Kana Quest teaches it** — `g` is the story's own one-time gloss, and it
is required, not a fallback.

### Why story-local glosses, and not a "misc" vocabulary unit

The alternative was to add every unglossed word to a catch-all vocab unit so
it would have a real entry. Rejected, for three reasons:

1. **Most of them should never be flashcards.** どんぶらこ, きびだんご, よーい,
   ももたろう, 鬼が島, and every inflected form are all things a reader needs
   explained *once, here* — not things anybody should be quizzed on.
2. **A vocab entry is expensive.** `build_vocab_data.py` generates wrong
   readings (`mis`) and wrong spellings (`sp`) for every entry from JMdict,
   because Recall and the yomi stage need plausible distractors. A hand-added
   entry either gets those generated or is broken in the quiz.
3. **It would quietly change what "studying vocabulary" means.** Words would
   arrive in the learner's units because a story happened to use them.

So: `g` explains everything, and `d` links to the curriculum only where a
real entry already exists. **If a word genuinely belongs in the
curriculum, add it there properly** — in `build_vocab_data.py`, with its
distractors — rather than smuggling it in through a story.

---

## 4. Conjugated words explain themselves

A token in any form other than its dictionary form carries two more fields:

- `df` — the dictionary form (行く)
- `cf` — what this form *is* ("polite past")

The reader then shows all three parts, which is the whole point:

```
  行きました   いきました   ikimashita
  went
  polite past of 行く (to go)
```

`df` and `cf` come as a pair: one without the other fails the build.

Form labels in use, to keep the wording consistent across stories:

**A label has to read as a noun phrase**, because the card renders it as
`<label> of <dictionary form>`. "polite past of 行く" reads; "stem + に, in
order to of 切る" does not. Name the form; don't describe the recipe.

| Label | Example |
| --- | --- |
| `polite past` | 行きました, 言いました, でした |
| `polite present/future` | やっつけます |
| `polite past progressive` | 住んでいました, 待っていました |
| `te-form` | 拾って, 笑って, 力を合わせて |
| `polite past 〜てくれる form` | 作ってくれました |
| `polite past 〜てくる form` | 流れてきました |
| `plain past (modifying a noun)` | 怒った(かめ) |
| `plain present` | 着く, 競争する |
| `"when" form` | 着くと, さますと |
| `volitional ("let's ...")` | 競争しよう |
| `"try to" form` | 切ろうとすると |
| `conditional ("if ...")` | 歩けば |
| `"even if" form` | 休んでも |
| `"without ...ing" form` | 休まずに |
| `"in order to" form` | 切りに |
| `adverbial form` | 幸せに, 大きく |
| `na-adjective form` | 元気な |

Add to this table rather than inventing a new phrasing for a form already
listed. A learner meeting "polite past" in one story and "past polite" in the
next has to work out they are the same thing.

---

## 5. Sentences and translations

**One `en` per sentence, always** (`stories-plan.md` §3.6):

1. **Natural English, not glossed Japanese.** 「頭が痛い」is *"I have a
   headache"*, not *"as for head, it hurts"*. Word-level explanation is the
   card's job; the translation's job is what the sentence *means*.
2. **Split the English where the Japanese splits**, even at some cost in
   elegance — the alignment is the feature.
3. **The translation is ours.** A published English translation of a
   public-domain Japanese text is a separate copyrighted work.

---

## 6. What the build checks

The generator refuses to emit a story that fails any of these, so a mistake
is caught at authoring time rather than found by a learner:

- every sentence has a non-empty translation
- every non-punctuation token has a gloss (`g`)
- every token containing kanji has per-character ruby
- every `d` resolves in `VOCAB_LOOKUP`
- `df` and `cf` are both present or both absent

What it does **not** check, and a human must:

- that the gloss is *right for this context* (は as "topic marker" is
  mechanical; ある as "a certain" is a judgement)
- that the reading is right for this compound — 中 is なか in 家の中 and
  ちゅう in 途中; 出 is で in 出て and だ in 歩き出す
- rendaku — 三匹 is さんびき, not さんひき
- that the Japanese is something a person would actually say

---

## 7. Sourcing and licence

Full reasoning in `stories-plan.md` §4. In short:

- **Aozora Bunko** is the usable free source, and only works marked public
  domain — anything hosted under a rights-holder's no-derivatives terms is
  unusable here, because tokenising, re-rendering and translating are all
  derivative acts.
- **Tadoku's free graded readers are CC BY-NC-ND.** Exactly the right level,
  exactly the wrong licence. Same for NHK News Web Easy and 福娘童話集.
- **Traditional folk tales** (Momotarō, the tortoise and the hare) have no
  identifiable author. Retell them in your own words rather than translating
  a specific published edition, and say so in `source.notes`.
- Every story records `source.kind` (`public-domain` / `original` /
  `adapted`), what it came from, what was changed, and its licence. The
  reader shows that line at the end of the text.

**Drafting may be LLM-assisted; shipping is not.** A model is good at
producing plausible Japanese to a word list and unreliable at collocation,
register, whether a sentence is something a person would say, and whether the
English says what the Japanese says. Every episode is read by a person who
knows Japanese before it ships.

---

## 8. Checklist

- [ ] Level chosen first; vocabulary and grammar written to it
- [ ] Ordinary Japanese with kanji (except kana-normal words and onomatopoeia)
- [ ] No loanwords at L1/L2
- [ ] Verb chains, suffixes and idioms merged into single tokens
- [ ] No word split across tokens
- [ ] Every token has a contextual gloss, particles included
- [ ] Every inflected token has `df` + `cf`, using the §4 labels
- [ ] Every sentence has a natural English translation
- [ ] Compound readings and rendaku checked by hand
- [ ] `source` filled in honestly, licence checked
- [ ] Read end-to-end in the app, at a phone width, before shipping
