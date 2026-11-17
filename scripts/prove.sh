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

node scripts/verify-stream-frames.js

# The web client is native ES modules: prove the module graph, the committed
# build manifest, and the screenshot selector contract offline, before any
# browser runs. A stale or absent web/build.json fails here; it never SKIPs.
node scripts/verify-web.mjs
node scripts/verify-web-state.js

test -f ios/ZotApp.swift
test -f ios/Keychain.swift
test -f ios/ApiClient.swift
test -f ios/ContentView.swift
echo "PASS ios files exist"

# NOTE for T7: these four assertions (and the `ios/` legacy app they guard) move
# or disappear when ios/ is archived. Update this block in the same commit that
# archives it, or this check fails on a tree that is actually correct.

# RN client checks. A green gate used to say nothing about rn/ or rn/ios, even
# though the shipped client is the RN app. Honest on a clean checkout: without
# node_modules none of this can run at all, so say SKIP instead of faking a pass
# or failing on an installation the checkout never had.
if [ -d rn/node_modules ]; then
	(
		cd rn
		npx prettier --check "**/*.{ts,tsx,js,mjs}"
		npx tsc --noEmit
		npx jest
		npx eslint .
	)
	echo "PASS rn checks: prettier, tsc, jest, eslint"
else
	echo "SKIP rn checks (installed deps absent)"
fi

# Browser screenshots. A resolved browser that misses an assertion must fail the
# gate. Hosts without one say SKIP instead of pretending a screenshot passed;
# scripts/verify-shots.sh owns discovery and prints what is missing.
SHOTS_RC=0
bash scripts/verify-shots.sh || SHOTS_RC=$?
if [ "$SHOTS_RC" = "2" ]; then
	echo "SKIP browser screenshots (no browser resolved; set ZOT_BROWSER and ZOT_CHROME)"
elif [ "$SHOTS_RC" != "0" ]; then
	echo "FAIL browser screenshots (verify-shots.sh exit ${SHOTS_RC})"
	exit 1
fi

echo "ALL PASS"
