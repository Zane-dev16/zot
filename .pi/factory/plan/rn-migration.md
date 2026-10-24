# Plan: React Native migration for zot

- Task: `rn-migration` (matches `.pi/factory/tasks/rn-migration.json`, currently running)
- Planner mode: plan-only. No worktree, no branch, no code changes. This file is the deliverable.
- Date: 2026-10-24
- Scope decision (stated assumption, no user grilling available in factory mode): migrate the SwiftUI iOS client to a bare React Native (community CLI) app reusing the existing App ID, push entitlement, and daemon API. The daemon stays untouched unless a kind allowlist change is needed. The old `ios/` Swift app is kept in-tree until the RN device flow is green, then archived in a later ticket.
- Assumption ADR-001: bare React Native (TypeScript), not Expo. Reason: the daemon's push transport sends raw APNs over HTTP/2 (`src/push.js` → `api.sandbox.push.apple.com`) and `registerToken` validates a 64-hex APNs token shape. Expo's `getExpoPushTokenAsync` returns an `ExponentPushToken[...]` string routed through Expo's push service, not the raw APNs token the daemon expects. A bare RN app can read the raw APNs token from `didRegisterForRemoteNotificationsWithDeviceToken` via a thin native module. Expo would force either a daemon-side transport change or Expo's push service — both out of scope.
- Assumption ADR-002: the RN app keeps pairing `kind: "ios"`. The server allowlist is `"browser" | "ios"` at `src/auth.js:65` and `src/auth.js:102`; reusing `ios` avoids a server change and keeps `device_session.kind` reporting consistent with existing rows and docs (`docs/API.md`, `docs/IOS.md`).

## 1. Seams in current code (file/line refs)

### S1. Pair handshake
- Client: `ios/ApiClient.swift:62-80` — `confirmPair` POSTs `{code, label, kind:"ios"}` to `/api/v1/pair/confirm` with `auth: false` (no bearer), accepts 200/201, decodes `PairToken { token }`, saves to Keychain.
- Server: `src/api.js:258-291` — `POST /api/v1/pair/confirm`, rate limited (`pairLimited`), validates against pending code, 201 returns `{token, device}`. `src/auth.js:128-145` (`confirmPairing`) mints a 32-byte hex token, stores only the sha256 hash. Kind allowlist at `src/auth.js:65,102`.
- UI: `ios/ContentView.swift:78-95` — `pair()` normalizes host, enforces 6-digit numeric code, renders one error line.

### S2. Keychain token storage
- `ios/Keychain.swift:1-44` — service `"zot-token"`, account `"device-token"`, generic-password item; `load()` on launch (`ios/ApiClient.swift:47` `@Published var token = Keychain.load()`), `save()` after pair confirm, `delete()` on sign-out (`ios/ApiClient.swift:103-106`). Token never goes to UserDefaults or logs.

### S3. Runs API
- Client: `ios/ApiClient.swift:82-93` — `fetchRuns` GET `/api/v1/runs` → `{runs:[AgentRun]}`, `createRun` POST `/api/v1/runs` with `{title, prompt}` → `{run}`. Bearer header added at `ios/ApiClient.swift:57`.
- Server: `src/api.js:393-439` — GET lists `agent_run` ordered `created_at DESC LIMIT 100`; POST requires non-empty `title` and `prompt`, honors optional `model`. Run state machine lives in `src/runs.js` (states: e.g. `running`, `waiting_tool`, `done`, `cancelled`).
- UI: `ios/ContentView.swift:96-122` — `load()` on appear + refresh, `send()` posts run, error line on failure.

### S4. Events stream
- Server: `src/stream.js:9` (`STREAM_PATH = "/api/v1/stream"`), upgrade handler `src/stream.js:140-175` — WebSocket with `?token=` (bearer token) and `?since=` (replay cursor), rejects 401 on bad token, replays persisted events via `src/events2.js:replayEvents` (`REPLAY_LIMIT = 200`), broadcasts via `streamHandle.publish` (`src/daemon2.js:115-120`), heartbeat ping every 15s (`src/stream.js:205-212`, `HEARTBEAT_MS` at `src/stream.js:10`).
- Browser reference client: `web/app.js:237-243` (stream URL with token+since), `web/app.js:301` (WebSocket connect), `lastId` persisted in localStorage — this is the behavioral contract the RN client should copy.
- Note: the current iOS app does NOT use the stream (it polls `fetchRuns` only). The migration keeps poll parity first and adds the stream as its own slice — the seam exists on the server and in the web client and is named in the task.

