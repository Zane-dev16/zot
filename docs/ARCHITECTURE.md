# Architecture

Three surfaces share one domain.

`src/daemon2.js` owns the heartbeat loop plus health plus static plus api mount. It is the canonical boot on port 8787.
`daemon.js` is a shim that execs `src/daemon2.js`.
`src/server2.js` is a thin wrapper over `src/daemon2.js`.
`src/server.js` is deprecated and points at `src/daemon2.js`.
`src/api.js` owns dispatch plus bearer auth plus body validation. Pure modules stay framework free.
`src/runs.js` owns the run state machine. Cancel and approve reuse it.
`src/events2.js` owns the stream event table plus replay from tool events.
`src/stream.js` owns raw WebSocket framing plus since replay. No framework was added.
`web/index.html` owns the operator-console shell (topbar, sidebar, four views, inspector). `web/js/` is the client, in named pieces: `main.js` owns every effect (fetch, websocket, timers, localStorage) and dispatches into `store.js`, the single reducer; `render.js` plus `views/chat.js`, `views/approvals.js`, `views/activity.js`, `views/pairing.js`, and `views/inspector.js` are the only DOM writers; `api.js` is the only module that knows server field names; `stream.js` owns the socket, backoff, stale-frame watchdog, and numeric-only `since` cursor; `dom.js` holds the element and keyed-reconciler helpers plus the one-shot state-change flash; `format.js` holds the pure formatters (title, relative time, state label, prompt line, clipping).

`web/css/tokens.css`, `layout.css`, and `components.css` own the base styling; `web/css/variants.css` plus the one small hook in `web/js/views/variants/` re-lay out that same selector contract as three consoles behind `?variant=console|ledger|tty`, persisted in `localStorage["zot.variant"]`, switchable live via `#variantSwitch`, and reflected as `#app[data-variant]`. **Console is the default and the shipping layout.** Ledger (icon rail, table rows, slide-over inspector) and tty (top tab row, two equal panes, monospace prose) stay reachable behind `?variant=` for exactly one release; after that they are removed unless a human keeps them. All three expose the identical selector contract, so one screenshot script covers every layout.

There is no bundler, per plan ADR-1: the client is native ES modules and the build artifact is a committed `web/build.json` manifest. `scripts/build-web.mjs` writes it and `scripts/verify-web.mjs` re-derives its `sourceHash`, the module graph, and the screenshot selector contract, so a stale or absent manifest fails the gate instead of skipping. ADR-1's pre-committed trigger to adopt esbuild: only if client source exceeds ~3000 lines, the state model needs static types to stay correct, or a view genuinely needs JSX. Until then the manifest is the whole build.
`ios` owns pairing plus runs list plus runs create over the same api v1 routes.

`src/daemon2.js` also attaches `src/stream.js` and ticks `runner.tickScheduler` every 15 seconds. `runner.tickScheduler` routes due jobs through `scheduler.tickJobs` and records each fire in `scheduler_run`.

Pair confirm stays public. `src/api.js` wires it before bearer auth. The iOS stub calls it without a token.

Browser pairing is a self-pair on the unchanged public endpoints: `web/js/views/pairing.js` renders one named machine (`#pairStatus[data-kind]` = `idle|requesting|code|confirming|paired|expired|mismatch|no-pending|rate-limited|error`). `pair/start` returns a 6-digit code that the page displays and can confirm itself, so the browser gets the token the same way a phone does; the copy says so rather than claiming a second factor. The token is written only to `localStorage["zot.token"]` and never to a URL, query, or hash. The daemon keeps one pending code and rate-limits pairing POSTs to 5 per minute, so `mismatch`/`no-pending`/`rate-limited` are real states with their own copy, not generic failures. The manual `#token`/`#saveToken` fallback stays open by default so a pasted token and the in-browser flow are both reachable.
