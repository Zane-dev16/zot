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
`web/index.html` owns the operator-console shell (topbar, sidebar, four views, inspector). `web/js/main.js` owns every effect (fetch, websocket, timers, localStorage) and dispatches into `web/js/store.js`, the single reducer; `web/js/api.js` is the only module that knows server field names; `web/js/render.js` plus `web/js/views/*.js` are the only DOM writers; `web/js/stream.js` owns the socket, backoff, stale-frame watchdog, and numeric-only `since` cursor. `web/css/tokens.css`, `layout.css`, and `components.css` own the styling. There is no bundler: `scripts/build-web.mjs` writes the committed `web/build.json` manifest and `scripts/verify-web.mjs` re-derives its `sourceHash` plus the module graph and screenshot selector contract, so a stale or absent manifest fails the gate.
`ios` owns pairing plus runs list plus runs create over the same api v1 routes.

`src/daemon2.js` also attaches `src/stream.js` and ticks `runner.tickScheduler` every 15 seconds. `runner.tickScheduler` routes due jobs through `scheduler.tickJobs` and records each fire in `scheduler_run`.

Pair confirm stays public. `src/api.js` wires it before bearer auth. The iOS stub calls it without a token.

Browser pairing is a self-pair on the unchanged public endpoints: `web/js/views/pairing.js` renders one named machine (`#pairStatus[data-kind]` = `idle|requesting|code|confirming|paired|expired|mismatch|no-pending|rate-limited|error`). `pair/start` returns a 6-digit code that the page displays and can confirm itself, so the browser gets the token the same way a phone does; the copy says so rather than claiming a second factor. The token is written only to `localStorage["zot.token"]` and never to a URL, query, or hash. The daemon keeps one pending code and rate-limits pairing POSTs to 5 per minute, so `mismatch`/`no-pending`/`rate-limited` are real states with their own copy, not generic failures. The manual `#token`/`#saveToken` fallback stays open by default so a pasted token and the in-browser flow are both reachable.