### S5. Push token registration
- Client: `ios/ZotApp.swift:6-22` — `PushDelegate` requests notification authorization, registers for remote notifications, hex-encodes the device token, stashes it in `UserDefaults` key `"ZotPushToken"`, posts `Notification.Name("zotPushToken")`. `ios/ContentView.swift:61-66` observes it and calls `pushUp`; `ios/ApiClient.swift:95-101` POSTs `{token: <lowercased hex>, platform: "ios"}` to `/api/v1/push/tokens`. `load()` re-uploads the stashed hex after every fetch (`ios/ContentView.swift:99-101`).
- Server: `src/api.js:806-826` — POST registers (auth required, 201), GET lists, DELETE removes. `src/push.js:212` `registerToken` validates the 64-hex shape before storing in sqlite `push_token`. Daemon fires `push.notifyRunDone(db, runId, {live:true})` on every `run.done` (`src/daemon2.js:117-120`). Topic default `com.zanishlabs.zot`, mode `development` (`src/push.js:10,38`).

### S6. Baked pair config (automation flavor)
- `ios/BakedPair.swift:1-39` — activated by launch arg `-ZOT_BAKED` or env `ZOT_BAKED=1`; reads `-ZOT_SERVER_URL` / `ZOT_SERVER_URL` and `-ZOT_PAIR_CODE` / `ZOT_PAIR_CODE` from `ProcessInfo.processInfo.arguments` / environment. Consumed by `ios/ContentView.swift:68-76` (`bakedAutoPair`, guarded by `bakedDidRun`), which injects host+code and runs `pair()` once. Wired through Xcode scheme args for UI tests (see `BLOCKED.md` baked flavor entries).

### S7. aps-environment entitlement + ATS
- `ios/Zot.entitlements:5` — `aps-environment` = `development`. Referenced by `CODE_SIGN_ENTITLEMENTS` in `ios/Zot.xcodeproj/project.pbxproj` (line 234 debug / 308 release). Bundle id `com.zanishlabs.zot` (`project.pbxproj:248`), deployment target iOS 17.0 (`project.pbxproj:245`), team 36V92GAJBT (see `docs/APPID.md`, `docs/APNS.md`). The push-capable explicit App ID and profile path is documented in `docs/APPID.md` (human steps, partially done).
- `ios/Info.plist:5-37` — `NSAppTransportSecurity` → `NSExceptionDomains` allowing plain-http to `192.168.68.50/56/67`, `127.0.0.1`, `localhost`. RN's Info.plist must carry the same exceptions or LAN pairing breaks.

## 2. React Native equivalent for each seam

| # | Swift seam | RN equivalent |
|---|-----------|---------------|
| S1 | `confirmPair` (ApiClient.swift:62) | TS API module: `fetch` POST `/api/v1/pair/confirm` with `{code, label, kind:"ios"}`, no auth header; accept 200/201; decode `{token}`; error body `{error}` surfaced verbatim. Host normalization helper ported from `normalizeBaseURL` (ApiClient.swift:30-41). |
| S2 | Keychain.swift | `react-native-keychain` with `service = "zot-token"`, `account = "device-token"` (same identifiers). Token held in a session store (zustand/context), hydrated at startup, cleared on unpair. Never in AsyncStorage, never logged. |
| S3 | `fetchRuns`/`createRun` | TS API module: GET/POST `/api/v1/runs` with Bearer header, same JSON shapes (`AgentRun {id,title,prompt,state}`). Render with RN `FlatList` + a composer form. |
| S4 | (none in Swift app) | RN built-in `WebSocket` connecting to `ws://host/api/v1/stream?token=...&since=...`; port the web client's reconnect/backoff and `lastId` cursor persistence (`web/app.js` contract), store `since` in AsyncStorage instead of localStorage. Heartbeat: server pings every 15s, RN auto-pongs; client-side stale-socket watchdog matching the server's 15s cadence. |
| S5 | PushDelegate (ZotApp.swift:6-22) + registerPushToken | Thin native module (Swift/ObjC, ~40 lines) exposing `didRegisterForRemoteNotificationsWithDeviceToken` hex string and registration request; or `@react-native-community/push-notification-ios` device-token events. TS side: POST hex (lowercased) + `platform:"ios"` to `/api/v1/push/tokens` after pair and on app foreground, mirroring ContentView `load`/`pushUp`. On simulator/non-device the native side returns null and the TS side skips silently. |
| S6 | BakedPair.swift + scheme args | Native module reading `ProcessInfo.processInfo.arguments`/environment (same flags `-ZOT_BAKED`, `-ZOT_SERVER_URL`, `-ZOT_PAIR_CODE` and env equivalents) exposed as constants; TS `bakedAutoPair` hook (once-guard like `bakedDidRun`) that seeds host+code and runs pair. Keeps the existing baked test contract in `BLOCKED.md` workable against the RN app. |
| S7 | Zot.entitlements + Info.plist ATS | Carry `Zot.entitlements` (aps-environment development) into the new Xcode target via `CODE_SIGN_ENTITLEMENTS`; same bundle id `com.zanishlabs.zot`, iOS 17.0 target, team 36V92GAJBT, same push App ID. Merge `NSAppTransportSecurity` exception domains into the RN app's `ios/<App>/Info.plist` (bare RN: file is checked in and survives builds). |

