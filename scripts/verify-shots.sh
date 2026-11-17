#!/usr/bin/env bash
# Browser screenshot verification for the web UI, using the agent-browser CLI
# that drives a real headless Chrome over CDP. No npm dependency, no Playwright.
#
# One command boots an isolated daemon (temp port + temp db), pairs a browser
# device, drives the UI through its documented selectors, and captures four
# full-window PNGs into an evidence directory:
#
#   pairing.png   the auth/pairing surface before a token is saved
#   chat.png      token accepted, stream live, completion text rendered
#   approvals.png a run paused in waiting_tool with its Approve/Cancel row
#   activity.png  #activity populated with titled run rows
#
# Viewport is fixed at 1280x800 so screenshots compare before/after a UI change.
#
# Browser discovery, in order: ZOT_BROWSER (or ZOT_AGENT_BROWSER) for the CLI,
# ZOT_CHROME for the browser executable, then PATH, then common install paths.
# If nothing resolves the script prints a SKIP line naming both env vars and
# exits 2 so scripts/prove.sh can skip without pretending it passed.
#
# Usage:
#   bash scripts/verify-shots.sh [evidence-dir]
#   EVIDENCE_DIR=/path bash scripts/verify-shots.sh
#
# Env:
#   ZOT_BROWSER            agent-browser CLI path (ZOT_AGENT_BROWSER also works)
#   ZOT_CHROME             Chrome/Chromium executable path
#   EVIDENCE_DIR           where PNGs land when $1 is absent
#   ZOT_SHOTS_PORT         daemon port (default 18788; 18787 is prove.sh's)
#   ZOT_SHOTS_MIN_BYTES    minimum plausible PNG size (default 10000)
#
# Exit codes: 0 all four screens passed; 2 browser unavailable (safe to SKIP);
# 1 any boot, interaction, or image assertion failed. Evidence is preserved on
# failure and the evidence path is printed on every run.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VIEWPORT_W=1280
VIEWPORT_H=800
MIN_BYTES="${ZOT_SHOTS_MIN_BYTES:-10000}"
PORT="${ZOT_SHOTS_PORT:-18788}"
BASE="http://127.0.0.1:${PORT}"

fail() {
	echo "FAIL $*" >&2
	exit 1
}

first_exec() {
	# Echo the first existing executable in the argument list.
	local candidate
	for candidate in "$@"; do
		if [ -n "$candidate" ] && [ -x "$candidate" ]; then
			printf '%s\n' "$candidate"
			return 0
		fi
	done
	return 1
}

# An explicit env var pointing nowhere is a misconfiguration, not a skip.
for var in ZOT_BROWSER ZOT_AGENT_BROWSER ZOT_CHROME; do
	value="${!var:-}"
	if [ -n "$value" ] && [ ! -x "$value" ]; then
		fail "$var is set but not executable: $value"
	fi
done

BROWSER_CANDIDATES=(
	"${ZOT_BROWSER:-}"
	"${ZOT_AGENT_BROWSER:-}"
)
for name in agent-browser agent-browser-linux-x64; do
	BROWSER_CANDIDATES+=("$(command -v "$name" 2>/dev/null || true)")
done
BROWSER_CANDIDATES+=(
	"$HOME"/.hermes/tools/agent-browser-*/bin/agent-browser-linux-x64
	"$HOME"/.hermes/tools/agent-browser-*/bin/agent-browser
	"$HOME"/.local/bin/agent-browser
	"$HOME"/.npm-global/bin/agent-browser
	/usr/local/bin/agent-browser
	/usr/bin/agent-browser
)
BROWSER_BIN="$(first_exec "${BROWSER_CANDIDATES[@]}" || true)"

CHROME_CANDIDATES=(
	"${ZOT_CHROME:-}"
	"${AGENT_BROWSER_EXECUTABLE_PATH:-}"
)
for name in google-chrome google-chrome-stable chromium chromium-browser chrome; do
	CHROME_CANDIDATES+=("$(command -v "$name" 2>/dev/null || true)")
