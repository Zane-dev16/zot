#!/usr/bin/env bash
set -euo pipefail
PORT="${PORT:-18787}"
BASE="http://127.0.0.1:${PORT}"
TMPDIR="$(mktemp -d)"
DB="${TMPDIR}/zot.db"
LOG="${TMPDIR}/daemon.log"

cleanup() {
	if [ -n "${PID:-}" ] && kill -0 "$PID" 2>/dev/null; then
		kill "$PID" 2>/dev/null || true
		wait "$PID" 2>/dev/null || true
	fi
	rm -rf "$TMPDIR"
}
trap cleanup EXIT

PORT="$PORT" ZOT_DB="$DB" node src/daemon2.js >"$LOG" 2>&1 &
PID=$!

ok=0
for _ in $(seq 1 75); do
	if curl -s -f -o /dev/null "${BASE}/healthz"; then
		ok=1
		break
	fi
	sleep 0.2
done
if [ "$ok" != "1" ]; then
	cat "$LOG"
	echo "FAIL healthz did not come up"
	exit 1
fi

body="$(curl -s "${BASE}/healthz")"
echo "$body" | grep -q '"state":"ready"'
echo "PASS healthz returns ready on tmp port with tmp db"

code="$(curl -s -o "${TMPDIR}/unauth.json" -w "%{http_code}" "${BASE}/api/v1/runs")"
if [ "$code" != "401" ]; then
	echo "FAIL expected 401 got ${code}"
	exit 1
fi
grep -q '"error"' "${TMPDIR}/unauth.json"
echo "PASS unauthorized api returns 401 with JSON error"

test -f web/index.html
test -f web/app.js
test -f web/style.css
echo "PASS web files exist"

test -f ios/ZotApp.swift
test -f ios/Keychain.swift
test -f ios/ApiClient.swift
test -f ios/ContentView.swift
echo "PASS ios files exist"

echo "ALL PASS"
