#!/bin/sh
# Serve the app for local development and print the URL to open on a phone
# or tablet on the same wifi.
#
#   ./tools/serve.sh [port]

PORT="${1:-8000}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)"

echo "Serving $DIR"
echo
echo "  On this Mac:      http://localhost:$PORT/"
if [ -n "$IP" ]; then
  echo "  On phone/tablet:  http://$IP:$PORT/   (same wifi)"
else
  echo "  (Could not find a wifi address — check you are connected.)"
fi
echo
echo "Ctrl-C to stop."
echo

cd "$DIR" && exec python3 -m http.server "$PORT"