done
CHROME_CANDIDATES+=(
	"$HOME"/.hermes/tools/chromium-*/chrome-linux64/chrome
	"$HOME"/.cache/ms-playwright/chromium-*/chrome-linux/chrome
	"$HOME"/.agent-browser/browsers/*/chrome-linux64/chrome
	"$HOME"/.cache/puppeteer/chrome/*/chrome-linux64/chrome
	/usr/bin/google-chrome
	/usr/bin/google-chrome-stable
	/usr/bin/chromium
	/usr/bin/chromium-browser
	/opt/google/chrome/chrome
	/snap/bin/chromium
)
CHROME_BIN="$(first_exec "${CHROME_CANDIDATES[@]}" || true)"

if [ -z "$BROWSER_BIN" ] || [ -z "$CHROME_BIN" ]; then
	missing=""
	[ -z "$BROWSER_BIN" ] && missing="browser automation CLI"
	[ -z "$CHROME_BIN" ] && missing="${missing:+$missing and }Chrome executable"
	echo "SKIP browser screenshots ($missing not found)"
	echo "  set ZOT_BROWSER=/path/to/agent-browser (or ZOT_AGENT_BROWSER) and ZOT_CHROME=/path/to/chrome,"
	echo "  or put agent-browser and a Chrome/Chromium binary on PATH"
	exit 2
fi

EVIDENCE="${1:-${EVIDENCE_DIR:-}}"
if [ -z "$EVIDENCE" ]; then
	EVIDENCE="$(mktemp -d "${TMPDIR:-/tmp}/zot-shots-XXXXXX")"
fi
mkdir -p "$EVIDENCE"
EVIDENCE="$(cd "$EVIDENCE" && pwd)"
echo "EVIDENCE ${EVIDENCE}"

# agent-browser keeps one daemon per machine and derives session/browser launch
# from env. A per-run session name keeps other tasks' browser state untouched.
export AGENT_BROWSER_SESSION="zot-shots-$$"
export AGENT_BROWSER_EXECUTABLE_PATH="$CHROME_BIN"
if [ "$(id -u)" = "0" ]; then
	case ",${AGENT_BROWSER_ARGS:-}," in
	*no-sandbox*) ;;
	*) export AGENT_BROWSER_ARGS="${AGENT_BROWSER_ARGS:+${AGENT_BROWSER_ARGS},}--no-sandbox" ;;
	esac
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/zot-shots-run-XXXXXX")"
LOG="$TMP/daemon.log"
PID=""
OPENED=0

cleanup() {
	local rc=$?
	if [ "$OPENED" = "1" ]; then
		"$BROWSER_BIN" close >/dev/null 2>&1 || true
	fi
	if [ -n "${PID:-}" ] && kill -0 "$PID" 2>/dev/null; then
		kill "$PID" 2>/dev/null || true
		wait "$PID" 2>/dev/null || true
	fi
	if [ -f "$LOG" ]; then
		cp "$LOG" "$EVIDENCE/daemon.log" 2>/dev/null || true
	fi
	rm -rf "$TMP"
	if [ "$rc" -ne 0 ]; then
		echo "EVIDENCE ${EVIDENCE} (kept for failure inspection)" >&2
	fi
}
trap cleanup EXIT

# Never claim a pass against a dev instance: a port that already answers is a
# collision, not our daemon.
if curl -s -f -o /dev/null "${BASE}/healthz" 2>/dev/null; then
	fail "${BASE} already answers; set ZOT_SHOTS_PORT to a free port"
fi

PORT="$PORT" ZOT_DB="$TMP/zot.db" node src/daemon2.js >"$LOG" 2>&1 &
PID=$!

ready=0
for _ in $(seq 1 75); do
	if curl -s -f -o /dev/null "${BASE}/healthz"; then
		ready=1
		break
	fi
	sleep 0.2
done
if [ "$ready" != "1" ]; then
	cat "$LOG" >&2
	fail "daemon did not become ready on ${BASE}"
fi

# Pair once through the public, rate-limited routes. The token is then typed
# into the real #token form; it never goes into a URL, query string, or hash.
pair_start="$(curl -sS -X POST "${BASE}/api/v1/pair/start" \
	-H 'content-type: application/json' \
	-d '{"label":"verify-shots","kind":"browser"}')" || fail "pair/start request failed"
CODE="$(printf '%s' "$pair_start" | node -e '
	const o = JSON.parse(require("fs").readFileSync(0, "utf8"));
	if (!o || !o.code) process.exit(1);
	process.stdout.write(String(o.code));
