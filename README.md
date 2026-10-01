# zot

Local first daemon plus browser chat for personal automation.

`src/daemon2.js` owns the bootable process. It serves health plus web plus api.
`src/api.js` owns all api v1 routes and auth.
`src/server2.js` owns a second bootable server for probes.
`src/stream.js` owns the WebSocket upgrade at api v1 stream. It is not wired into daemon2 yet.
`src/events2.js` owns the stream event table plus replay.
`web/app.js` owns post plus stream render plus reconnect.
`ios` owns the Swift pairing screen plus chat list.

Quickstart.

1. Run `node src/daemon2.js`.
2. Open `http://localhost:8787/healthz` and expect ready state.
3. Open `http://localhost:8787/` for the browser chat.
4. See `docs/IOS.md` for the iOS pairing flow.
