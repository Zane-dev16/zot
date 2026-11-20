---
name: verify-zot
description: Verify zot daemon plus browser chat for personal automation. HTTP service on 8787 with web UI, api v1, websocket stream. Use for any zot run, approval, activity, pairing, or memory/job change.
---

# Verify zot

Local-first daemon + browser chat. `src/daemon2.js` serves health + web + api on port 8787. No build, no npm install for default path. Node 22+ and curl only.

## Launch

Boot on an isolated port + tmp db so two instances run side by side:

```sh
TMPDIR="$(mktemp -d)"; DB="$TMPDIR/zot.db"; LOG="$TMPDIR/daemon.log"
PORT=18787 ZOT_DB="$DB" node src/daemon2.js >"$LOG" 2>&1 &
echo $! > "$TMPDIR/pid"
```

Ready when health answers (poll up to ~15s, same as `scripts/prove.sh`):

```sh
for _ in $(seq 1 75); do curl -s -f -o /dev/null http://127.0.0.1:18787/healthz && break; sleep 0.2; done
curl -s http://127.0.0.1:18787/healthz
# expect {"state":"ready",...}
```

Teardown: kill the saved PID only, then remove tmpdir. Never `pkill node`:

```sh
kill "$(cat $TMPDIR/pid)" 2>/dev/null || true; wait "$(cat $TMPDIR/pid)" 2>/dev/null || true
cp "$LOG" <evidence-dir>/daemon.log  # before rm
rm -rf "$TMPDIR"
```

Default port 8787 collides; always override `PORT` plus `ZOT_DB` per run. Env is optional otherwise (`PORT`, `ZOT_DB`/`ZOT_DATA_DIR`; live models need `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`, chatops needs `CHATOPS_INBOUND_SECRET`).

## Doctor

One read-only check — is this instance worth driving?

```sh
curl -s http://127.0.0.1:18787/healthz | grep -q '"state":"ready"'
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:18787/api/v1/runs  # expect 401, proves auth gate
test -f web/index.html && test -f web/js/main.js && test -f web/build.json
node scripts/verify-web.mjs   # module graph + build manifest + selector contract
```

If health is not `ready`, stop and read `$LOG`. If `/api/v1/runs` is not 401 without token, the instance is wrong — do not drive it.

## Drive

Plain HTTP is the harness — no Playwright/Cypress in repo. `scripts/prove.sh` is the boot pattern; `scripts/verify-*.js` are offline unit checks (`node scripts/verify-approvals.js`).

Pair once per instance (public routes, rate-limited):

```sh
B=http://127.0.0.1:18787
CODE=$(curl -s -X POST $B/api/v1/pair/start -d '{"label":"verify","kind":"browser"}' -H 'content-type: application/json' | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).code")
TOKEN=$(curl -s -X POST $B/api/v1/pair/confirm -d "{\"code\":\"$CODE\"}" -H 'content-type: application/json' | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).token")
AUTH="Authorization: Bearer $TOKEN"
```

Chat send (offline echo model, no API keys needed — daemon polls every 1s):

```sh
RUN=$(curl -s -X POST $B/api/v1/runs -H "$AUTH" -H 'content-type: application/json' -d '{"title":"hello","prompt":"hello verify"}' | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).run.id")
sleep 3
curl -s $B/api/v1/runs/$RUN -H "$AUTH"  # expect state done
```

Approvals (any prompt starting `tool:` pauses with `waiting_tool`):

```sh
RUN=$(curl -s -X POST $B/api/v1/runs -H "$AUTH" -H 'content-type: application/json' -d '{"title":"tool","prompt":"tool: shell echo hi"}' | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).run.id")
sleep 2
curl -s $B/api/v1/runs/$RUN -H "$AUTH"  # expect waiting_tool
curl -s -X POST $B/api/v1/runs/$RUN/approve -H "$AUTH"  # -> running, then done
curl -s "$B/api/v1/runs/$RUN/events?since=0" -H "$AUTH"  # tool_event with output
```

