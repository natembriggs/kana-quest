#!/usr/bin/env bash
#
# Stage and deploy the app as Cloudflare static assets.
#
# WHY THIS EXISTS, rather than just pointing wrangler at the repo root:
#
#   1. An allowlist fails closed. The list below is everything the browser
#      ever fetches; anything not named here cannot reach the public, even
#      by accident. The obvious alternative — `[assets] directory = "."`
#      plus a .assetsignore blacklist — fails OPEN: a new top-level
#      directory ships unless someone remembers to exclude it. For a repo
#      that also holds design documents and an authoring pipeline, that is
#      the wrong default.
#
#   2. .assetsignore did not actually work here. Pointed at the repo root
#      with a .assetsignore listing .git/, tools/ and *.md, wrangler still
#      reported reading 10,272 entries — the entire repository, git
#      directory and node_modules included, against the 402 files the app
#      needs. Whatever the cause, "the filter silently did nothing" is not
#      a failure mode worth risking when what leaks is every plan document.
#
#   3. Staging outside Dropbox keeps deploys fast and avoids resyncing tens
#      of megabytes through Dropbox on every deploy.
#
# The app itself still has no build step: this copies files, it does not
# transform them. What runs locally is byte-for-byte what deploys.
#
# Usage:
#   tools/deploy-site.sh --stage-only   # stage and print the manifest
#   tools/deploy-site.sh                # stage, then deploy to Cloudflare

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="${SITE_DIST:-/private/tmp/kq-site-dist}"

# Everything the browser fetches, and nothing else. Adding a served
# directory means adding it here deliberately.
PATHS=(
  index.html
  styles.css
  sw.js
  manifest.webmanifest
  src
  assets
  icons
  vendor
)

cd "$REPO"

# A renamed or moved path must stop the deploy, not silently ship a site
# with a missing stylesheet.
missing=0
for p in "${PATHS[@]}"; do
  [ -e "$p" ] || { echo "MISSING: $p" >&2; missing=1; }
done
[ "$missing" -eq 0 ] || { echo "Refusing to deploy with missing paths." >&2; exit 1; }

rm -rf "$DIST"
mkdir -p "$DIST"

for p in "${PATHS[@]}"; do
  if [ -d "$p" ]; then
    rsync -a --exclude='.DS_Store' "$p/" "$DIST/$p/"
  else
    cp "$p" "$DIST/$p"
  fi
done

# macOS and Dropbox both leave litter that should never be served.
find "$DIST" -name '.DS_Store' -delete
find "$DIST" -name '._*' -delete

# The allowlist above works at top-level granularity, which is the right
# grain for src/ and icons/ but too coarse for assets/: the paintings the
# app fetches sit in the same tree as the authoring record that produced
# them. None of the following is ever requested by the browser — checked
# against src/, sw.js and index.html — and all of it is working material:
# the art-direction brief, and the generation prompts and source lists for
# the cover and story paintings.
find "$DIST/assets" -name 'ART-DIRECTION.md' -delete
find "$DIST/assets" -name '*-prompts.json' -delete
find "$DIST/assets" -name '*-sources.json' -delete
find "$DIST/assets" -name 'cover-prompts.json' -delete
find "$DIST/assets" -name 'cover-sources.json' -delete

echo "Staged to $DIST"
echo "  files: $(find "$DIST" -type f | wc -l | tr -d ' ')"
echo "  size:  $(du -sh "$DIST" | cut -f1 | tr -d ' ')"
echo
echo "Top level:"
ls -1 "$DIST" | sed 's/^/  /'

# Anything prose-shaped in the staged tree is a bug in the list above.
# Recursive on purpose. This check used to be -maxdepth 1, which made it
# blind to exactly the case that matters: prose nested inside an otherwise
# legitimate served directory. assets/stories/ART-DIRECTION.md sat in the
# staged tree through every verification run in §6 because of it.
strays="$(find "$DIST" \( -name '*.md' -o -name '.git*' \) -print)"
if [ -n "$strays" ]; then
  echo >&2
  echo "Unexpected files staged:" >&2
  echo "$strays" >&2
  exit 1
fi

if [ "${1:-}" = "--stage-only" ]; then
  echo
  echo "Stage only — not deployed."
  exit 0
fi

echo
npx wrangler deploy --assets "$DIST"
