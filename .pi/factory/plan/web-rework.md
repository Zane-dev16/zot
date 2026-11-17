# Plan: zot web operator console (web UI/UX rework)

- Task: `web-rework`. Lane `/root/zot/.pi/factory/worktrees/web-rework`, branch `factory/web-rework`.
- Planner mode: plan only. No `src/` change, no API change, no code in this commit.
- Date: 2026-11-17. Written against base `295ffc5` (lane clean).
- This file is the deliverable. Builders stay refused until it exists at this exact path.
- Decisions already made by the human and not re-litigated here: operator-console visual family;
  sidebar + main thread + right inspector with four views (Chat, Approvals, Activity, Pairing);
  in-browser pairing plus manual device-token paste, on the existing public endpoints; a build
  step was permitted and is settled in §6.

## 0. Baseline facts this plan is built on (measured, not recalled)

Verified by reading the tree at `295ffc5` and running the gate pieces by hand:

- **Screenshots work today.** `bash scripts/verify-shots.sh /tmp/zot-shots-baseline` → `PASS shot
  pairing|chat|approvals|activity (1280x800)` and `PASS browser screenshots 4/4` on this host
  (agent-browser 0.26.0 + chromium 1208 both resolve). The upstream `prove.sh` browser block will
  therefore **run, not SKIP** in this lane, so any UI change must land with its harness update in
  the same commit.
- **`POST /api/v1/runs` publishes nothing to the stream.** `src/api.js` has no `publish` calls at
  all; only the runner and scheduler publish. Interactive runs reach the browser first as
  `run.state` with `{runId, state}` — **no title**. That is the mechanical cause of the
  "raw UUID as run title" defect, not a rendering slip. `run.created` (with `title`) is only
  published by the scheduler path (`src/runner.js:258`).
- **Heartbeat frames have no `seq`.** `src/stream.js:218` broadcasts
  `{id: "hb-"+Date.now(), type: "daemon.heartbeat"}`. The current client persists that `id` as
  `zot.since`, and `events2.replayEvents` then parses `String(sinceId).split("-").pop()` into a
  huge number and replays nothing. Silent lost replay after any reload that followed a heartbeat.
- **The pairing store is one in-memory slot per handler** (`pending` in `createHandler`). A second
  `pair/start` overwrites the first code. `pair/confirm` returns the token *to whoever confirms*,
  so (a) in-browser pairing is a self-pair, and (b) a code displayed in the browser is still valid
  input for a phone calling `pair/confirm` with it — same endpoints, no server change.
- **Rate limit is 5 pairing POSTs per 60 s**, counted on every `pair/start` *and* `pair/confirm`
  (`src/auth.js:8,136`, `pairLimited` at `src/api.js:155`). 429 body is `{"error":"rate limited"}`.
  Code TTL is 5 minutes (`PAIR_CODE_EXPIRY_MS`), 6 digits (`padStart(6,"0")`).
- **Exact payloads the client may consume** (`src/api.js`):
  - `GET /healthz` → `{version, state, startedAt, uptimeMs}`, public.
  - `POST /api/v1/pair/start` `{label, kind}` → 200 `{code, expiresAt}`; 400 `{error}`; 429.
  - `POST /api/v1/pair/confirm` `{code}` → 201 `{token, device{id,label,kind,createdAt,lastSeenAt,revokedAt}}`;
    400 `no pending pairing` / `pair code expired` / `pair code mismatch`; 429.
  - `GET /api/v1/runs` → `{runs: [...]}` ordered `created_at DESC` LIMIT 100.
  - `POST /api/v1/runs` `{title, prompt}` (both required, else 400) → 201 `{run}`.
  - `GET /api/v1/runs/:id` → `{run}`; 404 `{error:"not found"}`.
  - `POST /api/v1/runs/:id/approve|cancel` → 200 `{run}`; 409 `{error:"bad run transition"}`; 404.
  - `GET /api/v1/runs/:id/events[?since=N]` → `{events:[{id, run_id, tool, args_hash, result_ref,
    created_at}]}` — **snake_case rows**, id-ordered, LIMIT 200.
  - Run object fields (`mapRun`): `id, title, prompt, state, model?, attempt, createdAt, updatedAt,
    finishedAt, lastHeartbeat, ownerDeviceId`. `model` is dropped by JSON when the column is absent
    → treat as optional. States and transitions come from `src/runs.js`:
    `queued → {running, cancelled}`, `running → {waiting_tool, done, failed, cancelled}`,
    `waiting_tool → {running, failed, cancelled}`, terminal = `done|failed|cancelled`.
    **`approve` also accepts `queued → running`**, so Approvals must list `queued` too.
  - Stream frames: `{id, seq, type, at, ...}` for `run.created{runId,title}`, `run.state{runId,state}`,
    `run.token{runId,token}`, `tool.request{runId,tool}`, `tool.result{runId,tool,ok}`,
    `run.done{runId,state}`; `daemon.heartbeat{id,at}` has no `seq`. Replay limit 200, and a freshly
    booted daemon replays from `stream_event` in sqlite ignoring `since` (`events2.replayEvents`),
    so dedupe must be per-frame, not per-connect.
- **`serveWeb()` already serves subdirectories** with `path.join` + `startsWith(webDir)` +
  MIME-by-extension, and strips the query string before resolving. So `web/js/main.js` and
  `?variant=…` work with **zero `src/` change**. MIME map is
  `.html .js .css .json .svg .png .ico` only — **no `.woff2`, `.ts`, `.mjs`, `.map`**. Fonts stay
  system stacks; any new extension would need a `serveWeb` edit, which is out of scope (§13).

## 1. Design thesis

zot's browser surface is an **operator console**, not a chat toy: a three-pane cockpit whose whole
job is to answer "is the daemon healthy, what is running, what is blocked on me" in under five
seconds. Density is the feature. At 1280×800 the operator should read ≥18 runs without scrolling,
see every non-terminal state at a glance from a color-coded chip *plus* its word, and reach a
pending approval in two keystrokes because `waiting_tool` is the only state that costs real time.
State color is used the way a flight deck uses it: hue carries severity (`queued` grey, `running`
blue, `waiting_tool` amber, `done` green, `failed` red, `cancelled` dim), and text always repeats
the word so color is never the only channel. Monospace is reserved for machine facts — run ids,
timestamps, tokens, tool names, codes — and prose stays in the UI sans, which is what makes a dense
screen scannable instead of noisy. Five seconds after load: topbar says `live` and daemon `ready`;
the sidebar shows an approval count badge; if that badge is non-zero, one click lands on Approvals
with the blocking row already at the top. The inspector never hides information behind navigation:
anything you select in Chat, Approvals, or Activity opens there, read-only, with tool events one tab
away.

