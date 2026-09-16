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

39 covers are installed. Rapunzel (`rapunzel`), The Little Mermaid
(`ningyo-hime`) and Pinocchio (`pinocchio`) still use the library's placeholders.
`cover-sources.json` maps each installed cover to its original PNG and records
the generation batch and artwork credit. The originals remain in Codex's
generated-images folder; the app uses only the WebP files committed here.

Ali Baba uses the corrected arm version (`exec-397af912-…`), not the original
(`exec-2054f78d-…`). Around the World in Eighty Days retains its original
pocket-watch/steam-train cover, as requested. No further images were generated.

To re-export the selected originals (requires Python and Pillow):

```sh
python3 tools/prepare_story_covers.py /path/to/generated_images/01a0aa54-ed32-75f0-979c-14dca23571c5
node tools/build_story_data.mjs
```

The exporter preserves the full composition, resizes to 480×640, and chooses
the highest WebP quality from 90 downwards that meets the 60 KiB budget.

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