Server-side changes required: none expected (kind `"ios"` already allowlisted; WS stream and push routes are device-kind agnostic). Any change found during build-out is a decision point for the head.

## 3. Order of work — sequenced slices, tracer-bullet tickets

Dependency edges: `T0 → T1 → {T2, T3}`; `T3 → T4`; `T1+T2 → T5`; `T0 → T6`; human gates G1-G3 gate T7.

**Slice A — thin end to end (no UI).**
- T0 (scaffold): bare RN + TypeScript app in `rn/` (community CLI template), jest + eslint + `@react-native-async-storage/async-storage` + `react-native-keychain` deps pinned. No iOS build here; proof = `tsc --noEmit` + jest green + lint green on this Linux host.
- T1 (API client, tracer bullet): TS module `src/api/client.ts` implementing S1+S2+S3 logic (pair confirm, keychain save/load/delete via react-native-keychain, fetchRuns, createRun, push-token upload stub). Jest tests run against a mock HTTP server; plus one integration check reusing `scripts/verify-client-contract.js` semantics against a live daemon on 127.0.0.1:8787 (node-side fetch — the module keeps transport injectable so tests run under node). This is the tracer bullet: pair → persist token → list → create → unpair, end to end against the real daemon without any iOS surface.
- Blocking edge: T0 → T1.

**Slice B — surface.**
- T2 (screens): pair screen (host + 6-digit code, numeric check, error line), run list + composer, unpair, baked hook placeholder. Ports ContentView.swift:1-127 behavior into `rn/src/screens/`. Jest + react-test-renderer on Linux; visual check is human gate G1.
- Edge: T1 → T2.

**Slice C — liveness.**
- T3 (events stream): `src/api/stream.ts` — WebSocket `?token&since`, replay, heartbeat watchdog, backoff reconnect, `since` in AsyncStorage; wire run list to live `run.state` updates. Jest with a mock WS server (ws package) on Linux; plus live check against daemon on 127.0.0.1 (client code runs in node under jest).
- Edge: T1 → T3. After T3, run list reads from stream but falls back to polling (parity with current Swift app preserved).

**Slice D — device seams.**
- T4 (push token registration): native module + TS upload path (S5). Linux proof = jest with mocked native module; device proof = human gate G2/G3.
- T5 (baked pair): native launch-args module + TS `bakedAutoPair` (S6). Linux proof = jest with mocked native module; device proof = human gate G3.
- T6 (native project config): entitlements, ATS exceptions, bundle id, team, deployment target in `rn/ios` (S7). Linux proof = static file checks (grep entitlements keys, bundle id); build proof = human gate G2.
- Edges: T3 → T4 (upload hook lives in session bootstrap next to stream connect); T2 → T5 (baked path seeds the pair screen); T0 → T6 (config lands in the scaffolded Xcode project).

**Slice E — retire old client.**
- T7 (archive `ios/`): after G1+G2+G3 pass, move `ios/` to `ios.swift-archive/` (or delete) and update `docs/IOS.md`, `BLOCKED.md`, `docs/APNS.md` references to point at `rn/`. Edge: gated on G1, G2, G3.

### Ticket list (blocking edges)

