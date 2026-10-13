# APNs push config

Push is off by default. It returns skipped until env config is present. No real keys live in this repo.

**Identity.** App ID is com.zanishlabs.zot. Team is 36V92GAJBT. Entitlements hold aps-environment development at ios slash Zot.entitlements. Production uses the same App ID with a production profile later.

**Env.** Config loads from process env on every send. All values are strings. Missing team plus key plus path means unconfigured. Topic defaults to the App ID. Mode defaults to development.

Env vars in this list.

```text
APNS_TEAM_ID holds the Apple team id
APNS_KEY_ID holds the p8 key id
APNS_KEY_PATH holds the local p8 file path
APNS_TOPIC holds the push topic and defaults to com.zanishlabs.zot
APNS_MODE holds development or production and defaults to development
```

Example uses fake values only.

```text
APNS_TEAM_ID=36V92GAJBT
APNS_KEY_ID=FAKEKEY1
APNS_KEY_PATH=/tmp/fake-apns.p8
APNS_TOPIC=com.zanishlabs.zot
APNS_MODE=development
```

**Shapes.** Code calls the module the way api will. Skipped means config is missing. Queued means config is present and transport is still stubbed.

Result shapes in this list.

```text
Unconfigured send returns ok false plus skipped apns-not-configured plus configured false
Configured send returns ok true plus queued true plus configured true plus id plus topic plus mode
Invalid token returns ok false plus skipped invalid-token
```

**Tokens.** Device tokens live in sqlite table push_token. The module creates the table on first use. Register validates the 64 hex shape before storage. Re register updates the same token.

Register input in this list.

```text
POST body holds token plus optional deviceId plus optional platform
Platform accepts ios only for now
Bad token returns ok false with error invalid token
```

Live route wiring in this list.

```text
POST /api/v1/push/tokens registers one token and needs auth
GET /api/v1/push/tokens lists tokens and needs auth
DELETE /api/v1/push/tokens/:token removes one token and needs auth
```

Routes live in src api.js and call push registerToken plus listTokens plus removeToken. Bad tokens return 400. Missing auth returns 401.

**Live send.** Config accepts a PEM string in APNS_KEY_PEM or a p8 file at APNS_KEY_PATH. PEM wins when both are set. sendPush without live stays a queued stub. sendPush with live true signs an ES256 provider token and POSTs over HTTP2 to the sandbox host in development or the prod host in production. A missing or unreadable key falls back to queued so local runs never fail. The daemon fires notifyRunDone on every run.done event with live true and swallows transport errors so one bad push never kills the loop. iOS registers via PushDelegate in ZotApp swift plus registerPushToken in ApiClient swift. ContentView uploads the stored hex token after pair and on load.

Keys never live in this repo. The live verify script mints an ephemeral P-256 key in tmp and deletes it on exit.

**Verify.** Run the checks below from repo root. Both scripts use fake or ephemeral keys and stub transports. Neither touches the network.

Commands in this list.

```text
node --check src/push.js
node --check src/api.js
node --check src/daemon2.js
node --check scripts/verify-push.js
node --check scripts/verify-push-live.js
node scripts/verify-push.js
node scripts/verify-push-live.js
```

Expected output ends with register and bulk PASS lines plus ALL PASS push live with stub key.

**Live probe.** Measured on 2026-10-08 via loki sandbox with live true. Store held zero tokens measured via listTokens. Synthetic 64hex probe returned Apple 400 measured via sendPush. Worker returned zero total with skip no tokens measured via notifyRunDone. Log lives at /tmp/zot-push-ping.log. Next step is pair phone then upload token then resend for 200.

## Live ping 2026-10-13

Store held zero push tokens measured via sqlite push_token count over ssh.
Synthetic probe returned Apple 400 measured via sendPush output over ssh.
Sandbox stayed reachable measured via status 400 over ssh.
Worker returned zero total with skip no tokens measured via notifyRunDone output over ssh.
Config used team 36V92GAJBT with topic com.zanishlabs.zot in development mode measured via push config output over ssh.
Key loaded yes with 257 bytes measured via push key output over ssh.
Log lives at tmp zot keep pair log measured via local file copy.
Next step is upload one real device token then resend for Apple 200 measured via push token count 0 over ssh.