## 2. Decision log (inline ADRs)

- **ADR-1 (build): no bundler, no npm, no committed bundle.** The client becomes native ES modules
  under `web/js/`, and the "build" is a pure-Node script that validates the module graph and writes
  a committed `web/build.json` manifest whose `sourceHash` the gate re-derives. Full reasoning and
  the named trigger for adopting esbuild later in §6.
- **ADR-2 (selector invariance):** the harness contract is expressed only as ids, `data-*`
  attributes, and the few existing class names. **All three variants expose identical selectors**;
  they differ in layout, type scale, and row structure only. So one screenshot script covers every
  variant, and the human compares like with like.
- **ADR-3 (one owner per action):** the Approvals view is the only surface with approve/cancel
  buttons. Chat and Inspector are read-only about transitions and link to Approvals. Prevents three
  divergent copies of the same `POST` and one approval row per view.
- **ADR-4 (pairing honesty):** the pairing view is a self-pair with a UX that mirrors the phone
  flow. Copy says so. The displayed code is also legitimately typeable on another device, but the
  surface never claims a second factor, and it never puts a token or code in a URL, query, or hash.
- **ADR-5 (single store):** one reducer owns every byte of client state; the renderer is the only
  module that writes DOM; REST and WS both dispatch into the same reducer. No component-local
  mutable state beyond a keyed node cache.
- **ADR-6 (touch surface):** this rework edits `web/**`, `scripts/**`, `docs/**`, `.pi/skills/**`
  only. `src/**` is untouched, so "API routes, payloads, and data model stay byte-identical" is
  enforced by the diff, not by review vigilance.

## 3. Glossary deltas (apply when `GLOSSARY.md` is created; it does not exist yet)

M0 creates `docs/GLOSSARY.md` with these terms, one line each:

- **Run** — one `agent_run` row: `id, title, prompt, state, attempt, createdAt, updatedAt,
  finishedAt, lastHeartbeat, ownerDeviceId, model?`. The unit every view lists.
- **View** — one of the four navigable surfaces: `chat`, `approvals`, `activity`, `pairing`.
  Persisted in the URL hash as `#/<view>` and in the store as `ui.view`.
- **Thread** — the Chat view's chronological stack of the newest 12 runs, oldest at top. Not a
  conversation store: zot has no multi-turn thread object, and this rework does not invent one.
- **Inspector** — the right pane. Read-only detail for one selected run, two tabs (Details,
  Events). Never mutates a run.
- **Approval** — the transition out of `waiting_tool` (approve → `running`, cancel → `cancelled`),
  also offered for `queued` (approve → `running`). Only the Approvals view performs it.
- **Pairing** — minting a device session. Three-step: start (code), display, confirm (token). The
  code comes back to the caller, so a browser pairing with itself is a self-pair.
- **Device token** — the bearer string stored in `localStorage["zot.token"]`. Never in a URL.
- **Variant** — one of `console | ledger | tty`, selected by `?variant=`, default `console`.
- **Build manifest** — `web/build.json`: module list, per-file digests, one `sourceHash`. The
  committed artifact the gate proves (§6).
- **Operator console** — this visual family: dense dark chrome, mono for machine facts, state
  always labeled and color-coded, selected detail always visible in the inspector.

## 4. Layout spec

Shell grid at the gate viewport (1280×800): `grid-template-columns: 208px minmax(0,1fr) 380px`,
`grid-template-rows: 40px 1fr`. Rows are 28px, `--fs-xs: 11px`, `--fs-sm: 12.5px`,
`--fs-code: 12px`, hairlines `1px solid var(--line)`. Surfaces: `--bg #0a0c10`, `--panel #0e1116`,
`--panel-2 #131922`, `--line #20262e`, `--text #d6dbe3`, `--muted #8b95a3`. State palette (each
paired with a word, never color-only): `queued #8b95a3`, `running #4c8dff`, `waiting_tool #d29922`,
`done #3fb950`, `failed #f85149`, `cancelled #6e7681`. All text tokens ≥4.5:1 on their surface.
Type stack: `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` for `--mono`;
`system-ui, -apple-system, Segoe UI, Roboto, sans-serif` for prose. No webfonts (MIME map).

Narrow fallbacks: ≤1100px inspector becomes an overlay drawer; ≤760px sidebar becomes a horizontal
tab row, inspector becomes a full-screen sheet. The 1280×800 gate is untouched by both.

`#app` carries `data-view`, `data-conn`, `data-variant` — every layout/size variant keys off those
three attributes, so no variant JS needs to touch the reshape logic.

### 4.1 Shell (present on all four views)

- `header#topbar` — `#brand` (`zot · operator console`), `#status` (the existing connection chip:
  text `connecting|live|reconnecting N|offline|auth failed`, `data-kind` one of
  `connecting|live|reconnecting|offline|auth`), `#retryCount`, `#retryNow`, then right-aligned
  machine facts: `#daemon` (`ready · v0.0.1 · 12s`, `data-kind=ready|starting|unknown|unreachable`,
  from `GET /healthz` polled every 15 s and on every reconnect), `#build` (`build 8f3a1c7`, from
  `/build.json`, `data-kind=fresh|unknown`), and `#variantSwitch` (`<select aria-label="Layout
  variant">` with `console|ledger|tty`, so a human can flip without editing URLs).
- `nav#sidebar` — `a[data-view]` for each of the four views with stable ids `#navChat`,
  `#navApprovals`, `#navActivity`, `#navPairing`; `aria-current="page"` on the active one.
  `#approvalsCount` badge on Approvals (hidden at 0), `#runsCount` total next to Activity.
- `main#main` — four `section.view`, exactly one carrying `data-active`: `#view-chat`,
  `#view-approvals`, `#view-activity`, `#view-pairing`. `#viewTitle` is the `<h1>` of whichever is
  active; focus moves there on view change (a11y).
- `aside#inspector` — `#inspectorTitle`, `#inspectorTabs button[data-tab="details"|"events"]`
  (`aria-selected`), `#inspectorBody`, `#inspectorClose`, and `#inspector` `[data-collapsed]` rail
  state (persisted in `ui.inspectorOpen`). Empty state: "select a run".
- `div#live` — `sr-only`, `aria-live="polite"`, `aria-atomic="false"`. **Only** state changes and
  errors announce here. The token stream never does (it would flood a screen reader).

### 4.2 Chat (`#view-chat`) — the thread

`#log` (kept id, `role="log"`) holds the newest 12 runs oldest→newest as
`article[data-run-id][data-state]`:

- `.runTitle` — real title; derivation is `title` if present, else `format.titleFallback(run)`
  (`prompt` first line, 60 chars), else `run · <id[0..8]>`. A bare UUID is never the only label.