')" || fail "pair/start did not return a code: $pair_start"

pair_confirm="$(curl -sS -X POST "${BASE}/api/v1/pair/confirm" \
	-H 'content-type: application/json' \
	-d "{\"code\":\"${CODE}\"}")" || fail "pair/confirm request failed"
TOKEN="$(printf '%s' "$pair_confirm" | node -e '
	const o = JSON.parse(require("fs").readFileSync(0, "utf8"));
	if (!o || !o.token) process.exit(1);
	process.stdout.write(String(o.token));
')" || fail "pair/confirm did not return a token: $pair_confirm"
[ -n "$TOKEN" ] || fail "pair/confirm returned an empty token"

ab() {
	"$BROWSER_BIN" "$@"
}

assert_true() {
	local desc="$1" js="$2" out
	if ! out="$(ab eval --json "$js" 2>"$TMP/eval.err")"; then
		fail "$desc: browser eval failed: $(cat "$TMP/eval.err")"
	fi
	if ! printf '%s' "$out" | node -e '
		const o = JSON.parse(require("fs").readFileSync(0, "utf8"));
		if (!o.success) {
			console.error(o.error || "eval failed");
			process.exit(1);
		}
		let r = o.data.result;
		if (typeof r === "string") {
			try {
				r = JSON.parse(r);
			} catch {
				// keep the raw string
			}
		}
		if (r !== true) {
			console.error("got " + JSON.stringify(r));
			process.exit(1);
		}
	'; then
		fail "$desc: assertion failed"
	fi
}

wait_true() {
	local desc="$1" js="$2"
	if ! ab wait --fn "$js" >/dev/null 2>"$TMP/wait.err"; then
		fail "$desc: timed out waiting for ${js}"
	fi
}

capture() {
	local name="$1" path="$EVIDENCE/$1.png" bytes
	if ! ab screenshot "$path" >/dev/null 2>"$TMP/shot.err"; then
		fail "screenshot $name failed: $(cat "$TMP/shot.err")"
	fi
	if ! bytes="$(node - "$path" "$VIEWPORT_W" "$VIEWPORT_H" "$MIN_BYTES" <<'NODE'
		const fs = require("node:fs");
		const [path, wantW, wantH, minBytes] = process.argv.slice(2);
		let buf;
		try {
			buf = fs.readFileSync(path);
		} catch (err) {
			console.error("unreadable screenshot: " + err.message);
			process.exit(1);
		}
		const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		if (buf.length < 24 || !buf.subarray(0, 8).equals(sig)) {
			console.error("not a PNG: " + path);
			process.exit(1);
		}
		const width = buf.readUInt32BE(16);
		const height = buf.readUInt32BE(20);
		if (width !== Number(wantW) || height !== Number(wantH)) {
			console.error("wrong viewport: " + width + "x" + height);
			process.exit(1);
		}
		if (buf.length < Number(minBytes)) {
			console.error("too small: " + buf.length + " bytes (min " + minBytes + ")");
			process.exit(1);
		}
		process.stdout.write(String(buf.length));
NODE
	)"; then
		fail "screenshot $name is not a usable image"
	fi
	echo "PASS shot ${name} (${VIEWPORT_W}x${VIEWPORT_H}, ${bytes} bytes) ${path}"
}

create_run() {
	local title="$1" prompt="$2" body
	body="$(node -e '
		const [title, prompt] = process.argv.slice(1);
		process.stdout.write(JSON.stringify({ title, prompt }));
	' "$title" "$prompt")"
	curl -sS -X POST "${BASE}/api/v1/runs" \
		-H "Authorization: Bearer ${TOKEN}" \
		-H 'content-type: application/json' \
		-d "$body" | node -e '
		const o = JSON.parse(require("fs").readFileSync(0, "utf8"));
		if (!o || !o.run || !o.run.id) process.exit(1);
		process.stdout.write(String(o.run.id));
	'
}

run_state() {
	curl -sS "${BASE}/api/v1/runs/$1" \
		-H "Authorization: Bearer ${TOKEN}" | node -e '
		const o = JSON.parse(require("fs").readFileSync(0, "utf8"));
		if (!o || !o.run) process.exit(1);
		process.stdout.write(String(o.run.state || ""));
	'
}

