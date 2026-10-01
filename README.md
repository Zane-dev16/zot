# zot

Local first daemon plus browser chat for personal automation.

`src/daemon2.js` owns the bootable process. It serves health plus web plus api on port 8787.
`src/api.js` owns all api v1 routes and auth.
`daemon.js` is a shim that execs `src/daemon2.js`.
`src/server2.js` is a thin wrapper over `src/daemon2.js`.
`src/server.js` is deprecated. It points at `src/daemon2.js`.
`src/stream.js` owns the WebSocket upgrade at api v1 stream. It is not wired into daemon2 yet.
`src/events2.js` owns the stream event table plus replay.
`web/app.js` owns post plus stream render plus reconnect.
`ios` owns the Swift pairing screen plus chat list.

Quickstart.

1. Run `npm start` or `./scripts/zot-run.sh`.
2. Open `http://localhost:8787/healthz` and expect ready state.
3. Open `http://localhost:8787/` for the browser chat.
4. Api lives under `http://localhost:8787/api/v1`. See `docs/IOS.md` for the iOS pairing flow.
