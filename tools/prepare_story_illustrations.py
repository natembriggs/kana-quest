#!/usr/bin/env python3
"""Export selected painted originals as inline WebP; does not generate artwork.

Usage: python3 tools/prepare_story_illustrations.py STORY_ID ORIGINALS_DIRECTORY
Requires Pillow. Reads assets/stories/STORY_ID/painted-sources.json.
"""
import argparse
from io import BytesIO
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
MAX_BYTES = 150 * 1024


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('story_id')
    parser.add_argument('originals', type=Path)
    args = parser.parse_args()
    if Path(args.story_id).name != args.story_id:
        raise ValueError('Story id must be a plain directory name')
    directory = ROOT / 'assets' / 'stories' / args.story_id
    sources = json.loads((directory / 'painted-sources.json').read_text())
    outputs = []
    for output, source in sources['images'].items():
        if Path(output).name != output or Path(source).name != source or not output.endswith('.webp'):
            raise ValueError('Images must have plain filenames and WebP outputs')
        with Image.open(args.originals / source) as original:
            image = original.convert('RGB')
            image.thumbnail((960, 560), Image.Resampling.LANCZOS)
        for quality in range(90, 59, -1):
            encoded = BytesIO()
            image.save(encoded, format='WEBP', quality=quality, method=6)
            data = encoded.getvalue()
            if len(data) <= MAX_BYTES:
                break
        else:
            raise ValueError(f'{output}: cannot meet 150 KiB without dropping below quality 60')
        outputs.append((output, data, image.size, quality))
    if sum(len(data) for _, data, _, _ in outputs) > 450 * 1024:
        raise ValueError('Illustrations exceed 450 KiB per story')
    for output, data, size, quality in outputs:
        (directory / output).write_bytes(data)
        print(f'{output}: {size[0]}×{size[1]}, {len(data):,} bytes, quality {quality}')


if __name__ == '__main__':
    main()