wait_run_state() {
	local id="$1" want="$2" state="" i
	for i in $(seq 1 75); do
		state="$(run_state "$id" || true)"
		if [ "$state" = "$want" ]; then
			return 0
		fi
		sleep 0.2
	done
	fail "run ${id} did not reach ${want} (last state: ${state:-unknown})"
}

# --- pairing screen -------------------------------------------------------
# Selector contract: #auth holds the pairing/device-token surface, #token is
# the token field (aria-label "Device token"), #saveToken saves it. A later UI
# rework must keep these three handles or update this script and the skill.
if ! ab open "${BASE}/" >/dev/null 2>"$TMP/open.err"; then
	fail "browser could not open ${BASE}/: $(cat "$TMP/open.err")"
fi
OPENED=1
ab set viewport "$VIEWPORT_W" "$VIEWPORT_H" >/dev/null
wait_true "page loaded" 'document.querySelector("#auth #token") !== null'
assert_true "pairing surface is initial state" '(() => {
	const auth = document.querySelector("#auth");
	const token = document.querySelector("#auth #token");
	const save = [...document.querySelectorAll("#auth button")].find((b) => b.id === "saveToken" || b.textContent.trim() === "Save");
	return Boolean(
		auth && auth.offsetWidth > 0 &&
		token && token.offsetWidth > 0 &&
		token.value === "" &&
		token.getAttribute("aria-label") === "Device token" &&
		save && save.offsetWidth > 0
	);
})()'
capture pairing

# --- chat screen ----------------------------------------------------------
ab fill "#token" "$TOKEN" >/dev/null
ab click "#saveToken" >/dev/null
wait_true "stream live" 'document.querySelector("#status").textContent === "live"'
assert_true "token accepted and stream live" '(() => {
	const status = document.querySelector("#status");
	return status.textContent === "live" &&
		status.getAttribute("data-kind") === "live" &&
		localStorage.getItem("zot.token") === document.querySelector("#token").value;
})()'

CHAT_RUN="$(create_run "hello verify" "hello verify")" || fail "could not create chat run"
wait_run_state "$CHAT_RUN" "done"
wait_true "chat completion rendered" 'document.querySelector("#log").textContent.includes("echo[echo]: hello verify")'
assert_true "chat run is done in #log" '(() => {
	const block = [...document.querySelectorAll("#log article")].find((a) => a.textContent.includes("echo[echo]: hello verify"));
	return Boolean(block && block.dataset.state === "done");
})()'
capture chat

# --- approvals screen -----------------------------------------------------
TOOL_RUN="$(create_run "tool approval" "tool: shell echo hi")" || fail "could not create tool run"
wait_run_state "$TOOL_RUN" "waiting_tool"
wait_true "approval row visible" '(() => {
	return [...document.querySelectorAll("#log article")].some((a) => {
		const row = a.querySelector(".approvalRow");
		return a.dataset.state === "waiting_tool" && row && row.offsetWidth > 0;
	});
})()'
assert_true "approval row has Approve and Cancel" '(() => {
	const block = [...document.querySelectorAll("#log article")].find((a) => a.dataset.state === "waiting_tool");
	if (!block) return false;
	const row = block.querySelector(".approvalRow");
	if (!row || row.offsetWidth === 0) return false;
	const buttons = [...row.querySelectorAll("button")].map((b) => b.textContent.trim());
	return buttons.some((t) => t.startsWith("Approve")) && buttons.includes("Cancel");
})()'
capture approvals

# --- activity screen ------------------------------------------------------
ab click "#refreshActivity" >/dev/null
wait_true "activity populated" 'document.querySelectorAll("#activity li button.activityRun").length >= 2'
assert_true "activity rows are titled and count is shown" '(() => {
	const rows = [...document.querySelectorAll("#activity li button.activityRun")].map((b) => b.textContent);
	const count = document.querySelector("#activityCount").textContent;
	return rows.some((t) => t.includes("hello verify")) &&
		rows.some((t) => t.includes("tool approval")) &&
		/\d+ shown/.test(count);
})()'
capture activity

echo "PASS browser screenshots 4/4"