```text
T0 scaffold                (no deps)
T1 api client tracer       (blocks on T0)
T2 screens                 (blocks on T1)
T3 events stream           (blocks on T1)
T4 push token registration (blocks on T3)
T5 baked pair              (blocks on T1, T2)
T6 native project config   (blocks on T0)
T7 retire ios/             (blocks on G1, G2, G3)
```

T4/T5/T6 are parallelizable once their edges clear. T2+T3 are the "thin end to end" completion point (pair, list, create, live updates all runnable on this host under jest against a live daemon).

## 4. Human-only gates (cannot be verified on this host)

This host is Linux headless: no Xcode, no simulator, no device. Anything that needs an iOS surface is a human gate on the Mac `loki` (operator `irellzane`, per `docs/IOS.md`, `BLOCKED.md`). A builder/verifier on this host must stop at these gates and record "human-required" rather than fake a pass.

- **G1 — build + simulator install/launch.** `pod install` (CocoaPods — requires macOS), `xcodebuild` for simulator, `simctl` install/launch, and a visual check of the pair screen. Only a human with loki access can produce "BUILD SUCCEEDED" + launch exit 0 + a screenshot/visual confirmation. The factory on Linux cannot run any of it.
- **G2 — signed device build + install.** Requires the codesign identity (team 36V92GAJBT), the push-capable explicit App ID profile (`com.zanishlabs.zot`, aps-environment present — steps in `docs/APPID.md`), and the iPhone 5A3DC1B6. Historically red: unsigned output over ssh, build exit 65, install exit 1 (`BLOCKED.md:2026-10-13`). A human must produce exit-0 build + install and confirm `aps-environment` in the decoded profile.
- **G3 — real-device runtime checks.** All of the following only pass on hardware and must be measured by the operator:
  1. APNs push token delivery: app on device receives `didRegisterForRemoteNotificationsWithDeviceToken`; hex token lands in `push_token` (sqlite) via `/api/v1/push/tokens`; a `run.done` triggers an actual APNs 200 against the sandbox with a real token (the live ping so far only got 400 with synthetic tokens — `docs/APNS.md`, `BLOCKED.md`).
  2. Pairing against a live LAN daemon with visual confirmation on the phone — the open BLOCKED.md visual gate (no screenshot tool on loki).
  3. Keychain persistence across app relaunch/reinstall on device (react-native-keychain).
  4. ATS: plain-http pairing to the LAN host succeeds through the RN Info.plist exception domains.
  5. Baked pair flavor: launch with scheme args `-ZOT_BAKED -ZOT_SERVER_URL ... -ZOT_PAIR_CODE ...` on device reaches the run list automatically.
- **G4 — provisioning/portal actions.** Creating/refreshing the push profile in the Apple developer portal is a human action; partially complete per `docs/APPID.md`. Reuse the existing explicit App ID — do not create a new bundle id.

Verification the factory CAN do on this host (so builders are never blocked before a gate): `tsc`, eslint, jest (with mocked native modules and a mock WS server), a live tracer-bullet pass against `daemon2` on 127.0.0.1:8787 (pair → runs → create → stream replay), and static checks of `rn/ios` config files (entitlement keys, ATS domains, bundle id). CI-style checks on the Swift archive (`node --check`, contract scripts) keep passing untouched.

## Glossary deltas (for GLOSSARY.md — file does not exist yet; apply these when created)

- **Bare React Native**: community-CLI RN app with a checked-in `ios/` project; not Expo. Chosen so the daemon's raw-APNs transport keeps working (ADR-001).
- **Raw APNs token**: the 64-hex device token from Apple's `didRegisterForRemoteNotificationsWithDeviceToken`; what `src/push.js:212` validates and what `/api/v1/push/tokens` stores. Contrast with an Expo push token, which this project cannot use.
- **Tracer bullet**: the thinnest end-to-end path (pair → token → runs → stream) proven against the live daemon before any UI polish.
- **Baked pair**: the automation-only pairing flavor driven by launch args (`-ZOT_BAKED`, `-ZOT_SERVER_URL`, `-ZOT_PAIR_CODE`), used by UI tests and device automation; normal users never see it.
- **Human gate**: a verification step that requires the Mac (loki) or the iPhone (5A3DC1B6) and cannot be executed on the Linux build host; the factory records it as human-required and stops.
