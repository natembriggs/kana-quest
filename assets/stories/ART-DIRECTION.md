# Story cover art

House style fixed before generation, 16 September 2026, following
`stories-plan.md` sections 8.7–8.8.

Hand-painted gouache picture-book illustrations, with subtle paper grain,
broad opaque shapes and gently imperfect brush edges. Strong silhouettes
must remain readable in the library's 54px-wide thumbnails. Use restrained
detail, two or three depth layers, and one clear focal subject.

Shared palette: warm ivory, midnight indigo, muted teal, sage green, ochre
gold and terracotta red. Vary the proportions with each setting. Faces use
small dark eyes and minimal expressive features, with natural proportions.
Original character designs; no film-adaptation costumes or likenesses.

Portrait 3:4, full bleed, no lettering, title, border or watermark. Titles
remain in the adjacent library text. Depict an opening situation, never a
resolution; mystery covers must not expose their solution.

Each final file is `assets/stories/<id>/cover.webp`, 480×640, at most
60 KiB. Covers remain decorative, lazy-loaded and outside story bodies, so
adding them does not change saved reading positions or pre-cache the corpus.

Generated with OpenAI's built-in image-generation tool. The exact image model
is not exposed by the tool. Full prompts are preserved in `cover-prompts.json`.
Per-story source metadata records the cover credit separately from authorship.

## Implemented covers

41 covers are installed. Rapunzel (`rapunzel`) and The Little Mermaid
(`ningyo-hime`) were completed on 18 September 2026. Pinocchio (`pinocchio`)
still uses the library's placeholder: the built-in generator rejected its
workshop-scene prompt at output moderation, including on retry.
`cover-sources.json` maps each installed cover to its original PNG and records
the generation batch and artwork credit. The originals remain in Codex's
generated-images folder; the app uses only the WebP files committed here.

Ali Baba uses the corrected arm version (`exec-397af912-…`), not the original
(`exec-2054f78d-…`). Around the World in Eighty Days retains its original
pocket-watch/steam-train cover, as requested.

To re-export the selected originals (requires Python and Pillow):

```sh
python3 tools/prepare_story_covers.py /path/to/generated_images
node tools/build_story_data.mjs
```

The exporter preserves the full composition, resizes to 480×640, and chooses
the highest WebP quality from 90 downwards that meets the 60 KiB budget.
The catalog's `batch` is the default source folder; `batches` records
per-story overrides for later additions. A direct folder of PNGs is also
accepted. Use repeatable `--story <id>` options to export a subset.
The two September 18 covers use the existing prompts in `cover-prompts.json`;
Rapunzel is 56.7 KiB (quality 85), and The Little Mermaid is 56.6 KiB (quality 84).

## Inline drawing pilot: A House for the Cat

`neko-no-ie/01.svg` and `02.svg` are original SVG drawings authored by GPT-6,
using the installed cover as a visual reference. They are drawn directly as
vector paths, not generated raster images or automatic traces. Their source
credit lives in the story's `source.illustrations` field.

Keep Hana's dark hair bun, ivory shirt and blue overalls, and the ginger
tabby's white muzzle, chest and paws. Translate the cover's warm palette into
flat colour planes, gently curved silhouettes and a few expressive face
details. Open, irregular background shapes blend into the reading page;
the ground, window and pale highlights follow the existing theme variables.
Character and cardboard colours stay recognisable in both themes.

The first scene follows paragraph 0: the cat sits in its familiar little box
beside Hana and the large, still unconverted box. The second follows paragraph
1: the cat inspects the finished empty house. These depict each scene's setup;
neither reveals the cat's choice or the final toy-dog resolution. No captions
or text are embedded in the pictures.

Both use a 600×350 viewBox and the existing 460px maximum reader width.
The original files are 6,173 and 4,413 bytes respectively, below §8.8's 8 KiB
per-image limit, with 64 and 46 SVG elements. No filters, embedded bitmaps,
scripts or external resources. Rebuild with `node tools/build_story_data.mjs`;
art remains outside `body`, preserving the story hash and saved positions.

## Inline drawings: The Straw Hats for Jizō

Historical SVG trial, replaced in the reader by the painted pilot below on
17 September 2026. The original SVG files remain available for comparison.

`kasa-jizou/01.svg`, `02.svg` and `03.svg` continue the cat-story pilot's
flat vector style. Drawn directly by GPT-6 with the installed cover as the
character and palette reference; credited in `source.illustrations` and the
reader's source line. The old man keeps his indigo coat, rust scarf and grey
topknot. His pale head towel appears before his gift and is absent at home.
The old woman wears muted plum with a sage apron. Snow, mountains, room
backgrounds and pale highlights use the existing theme colours.

