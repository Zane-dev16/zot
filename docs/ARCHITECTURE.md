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
`web/index.html` owns the chat shell. `web/app.js` owns post plus render plus reconnect. `web/style.css` owns chat styling.
`ios` owns pairing plus runs list plus runs create over the same api v1 routes.

Next. Wire stream into daemon2. Decide if pair confirm stays authed.
