#!/bin/sh
# Drives the deployed Worker with curl, asserting the compare-and-swap
# semantics from sync-plan.md §2.1 and §7. Run against a live deployment —
# `npm run deploy` first — since Durable Object alarms and cross-request
# state don't mean much against a single `wrangler dev` process restart.
#
#   BASE=https://kana-quest-sync.natebriggs.workers.dev ./test.sh
# or just:
#   ./test.sh   # defaults to the URL below

set -eu

BASE="${BASE:-https://kana-quest-sync.natebriggs.workers.dev}"
ID="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
URL="$BASE/v1/doc/$ID"
FAIL=0

check() {
  desc="$1"; expected="$2"; actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "ok   - $desc"
  else
    echo "FAIL - $desc (expected $expected, got $actual)"
    FAIL=1
  fi
}

# --http1.1: HTTP/2 stream multiplexing to the Cloudflare edge occasionally
# drops mid-upload on the large-payload check below (a real network hiccup,
# reproduced independently of this script — not a defect in the Worker).
# -H "Expect:" turns off curl's "Expect: 100-continue" handshake for request
# bodies — under load, the interim "100 Continue" response was sometimes the
# one %{http_code} captured, reported here as a spurious "got 100". Up to 2
# retries cover any other transient connection failure ("000" or empty).
status() {
  tries=0
  code=""
  while [ "$tries" -lt 3 ] && { [ -z "$code" ] || [ "$code" = "000" ]; }; do
    [ "$tries" -gt 0 ] && sleep 1
    code="$(curl -s --http1.1 -H "Expect:" -o /dev/null -w '%{http_code}' "$@" || true)"
    tries=$((tries + 1))
  done
  echo "$code"
}
etag() { curl -s --http1.1 -D - -o /dev/null "$@" | grep -i '^etag:' | tr -d '\r' | sed 's/.*"\(.*\)"/\1/'; }

echo "Testing $URL"
echo

# --- malformed id, before touching any storage ---
check "malformed id -> 400" 400 "$(status "$BASE/v1/doc/not-hex")"

# --- fresh document ---
check "GET before creation -> 404" 404 "$(status "$URL")"
# "0" would legitimately match a nonexistent document (version 0 means "no
# document yet") — that's correct CAS behaviour, not something to test
# against here. A stale nonzero version is the real scenario this checks.
check "PUT with stale If-Match on nonexistent -> 412" 412 \
  "$(status -X PUT -H 'If-Match: "5"' --data 'x' "$URL")"
check "DELETE nonexistent -> 404" 404 "$(status -X DELETE -H 'If-Match: "5"' "$URL")"
check "PUT with neither header -> 400" 400 "$(status -X PUT --data 'x' "$URL")"

# --- create ---
check "PUT If-None-Match: * (create) -> 200" 200 \
  "$(status -X PUT -H 'If-None-Match: *' --data 'first version' "$URL")"
V1="$(etag "$URL")"
check "PUT If-None-Match: * again -> 412 (already exists)" 412 \
  "$(status -X PUT -H 'If-None-Match: *' --data 'x' "$URL")"

# --- read ---
BODY="$(curl -s --http1.1 "$URL")"
check "GET returns the body just written" "first version" "$BODY"
check "GET conditional, matching If-None-Match -> 304" 304 \
  "$(status -H "If-None-Match: \"$V1\"" "$URL")"

# --- CORS ---
check "OPTIONS preflight -> 204" 204 "$(status -X OPTIONS "$URL")"
EXPOSED="$(curl -s --http1.1 -D - -o /dev/null "$URL" | grep -i '^access-control-expose-headers:')"
case "$EXPOSED" in
  *ETag*) echo "ok   - ETag is exposed for cross-origin reads" ;;
  *) echo "FAIL - Access-Control-Expose-Headers missing ETag"; FAIL=1 ;;
esac

# --- conflict and retry, the real client loop from sync-plan.md §4.5 ---
check "PUT with stale If-Match -> 412" 412 \
  "$(status -X PUT -H 'If-Match: "999"' --data 'x' "$URL")"
check "PUT with correct If-Match -> 200" 200 \
  "$(status -X PUT -H "If-Match: \"$V1\"" --data 'second version' "$URL")"
V2="$(etag "$URL")"
check "version actually advanced" 1 "$([ "$V2" != "$V1" ] && echo 1 || echo 0)"
BODY2="$(curl -s --http1.1 "$URL")"
check "GET returns the second version" "second version" "$BODY2"

# --- size cap ---
BIGFILE="$(mktemp)"
trap 'rm -f "$BIGFILE"' EXIT
python3 -c 'import sys; sys.stdout.buffer.write(b"x" * (4 * 1024 * 1024 + 1))' > "$BIGFILE"
check "oversized PUT -> 413" 413 \
  "$(status -X PUT -H "If-Match: \"$V2\"" --data-binary "@$BIGFILE" "$URL")"
rm -f "$BIGFILE"

# --- delete ---
check "DELETE with stale If-Match -> 412" 412 \
  "$(status -X DELETE -H 'If-Match: "999"' "$URL")"
check "DELETE with correct If-Match -> 204" 204 \
  "$(status -X DELETE -H "If-Match: \"$V2\"" "$URL")"
check "GET after delete -> 404" 404 "$(status "$URL")"
check "PUT If-None-Match: * works again after delete (create)" 200 \
  "$(status -X PUT -H 'If-None-Match: *' --data 'reborn' "$URL")"

# leave no trace
curl -s --http1.1 -X DELETE -H "If-Match: \"$(etag "$URL")\"" "$URL" > /dev/null

echo
if [ "$FAIL" = 0 ]; then
  echo "All checks passed."
else
  echo "Some checks FAILED."
  exit 1
fi
