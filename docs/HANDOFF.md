# Handoff: zot web operator console

Status as of merge `4c45f61` on `master`. The web UI/UX rework is shipped and green.
This file lists what remains so a fresh session can finish without re-deriving anything.

Read first:

- `.pi/factory/plan/web-rework.md` — the approved plan, ADRs, selector contract, milestones.
- `docs/ARCHITECTURE.md` — module map, variants, ADR-1 esbuild addendum.
- `.pi/skills/verify-zot/SKILL.md` — how to drive and screenshot the real UI.
- `.pi/factory/tasks/{verify-shots,web-rework}.json` — merged task records and approvals.

## What is already done (do not redo)

Shipped in `4c45f61` (merge of `factory/web-rework`) and `f03cadd` (screenshot harness):

- Four views: Chat, Approvals, Activity, Pairing. Sidebar + thread + docked inspector.
- In-browser pairing machine (10 named states) with token-paste fallback. Token in
  `localStorage["zot.token"]`; page URL/query/hash are clean. The WebSocket handshake carries
  `?token=` because `src/stream.js` requires it — that protocol is unchanged.
- One reducer owns client state; the renderer is the only DOM writer. REST and stream merge in
  `web/js/store.js`.
- Console is the default. `ledger` and `tty` remain behind `?variant=` for one release.
- `scripts/verify-shots.sh`: seven 1280x800 screens through headless Chrome, wired into
  `scripts/prove.sh` with an explicit `SKIP` when no browser resolves.
- `scripts/build-web.mjs` + `scripts/verify-web.mjs` + committed `web/build.json`. Stale or
  absent manifest fails the gate; it never skips.
- Fixed defects: raw-UUID run titles, heartbeat frames poisoning `zot.since`, stuck
  "auth failed" on a pre-token load, composer floating mid-pane, variable-width state column.
- Factory check now uses `set -e` (`7490e0f`); it previously masked a failing `prove.sh`.

## Remaining work, in priority order

### 1. esbuild migration — tracked task `esbuild-migration` (paused, architecture)

The plan's ADR-1 pre-committed trigger fired: `web/js` is 3334 lines (3089 non-blank) against
the ~3000 threshold. The human decision was ship-now / migrate-next, recorded in
`docs/ARCHITECTURE.md`.

Resume:

1. `setStatus("esbuild-migration","running")`, then `ensureWorktree("esbuild-migration")`.
2. Planner first. It must write `.pi/factory/plan/esbuild-migration.md`; builders stay refused
   until that exact path exists.
3. Scope from plan §6.6 option B: dev-only `esbuild` resolved via `ZOT_ESBUILD` → PATH →
   `npx --no-install`; output committed to `web/dist/app.js`; gate = parse + freshness hash +
   the existing 77-handle selector contract; esbuild absent at edit time is a hard failure with
   the install line printed. No runtime dependency.

Acceptance: same UI, same seven screens, gate green without network access at gate time.

### 2. Variant retirement decision — after this release

`ledger` and `tty` were kept "for one release" by human decision. Next release window, decide
keep or delete. If deleting, touch all of:

- `web/css/variants.css`, `web/js/views/variants/{index,ledger}.js`
- variant plumbing: `DEFAULT_VARIANT` and `actions.variant` in `web/js/main.js`, the variant
  slice in `web/js/store.js`, `#variantSwitch` in `web/index.html`, `#app[data-variant]`
- `scripts/verify-shots.sh` (`ZOT_SHOTS_VARIANT`, per-variant alignment assertions) and
  `scripts/verify-web.mjs` contract entries
- `docs/ARCHITECTURE.md` variants section, `README.md`, `docs/GLOSSARY.md`,
  `.pi/skills/verify-zot/SKILL.md`

### 3. Three small, verified defects

a. **`draining` state word** — `web/js/render.js:132` maps `d.status` to the word `ready |
starting | unreachable | unknown`, while `:133` sets `data-kind` to `d.status` verbatim, so
`data-kind="draining"` renders the word "unknown". Either add a `draining` branch or drop it
from the enumeration documented in `.pi/skills/verify-zot/SKILL.md:84`. The window is narrow
(shutdown only); copy-level.

b. **`#runsCount` can exceed 100** — `web/js/store.js:618` `mergeRuns` appends stream-discovered
runs with no cap, so the sidebar count can pass the REST limit. `docs/QUICKSTART.md:45` says
"up to the API's 100". Either cap `runs.order` in the store or reword to "the list API returns
up to 100 per fetch". Pick one; do not leave the two disagreeing.

c. **Wrong-code pairing copy** — `web/js/views/pairing.js:33-34` renders `mismatch` as "another
pairing replaced this code — the daemon only keeps one pending code." The state mapping is
correct (`web/js/store.js:740` maps the server's "pair code mismatch"), but for a mistyped code
that sentence is misleading. Use "that code did not match. Check the six digits and try again."
Add a reducer/render test alongside.

### 4. Decisions that need the human, not a builder

- **Tool args before Approve.** Approvals show `run.prompt` (e.g. `tool: shell echo hi`) because
  `src/runner.js:181` publishes `tool.request` as `{runId, tool}` only. Showing real args needs a
  stream/API change, which the rework deliberately forbade. Decide if it is worth breaking the
  API-identical constraint.
- **CSP headers** and **a light theme** were explicit non-goals. Revisit only on a product ask.

## Ops notes

- `scripts/prove.sh` and `scripts/verify-shots.sh` default to ports 18787 and 18788. Two
  concurrent verification runs collide and the screenshot stage fails. Set `PORT` and
  `ZOT_SHOTS_PORT` when running them in parallel.
- In a factory lane without `rn/node_modules`, the gate prints `SKIP rn checks (installed deps
  absent)`. The main checkout runs the full RN suite (prettier, tsc, jest, eslint) and passes.
- Screenshot evidence lives under `/tmp` and is ephemeral. Regenerate rather than cite old paths.
- Commits need the factory identity `Irell Zane <itsirellzane@gmail.com>` and a declared scope
  from `.pi/factory.json`. Protocol: `/root/zanish-factory/zanish-factory/skills/commit-protocol/SKILL.md`.

## How to run and verify

```sh
cd /root/zot

bash scripts/prove.sh                 # full gate: web checks, state checks, 7 screenshots, RN
node scripts/build-web.mjs            # rewrite web/build.json after any web/** edit

bash scripts/verify-shots.sh /tmp/zot-shots-console
ZOT_SHOTS_VARIANT=ledger bash scripts/verify-shots.sh /tmp/zot-shots-ledger
ZOT_SHOTS_VARIANT=tty    bash scripts/verify-shots.sh /tmp/zot-shots-tty

node src/daemon2.js                   # http://localhost:8787/ , ?variant=ledger , ?variant=tty
```

Browser discovery: `ZOT_BROWSER` / `ZOT_AGENT_BROWSER` and `ZOT_CHROME`, then PATH and common
install paths. On this host: `/root/.hermes/tools/agent-browser-0.26.0-linux-x64/bin/agent-browser-linux-x64`
and `/root/.hermes/tools/chromium-1208/chrome-linux64/chrome`.

## What not to redo

- Do not re-open the console-vs-ledger-vs-tty choice; the evaluator scored 27/23/17 and the
  human chose console, with the losers kept behind the flag on purpose.
- Do not change API routes, payloads, or the DB schema. The whole rework is web-only by design.
- Do not put the device token in the page URL, query, or hash.
- Do not delete `web/build.json` without wiring the replacement build proof in the same commit.
