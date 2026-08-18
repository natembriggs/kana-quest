#!/bin/sh
# Downloads the KANJIDIC2 and JMdict source dictionaries that
# build_kanji_data.py reads. Not committed (~90MB uncompressed, and easy to
# re-fetch) — run this once before running that script.
#
#   ./tools/fetch_kanji_sources.sh
#   python3 tools/build_kanji_data.py
#
# Source: The Electronic Dictionary Research and Development Group
# (EDRDG), https://www.edrdg.org/ — CC BY-SA 4.0.

set -e
DIR="$(cd "$(dirname "$0")" && pwd)/data_src"
mkdir -p "$DIR"
cd "$DIR"

echo "Fetching KANJIDIC2..."
curl -sL -o kanjidic2.xml.gz "http://www.edrdg.org/kanjidic/kanjidic2.xml.gz"
gunzip -f kanjidic2.xml.gz

echo "Fetching JMdict..."
curl -sL -o JMdict_e.gz "http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz"
gunzip -f JMdict_e.gz

echo "Done: $DIR/kanjidic2.xml, $DIR/JMdict_e"
