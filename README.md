# zot

Local first daemon plus browser chat for personal automation.

`src/daemon2.js` owns the bootable process. It serves health plus web plus api on port 8787.
`src/api.js` owns all api v1 routes and auth.
`daemon.js` is a shim that execs `src/daemon2.js`.
`src/server2.js` is a thin wrapper over `src/daemon2.js`.
`src/server.js` is deprecated. It points at `src/daemon2.js`.
`src/stream.js` owns the WebSocket upgrade at api v1 stream.
`src/events2.js` owns the stream event table plus replay.
`web/app.js` owns post plus stream render plus reconnect plus approvals plus Activity.
`ios` owns the Swift pairing screen plus chat list.

Start here.

1. Follow `docs/QUICKSTART.md` to boot and send one prompt.
2. Open `http://localhost:8787/` for the browser chat.
3. Read `docs/API.md` for routes and run states.
4. See `docs/IOS.md` for the iOS pairing flow.

Quickstart.

1. Run `npm start` or `./scripts/zot-run.sh`.
2. Open `http://localhost:8787/healthz` and expect ready state.
3. Open `http://localhost:8787/` for the browser chat.
4. Runs in waiting_tool show Approve and Cancel. Activity lists tool events per run.
5. Api lives under `http://localhost:8787/api/v1`. See `docs/API.md` for routes.
6. Env vars are optional for the default path. See `docs/QUICKSTART.md` for the list.
7. Chatops inbound needs `CHATOPS_INBOUND_SECRET`. See `docs/CHATOPS.md`.
8. Skill tools load from `skills`. See `docs/SKILLS.md`.
