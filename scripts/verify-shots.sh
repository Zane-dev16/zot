#!/usr/bin/env bash
# Browser screenshot verification for the web UI, using the agent-browser CLI
# that drives a real headless Chrome over CDP. No npm dependency, no Playwright.
#
# One command boots an isolated daemon (temp port + temp db), pairs a browser
# device through the pairing UI, drives the console through its documented
# selectors, and captures seven full-window PNGs into an evidence directory:
#
#   pairing.png           the pairing view before any code is requested (#token empty)
#   pairing-code.png      #pairStart answered: six-digit #pairCode + countdown
#   pairing-confirmed.png #pairConfirm answered: #pairStatus[data-kind="paired"]
#   chat.png              token accepted, stream live, completion text rendered
#   approvals.png         the Approvals view: a waiting_tool run and its Approve/Cancel
#   activity.png          the Activity view: #activity populated with titled run rows
#   inspector.png         selecting an Activity row opens its tool events
#
# Views navigate through #navChat/#navApprovals/#navActivity/#navPairing; each
# screen asserts its own `data-active` before capturing.
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
#   ZOT_SHOTS_PAIR_VIA     ui (default, 2 POSTs) or api (curl escape hatch that
#                          skips the three pairing screens)
#
# Exit codes: 0 all screens passed; 2 browser unavailable (safe to SKIP);
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

# Pairing is driven through the UI by default: two POSTs (#pairStart, then
# #pairConfirm) against the daemon's 5-per-minute limit, leaving three spare.
# ZOT_SHOTS_PAIR_VIA=api keeps the old curl sequencing as an escape hatch for
# debugging this harness when the pairing UI itself is what is broken.
PAIR_VIA="${ZOT_SHOTS_PAIR_VIA:-ui}"
case "$PAIR_VIA" in
ui | api) ;;
*) fail "ZOT_SHOTS_PAIR_VIA must be ui or api (got: $PAIR_VIA)" ;;
esac
TOKEN=""

pair_via_api() {
	local pair_start CODE pair_confirm
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
}

if [ "$PAIR_VIA" = "api" ]; then
	echo "NOTE ZOT_SHOTS_PAIR_VIA=api: pairing screens skipped, token minted by curl"
	pair_via_api
fi

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

# --- pairing screens ------------------------------------------------------
# Selector contract: #auth holds the pairing/device-token surface, #token is
# the token field (aria-label "Device token"), #saveToken saves it, and the
# machine is #pairStart -> #pairCode -> #pairConfirm with every state named on
# #pairStatus[data-kind]. The initial screen is captured before any code is
# requested so it still shows the empty token field, exactly as before.
if ! ab open "${BASE}/#/pairing" >/dev/null 2>"$TMP/open.err"; then
	fail "browser could not open ${BASE}/#/pairing: $(cat "$TMP/open.err")"
fi
OPENED=1
ab set viewport "$VIEWPORT_W" "$VIEWPORT_H" >/dev/null
wait_true "page loaded" 'document.querySelector("#auth #token") !== null'
assert_true "pairing surface is initial state" '(() => {
	const auth = document.querySelector("#auth");
	const token = document.querySelector("#auth #token");
	const save = [...document.querySelectorAll("#auth button")].find((b) => b.id === "saveToken" || b.textContent.trim() === "Save");
	const start = document.querySelector("#pairStart");
	const status = document.querySelector("#pairStatus");
	return Boolean(
		auth && auth.offsetWidth > 0 &&
		token && token.offsetWidth > 0 &&
		token.value === "" &&
		token.getAttribute("aria-label") === "Device token" &&
		save && save.offsetWidth > 0 &&
		start && start.offsetWidth > 0 && !start.disabled &&
		status && status.getAttribute("data-kind") === "idle"
	);
})()'
assert_true "pairing view is active" '(() => {
	const view = document.querySelector("#view-pairing");
	const start = document.querySelector("#pairStart");
	return Boolean(view && view.hasAttribute("data-active") && start && start.offsetWidth > 0);
})()'
capture pairing

storage_value() {
	local key="$1" raw
	if ! raw="$(ab eval --json "localStorage.getItem(\"${key}\")" 2>"$TMP/eval.err")"; then
		fail "could not read localStorage.${key}: $(cat "$TMP/eval.err")"
	fi
	printf '%s' "$raw" | node -e '
		const o = JSON.parse(require("fs").readFileSync(0, "utf8"));
		if (!o.success) {
			console.error(o.error || "eval failed");
			process.exit(1);
		}
		const r = o.data ? o.data.result : null;
		process.stdout.write(r == null ? "" : String(r));
	' || fail "localStorage.${key} was not readable as a string"
}

