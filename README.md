# zot

Local first daemon plus browser chat for personal automation.

`src/daemon2.js` owns the bootable process. It serves health plus web plus api on port 8787.
`src/api.js` owns all api v1 routes and auth.
`daemon.js` is a shim that execs `src/daemon2.js`.
`src/server2.js` is a thin wrapper over `src/daemon2.js`.
`src/server.js` is deprecated. It points at `src/daemon2.js`.
`src/stream.js` owns the WebSocket upgrade at api v1 stream.
`src/events2.js` owns the stream event table plus replay.
`web/index.html` plus `web/js/` own the operator console: `main.js` holds every effect, `store.js` is the single reducer, `render.js` and `views/*.js` are the only DOM writers, `api.js` speaks the server field names, `stream.js` owns the socket, and `dom.js`/`format.js` are the shared helpers. `console` is the default layout; `ledger` and `tty` stay behind `?variant=` for one release.
`rn` owns the React Native client. It is the primary iOS path going forward.
`ios` owns the SwiftUI client. Its last recorded simulator build, install plus launch proof is 2026-10-05; the simulator pair matrix passed on 2026-10-13 and the baked pair flavor on the simulator on 2026-10-21. Those proofs are historical. It stays in tree until the React Native app passes the device gates in `BLOCKED.md`.

Clients.

Two iOS clients are in tree.

`rn` is bare React Native 0.88 plus TypeScript. It pairs with the six digit code, stores the token in Keychain, lists plus creates runs, follows the api v1 stream with polling fallback, uploads the raw APNs token, and reads baked pair launch args. Transport plus socket are injected, so the same modules run under jest and under plain node against a real daemon. `docs/IOS.md` has the architecture. `docs/API.md` has the routes.

`ios` is the SwiftUI client. It polls runs and does not use the stream. It is being retired. The plan archives it in T7 after human gates G1 to G3 pass.

The React Native app is device-unverified. No iOS build, simulator install, or on-device check has run for it. This host is Linux headless, with no Xcode, no simulator, and no iPhone. What runs here is jest, typecheck, lint, the stream frame regression check, and live tracer runs against a real daemon. Open human gates are listed in `BLOCKED.md`.

`bash scripts/prove.sh` is the repo gate. It boots an isolated daemon, checks auth, and runs `node scripts/verify-stream-frames.js` (WebSocket framing), `node scripts/verify-web.mjs` (ES module graph, committed `web/build.json` freshness, screenshot selector contract, the 13ch state column and reduced-motion flash rules, no external assets), and `node scripts/verify-web-state.js` (the client reducer and its selectors). It also runs prettier, tsc, jest, and eslint from `rn/` when `rn/node_modules` exists, and prints `SKIP rn checks (installed deps absent)` when the install is missing, so a green gate never hides an unrun client check. The last stage drives the console in a real browser through `scripts/verify-shots.sh` for the seven screens (pairing, pairing code, pairing confirmed, chat, approvals, activity, inspector) at 1280x800; a resolved browser with a failed assertion fails the gate, and a host with no browser prints `SKIP browser screenshots (no browser resolved; set ZOT_BROWSER and ZOT_CHROME)` instead of claiming a pass.

Commands that work on this host.

```sh
cd rn
npm test
npm run typecheck
npm run lint
```

Run `bash scripts/prove.sh` from the repo root for the full local gate.

Live tracers. Each boots its own daemon on an isolated port and database, then kills only the PID it started.

```sh
cd rn
node scripts/verify-live.mjs
node scripts/verify-stream-live.mjs
```

The first covers pair, persist, list, create, unpair. The second covers stream live, reconnect with the saved cursor, replay, heartbeat, and a completed run over the socket. Override the port when the default collides, as in `PORT=18787 node scripts/verify-stream-live.mjs`. Do not use `pkill node`.

To drive a daemon by hand, follow the isolated boot pattern in `.pi/skills/verify-zot/SKILL.md`. Set `PORT` plus `ZOT_DB` per run and kill the saved PID only.

Start here.

1. Follow `docs/QUICKSTART.md` to boot and send one prompt.
2. Open `http://localhost:8787/` for the browser chat.
3. Read `docs/API.md` for routes and run states.
4. See `docs/IOS.md` for the iOS pairing flow and the React Native client.

Quickstart.

1. Run `npm start` or `./scripts/zot-run.sh`.
2. Open `http://localhost:8787/healthz` and expect ready state.
3. Open `http://localhost:8787/` for the browser chat.
4. Runs in waiting_tool show Approve and Cancel under their prompt line. Select an Activity row to see that run's tool events in the inspector.
5. Api lives under `http://localhost:8787/api/v1`. See `docs/API.md` for routes.
6. Env vars are optional for the default path. See `docs/QUICKSTART.md` for the list.
7. Chatops inbound needs `CHATOPS_INBOUND_SECRET`. See `docs/CHATOPS.md`.
8. Skill tools load from `skills`. See `docs/SKILLS.md`.