Three scenes, each with a 600×350 viewBox:

- `01.svg`, after paragraph 0: he finishes one straw hat with four completed
  hats beside him, making the story's total of five visible.
- `02.svg`, after paragraph 2: he offers the first hat to six snow-covered
  stone Jizō. All six are visible, with quiet faces and hands held in prayer.
  The shared figure uses a story-specific local SVG reference; no external
  image requests are needed.
- `03.svg`, after paragraph 3: the couple share hot water by a small hearth.
  The night window establishes the time; there is no food on display and no
  hint of the visitors or gifts revealed in the final paragraph.

Each drawing is under 8 KiB and the set is under 18 KiB. These are decorative
illustrations between intact paragraphs, without embedded text, raster
images, filters or scripts. The story text and its saved-position hash stay
unchanged. Rebuild with `node tools/build_story_data.mjs`.

## Painted inline pilot: Kasa Jizō, 17 September 2026

Original painted treatment. The approved simpler replacements are documented
below; the table here records the initial exports for comparison.

The three inline scenes now use `kasa-jizou/01.webp`, `02.webp` and `03.webp`.
Generated with OpenAI's built-in image-generation tool, with `cover.webp`
supplied as the character and style reference for each image. The exact model
is not exposed by that tool. Full prompts are in
`kasa-jizou/painted-prompts.json`; selected originals and the credit are in
`kasa-jizou/painted-sources.json`. The full-size PNGs remain in Codex's
generated-images folder; the app uses the committed WebP exports.

The scene placements stay after paragraphs 0, 2 and 3. The first picture has
one hat in the man's hands and four finished hats on the floor. The second
shows six distinct stone Jizō and the old man's offer of a hat. The third
shows the couple with plain hot water beside their hearth, without showing
the gifts or visitors from the ending. Keep the indigo coat, rust scarf,
grey topknot and gentle natural faces consistent with the cover. The head
towel is present before the gift and absent in the evening scene.

All three exports are 960×560 with the full compositions preserved:

| Image | Bytes | WebP quality |
| --- | ---: | ---: |
| `01.webp` — hat making | 152,398 | 84 |
| `02.webp` — snowy roadside | 152,916 | 83 |
| `03.webp` — evening hearth | 151,008 | 88 |

Total: 456,322 bytes (445.6 KiB), compared with 18,043 bytes for the original
SVGs. The paintings are separate lazy-loaded files; the story module now
contains only their URLs and dimensions. Each URL includes a content hash,
allowing cache-first reuse within the current app cache. No paintings are
precached with the app shell. The picture slot reserves space before loading;
a failed image removes its slot, and Pictures off requests no paintings.
Painted colours remain unchanged in dark mode, like the covers.

To reproduce the exports (requires Pillow):

```sh
python3 tools/prepare_story_illustrations.py kasa-jizou /path/to/generated_images/01a0abde-796c-7231-9c20-a9b39dbc6f66
node tools/build_story_data.mjs
```

The exporter chooses the highest quality from 90 down to 60 that fits each
150 KiB budget. The build enforces 450 KiB of paintings per story, validates
WebP dimensions, rejects animated files, and requires an artwork credit.

## Approved simpler inline style: 18 September 2026

The user selected the second simplification preview for all three Kasa Jizō
scenes. Keep the cover's characters, palette and warm lighting, but use broad
mostly smooth colour areas, gentle contours, a few purposeful folds and face
lines, simple hat-weaving marks, and quieter backgrounds. Inline scenes need
less surface texture than covers. Preserve believable hands, scene continuity
and the exact five-hat/six-statue counts.

`kasa-jizou/01.webp`, `02.webp` and `03.webp` now contain these approved images.
They were edited with OpenAI's built-in image-generation tool through two
simplification passes. Both prompt sets are preserved in `styleRefinements`
inside `kasa-jizou/painted-prompts.json`. `painted-sources.json` selects the
new full-size originals and retains the first painted set under
`originalPaintedImages`. The export command and quality policy are unchanged.

| Scene | Original bytes | Approved bytes | Dimensions | WebP quality |
| --- | ---: | ---: | --- | ---: |
| Hat making | 152,398 | 83,070 | 960×560 | 90 |
| Snowy roadside | 152,916 | 115,184 | 960×560 | 90 |
| Evening hearth | 151,008 | 70,224 | 958×560 | 90 |

Total: **268,478 bytes (262.2 KiB)** versus 456,322 bytes (445.6 KiB):
**41.2% smaller**, despite the higher export-quality setting. The small width
difference in the evening image preserves its generated aspect ratio without
cropping or stretching. Placements and story text are unchanged; rebuilt
content-versioned URLs ensure readers receive the approved replacements.