Browser UI selectors (stable handles, no coordinates). The shell is four views under one topbar; exactly one `section.view` carries `data-active` and the sidebar anchors switch it:

- Shell: `#status` (`live` / `reconnecting N` / `offline` / `auth failed`, `data-kind` mirrors it), `#retryCount`, `#retryNow`, `#daemon`, `#build`, `#variantSwitch` (enabled; `console|ledger|tty`), `#viewTitle` (focus target on route change), `#live` (`aria-live="polite"`, `aria-atomic="false"`; announces connection changes, visible run-state transitions, and load errors — never token text). `#app` carries `data-view`, `data-conn`, `data-variant`, and `data-inspector` (`docked` on Chat/Approvals/Activity, `hidden` on Pairing).
- Navigation: `#navChat`, `#navApprovals` (+ `#approvalsCount` badge, hidden at 0), `#navActivity` (+ `#runsCount`), `#navPairing`; the active view is `#view-chat` / `#view-approvals` / `#view-activity` / `#view-pairing` with `data-active`. The sidebar is one tab stop with a roving tabindex: Up/Down/Left/Right (and Home/End) move focus between views, Enter follows the route and focus lands on `#viewTitle`.
- Chat: `#log article[data-run-id][data-state]` with `.runHead` holding `.runBadge` in a fixed 13ch state column (so `.runTitle` starts at the same x on a `done` row and a `waiting_tool` row), plus `.runMeta`, `.runTokens`, and a `.inspectorOpen` button per run; `.runNeedsApproval` links into Approvals (Chat has no Approve/Cancel buttons); `#composer` with `#box` (aria `Prompt`) and `#send`; `#chatEmpty` and `#chatError` are the explicit empty/loading/error lines.
- Approvals: `#approvals li[data-run-id][data-state]` containing `.approvalTitle`, then `.approvalPrompt` (the run's own `prompt`, first non-empty line, mono, one line, truncated; omitted when the prompt is empty), then `.approvalNote`, then `.approvalRow` with `[data-action="approve"]` / `[data-action="cancel"]` / `.inspectorOpen`; Up/Down move between rows; `#approvalsRefresh`, `#approvalsEmpty` (says `loading runs…` while the first load runs), `#approvalsError`. This view is the only surface that performs a transition, and the prompt line is what the operator is approving — the API carries no tool args.
- Activity: `#activity li[data-run-id]` rows, `button.activityRun` (aria `Show tool events for <title>`) whose `.activityState` sits in a fixed 13ch column and whose `.activityTitle` starts at the same x on every row, `#activityFilter` chips (Left/Right move and activate), `#activityCount` (`N shown`), `#refreshActivity`, `#activityEmpty` (per-filter copy such as `no failed runs`), `#activityError`; Up/Down/Home/End walk the rows. At 1280x800 the 18 newest rows fit above 760px (the harness measures rows 1 through 18 with `getBoundingClientRect`).
- Pairing: `#auth` card with `#pairStart`, `#pairCode`, `#pairExpiry`, `#pairConfirm`, `#pairStatus` (`data-kind` = `idle|requesting|code|confirming|paired|expired|mismatch|no-pending|rate-limited|error`), `#pairRetry`, `#pairNote`, `#pairDone`, `#deviceSummary`, `#pairFallback` (open when no token) holding `#token` (aria `Device token`) + `#saveToken`, `#tokenError`, `#signOut`. One code, two uses: confirming in the browser stores the token in `localStorage["zot.token"]`, and the six digits are also typeable on a phone (self-pair, not a second factor). The token never appears in a URL, query, or hash.
- Inspector: `#inspector` with `#inspectorTitle`, `#inspectorTabs button[data-tab="details"|"events"]` (`role="tab"`, `aria-selected`, Left/Right switch), `#inspectorBody` (`data-state=empty|loading|ready|error`), `.toolEvent[data-tool][data-source]`, `#inspectorClose`, `#inspectorGoApprove`. It is docked only on Chat, Approvals, and Activity; on Pairing nothing can be selected, so `#inspector` is `hidden`, `#app[data-inspector="hidden"]` gives its column back to `#main`, and navigating to any run view restores it (tty collapses to one pane). Opening a row from Chat, Approvals, or Activity selects it; Escape closes the pane and returns focus to the row that opened it.
- State-change flash: a row whose run state changes gets `data-flash="true"` for one 600ms wash, then the attribute clears. `prefers-reduced-motion: reduce` sets `animation: none` on that selector, so reduced-motion users get the state word and announcement without motion.
- `GET /api/v1/runs` lists 100 newest; Activity renders newest 30 with title + state + time and count in `#activityCount`; a stream-only run gets its title from `GET /runs/:id` (POST /runs publishes no `run.created`).

Screenshots — seven real PNGs through a headless browser, no Playwright/npm. Each screen navigates with its `#nav*` handle and asserts its own `data-active` before capturing:

```sh
bash scripts/verify-shots.sh /tmp/zot-shots   # or EVIDENCE_DIR=/tmp/zot-shots
# PASS shot pairing|pairing-code|pairing-confirmed|chat|approvals|activity|inspector (1280x800, N bytes) <path>
```

The harness also asserts keyboard and state behaviour on the way through: arrows move the sidebar focus and Enter follows the route to `#viewTitle`, Pairing hides the inspector and gives its column to `#main` (Chat docks it again), Chat and Activity keep one fixed 13ch state column (`done` and `waiting_tool` rows share a title x; console and tty also share the state box), the approvals row shows `tool: shell echo hi` in mono above its buttons, the `failed` filter shows the explicit `no failed runs` empty state and restores 18+ rows on `all`, the 18-row density budget holds, a run-state change is announced in `#live` without token text, the row flash animates as `stateFlash` and disappears under emulated `prefers-reduced-motion`, and Escape closes the inspector back onto its row.

Screens: `pairing.png` (pairing view before any code: `#pairCode` empty, `#token` empty, `#pairStart` enabled, inspector column reclaimed), `pairing-code.png` (`#pairStart` → six-digit `#pairCode` + `#pairExpiry` countdown, `#pairStatus[data-kind="code"]`), `pairing-confirmed.png` (`#pairConfirm` → `#pairStatus[data-kind="paired"]`, token in localStorage only), `chat.png` (stream live, completion text, and both a `done` row and the `waiting_tool` row so the shared state column is visible; the harness also asserts `#composer`'s bottom edge is within 2px of the `#view-chat` pane bottom with a short thread), `approvals.png` (Approvals view: the `waiting_tool` row with its `.approvalPrompt` line and Approve/Cancel), `activity.png` (Activity view, titled rows in one state column + `N shown`), `inspector.png` (Activity row selected → tool events tab). The harness then clicks `#signOut`, asserts the fallback reopens empty, and re-saves the token the UI just minted through `#token`/`#saveToken` — one token total, two pairing POSTs against the 5-per-minute limit. `ZOT_SHOTS_PAIR_VIA=api` keeps the old curl sequencing as a debugging escape hatch and skips the three pairing screens.

Layout variants (M5): `?variant=console|ledger|tty` on `/` selects the layout, persisted as `localStorage["zot.variant"]`, switchable at runtime through `#variantSwitch` (no reload), and reflected as `#app[data-variant]`. `console` is the default docked three-pane and the shipping layout; `ledger` is a 44px icon rail (labels on hover) with hairline table rows and a slide-over inspector visible only while a run is selected; `tty` is a top tab row with no sidebar, two equal panes, and monospace prose. `ledger` and `tty` stay behind `?variant=` for one release, then they are removed unless a human keeps them. All three expose the identical selector contract above — variants change structure, never handles — and the harness asserts the requested variant plus a runtime flip on every run. The gate covers the default only; produce the matrix on demand (each file is prefixed, so the three dirs compare screen-for-screen):

```sh
bash scripts/verify-shots.sh /tmp/zot-shots-console
ZOT_SHOTS_VARIANT=ledger bash scripts/verify-shots.sh /tmp/zot-shots-ledger
ZOT_SHOTS_VARIANT=tty    bash scripts/verify-shots.sh /tmp/zot-shots-tty
```

`ZOT_SHOTS_VARIANT` appends `?variant=<v>` to the opened URL and prefixes every capture (`ledger-pairing.png`, `ledger-chat.png`, …). Unset means the default console layout with no query and unprefixed files, which is what `scripts/prove.sh` runs. An unknown value fails immediately instead of capturing the wrong layout.

Discovery: `ZOT_BROWSER` (or `ZOT_AGENT_BROWSER`) for the agent-browser CLI, `ZOT_CHROME` for Chrome/Chromium, then PATH and common install paths. No browser prints `SKIP` and exits 2. The script boots its own daemon on `ZOT_SHOTS_PORT` (default 18788) with a tmp db, pairs through the UI (or curl when `ZOT_SHOTS_PAIR_VIA=api`), keeps the token in localStorage/page memory only (never a URL), fixes the viewport at `1280x800`, and writes the seven PNGs above to the evidence dir (tmp path printed when none given). `scripts/prove.sh` runs it; a resolved browser plus a failed assertion fails the gate, otherwise the gate prints `SKIP browser screenshots (...)`.

Screenshot selector contract (single source for the harness): `#auth` holds the pairing entry and keeps `#token` (aria-label `Device token`) + `#saveToken`, with the machine on `#pairStart`/`#pairCode`/`#pairConfirm` and `#pairStatus[data-kind]`; `#log article[data-run-id][data-state]` is the Chat thread, its `.runHead` holds `.runBadge` in the 13ch state column; `.approvalRow` and `.approvalPrompt` live only inside `#approvals li[data-run-id]`; `#activity li button.activityRun` and `#activityCount` (`N shown`) are the Activity ledger, with `.activityState` in the 13ch column; `#inspector .toolEvent` is the tool-event detail and `#app[data-inspector]` says whether the pane is docked; `#composer` is the Chat footer; `[data-flash]` marks a row mid state-change flash. `scripts/verify-web.mjs` asserts this contract offline, so dropping a handle fails the gate before a browser starts. No variant renames or adds a handle: `console`, `ledger`, and `tty` all render this same contract (ledger right-aligns its state word, so the harness requires the title column there and the state box in console/tty). A failure names the screen and the wait/selector that broke, or says `not a usable image` for a missing/wrong-size/undersized PNG; the printed evidence dir keeps the PNGs and `daemon.log`.

## Evidence

Capture action plus resulting state to `<evidence-dir>/` (proof artifacts survive cleanup — copy before `rm -rf $TMPDIR`):

- `health.json` — full `/healthz` body
- `run.json` — `GET /api/v1/runs/:id` showing terminal state (`done`)
- `events.json` — `GET /api/v1/runs/:id/events?since=0` showing side effects
- `daemon.log` — tail of daemon log on failure
- `pairing.png`, `pairing-code.png`, `pairing-confirmed.png`, `chat.png`, `approvals.png`, `activity.png`, `inspector.png` — the browser screens (see Drive)

Verify side effects alongside what is visible: run state `done` AND `tool_event` row / `result_ref` present. A 401 without token and 409 on bad approve→cancel transition are pass criteria, not failures.

## Cleanup

Kill by saved PID, preserve evidence first (see Launch). Confirm evidence still exists after `rm -rf $TMPDIR`:

```sh
ls <evidence-dir>/health.json <evidence-dir>/run.json
```

Isolation: side-by-side safe via distinct `PORT` + `ZOT_DB`. Default `PORT 8787` + `~/.zot/zot.db` collides — never verify against a dev instance you did not boot.