- `.runBadge` — state word, `data-state`, colored per palette.
- `.runMeta` — `attempt N · updated 12s ago · <id[0..8]>` (mono for the id and time).
- `.runTokens` — `pre-wrap` streamed text, appended in place (one text node per run).
- `.runToolNote` — `waiting on shell`, or last `tool.result` line.
- `.runNeedsApproval` — only when approvable: `needs approval · open` button that routes to
  Approvals with that run selected (ADR-3; Chat grows no approval buttons).
- Footer: `#composer` with `#box` (`aria-label="Prompt"`, `autocomplete=off`) and `#send`;
  `#composerHint` for `sending…`, `queued · waiting`, `auth required`. Submitting posts
  `{title: firstLine(prompt).slice(0,60), prompt}` and merges the returned `{run}` into the store.
- Above the thread: `#chatOlder` link "older runs live in Activity".

### 4.3 Approvals (`#view-approvals`) — the attention queue

`#approvals` (`role="list"`), one `li[data-run-id][data-state]` per run whose state is `queued` or
`waiting_tool`, `updatedAt` desc (blocking work sorts itself to the top within one poll/event).

- Row: title, short id (mono), state badge, `waiting on <tool>` when set, `updated 12s ago`.
- `.approvalRow` with `button[data-action="approve"]` (`Approve` / `Approve <tool>`) and
  `button[data-action="cancel"]` (`Cancel`). Buttons disable on click, re-enable on settle;
  on 200 merge returned `{run}`; on 409 re-fetch `GET /runs/:id` and show "state changed — reloaded";
  on 401 escalate to `auth.rejected`.
