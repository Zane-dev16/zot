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

Future route wiring in this list.

```text
POST /api/v1/push/tokens registers one token and needs auth
GET /api/v1/push/tokens lists tokens and needs auth
DELETE /api/v1/push/tokens/:token removes one token and needs auth
```

Route wiring is not done yet. Helpers parseRegisterBody plus registerToken plus listTokens plus removeToken already match those routes.

**Verify.** Run the checks below from repo root. The script uses fake env and an in memory db. It never touches the network.

Commands in this list.

```text
node --check src/push.js
node --check scripts/verify-push.js
node scripts/verify-push.js
```

Expected output ends with register and bulk PASS lines. Real APNs send is a later step. It replaces the queued branch with a signed HTTP2 call using the stored key.
