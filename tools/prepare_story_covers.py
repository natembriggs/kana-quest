#!/usr/bin/env python3
"""Resize existing originals into the story plan's WebP budget; never generate art.

Requires Pillow. Pass the directory containing the PNGs listed in
assets/stories/cover-sources.json. Originals are left untouched.
"""

import argparse
from io import BytesIO
import json
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / "assets" / "stories"
SIZE = (480, 640)
MAX_BYTES = 60 * 1024


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("originals", type=Path)
    args = parser.parse_args()
    catalog = json.loads((ART / "cover-sources.json").read_text())
    # Validate every input before writing anything.
    for story_id, filename in catalog["covers"].items():
        if Path(story_id).name != story_id or Path(filename).name != filename:
            raise ValueError("Story ids and source filenames must be plain names")
        if not (args.originals / filename).is_file():
            raise FileNotFoundError(args.originals / filename)
    total = 0
    for story_id, filename in catalog["covers"].items():
        with Image.open(args.originals / filename) as original:
            if original.width * 4 != original.height * 3:
                raise ValueError(f"{story_id}: expected a 3:4 portrait; refusing to crop")
            image = original.convert("RGB").resize(SIZE, Image.Resampling.LANCZOS)
        for quality in range(90, 39, -1):
            encoded = BytesIO()
            image.save(encoded, format="WEBP", quality=quality, method=6)
            data = encoded.getvalue()
            if len(data) <= MAX_BYTES:
                break
        else:
            raise ValueError(f"{story_id}: cannot meet the 60 KiB budget")
        destination = ART / story_id / "cover.webp"
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
        total += len(data)
        print(f"{story_id}: {len(data) / 1024:.1f} KiB, quality {quality}")
    print(f"Prepared {len(catalog['covers'])} covers, {total / 1024:.1f} KiB total")


if __name__ == "__main__":
    main()