if [ "$PAIR_VIA" = "ui" ]; then
	# --- pairing-code screen ---------------------------------------------
	ab click "#pairStart" >/dev/null
	wait_true "pairing code issued" '/^\d{6}$/.test(document.querySelector("#pairCode").textContent) && document.querySelector("#pairStatus").getAttribute("data-kind") === "code"'
	assert_true "pairing code is six digits with a countdown" '(() => {
		const code = document.querySelector("#pairCode");
		const expiry = document.querySelector("#pairExpiry");
		const confirm = document.querySelector("#pairConfirm");
		const status = document.querySelector("#pairStatus");
		return Boolean(
			code.dataset.kind === "code" &&
			/^\d{6}$/.test(code.textContent) &&
			/^expires in \d+:\d{2}$/.test(expiry.textContent) &&
			confirm && !confirm.disabled &&
			status.textContent.includes("expires in")
		);
	})()'
	capture pairing-code

	# --- pairing-confirmed screen ----------------------------------------
	ab click "#pairConfirm" >/dev/null
	wait_true "pairing confirmed" 'document.querySelector("#pairStatus").getAttribute("data-kind") === "paired"'
	assert_true "paired state saved the token out of the URL" '(() => {
		const kind = document.querySelector("#pairStatus").getAttribute("data-kind");
		const summary = document.querySelector("#deviceSummary").textContent;
		const token = localStorage.getItem("zot.token");
		return Boolean(
			kind === "paired" &&
			typeof token === "string" && token.length > 0 &&
			summary.includes("browser") &&
			!location.href.includes(token) &&
			document.querySelector("#pairCode").dataset.kind === "empty"
		);
	})()'
	capture pairing-confirmed
	TOKEN="$(storage_value "zot.token")"
	[ -n "$TOKEN" ] || fail "the UI pairing saved no token in localStorage"

	# --- paste fallback, driven with the token the UI just minted --------
	# Proves the manual path and keeps one token total: sign out clears it,
	# the fallback reopens empty, and saving the same token reconnects.
	ab click "#signOut" >/dev/null
	wait_true "sign out clears the token" 'localStorage.getItem("zot.token") === null && document.querySelector("#pairStatus").getAttribute("data-kind") === "idle"'
	assert_true "paste fallback reopens after sign out" '(() => {
		const fallback = document.querySelector("#pairFallback");
		const token = document.querySelector("#token");
		return Boolean(fallback && fallback.open && token && token.value === "" && token.offsetWidth > 0);
	})()'
else
	echo "NOTE pairing-code/pairing-confirmed screens skipped (ZOT_SHOTS_PAIR_VIA=api)"
fi

ab fill "#token" "$TOKEN" >/dev/null
ab click "#saveToken" >/dev/null

# --- chat screen ----------------------------------------------------------
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
assert_true "chat view is active" '(() => {
	const view = document.querySelector("#view-chat");
	return Boolean(view && view.hasAttribute("data-active"));
})()'
capture chat

# --- approvals screen -----------------------------------------------------
# Approvals are their own view: Chat and the Inspector never perform a run
# transition (ADR-3), so the row lives in #view-approvals and the harness has to
# navigate there before asserting. The run id is exported onto window so the
# selector can interpolate it without shell-quoting a template literal.
TOOL_RUN="$(create_run "tool approval" "tool: shell echo hi")" || fail "could not create tool run"
wait_run_state "$TOOL_RUN" "waiting_tool"
ab eval "window.__zotToolRun = '${TOOL_RUN}'" >/dev/null
ab click "#navApprovals" >/dev/null
wait_true "approvals view active" 'document.querySelector("#view-approvals[data-active]") !== null'
wait_true "approval row visible" '(() => {
	const item = document.querySelector(`#approvals [data-run-id="${window.__zotToolRun}"]`);
	if (!item) return false;
	const row = item.querySelector(".approvalRow");
	return item.dataset.state === "waiting_tool" && Boolean(row) && row.offsetWidth > 0;
})()'
assert_true "approval row has Approve and Cancel" '(() => {
	const item = document.querySelector(`#approvals [data-run-id="${window.__zotToolRun}"]`);
	if (!item) return false;
	const row = item.querySelector(".approvalRow");
	if (!row || row.offsetWidth === 0) return false;
	const buttons = [...row.querySelectorAll("button")].map((b) => b.textContent.trim());
	return buttons.some((t) => t.startsWith("Approve")) && buttons.includes("Cancel");
})()'
capture approvals

# --- activity screen ------------------------------------------------------
ab click "#navActivity" >/dev/null
wait_true "activity view active" 'document.querySelector("#view-activity[data-active]") !== null'
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

# --- inspector screen -----------------------------------------------------
# The newest Activity row is the waiting_tool run, so it already has a live
# tool.request event; opening it must show the events tab with that tool.
ab click "#activity li button.activityRun" >/dev/null
wait_true "inspector shows tool events" 'document.querySelector("#inspector .toolEvent") !== null'
assert_true "inspector is the selected run on the events tab" '(() => {
	const title = document.querySelector("#inspectorTitle");
	const tab = document.querySelector("#inspectorTabs button[data-tab='events']");
	const row = document.querySelector("#inspector .toolEvent[data-tool]");
	return Boolean(
		title && title.textContent.includes("tool approval") &&
		tab && tab.getAttribute("aria-selected") === "true" &&
		row && row.dataset.tool
	);
})()'
capture inspector

if [ "$PAIR_VIA" = "ui" ]; then
	echo "PASS browser screenshots 7/7"
else
	echo "PASS browser screenshots 5/5 (pairing screens skipped: ZOT_SHOTS_PAIR_VIA=api)"
fi
