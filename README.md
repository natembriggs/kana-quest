# Kana Quest

A kana and kanji practice app for kids, built as an installable web app so it
runs on iPhone, iPad and Android from one codebase.

There is no build step and no Node: the app is plain ES modules served as
static files. Edit a file, refresh the phone.

## Running it

```sh
./tools/serve.sh
```

That prints two URLs — one for this Mac, one for a phone or tablet on the same
wifi. Open the second on the device and, in the share menu, choose **Add to
Home Screen**; it then launches fullscreen with its own icon.

To run the tests (macOS ships JavaScriptCore, which is what stands in for Node
here):

```sh
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
$JSC -m test/smoke.js     # kana tables, answer checking, spaced repetition
$JSC -m test/wiring.js    # boots the app against a stub DOM and plays a session
```

Both must be run from the repo root.

## What works now

**Reading practice for hiragana and katakana.** A character is shown, and the
learner taps its sound from ten options laid out in two rows of five. Nothing
is typed, so no keyboard appears and the layout never shifts under a finger.

- **Profiles.** Several learners per device, no passwords — tap a name.
- **Adding more is always a deliberate choice.** The home screen and the
  end-of-session screen both offer *Add 5 more* and *Review N* as separate
  buttons; the app never slips new characters into a review session on its own.
  New characters are taught on their own cards before being quizzed.
- **Spaced repetition.** Leitner boxes, reviewed after 1, 2, 4, 8, 16 then 32
  days. A miss drops the character to box 0, so it comes back later in the same
  session and again the next day.
- **The pace suggestion never blocks.** If most of what has been introduced is
  not yet solid, the card shows a *review first* tip — but *Add 5 more* stays
  enabled. The learner decides.
- **Distractors are confusable on purpose.** The nine wrong options are drawn
  from the character's own set first, and de-duplicated by romaji, because
  じ/ぢ are both "ji" and ず/づ are both "zu" — offering both would make a
  question unanswerable. A test checks this for all 208 characters.

## What is not built yet

- **Writing mode** — visible in the app but disabled. Next thing to build:
  a canvas with the four-quadrant dashed guide, then stroke-by-stroke grading
  against [KanjiVG](https://kanjivg.tagaini.net/) stroke data.
- **Kanji** — readings, example words and meanings from KANJIDIC2/JMdict,
  ordered by Japanese school grade.
- **Speech input** — planned via the Web Speech API. Note this needs HTTPS, so
  it cannot be tested over a plain `http://` wifi address; it will need
  deploying (GitHub Pages gives free HTTPS) to try on a phone.

## Progress and backups

Progress is stored per device in IndexedDB, and separately for each mode — a
learner can be well ahead on reading a character while still learning to write
it, and the app tracks those independently.

Every pass and fail is appended to the character's history, not just the
current box, so the scheduling algorithm can be changed later without throwing
away what a learner has actually done.

Browsers can evict site storage, and Safari is the strictest about it. The app
asks for persistent storage on launch, but that is a request rather than a
guarantee, so **Settings → Save backup file** writes a JSON file with every
profile on the device. Loading a backup on another device merges rather than
overwrites: for each character it keeps whichever record has the longer
history, so restoring an old backup cannot wipe out newer practice.

## Layout

| Path | What it is |
| --- | --- |
| `index.html` | All screens, hidden and shown by `app.js` |
| `src/kana.js` | Kana tables, chunking, romaji answer checking |
| `src/srs.js` | Leitner scheduling and the chunk-unlocking rule |
| `src/store.js` | IndexedDB profiles, backup export/import |
| `src/app.js` | Screen routing, session flow, event wiring |
| `vendor/` | `wanakana` (romaji ↔ kana), vendored so the app works offline |
| `tools/make_icons.py` | Regenerates the home-screen icons |

Katakana is not written out anywhere: it is derived from the hiragana tables
with `wanakana.toKatakana`, and every romaji prompt is derived with
`wanakana.toRomaji`, so there is no hand-typed romaji that could disagree with
the answer checker. `test/smoke.js` asserts that invariant for all 208
characters.

## Credits

Uses [WanaKana](https://wanakana.com/) (MIT) for romaji/kana conversion.
