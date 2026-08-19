#!/bin/sh
# Downloads KanjiVG (stroke-order SVGs) that tools/build_stroke_data.py reads.
# Not committed (~13MB of individual SVG files, easy to re-fetch) — run this
# once before running that script.
#
#   ./tools/fetch_kanjivg.sh
#   python3 tools/build_stroke_data.py
#
# Source: KanjiVG by Ulrich Apel, http://kanjivg.tagaini.net —
# CC BY-SA 3.0. Covers hiragana, katakana and kanji as separate per-character
# SVGs, one stroke per <path>, in stroke order.

set -e
DIR="$(cd "$(dirname "$0")" && pwd)/data_src/kanjivg"
mkdir -p "$DIR"
cd "$DIR"

RELEASE_URL=$(curl -sL --max-time 20 "https://api.github.com/repos/KanjiVG/kanjivg/releases/latest" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(next(a['browser_download_url'] for a in d['assets'] if a['name'].endswith('-main.zip')))")

echo "Fetching $RELEASE_URL ..."
curl -sL -o main.zip "$RELEASE_URL"
unzip -oq main.zip
rm -f main.zip

echo "Done: $DIR/kanji/*.svg ($(ls kanji | wc -l | tr -d ' ') files)"