- `#approvalsCount` (`N pending`), `#approvalsRefresh`, `#approvalsEmpty` ("nothing is waiting on
  you"), `#approvalsError` (`role="alert"`, cleared by any successful load).

### 4.4 Activity (`#view-activity`) — the ledger

`#activity` as a dense table-like list, newest 30 by `createdAt` desc:
`li[data-run-id][data-state]` containing `button.activityRun` (kept class, kept aria-label
`Show tool events for <title>`) whose text is `<state> · <title> · <short id> · attempt N · <updated>`.
`#activityFilter` chips `[data-filter="all|waiting_tool|running|failed|done"]` (client-side filter of
the same list; `all` default, so the gate assertion sees every row). `#activityCount` keeps its exact
`N shown` format. `#refreshActivity` re-fetches. `#activityEmpty`, `#activityError` as in 4.3.
Row click selects in the inspector (no inline expansion — tool events live in exactly one place).

### 4.5 Pairing (`#view-pairing`) — one code, two uses

`#auth` is the card and it **keeps containing `#token` + `#saveToken`** (screenshot contract):

- `#pairStart` — "Pair this browser".
- `#pairCode` — the 6 digits, large mono, letter-spaced, `data-kind=empty|code`. Empty until start.
- `#pairExpiry` — `expires in 4:37` countdown from the server's `expiresAt`.
- `#pairConfirm` — "Confirm in this browser".
- `#pairStatus` — `aria-live="assertive"`, `data-kind=idle|requesting|code|confirming|paired|
  expired|mismatch|no-pending|rate-limited|error`, human sentence per state (§5).
- `#pairNote` — one line: "This pairs the browser with the local daemon. The code comes back to
  this page, so it is a self-pair, not a second factor." (§5, ADR-4)
- `#deviceSummary` — after a successful confirm: `paired · browser · just now` from the 201
  `device` object. After reload, only `a device token is saved` (there is no `/devices` in the
  allowed endpoint set, so the console does not pretend to know more).
- `#pairFallback` — `<details>`, **open by default when no token is stored** (so the initial
  screenshot still shows the token field), summary "Enter a device token manually", containing
  `#token` (`type=password`, `aria-label="Device token"`, `autocomplete=off`, `spellcheck=false`)
  and `#saveToken` (`Save`), plus `#tokenError` (`role="alert"`).
- `#signOut` — clears `zot.token` + `zot.since`, `auth.none`, routes back to pairing. No revoke call
  (not in the allowed set; §13).

### 4.6 Inspector (`#inspector`) — details / tool events

Opens on row click in Chat, Approvals, or Activity; also `#inspectorOpen` in each row's actions.
Tab `events` (default when the run has tool events) lists `.toolEvent[data-tool][data-source]` rows:
tool name (mono), `result_ref` (mono, truncated) or `args_hash[0..8]`, relative time. Seeded live
from `tool.request`/`tool.result` WS frames and reconciled on open from
`GET /runs/:id/events?since=0` (snake_case rows → normalise in `api.js`). Tab `details` shows every
run field plus the full `prompt` (`pre-wrap`), and `#inspectorGoApprove` when approvable. Escape
closes and returns focus to the originating row. Empty/loading/error states are explicit, never a
blank pane.

### 4.7 Selector contract (this table is the screenshot contract)

| Selector | Surface | Meaning | Used by harness |
| --- | --- | --- | --- |
| `#app` + `[data-view]`/`[data-conn]`/`[data-variant]` | shell | view/connection/variant switch | nav + state asserts |
| `#status`, `#retryCount`, `#retryNow` | topbar | connection chip (text + `data-kind`) | **existing, unchanged** |
| `#daemon`, `#build`, `#variantSwitch` | topbar | healthz facts, build id, variant | new |
| `#navChat` `#navApprovals` `#navActivity` `#navPairing` | sidebar | view switches | new |
| `#approvalsCount` | sidebar | pending badge | new |
| `#view-chat` `#view-approvals` `#view-activity` `#view-pairing` | main | active view (`data-active`) | new |
| `#log`, `article[data-run-id][data-state]`, `.runTitle`, `.runTokens` | chat | thread | **existing `#log` + `article[data-state]`** |
| `#composer`, `#box` (aria `Prompt`), `#send` | chat | composer | **existing** |
| `#approvals`, `li[data-run-id]`, `.approvalRow`, `[data-action="approve"]`, `[data-action="cancel"]` | approvals | action queue | replaces `.approvalRow`-in-`#log` |
| `#approvalsEmpty`, `#approvalsError`, `#approvalsRefresh` | approvals | states | new |
| `#activity`, `li[data-run-id]`, `button.activityRun`, `#activityCount`, `#refreshActivity`, `#activityError` | activity | ledger | **existing `#activity`, `.activityRun`, `#activityCount`, `#refreshActivity`, `#activityError`** |
| `#activityFilter`, `#activityEmpty` | activity | filter + empty | new |
| `#auth`, `#token` (aria `Device token`), `#saveToken` | pairing | auth card + paste fallback | **existing, unchanged** |
| `#pairStart`, `#pairCode`, `#pairExpiry`, `#pairConfirm`, `#pairStatus`, `#pairNote`, `#deviceSummary`, `#pairFallback`, `#tokenError`, `#signOut` | pairing | pairing machine | new |
| `#inspector`, `#inspectorTitle`, `#inspectorTabs`, `#inspectorBody`, `#inspectorClose`, `.toolEvent` | inspector | selection detail | new |
| `#live` | shell | polite announcements | new |

Rule: **no selector is renamed by a variant.** `#log` stays the Chat thread, `#activity` stays the
Activity list, `#auth` keeps `#token`/`#saveToken`, `#status` keeps its exact `live` string. Anything
in the "existing" rows above is a hard constraint on M0; M2 is the only milestone allowed to move
`.approvalRow` out of `#log article` (and it updates `scripts/verify-shots.sh` +
`.pi/skills/verify-zot/SKILL.md` in that same commit).

## 5. Pairing flow spec

State machine (`store.pairing`, one machine, no ad-hoc DOM writes):

```text
idle ──pairStart──▶ requesting ──200──▶ code ──pairConfirm──▶ confirming ──201──▶ paired
  ▲                    │ 400/429/network                                                │
  │                    ▼                                                                │
  │                  error / rate-limited                                               │
  code ──expiresAt passed (tick 1s, and any 400 "pair code expired")──▶ expired ─start─┘
  confirming ──400 "pair code mismatch"──▶ mismatch ─start─┐
  confirming ──400 "no pending pairing"──▶ no-pending ─start┘
  code|mismatch|no-pending|expired|paired ──signOut──▶ idle (token cleared)
  any ──401 from a run call while paired──▶ auth.rejected (pairing view, #tokenError)
```

Copy per state (exact strings, so the harness can assert `data-kind`, humans get the cause):

- `idle`: "Pair this browser" + `#pairNote` (§4.5).
- `requesting`: "asking the daemon for a code…" (Start disabled).
- `code`: "code <123456> · expires in 4:37"; Start disabled, Confirm enabled.
- `confirming`: "confirming…" (both buttons disabled).
- `paired`: "paired · browser · token saved" → `auth.hasToken`, connect stream, `#view` stays on
  pairing with `#pairDone` ("go to chat") so the human reads the success.
- `expired`: "that code expired (5 minutes). Start again." Confirm disabled.
- `mismatch`: "another pairing replaced this code — the daemon only keeps one pending code. Start
  again." (Real case: a phone called `pair/start` after this page.)
- `no-pending`: "the daemon has no pending pairing (restarted, or someone already confirmed).
  Start again."
- `rate-limited`: "too many pairing attempts (5 per minute). Wait Ns." Start disabled with a local
  countdown; the daemon sends no `Retry-After`, so the client tracks its own POST timestamps and
  names the wait honestly.
- `error`: "could not reach the daemon" + Retry.

Implementation notes:

- `pair/start` body is `{label: "browser", kind: "browser"}` (the allowlist has exactly
  `"browser" | "ios"`). `pair/confirm` body is `{code}` from store; the code is **not** a typed
  input in the self-pair path, so an operator cannot fat-finger a mismatch.
- On 201, persist `localStorage["zot.token"] = token`; the **token is never rendered, logged, put in
  the URL, query, or hash**. `#deviceSummary` shows `label`/`kind` only.
- The displayed code is honest about being typeable elsewhere: if a phone holds a token minted by
  confirming this code, this page's `#pairConfirm` then answers `no-pending` — handled, not hidden.
- Paste fallback: save trims whitespace, connects, and verifies by WS open + first REST call. A 401
  sets `auth.rejected` and `#tokenError` = "the daemon rejected that token"; the stored token is
  **not** silently cleared (`#signOut` is the explicit clear), because an operator may want to see
  what was pasted.
- First load with no token routes to `#/pairing`. First load with a token opens `#/chat` and
  verifies in the background; 401 routes to pairing with the error surfaced.

## 6. Build-step decision

### 6.1 Options considered

| # | Option | Artifact | Edit-time tool | Gate-time network | Failure classes it introduces |
| --- | --- | --- | --- | --- | --- |
| A | Native ES modules, no bundler, pure-Node build manifest | `web/build.json` (committed) | none (browser + node) | none | stale manifest (caught by hash) |
| B | esbuild bundle, committed `web/dist/app.js` | dist bundle + map | esbuild binary (`npx`/PATH) | none at gate (hash check) | stale bundle, binary absent in a fresh lane, generated code in git |
| C | esbuild bundle built at boot by `daemon2.js` | none on disk | esbuild at **runtime** | none | breaks the "no install, one command" promise |

### 6.2 Decision: A — native ES modules, no bundler, manifest as the artifact

Rationale, in priority order:

1. **The repo's promise is zero install.** `node src/daemon2.js` is the whole product story, and
   `prove.sh` runs on a host with no `node_modules`. Option B makes editing the UI require a
   binary that a fresh lane may not have; option C breaks the promise outright. A needs nothing
   beyond `node`, which the gate already requires — so **the "missing build tool" failure mode does
   not exist** rather than being SKIPped (§6.4).
2. **Modularity is the actual benefit of a build here, and ESM delivers it for free.** The win is
   not minification (localhost, ~30 KB) or tree-shaking (no deps); it is 12 small modules with real
   names instead of one 2000-line `app.js`. `serveWeb` already serves subdirectories and `.js` with
   `text/javascript`.
3. **No generated code in git.** A committed bundle is unreadable in review and drifts from sources
   by default. A committed *manifest* is 20 lines of hashes and cannot drift silently, because the
   gate recomputes it.
4. **A build that produces nothing but truth is still a build.** `build.json` is a real artifact:
   it proves the module graph is closed, gives the topbar a build id, and fails the commit when
   sources and artifact disagree.

Costs, stated plainly: no TypeScript, no JSX, no minification, one HTTP request per module
(~12 on localhost), and DOM code written by hand with a small `h()` helper. That is accepted.

### 6.3 The build and its proof (three small files, no dependencies)

- `scripts/lib/webbuild.mjs` — exported `scanWeb()` and `computeSourceHash()`: walks
  `web/index.html`, `web/js/**/*.js`, `web/css/**/*.css`; extracts every `import … from "x"`,
  `export … from "x"`, and dynamic `import("x")` specifier with a narrow regex over module text
  (no AST, no dependency); each specifier must start with `./` or `../`, must resolve to an existing
  file inside `web/`, and every module must be reachable from `web/js/main.js`. **Bare specifiers
  are an error** (nothing may ever need `node_modules`). `sourceHash` = sha256 over the sorted
  `relpath \0 sha256(content)` lines of every scanned file, so it is path- and content-derived and
  identical on any clone.
- `scripts/build-web.mjs` — writes `web/build.json`:
  `{"version":1,"moduleCount":N,"sourceHash":"…","files":{"js/main.js":"sha256:…",…},"builtAt":"<iso>"}`
  and prints `PASS build web (N modules, sourceHash <12 chars>)`. `builtAt` is deliberately excluded
  from `sourceHash`.
- `scripts/verify-web.mjs` — the gate: imports `webbuild.mjs` (single source of truth), then proves
  five things, each with its own failure line:
  1. every `web/js/**/*.js` parses as an ES module, via
     `node --input-type=module --check < <file>` (verified working on the repo's Node 26.7.0;
     plain `node --check file.js` **fails** here because `package.json` says
     `"type": "commonjs"` — the module-type check is the only correct form). A non-zero exit fails;
     an unsupported flag fails loudly, never skips;
  2. import graph closed, relative-only, all modules reachable from `main.js`;
  3. `web/build.json` exists and `sourceHash` matches the recomputed value → otherwise
     `FAIL web build manifest is stale (web/js/views/pairing.js); run node scripts/build-web.mjs`;
  4. **selector contract present**: every id/class in §4.7's harness column appears in the sources,
     so a refactor that drops a harness handle fails offline, before any browser runs;
  5. no external URLs in `web/**` (`https?://` in `href|src|url(`) — the console must load with the
     network off.
- `scripts/prove.sh`: replace the three `test -f web/…` lines with `node scripts/verify-web.mjs`.
  One line, same gate, strictly stronger (existence → parse + graph + freshness + contract).

### 6.4 Absent or stale build — exact behaviour

- **Manifest absent at runtime**: the daemon still boots and still serves the app (no boot
  dependency); `/build.json` 404s; `#build` renders `build unknown` with `data-kind=unknown`; the
  gate **fails**. No silent pass, no SKIP.
- **Manifest stale**: same runtime behaviour (`build unknown`), gate fails naming the changed file
  and the one command to run.
- **Sources broken (parse/import)**: runtime shows a blank view and a console error; gate fails at
  step 1 or 2 with the file and the specifier.
- **Build tool absent**: cannot happen — the tool is `node`. If `node` is absent, `prove.sh` cannot
  run at all. There is deliberately **no SKIP branch** for the web build, unlike the browser
  screenshots, whose SKIP is honest because `verify-shots.sh` names exactly what is missing and
  exits 2.
- **Gate honesty, both directions:** a missing manifest/broken module fails; and a *resolved*
  browser that misses an assertion in `verify-shots.sh` still exits 1 and fails `prove.sh` exactly
  as today (`SHOTS_RC` handling is unchanged).

### 6.5 ES module + MIME constraints (no `src/` change)

`text/javascript; charset=utf-8` is already mapped for `.js`, subpaths already resolve, and the
query string is already stripped, so `<script type="module" src="/js/main.js">` and
`?variant=ledger` both work today. Assets stay within `.html .js .css .json .svg .png .ico`. No
`.mjs` (served as `application/octet-stream`, would be refused), no source maps, no `@font-face`
files (browser requires a font MIME — system stacks only), `web/favicon.svg` added so
`/favicon.ico` stops 404ing.

### 6.6 Pre-committed trigger to adopt esbuild (so nobody re-litigates)

Adopt option B **only if** one of these becomes true: (a) client source exceeds ~3000 lines,
(b) the state model needs static types to stay correct, (c) a view genuinely needs JSX. The B plan
is already sketched: dev-only `esbuild` via `ZOT_ESBUILD` → PATH → `npx --no-install`, output
committed to `web/dist/app.js`, gate = parse + freshness hash + selector contract (identical
shape to §6.3), and `esbuild` absent at edit time is a hard failure with the install line printed.
Until then, A.

## 7. Client state model

### 7.1 Store shape (one reducer, one subscription)

```js
state = {
  ui:      { view, variant, selectedRunId, inspectorOpen, inspectorTab, chatCap: 12 },
  conn:    { status, attempt, backoffMs, lastFrameAt, error },      // boot|connecting|live|reconnecting|offline|auth
  auth:    { status, token, error },                                // unknown|none|hasToken|rejected
  builds:  { hash, moduleCount, error },
  daemon:  { status, version, uptimeMs, error },
  runs:    { byId: { [id]: run }, order: [ids], load: { status, error, at } },
  approvals: { pending: { [id]: "pending" }, error: { [id]: msg } },
  pairing: { status, code, expiresAt, device, error, attempts: [ts] },
}
run = { id, title, titleSource, prompt, state, attempt, createdAt, updatedAt, finishedAt,
        lastHeartbeat, model, ownerDeviceId, tokensText, pendingTool, toolEvents: [] }
```

Actions: `ui.route|variant|select|inspectorToggle|inspectorTab`, `conn.*`, `auth.token|rejected|signOut`,
`builds.loaded`, `daemon.loaded`, `runs.loadStart|loadOk|loadErr`, `run.upsert`, `run.tokens`,
`run.toolRequest|toolResult`, `stream.frame|stale`, `approve.begin|ok|conflict|fail`,
`pair.*`. The renderer subscribes once and re-renders the affected view; views never fetch.

### 7.2 Machine per surface

- **conn**: `boot → connecting → live`; close while online → `reconnecting(attempt++)` with backoff
  1s→10s; `navigator.onLine === false` or `offline` event → `offline` (timer cleared, socket closed);
  `online` event or `#retryNow` → `connecting` with attempt reset. **Stale-stream guard:** no frame
  (heartbeat included, every 15 s) for 35 s while `live` → `reconnecting` (the current client has no
  such guard and can sit on a half-dead socket). Auth probe on close: `GET /runs` 401 → `auth`
  state, stop retrying, route to pairing.
- **auth**: `unknown → hasToken → verified | rejected`. `unknown` (no localStorage) routes to
  `#/pairing`. `rejected` is sticky until a new token is saved or `#signOut`. **No REST call is made
  unless `auth ∈ {hasToken, verified}`** — this is the root fix for the stuck "auth failed" error
  line in the Activity panel (today `loadActivity()` fires at boot with no token and writes the
  error, and nothing clears it when a token later arrives).
- **runs**: `idle → loading → ready | error`. `error` keeps the previous list visible (stale-but-
  labeled beats empty), with `#activityError`/`#approvalsError` naming the cause and a retry path.
  Load-once at auth, then maintained by stream; `#refreshActivity` and `#approvalsRefresh` force
  a reload. Responses are stamped and dropped if a newer load started (kills the current race).
- **approvals**: per-run `idle|pending`; optimistic updates are **not** used; 409 triggers a re-fetch
  and an honest "state changed" message rather than a silent no-op.
- **pairing**: §5.

### 7.3 Merge rules (the current bug source)

1. `POST /runs` response `{run}` and `GET /runs/:id` `{run}` both merge by id — the interactive path
   now gets a title, because the client no longer waits for a `run.created` frame that never comes.
2. `run.state` / `run.done` / `tool.*` for an unknown id upsert a shell run (`titleSource:
   "pending"`) and enqueue `GET /runs/:id` to fill title/prompt/attempt. Rendered label falls back to
   `format.titleFallback()` until it lands — never a bare UUID.
3. `GET /runs` merge is a **union**, not a replace: ids newer than the list snapshot (arrived by
   stream) survive; `order` is `createdAt` desc and is **stable** (a state change never reorders
   rows under the cursor; `updatedAt` is a column, not the sort key).
4. `since` cursor: persist **only** frames with a finite numeric `seq`; heartbeat frames are
   excluded (fixes the `hb-…` cursor bug). Dedupe key is `seq` when numeric, else the frame `id`
   (`tool-<rowid>` from replay). This makes reload-after-heartbeat replay work again and keeps a
   fresh-boot daemon's 200-event replay idempotent.
5. `tokensText` appends only on unseen frames, so replay cannot duplicate text. Cap per run at
   64 KB in the DOM (keep tail) with a `…truncated` marker; the store keeps the tail only.
6. REST `events` rows are snake_case (`run_id`, `args_hash`, `result_ref`) → normalised to camelCase
   once in `api.js`, which is the only module that knows server field names.

### 7.4 Where each known defect dies

| Defect | Fix | Milestone |
| --- | --- | --- |
| Activity error stuck on "auth failed" from a pre-token load | no REST before `hasToken`; stamped loads; error cleared by success | M1 |
| Raw UUID as run title | merge POST/list responses; fetch on unknown id; labeled fallback | M1 |
| Tool events only reachable by toggling an Activity row | inspector with an Events tab, reachable from all three list views | M2 |
| No pairing surface | `#view-pairing` + `#pairStart/#pairCode/#pairConfirm` | M3 |
| No empty/loading/error distinctions | explicit `#*Empty`/`#*Error` per surface + `runs.load.status` | M4 |
| Thin a11y (no landmarks, focus, live strategy) | landmarks, `#viewTitle` focus on route, `role="log"`, `#live` for state only, Escape/arrow handling, reduced-motion | M4 |
| `since` cursor poisoned by heartbeats | numeric-seq-only cursor (7.3.4) | M1 |

## 8. Variant plan (2–3 genuinely different operator consoles, one flag)

Flag: `?variant=console|ledger|tty` on `/` (query is stripped by `serveWeb`, so it costs nothing),
persisted to `localStorage["zot.variant"]`, switchable at runtime via `#variantSwitch`, reflected as
`#app[data-variant]`. Default `console` (`DEFAULT_VARIANT` in `js/main.js`, one line to flip in M6).
All three are dark (the human's visual family is fixed) and expose the **identical selector
contract** (ADR-2); they differ in structure, not just paint:

| | `console` (default) | `ledger` | `tty` |
| --- | --- | --- | --- |
| Navigation | 208px left sidebar, icon+label | 44px icon rail, expands on hover | top tab row, `[chat] [approvals] …`, no sidebar |
| Main pane | thread of cards, `#log` | one dense ledger table, rows expand inline | two equal panes, thread left / inspector right |
| Inspector | docked 380px, always visible | slide-over 420px, only when a row is selected (main expands) | permanently docked 50% |
| Type | sans prose + mono ids | sans titles, mono ids/times only | monospace everywhere, prose included |
| State cue | 3px left bar + uppercase pill | colored dot + right-aligned word | fixed-width `STATE` column, no chrome |
| Density | 28px rows | 24px rows (≥24 runs visible) | 26px rows, 1px rules, no radius |
| Feels like | a control room | an audit ledger | a terminal |

Screenshots for the human to choose: the gate covers the default variant only (fast, honest); the
matrix is produced on demand and attached as evidence:

```sh
bash scripts/verify-shots.sh /tmp/zot-shots-console                                  # default
ZOT_SHOTS_VARIANT=ledger bash scripts/verify-shots.sh /tmp/zot-shots-ledger
ZOT_SHOTS_VARIANT=tty    bash scripts/verify-shots.sh /tmp/zot-shots-tty
```

Harness support (M5): `ZOT_SHOTS_VARIANT` appends `?variant=<v>` to every opened URL and prefixes
every filename (`ledger-pairing.png`, …), so three directories compare screen-for-screen. The head
launches the evaluator; **the human picks**, per the repo's prototype-variants rule. M6 promotes the
winner to `DEFAULT_VARIANT` and keeps the losers behind the flag for one release (then delete).

## 9. Spec: touched modules

| Path | Status | Milestone | Notes |
| --- | --- | --- | --- |
| `web/index.html` | rewrite | M0 (+M2/M3/M5 edits) | landmarks, topbar, sidebar, four views, inspector, `#live`; single `<script type="module" src="/js/main.js">` |
| `web/app.js` | delete | M0 | logic moves to `web/js/**`; no behaviour may vanish silently |
| `web/style.css` | delete | M0 | replaced by `web/css/*` |
| `web/css/tokens.css` | new | M0 | palette, spacing, type, state colors, focus ring, reduced motion |
| `web/css/layout.css` | new | M0 | grid shell, breakpoints, view/inspector geometry |
| `web/css/components.css` | new | M0 (+M2/M3/M4) | rows, chips, table, buttons, inputs, empty/error states, `sr-only` |
| `web/css/variants.css` | new | M5 | `[data-variant]` overrides only |
| `web/favicon.svg` | new | M0 | stops `/favicon.ico` 404 |
| `web/build.json` | new (generated, committed) | M0 (+ every web commit) | module list + `sourceHash` (§6.3) |
| `web/js/main.js` | new | M0 | boot, route, variant, subscriptions, hotkeys (Esc) |
| `web/js/store.js` | new | M0, M1 | state + reducer + selectors (§7) |
| `web/js/api.js` | new | M0, M1, M3 | the 7 allowed endpoints + healthz; status→error mapping; snake_case normalising |
| `web/js/stream.js` | new | M0, M1 | WS url/backoff/heartbeat guard/`since` cursor |
| `web/js/dom.js` | new | M0 | `h()`, keyed list reconcile, focus helpers |
| `web/js/format.js` | new | M0, M1 | relative time, short id, title fallback, state labels |
| `web/js/render.js` | new | M0, M4 | top-level render, `#app` data attributes, live-region writer |
| `web/js/views/chat.js` | new | M0, M2, M5 | thread, composer |
| `web/js/views/approvals.js` | new | M2, M5 | attention queue, the only approve/cancel |
| `web/js/views/activity.js` | new | M2, M4, M5 | ledger, filters |
| `web/js/views/pairing.js` | new | M0 stub, M3 full | `#auth` card, pairing machine, paste fallback |
| `web/js/views/inspector.js` | new | M2, M4 | details/events tabs |
| `web/js/views/variants/*.js` | new | M5 | per-variant layout hooks; `variants.css` does the rest |
| `scripts/lib/webbuild.mjs` | new | M0 | `scanWeb()` + `computeSourceHash()` |
| `scripts/build-web.mjs` | new | M0 | writes `web/build.json` |
| `scripts/verify-web.mjs` | new | M0 (+selector list per milestone) | the gate: parse, graph, freshness, contract, no-external |
| `scripts/verify-web-state.js` | new | M1 | pure reducer test over recorded frames: merge, dedupe, cursor, 401 race |
| `scripts/prove.sh` | change | M0 (+M1) | `test -f web/*` → `node scripts/verify-web.mjs`; + `node scripts/verify-web-state.js` |
| `scripts/verify-shots.sh` | change | M2, M3, M4, M5 | new screens, `ZOT_SHOTS_VARIANT`, `ZOT_SHOTS_ONLY`, error naming |
| `.pi/skills/verify-zot/SKILL.md` | change | M2, M3, M4, M5 | selector contract, four screens → six, variant matrix |
| `docs/ARCHITECTURE.md` | change | M0, M5 | the "web/app.js owns…" line becomes the module map |
| `docs/GLOSSARY.md` | new | M0 | §3 terms |
| `README.md` | change | M6 | one paragraph: what the console is, how to screenshot it |
| `src/**`, `rn/**`, `ios/**` | untouched | — | ADR-6; any need to touch them stops the task and returns to the head |

## 10. Milestones (each one commit, each leaves `prove.sh` green)

```text
M0 web shell + build proof      (no deps)
M1 REST/stream store            (M0)
M2 approvals view + inspector   (M1)
M3 browser pairing              (M2)
M4 activity table, states, a11y (M3)
M5 three variants + matrix      (M4)
M6 promote winner + docs        (M5, human pick)
```

**M0 — `web: rebuild the client as an ES-module shell with a build proof`** (tracer bullet)
Files: `web/index.html`, `web/css/{tokens,layout,components}.css`, `web/favicon.svg`,
`web/js/{main,store,api,stream,dom,format,render}.js`, `web/js/views/{chat,pairing}.js`,
`scripts/lib/webbuild.mjs`, `scripts/build-web.mjs`, `scripts/verify-web.mjs`, `web/build.json`,
`scripts/prove.sh`, `docs/ARCHITECTURE.md`, `docs/GLOSSARY.md`; delete `web/app.js`, `web/style.css`.
Acceptance: structure and styles are new; Chat works end to end; Pairing is the `#auth` card; **the
unmodified `scripts/verify-shots.sh` still passes 4/4**, including `.approvalRow` still inside
`#log article` and `#auth #token` still visible and empty on first load. That unchanged-harness run
is the acceptance test that no handle was lost.
Gate: `bash scripts/prove.sh` (now including `node scripts/verify-web.mjs`) + lane commit check.

**M1 — `web: merge REST and the stream into one run store`**
Files: `web/js/{store,api,stream,format,render}.js`, `web/js/views/chat.js`,
`scripts/verify-web-state.js`, `scripts/prove.sh`, `scripts/verify-web.mjs` (selector list).
Acceptance: §7.3 rules unit-tested offline (heartbeat frames never move the cursor; unknown-id
`run.state` triggers one `GET /runs/:id`; duplicate replay appends nothing; a 401 from a stale load
cannot overwrite a newer success); no REST before `hasToken`; Chat shows real titles.
Gate: prove + harness 4/4 unchanged.

**M2 — `web: give approvals their own view and tool events an inspector`**
Files: `web/js/views/{approvals,inspector,chat}.js`, `web/css/components.css`, `web/js/render.js`,
`scripts/verify-shots.sh` (approvals now driven through `#navApprovals` → `#view-approvals
[data-run-id] .approvalRow`; add `inspector.png`), `.pi/skills/verify-zot/SKILL.md`,
`docs/ARCHITECTURE.md`, `scripts/verify-web.mjs`.
Acceptance: `.approvalRow` gone from `#log`; exactly one approve path; inspector opens from all
three lists and lists tool events from `GET /runs/:id/events`.
Gate: prove + harness **5/5** with the updated script (same commit as the skill update).

**M3 — `web: pair from the browser`**
Files: `web/js/views/pairing.js`, `web/js/api.js`, `web/css/components.css`,
`scripts/verify-shots.sh` (pairing → code → confirmed, fallback path), `.pi/skills/verify-zot/SKILL.md`,
`docs/ARCHITECTURE.md`.
Acceptance: §5 states all reachable and named; 2 pairing POSTs total in the harness (budget 5/60 s:
3 spare); token stays in `localStorage`; `#pairCode` matches `/^\d{6}$/`; `#signOut` clears.
Gate: prove + harness **7/7**.

**M4 — `web: activity table, explicit states, accessibility pass`**
Files: `web/js/views/{activity,chat,approvals,inspector,pairing}.js`, `web/js/render.js`,
`web/css/components.css`, `scripts/verify-shots.sh` (empty-state + focus assertions),
`.pi/skills/verify-zot/SKILL.md`.
Acceptance: every surface has loading/empty/error; filter works; keyboard reaches every action;
focus follows route and Escape; `#live` announces state changes only; reduced-motion respected;
≥18 Activity rows at 1280×800 (assert first-18-rows height < 760px via `getBoundingClientRect`).
Gate: prove + harness 7/7.

**M5 — `web: three operator-console variants behind ?variant=`**
Files: `web/js/views/variants/*.js`, `web/css/variants.css`, `web/js/main.js`, `web/index.html`
(`#variantSwitch`), `scripts/verify-shots.sh` (`ZOT_SHOTS_VARIANT`, filename prefix, `ZOT_SHOTS_ONLY`),
`scripts/verify-web.mjs` (variant modules reachable), `docs/ARCHITECTURE.md`, skill.
Acceptance: all three variants pass the same 7-screen assertions; three evidence dirs produced;
default `console` unchanged for the gate.
Gate: prove (default variant only) + the 3×7 matrix as evidence for the evaluator.

**M6 — `web: promote the chosen variant and finish the console`**
Files: `web/js/main.js` (`DEFAULT_VARIANT`), `web/css/variants.css`, `scripts/verify-shots.sh`,
`README.md`, `docs/ARCHITECTURE.md`, skill.
Acceptance: human's pick is the default; final 7 PNGs attached; docs match the shipped state.
Blocked by: M5 **and** the human's variant choice.

Every milestone ends with the same two commands (the configured check), run in the lane:

```sh
bash scripts/prove.sh
bash '/root/zanish-factory/zanish-factory/scripts/check-commits.sh' "$(git rev-parse --show-toplevel)"
```

## 11. Verification

**Per-milestone gate** (unchanged shape, stronger content):

```sh
bash scripts/prove.sh                                  # includes node scripts/verify-web.mjs
bash scripts/verify-shots.sh /tmp/zot-shots-<ms>       # 4 → 5 → 7 screens as milestones land
node scripts/verify-web-state.js                       # M1 onward
```

**Selector changes the harness must absorb** (`scripts/verify-shots.sh`, and the same list in
`.pi/skills/verify-zot/SKILL.md`, edited in the same commit):

| Screen | Today | After |
| --- | --- | --- |
| `pairing` | open `/`, assert `#auth #token` empty + `#saveToken` visible, capture | open `/?variant=<v>#/pairing`, same `#auth #token` assertion (kept), plus `#pairStart` visible, capture `pairing.png` = **initial state, no code requested** |
| `pairing-code` | — | click `#pairStart`, wait `#pairCode` matches `/^\d{6}$/` and `#pairStatus[data-kind="code"]`, capture |
| `pairing-confirmed` | — | click `#pairConfirm`, wait `#pairStatus[data-kind="paired"]`, assert `localStorage.zot.token` non-empty, capture, then read `TOKEN` out of `localStorage` for the harness's own curl calls |
| fallback path | `ab fill "#token" "$TOKEN"` + `#saveToken` (uses a curl-minted token) | after `#signOut`, same fill/save with the token the UI just minted: proves the fallback and keeps one token total |
| `chat` | `#log` text + `article[data-state="done"]` | unchanged selectors, plus `#view-chat[data-active]` |
| `approvals` | `.approvalRow` inside `#log article` | click `#navApprovals`, assert `#view-approvals[data-active]` and `[data-run-id="<id>"] .approvalRow` with `Approve`/`Cancel` visible |
| `activity` | `#activity li button.activityRun`, `#activityCount` `/\d+ shown/` | unchanged selectors, plus `#view-activity[data-active]` |
| `inspector` | — | click the first `button.activityRun`, wait `#inspector .toolEvent` (or `#inspectorBody` non-empty), capture |

Pairing-call budget in the harness: 2 POSTs (`start`, `confirm`) against a 5-per-60 s limit, with
`ZOT_SHOTS_PAIR_VIA=api` as a documented escape hatch (old curl sequencing) for debugging the
harness when the pairing UI itself is the thing under repair, and a failure message that names the
429 instead of "assertion failed".

**What must fail (gate honesty):** missing/stale `web/build.json`; a module that fails ESM parse; a
bare import; a dropped harness selector; an external URL in `web/`; a resolved browser whose
assertion misses (`exit 1` → `FAIL browser screenshots`). **What may SKIP, with its name printed:**
browser discovery only (`exit 2`), unchanged from today.

**Manual/evaluator pass:** the 3×7 variant matrix goes to the human; the head launches the evaluator
to compare, the human decides (§8).

## 12. Risks

| Risk | Mitigation |
| --- | --- |
| M0 is a large rewrite and could drop a screenshot handle | `verify-web.mjs` asserts the selector contract offline; M0's acceptance is the **unchanged** harness passing 4/4 |
| Moving approvals out of Chat breaks muscle memory | sidebar badge + `.runNeedsApproval` one-click route from Chat; the harness moves in the same commit (M2) |
| Pairing rate limit (5/60 s) trips the harness | 2 POSTs only; explicit 429 message; `ZOT_SHOTS_PAIR_VIA=api` escape |
| One pending pairing slot: a phone's `pair/start` invalidates the browser's code | `mismatch` state explains it and offers Start again; `#pairNote` states the model |
| Browser caches modules between edits (`serveWeb` sends no cache headers) | documented hard-reload workaround; adding `Cache-Control` to `serveWeb` is a one-line **separate** task (§13) |
| Dark dense UI fails contrast or a11y | token contrast ≥4.5:1, state always labeled in text, focus management, `#live` for state only, `role="log"`, reduced-motion, M4 acceptance list |
| 100-run REST payload + long token streams jank the DOM | `order` cap 100, Activity 30, Chat 12, per-run node cache, 64 KB token tail cap; no virtual scrolling (§13) |
| Stream `since` regressions repeat | cursor rule in §7.3.4 with an offline reducer test (`verify-web-state.js`) |
| A builder "fixes" a bug by editing `src/` | ADR-6: any needed `src/` change stops the task and returns to the head; review checks the diff path list |
| Variants sprawl into three codebases | ADR-2 selector invariance + one `variants.css` + at most one small layout hook per variant |

## 13. Non-goals

- No change to `src/**`: no new route, no payload/shape change, no data-model change, no
  `serveWeb` cache/MIME change.
- No auth-model change. Pairing stays a self-pair; the console does not claim a second factor and
  adds no verification step.
- No device management: `GET/DELETE /api/v1/devices` are **not** in the allowed endpoint set, so the
  console cannot list or revoke devices. "Unpair other devices" is a separate task that needs an
  endpoint decision.
- No `rn/`, no `ios/`, no parity work of any kind.
- No memory/jobs/voice/chatops/push surfaces in the console.
- No bundler, no TypeScript, no JSX, no npm dependency, no source maps (§6, ADR-1).
- No webfonts, no external assets, no CDN.
- No service worker, no offline PWA, no push notifications in the browser.
- No virtual scrolling, no client-side FTS/search across runs.
- No mobile-first redesign; narrow viewports must merely not break (§4 fallbacks).
- No light theme; all three variants stay in the operator-console dark family.
- No bulk "approve all" (the API is one POST per run; N parallel POSTs is a later decision).
- No CSP headers (a server change, and inline-safe CSP is its own design).

## 14. Open questions for the human

**None block builders.** Two points need a human answer at defined moments, with stated defaults so
the line keeps moving:

1. **M5 → M6: which variant ships?** The evaluator compares the 3×7 matrix; the human picks. Default
   if nobody answers: keep `console`.
2. **M6: keep the losing variants behind the flag, or delete them?** Default: keep for one release,
   delete in a follow-up task.

Stated assumptions (not questions, correctable in review): the Pairing view shows the code with
copy that says another device may also enter it; a 401 does not auto-clear the saved token
(`#signOut` is the explicit clear); Chat keeps the newest 12 runs rather than an unbounded thread.
