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
