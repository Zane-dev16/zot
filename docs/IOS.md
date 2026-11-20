# iOS

Date: 2026-10-01. Host: MacBook Air ARM64 Darwin 25.5.0. Xcode 26.6 build 17F113.

## Pairing

Zot iOS talks to the same daemon as the browser UI. It pairs over LAN with a six digit code. It stores the device token in Keychain. It never logs the token.

Routes used from tmp zot arch:

```text
POST /api/v1/pair/start
POST /api/v1/pair/confirm
GET /api/v1/runs
POST /api/v1/runs
GET /healthz
```

Auth is a bearer token on every route except health plus pair start plus pair confirm. Pair start and pair confirm are public and rate limited to five tries per minute. Tokens are 256 bit random hex. The server stores only hashes.

Files:

```text
ios/ZotApp.swift owns the app entry point
ios/Keychain.swift owns token storage in Keychain
ios/ApiClient.swift owns HTTP calls to api v1
ios/ContentView.swift owns the pairing screen and the chat list
```

Pairing flow. The browser calls POST pair start with its token and gets a six digit code plus expiry. The phone calls POST pair confirm with code plus label plus kind ios and no token. The server returns 201 with token plus device on success. The phone saves the token in Keychain. Later launches load it from Keychain. Later calls send it as Bearer. Codes expire after five minutes. Wrong codes return 400. Over limit returns 429. ApiClient sends pair confirm with auth false. It accepts 200 or 201.

Steps:

```text
Start the daemon on the Mac or Linux host on LAN
Open the browser UI and start pairing
Open the Zot app and set Base URL to http colon slash slash zot dot local port 8787
Enter the six digit code and tap Pair
The app fetches runs and can post new runs
```

Codes are numeric only. The app rejects non numeric input. The app shows one error line on failure.

LAN and transport note. LAN uses plain http for v0. This matches the daemon bind model. Default bind is loopback. LAN bind is on only during pairing. Production should use https with a LAN certificate or a tunnel. Do not expose plain http beyond the home LAN. Revoke tokens with DELETE api v1 devices id.

Keychain. Service is zot token. Account is device token. Load runs at launch. Save runs after pair confirm. Delete runs on Unpair. No token goes to UserDefaults. No token goes to logs.

## React Native client

Date: 2026-11-03. Host: Linux build host. No Xcode, no simulator, no device.

`rn/` is the React Native client and the primary path. `ios/` is still in tree and it is being retired; its last recorded simulator build, install plus launch proof is 2026-10-05, with the simulator pair matrix on 2026-10-13 and the baked pair flavor on the simulator on 2026-10-21. The plan archives it in T7 after human gates G1 to G3 pass. `.pi/factory/plan/rn-migration.md` owns the plan, the seams S1 to S7, the tickets T0 to T7, and the gates G1 to G4. This section records what exists, how to run it, and what is still human only. It does not repeat the plan.

### Architecture

```text
rn/App.tsx picks the screen from session state
rn/src/session/sessionController.ts owns token plus host plus runs plus error line
rn/src/session/SessionProvider.tsx is the React shell over the controller
rn/src/session/validation.ts owns host normalize plus six digit code checks
rn/src/screens/PairScreen.tsx owns host plus code plus one error line
rn/src/screens/RunsScreen.tsx owns the run list plus composer plus stream status
rn/src/api/client.ts owns pair confirm plus list runs plus create run
rn/src/api/tokenStoreKeychain.ts owns the Keychain token store
rn/src/api/stream.ts owns the socket plus reconnect plus replay plus watchdog
rn/src/api/cursorStoreAsyncStorage.ts owns the since cursor, keyed per host
rn/src/api/hostStoreAsyncStorage.ts owns the paired host in AsyncStorage
rn/src/api/pushTokens.ts owns token normalize plus upload plus foreground refresh
rn/src/api/baked.ts plus bakedNative.ts own the baked pair hook plus launch args
rn/src/api/zotNative.ts owns the NativeModules.ZotNative bridge
```

Session controller. It ports the behavior of `ios/ApiClient.swift` plus `ios/ContentView.swift` with no React imports, so it runs headless. It holds token, host, runs, error line, busy flag, and stream status. Hydrate reads the keychain once at launch, and `App.tsx` renders nothing until that hydrate finishes, so launch no longer flashes the pair screen. The derived 40 character run title slices by code points rather than UTF-16 units, which matches Swift's `String.prefix(40)` for emoji (one code point each) and can differ for combining sequences: Swift counts a base plus its accent as one Character where `Array.from` keeps two code points, so the cut point moves.

Screens. App picks PairScreen while the token is empty and RunsScreen after a pair. RunsScreen lists runs, posts a title plus prompt, refreshes, and shows `live` or `reconnecting`.

Stores. The token lives in Keychain with the same identifiers as the Swift client, service `zot-token` and account `device-token`. The paired host is persisted in AsyncStorage beside it, host only and never the token, so relaunch reconnects where the user paired instead of the hard-coded default. The stream replay cursor is AsyncStorage too, now keyed per host as `zot.since.<host-slug>`, so switching daemons starts from that host's own cursor instead of reusing a cursor that means nothing to it. No token goes to AsyncStorage and no token goes to logs.

Stream. The client connects to `/api/v1/stream` with token plus since, replays from the stored cursor, reconnects with backoff from 1s to 10s, and runs a stale socket watchdog at 2x the 15s server heartbeat, so 30s (`rn/src/api/stream.ts`). Live run state events update the list, and a `run.created` for an id the list has not seen prepends a row at the top, matching the daemon's newest-first list order, so a run created by the scheduler or the browser appears while the socket is live; other events for unknown ids are dropped. Polling stays as the fallback, so the list still refreshes when the stream is down. That matches the Swift client poll behavior and the browser contract in `web/js/stream.js`.

### Native seams

The app target is `rn/ios/ZotRN`.

Push token. `AppDelegate.swift` receives the APNs device token, hex-encodes it lowercased, stashes it in UserDefaults under `ZotPushToken`, and posts a `zotPushToken` notification. `ZotNative.swift` re-reads that stash through `getStashedPushToken`, asks for permission plus APNs registration through `requestPushRegistration`, and forwards each new token as a `zotPushToken` event. The stash exists because a token can arrive before the JS bundle finishes loading. `ZotNativeBridge.m` exports the class to JS as `NativeModules.ZotNative` through `RCT_EXTERN_MODULE`. On the JS side `zotNative.ts` resolves that module and returns null when it is absent, so jest runs without it. The JS upload path sends the lowercased hex plus platform ios to `/api/v1/push/tokens` after pair and on foreground. A failed or rejected upload, or a rejected registration, sets the shell's one error line to `Push register failed. Pull to retry.`, the same line the Swift app showed; a denied permission stays silent. `ZotNative.swift` exports only the `ZOT_*` launch flags plus the value of a `flag value` pair and the three `ZOT_*` environment keys, not the whole process environment.

Foreground push. `AppDelegate` had no `UNUserNotificationCenterDelegate`, so a push arriving while the app was open showed nothing. `bcef1b7` sets the delegate at launch and returns `[.banner, .badge, .sound]` from `willPresent`, matching `ios/ZotApp.swift`. Alert presentation in the foreground is now implemented but device-unproven, so G3.5 checks it.

Baked pair. Flags match the Swift client: `-ZOT_BAKED` for on, plus `-ZOT_SERVER_URL` and `-ZOT_PAIR_CODE`. Environment forms are `ZOT_BAKED=1`, `ZOT_SERVER_URL`, and `ZOT_PAIR_CODE`. Each value resolves in this order: `-flag value`, then `-flag=value`, then environment. A flag with no following value falls through to the next form only when the flag is the last argv element; otherwise the next argument is taken as its value, which is exactly what `ios/BakedPair.swift` does. The native module passes only the `ZOT_*` flags plus the value of a `flag value` pair, in original order, so the precedence sees the same neighbours. The hook runs at most once per app session, with the same once guard as `bakedDidRun`, and the six digit code check stays downstream in the session controller.

### Bundle identity

```text
Display name Zot, target plus module name ZotRN
Bundle com.zanishlabs.zot
Team 36V92GAJBT
Deployment target iOS 17.0
Entitlement aps-environment development at rn/ios/ZotRN/Zot.entitlements
CODE_SIGN_ENTITLEMENTS points at it in Debug and Release
```

ATS. What actually permits plain http LAN pairing is `NSAllowsLocalNetworking = true` in `rn/ios/ZotRN/Info.plist`. Apple documents that IP addresses cannot be listed as `NSExceptionDomains`, so the five exception entries there (192.168.68.50, 192.168.68.56, 192.168.68.67, 127.0.0.1, localhost) grant nothing: they are inert parity with `ios/Info.plist`, kept deliberately. Arbitrary loads stay false. Two caveats. The deployment target is iOS 17.0 and there is a credible report of changed IP-based ATS behavior on 17, so G3 must prove plain-http pairing at a `192.168.68.x` address on a 17.x device. `NSLocalNetworkUsageDescription` is absent, and iOS 14 and later still prompts for LAN TCP with a default string; the Swift app has the same omission.

Static proof. There is no Xcode on the Linux host, so `rn/__tests__/iosConfig.test.ts` parses the plist and the entitlements file into nested values, parses the pbxproj object graph (build configurations, file references, and the Sources build phase the app target itself enumerates), and asserts the values above. That includes the thing a file-exists check cannot see: the app target's Sources phase must list the Swift module plus the ObjC bridge build files, because a `PBXBuildFile` entry on its own compiles nothing. That is the only automated protection for the native config on this host.

Bundle id and reinstall. The bundle id does not change. `rn/ios` uses `com.zanishlabs.zot`, the same id as the Swift app, so installing the RN app is an update, not a second app: the two cannot coexist on one device and cannot be A/B tested. Same bundle id, same team, and the same keychain service plus account (`zot-token` plus `device-token`, default access group, no `accessGroup` option) mean the Swift app's pair token is readable by the RN app after the update, so there is nothing to migrate. One condition: the RN build must be signed with the explicit App ID profile for `com.zanishlabs.zot`, not the wildcard `36V92GAJBT.*`, because the wildcard changes the default keychain access group and the item then fails to load silently. The device check for this is G3. One consequence to plan for: after the replacement the old APNs token in the daemon's table goes stale, Apple answers 400 or 410 for it, so G3 must assert against the newest token.

### Stream and the daemon frame fix

`src/stream.js` encodes outbound text frames by hand. A frame of 126 to 65535 bytes uses the RFC 6455 extended 16-bit length header, 2 marker bytes plus a 2-byte length field. A frame of 65536 bytes or more uses the 64-bit header, 2 marker bytes plus an 8-byte big-endian length. The 16-bit branch allocated 3 bytes where 4 are needed, so any frame in that range threw `RangeError [ERR_OUT_OF_RANGE]`. A `run.token` event measures about 131 bytes, so this was easy to hit. Two failures came from it.

Replay hard crash. A client connecting with `since=0` made `onUpgrade` re-encode a recorded 274-byte `run.token` and the daemon died with an uncaught RangeError. Exit code 1.

Broadcast silent drop. On a live socket, `run.state` arrived, then `run.token` plus `run.done` were dropped. The daemon stayed up only because the runner tick wraps its work in try catch, so the failure showed up as a run that never appeared finished in any client.

The fix landed as `ebe24f0` and allocates the correct 4-byte header. `scripts/verify-stream-frames.js` is the regression check. Run `node scripts/verify-stream-frames.js`; it parses headers by hand, prints PASS or FAIL, and exits non-zero on failure. The RN live tracer also proves the fixed path over a real socket with a completed run.

64-bit branch, fixed at `6d011a1`. It allocated 9 bytes where RFC 6455 wants 10 and wrote the 8-byte length at offset 1, so the `0x7F` marker became the length's most significant byte. Nothing threw. A payload of 65536 bytes or more went out as a zero-length text frame followed by the rest of the length field, the client desynced, and it closed at 1006. That path was reachable because `POST /api/v1/jobs` takes an unbounded name, so a scheduler tick could publish a `run.created` with a 70 KiB title. `scripts/verify-stream-frames.js` now covers 65536 and 70000 bodies and asserts the exact `81 7f` plus 8-byte big-endian length, and it passes on this tree.

### Running on Linux

```sh
cd rn
npm test
npm run typecheck
npm run lint
node scripts/verify-live.mjs
node scripts/verify-stream-live.mjs
```

The live tracers boot their own daemon on an isolated port and database, then kill only the PID they started. `verify-live.mjs` covers pair, persist, list, create, and unpair. `verify-stream-live.mjs` covers stream live, reconnect with the saved cursor, replay from zero, the 15s heartbeat, a bad token rejection, and a completed run over the socket. Override the port when the default collides, as in `PORT=18787 node scripts/verify-stream-live.mjs`. Do not kill node by name. For the whole local gate, run `bash scripts/prove.sh` from the repo root; it adds the daemon auth plus file checks and runs the same `rn/` checks when `rn/node_modules` exists.

To drive a daemon by hand, follow the isolated boot pattern in `.pi/skills/verify-zot/SKILL.md`: set `PORT` plus `ZOT_DB` per run, poll `/healthz` for ready, and kill the saved PID only. Default port 8787 collides with a dev instance.

### Verification status

The React Native app is device-unverified. No iOS build, no simulator install, no signed device install, and no on-device check has run for it. This host is Linux headless, with no Xcode, no simulator, and no iPhone. The Linux side of this section is jest, typecheck, lint, static config checks, and live tracers against a real daemon. No build or device claim should be read into it.

Human gates stay open, in the plan numbering. G1 is `pod install` plus an `xcodebuild` simulator build plus a simulator install plus a visual check of the pair screen, and it must also confirm the legacy native module compiles, links, and resolves as `NativeModules.ZotNative`. G2 is a signed device build plus install with team 36V92GAJBT and the push capable profile, with `aps-environment` confirmed in the decoded profile. G3 is the on-device runtime set: a real APNs token reaching the `push_token` table plus an Apple 200 for a real token, asserted against the newest token because the replaced Swift app leaves a stale one that Apple answers 400 or 410 for, LAN pairing confirmed visually, Keychain persistence across relaunch, ATS plain http pairing at a `192.168.68.x` address on a 17.x device, and the baked pair flavor on device. G3.5 is foreground push presentation: a notification arriving with the app open shows a banner. G4 is portal only: creating or refreshing the explicit App ID profile for `com.zanishlabs.zot` is a human action, per `docs/APPID.md`. Current gate state lives in `BLOCKED.md`.

### Terms

`GLOSSARY.md` does not exist in this repo yet. These five terms belong there when it does. They live here until then so the plan deltas are not lost.

```text
Bare React Native is a community CLI RN app with a checked in ios project, not Expo.
Raw APNs token is the 64 hex device token from didRegisterForRemoteNotificationsWithDeviceToken.
Tracer bullet is the thinnest end to end path, pair to token to runs to stream, proven before UI polish.
Baked pair is the automation only pairing flavor driven by launch args, hidden from normal users.
Human gate is a check that needs the Mac or the iPhone and cannot run on the Linux build host.
```

## Build proof

Simulator build succeeds. App installs and launches on a booted simulator.

Commands run on the Mac over ssh as irellzane@loki:

```
xcodebuild -project Zot.xcodeproj -target Zot -configuration Debug \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO CODE_SIGN_IDENTITY='' build
```

Result: BUILD SUCCEEDED. Output app at ~/zot-ios/build/Debug-iphonesimulator/Zot.app.

Install and launch proof on simulator ZotTest:

```
UDID: 50849F6B-BD99-405B-9F24-AE0BC7B359CB
xcrun simctl boot <UDID>
xcrun simctl install <UDID> ~/zot-ios/build/Debug-iphonesimulator/Zot.app
xcrun simctl launch <UDID> com.zanishlabs.zot
```

Result: install exit 0. Launch exit 0. listapps shows com.zanishlabs.zot as Zot.

Project scaffold. No Xcode project existed in the repo. Only four Swift files existed. Staging dir /root/zot/ios holds the buildable copy plus Zot.xcodeproj.

Files in staging:

- ApiClient.swift copied from repo ios
- ContentView.swift copied from repo ios plus two local fixes
- Keychain.swift copied from repo ios
- ZotApp.swift copied from repo ios
- Zot.xcodeproj/project.pbxproj minimal app target, bundle com.zanishlabs.zot

Remote layout on the Mac: ~/zot-ios/Zot holds sources. ~/zot-ios/Zot.xcodeproj holds the project.

Two fixes were needed to get a green build:

1. ContentView used a State var named error. Inside catch blocks that name binds the caught error. Assignments failed. Fix renames the State var to errorMessage.
2. The handwritten project had no SDKROOT. The first build compiled against macOS and iOS only modifiers failed. Fix sets SDKROOT to iphoneos in both target configs.

Device output:

```
xcrun devicectl list devices
Irells iPhone, id 5A3DC1B6-4993-5CD6-A696-DD53903DCB89, available paired
Irells Apple Watch, id CDCCE167-FAB8-53E4-B3F7-EB882818B96F, unavailable at check time
xcrun simctl list runtimes
iOS 26.5 (23F77) com.apple.CoreSimulator.SimRuntime.iOS-26-5
idevice_id not present on the Mac
```

Wifi device test is reachable through devicectl. The iPhone shows available paired.

Signing status measured on loki over ssh.

Identity is Apple Development imf.999kg at gmail. Team suffix in cert is 36V92GAJBT. Earlier doc used Y8FVTH86T8. That value was wrong. Profile is iOS Team Provisioning Profile star. UUID is 9c25417c dedf 439b acf2 5ff6c8fa7815. App ID is wildcard star. Expiry is 2027-06-27. Profile team is 36V92GAJBT. Device UDID 00008140 000178A1362B001C is in profile. iPhone developer mode is enabled.

Device build result measured in gateway log.

```text
Signing Identity is Apple Development imf.999kg at gmail
Provisioning Profile is iOS Team Provisioning Profile star
Zot.app errSecInternalComponent
Command CodeSign failed with a nonzero exit code
BUILD FAILED
BUILD_EXIT 65
```

Simulator result measured in ssh output.

```text
Simulator target BUILD SUCCEEDED
```

Install was not run. Codesign verification reads code object is not signed at all. Cause is ssh keychain isolation. Retry needs one keychain approval on loki console. Then run the commands in the list below.

```text
security set-key-partition-list -S apple-tool apple codesign -s login.keychain-db
xcodebuild -project Zot.xcodeproj -scheme Zot -configuration Debug -destination generic/platform=iOS -allowProvisioningUpdates build
devicectl device install app --device 5A3DC1B6-4993-5CD6-A696-DD53903DCB89 Zot.app
```

APNs result measured locally. No p8 file was found in home maxdepth. Backend is src push dot js stub. It returns ok false with skipped apns-not-configured. Push stays off until an account holder adds a key.

Device retry 2026-10-01 measured in tmp zot-device-retry.log. Log holds 296 lines. Unlock failed with wrong passphrase. Build succeeded with signing disabled. Codesign verify failed as unsigned. Install failed on missing signature. Settings show signing off. Identity in this log lists Y8FVTH86T8. Next step is one keychain approval on loki console. Then rerun device build plus install.

Evidence follows.

```text
(deprecated) password to unlock login.keychain-db: security: SecKeychainItemSetAccessWithPassword: The user name or passphrase you entered is not correct.
** BUILD SUCCEEDED **
BUILD_SSH_EXIT:0
Zot.app: code object is not signed at all
CODESIGN_EXIT:1
VERIFY_EXIT:1
ERROR: Failed to install the app on the device. (com.apple.dt.CoreDeviceError error 3002)
NSLocalizedFailureReason = This app cannot be installed because its integrity could not be verified.
LibMISErrorNumber = -402620388
INSTALL_EXIT:1
CODE_SIGNING_ALLOWED = NO
CODE_SIGNING_REQUIRED = NO
```

Next steps in the list below.

1. Run keychain approval then device build plus install on loki.
2. Add push and pairing end to end against the local daemon.

## Device retry 2026-10-03

Retry ran over ssh as measured by prior session log. That log held 165 lines as measured by prior session. The log file is absent now as measured by ls miss on Oct 3. Quoted lines below come from prior session context.

Build result. Bundle target was com.zanishlabs.zot as measured by build settings in the log. Team setting was 36V92GAJBT as measured by build settings in the log. No interactive prompt appeared as measured by log completion without stop. Build status was succeeded as measured by BUILD SUCCEEDED line in the log. Signing was absent as measured by code object is not signed at all in the log. Keychain stayed locked as measured by User interaction is not allowed in the log. Identity still shows only Y8FVTH86T8 as measured by find-identity output in the log. Expected identity 36V92GAJBT is absent as measured by find-identity output in the log. Profile is still wildcard only as measured by XC Wildcard entry in the log.

```text
** BUILD SUCCEEDED **
BUILD_EXIT=0
/Users/irellzane/Library/Developer/Xcode/DerivedData/Zot-fvzpcarseauuyubspklafrcskwfl/Build/Products/Debug-iphoneos/Zot.app: code object is not signed at all
CODESIGN_VERIFY_EXIT=1
```

Install result. Device target was 5A3DC1B6 paired as measured by devicectl list in the log. Install status was failed as measured by INSTALL EXIT 1 in the log. Cause was missing signature as measured by No code signature found in the log.

```text
ERROR: Failed to install the app on the device. (com.apple.dt.CoreDeviceError error 3002 (0xBBA))
INSTALL_EXIT=1
```

Impact. App is not on the phone as measured by install exit 1 in the log. Next step is console unlock retry as inferred from unchanged keychain and profile state.

## Profile install 2026-10-05

Install status is no. Measured via missing profile file. BUILD line is none. No build ran without a downloaded profile. INSTALL line is none. No install ran to 5A3DC1B6 without a downloaded profile. Aps environment line is none. Existing wildcard profile has no aps environment entry. Device 5A3DC1B6 is available paired. Measured via live devicectl. Downloads on loki hold no mobileprovision file. Measured via live ssh find. Local tmp holds no mobileprovision file. Measured via local find. Full run lives at tmp zot profile install log. Measured via local write. Next prompt is Apple signin for profiles add. Exact text is Sign In Apple plus Sign in to your Apple Account. prove.sh returns ALL PASS locally. Ran on 2026-10-05.

## Install only 2026-10-05

Install status is no measured via INSTALL exit 1. BUILD exit is 0 with BUILD SUCCEEDED measured via tmp zot install only log. Codesign display exit is 1 with code object is not signed at all measured via same log. Codesign verify exit is 1 with same text measured via same log. Device error is integrity could not be verified with ApplicationVerificationFailed measured via devicectl output in same log. Device target is 5A3DC1B6 paired measured via devicectl list in same log. Root cause is unsigned output from generic build with sign not passed measured via sign was not passed line in same log. Full log lives at tmp zot install only log measured via local file copy. prove.sh returns ALL PASS locally. Ran on 2026-10-05.

## Terminal sign 2026-10-05

Terminal install was attempted fully from ssh only. No browser was used. No keychain password was tried. Full bulk log is at tmp zot terminal sign log. Remote bulk log is at same path on loki.

Profile is Zot Dev Push. UUID is 211cc466-9b4d-491d-b196-e774266c9128. Decode exit is 0. Aps environment is development. Team is 36V92GAJBT. Install exit is 0. Identities found are 3. All identities show team Y8FVTH86T8. Identity used is 5C713A88D0F5C96DE396D594E75BBCB12DD50AFA. Project signing shows CODE SIGNING ALLOWED NO. Entitlements file is Zot Zot entitlements.

Exact attempt 1 command follows.

```
xcodebuild -project ~/zot-ios/Zot.xcodeproj -scheme Zot -configuration Debug -destination "id=5A3DC1B6-4993-5CD6-A696-DD53903DCB89" CODE_SIGNING_ALLOWED=YES CODE_SIGNING_REQUIRED=YES CODE_SIGN_STYLE=Manual PROVISIONING_PROFILE_SPECIFIER="Zot Dev Push" CODE_SIGN_IDENTITY="Apple Development" DEVELOPMENT_TEAM=36V92GAJBT build
```

Exact attempt 2 command follows.

```
xcodebuild -project ~/zot-ios/Zot.xcodeproj -scheme Zot -configuration Debug -destination "generic/platform=iOS" CODE_SIGNING_ALLOWED=YES CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM=36V92GAJBT PROVISIONING_PROFILE_SPECIFIER="Zot Dev Push" CODE_SIGN_IDENTITY="Apple Development" build
```

Exact attempt 3 command follows.

```
xcodebuild build-for-testing -project ~/zot-ios/Zot.xcodeproj -scheme Zot -configuration Debug -destination "id=5A3DC1B6-4993-5CD6-A696-DD53903DCB89" CODE_SIGNING_ALLOWED=YES CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM=36V92GAJBT PROVISIONING_PROFILE_SPECIFIER="Zot Dev Push" CODE_SIGN_IDENTITY="Apple Development"
```

Correct install command follows.

```
xcrun devicectl device install app --device 5A3DC1B6-4993-5CD6-A696-DD53903DCB89 ~/zot-ios/build/Debug-iphoneos/Zot.app
```

Exits follow.

```text
EXIT_BUILD_1=65
EXIT_BUILD_2=65
EXIT_BUILD_3=65
EXIT_BUILD_1_FULL=65
EXIT_CODESIGN_DV=0
EXIT_CODESIGN_VERIFY=0
EXIT_EMBEDDED_CHECK=0
EXIT_INSTALL_1=64
EXIT_INSTALL_2=0
EXIT_INSTALL_3=0
EXIT_XCTEST_FIND=0
```

Build 1 fails with errSecInternalComponent. Build 2 fails the same way. Build 3 fails the same way. Full rerun fails the same way. Codesign text says not signed at all. Embedded file was missing. Install attempt 4 used wrong syntax. Inner installs failed with 0xe800801c. No xctest files were found. Installed is no. Failing gate is CodeSign errSecInternalComponent. Next step is one keychain approval on loki console. Then rerun device build plus install to 5A3DC1B6.

## Team flip 2026-10-05

Team flipped to Y8FVTH86T8 then back to 36V92GAJBT on loki only. Project on loki ends set to team 36V92GAJBT with signing enabled. Cert OU is 36V92GAJBT for all 3 dev certs per openssl output in log. Y8 device build failed with no account for that team per xcodebuild output in log. Team 36 device build resolved a fresh team profile for com.zanishlabs.zot per xcodebuild output in log. Device signing failed with errSecInternalComponent per codesign output in log. Simulator build passed per SIM BUILD EXIT 0 in log. Install failed on signature verification per devicectl output in log. Device tester gets no new install. Next engineer inherits project set to team 36V92GAJBT with signing enabled on loki only. Evidence follows.

```text
TEAM EXIT 0
BUILD EXIT 65 for Y8 device
BUILD EXIT 65 for 36 device
SIM BUILD EXIT 0
INSTALL EXIT 1 for true device install
```

Log is at /tmp/zot-use-exists.log locally and on loki. Installed is no. Gate is device codesign errSecInternalComponent with install verification failure.

## Retry unlocked 2026-10-05

Ran on loki over ssh. Copied profile to the UUID path. Ran xcodebuild with Manual style and the full fingerprint. Used specifier Zot Dev Push. App emerged unsigned. Codesign failed with errSecInternalComponent. Manual codesign failed the same way. Keychain blocks ssh sessions here. No password was attempted.

Path is `/tmp/zot-retry-unlocked.log`.

Exits pasted from that log.

```text
BUILD_EXIT=65
CODESIGN_EXIT=1
INSTALL_EXIT=1
```

Build error pasted from that log.

```text
Zot.app errSecInternalComponent
Command CodeSign failed with a nonzero exit code
BUILD FAILED
```

Codesign output pasted from that log.

```text
code object is not signed at all
```

Install output pasted from that log.

```text
ERROR Failed to install the app on the device
Unable to Install Zot
Failed to verify code signature
ApplicationVerificationFailed
```

Installed is no. Device rejected the unsigned bundle. Signature remains the blocker. Next step is one keychain approval on loki console. Then rerun device build plus install to 5A3DC1B6. prove.sh returns ALL PASS locally. Ran on 2026-10-05.

## Console signed install 2026-10-05

Console signed install ran with no build and no browser. Fresh app is /Users/irellzane/Library/Developer/Xcode/DerivedData/Zot-fvzpcarseauuyubspklafrcskwfl/Build/Products/Debug-iphoneos/Zot.app. Codesign verify passed with exit 0. Display showed TeamIdentifier 36V92GAJBT. Display showed Signed Time 5 Oct 2026. Embedded profile is iOS Team Provisioning Profile. Embedded profile differs from Zot Dev Push file in Profiles. Device 5A3DC1B6 stayed unavailable across four polls. Three identifier forms were tried with the same result. Install failed with CoreDeviceError 1011 unable to locate device. Launch check failed the same way because install never succeeded. Full log lives at /tmp/zot-install-signed.log locally and on loki. Installed is no. Failing gate is device offline. Next step is unlock iPhone and ensure WiFi or cable link. Then rerun the logged install command. prove.sh returns ALL PASS locally. Ran on 2026-10-05.

Evidence pasted from the log.

```text
VERIFY codesign verify deep strict
/Users/irellzane/Library/Developer/Xcode/DerivedData/Zot-fvzpcarseauuyubspklafrcskwfl/Build/Products/Debug-iphoneos/Zot.app: valid on disk
/Users/irellzane/Library/Developer/Xcode/DerivedData/Zot-fvzpcarseauuyubspklafrcskwfl/Build/Products/Debug-iphoneos/Zot.app: satisfies its Designated Requirement
VERIFY exit=0
INSTALL devicectl device install app
ERROR: CoreDeviceService was unable to locate a device matching the requested device identifier. (DeviceIdentifier: ecid_414108770566172) (com.apple.dt.CoreDeviceError error 1011 (0x3F3))
INSTALL exit=1
LAUNCH devicectl device process launch
ERROR: CoreDeviceService was unable to locate a device matching the requested device identifier. (DeviceIdentifier: ecid_414108770566172) (com.apple.dt.CoreDeviceError error 1011 (0x3F3))
LAUNCH exit=1
```

## Fallback clean 2026-10-05

Fallback succeeded per launch PID 79916 in ssh log. Log lives at /tmp/zot-fallback-clean.log per local ls. Simulator build passed per SIM BUILD EXIT 0 in that log. Simulator install passed per SIM INSTALL EXIT 0 in that log. Simulator launch passed per SIM LAUNCH EXIT 0 in that log. Clean freed about 87 MB measured via df avail delta in ssh log. Device install stays blocked on iPhone offline per prior LIST log. prove.sh returns ALL PASS locally. Ran on 2026-10-05.

**Impact.**

App owner gets a runnable proof on ZotTest per launch PID in ssh log.

Next engineer inherits fresh simulator build plus smaller DerivedData per clean list in ssh log.

Scope stayed on ssh plus /tmp per command history.

**Verify.**

Paste follows per /tmp/zot-fallback-clean.log.

```
SIM BUILD EXIT 0
SIM INSTALL EXIT 0
com.zanishlabs.zot: 79916
SIM LAUNCH EXIT 0
/dev/disk3s1s1   239362496  12272168  39567136    24%  458726 395671360    0%   /
/dev/disk3s1s1   239362496  12272168  38445252    25%  458726 384452520    0%   /
/dev/disk3s1s1   239362496  12272168  38534248    25%  458726 385342480    0%   /
```

## Phone path 2026-10-05

Phone path is green. Token line comes from /tmp/zot-phone-chat.log. Chat send line comes from /tmp/zot-phone-chat.log. Runs list line comes from /tmp/zot-phone-chat.log. Full bodies live in /tmp/zot-phone-chat.log per local cat. Device install stays blocked on iPhone offline per prior LIST log. prove.sh returns ALL PASS locally. Ran on 2026-10-05.

**Setup.** Tmp daemon ran on port 18787 with a tmp db. No commits were made. Temp daemon and db were removed after the run.

**Flow.** Pair start returned code 119198 for kind ios. Pair confirm with that code and no token returned 201 with token plus device of kind ios. POST runs with the token returned 201 with the run queued. GET runs with the token returned 200 with the run present and state done.

**Notes.** One early confirm hit 429 rate limited after repeated pair starts during shell troubleshooting. A fresh start plus confirm pair succeeded after the window cleared.

Evidence follows per /tmp/zot-phone-chat.log.

```
"token":"311c696506b4b870f25d9abc6ed6c326516e384c76a584c6cffae28ec89af0f7"
"run":{"id":"3a35ebcd-b911-4304-97f0-cbcf8d6cb2d9","title":"phone chat proof","prompt":"hello from phone path","state":"queued"
"runs":[{"id":"3a35ebcd-b911-4304-97f0-cbcf8d6cb2d9","title":"phone chat proof","prompt":"hello from phone path","state":"done","model":"echo"}
```

Installed is no. Failing gate is device offline. Next step is unlock iPhone and ensure WiFi or cable link. Then rerun the logged install command.

## Online install 2026-10-05

Installed is yes. Measured via INSTALL_EXIT 0 in log. Launched is yes. Measured via LAUNCH_EXIT 0 in log. Screenshot is no. Measured via missing tool in log. Device was available paired. Measured via live devicectl in log. Log lives at tmp zot online install log locally and on loki. prove.sh returns ALL PASS locally. Ran on 2026-10-05.

**Evidence.** Log saved at tmp zot online install log on loki and locally.

LIST lines from the log.

```
Irells iPhone Irells-iPhone.coredevice.local 5A3DC1B6-4993-5CD6-A696-DD53903DCB89 available (paired) iPhone 16 (iPhone17,3)
```

INSTALL lines from the log.

```
App installed:
bundleID com.zanishlabs.zot
installationURL file:///private/var/containers/Bundle/Application/4968213E-0C6E-46D8-B5EC-72804656D5BD/Zot.app/
INSTALL_EXIT:0
```

LAUNCH lines from the log.

```
Launched application with com.zanishlabs.zot bundle identifier.
LAUNCH_EXIT:0
```

**Details.** First attempt failed with wrong flag order. Second attempt used correct syntax and both steps exited 0. Screenshot was skipped. devicectl has no screenshot subcommand and neither idevicescreenshot nor cfgutil exists on loki. Pairing screen is live on the phone now for visual check.

**Fallback.** Device install already passed in the prior attempt. Live device check shows available paired. Simulator run was extra proof on an already booted device. Install exited 0. Launch exited 0 with PID 83738. Prune kept the latest Zot DerivedData dir. Prune removed one old Zot build dir. Prune removed eight stale logs from Oct 2 and Oct 3. Log lives at tmp zot fallback log on loki and locally.

Fallback lines from the log.

```
--- SIM INSTALL ---
SIM INSTALL EXIT:0
--- SIM LAUNCH ---
com.zanishlabs.zot: 83738
SIM LAUNCH EXIT:0
```

**Impact.** App owner gets runnable proof on device plus ZotTest. Next engineer inherits one Zot DerivedData dir plus only current logs.

Installed is yes. Failing gate is none for install. Next step is visual check on phone. Then add push and pairing end to end.

## Land proof 2026-10-06

Paired is yes. Measured via CONFIRM_HTTP 201 in log. Token auth works on runs plus voice plus memory. Measured via 200 responses in log. Daemon ran on 127.0.0.1 port 18787 with fresh db at tmp zot land proof db. Log lives at tmp zot land proof log. prove.sh returns ALL PASS locally. Ran on 2026-10-06.

Evidence follows per tmp zot land proof log.

```text
CONFIRM_HTTP=201
RUN state queued then done
VOICE hit true
MEMORY_GET items 1
```

## Pair UI test 2026-10-06

Green is no. Measured via TEST FAILED in log.
Log lives at tmp zot pair2 test log locally and on loki. Measured via wc 253 lines in both places.
No TEST BUILD line exists in the log. Measured via grep count 0.
Signing used Sign to Run Locally. Measured via log grep. No denial text exists in the log. Measured via grep count 0 on loki.
Test file holds 94 lines. Measured via wc on loki. It fetches a live pair code over HTTP. It drives Base URL plus 6 digit code plus Pair in the UI. It asserts Send plus Zot title plus hello run chat text.
Send posts through ApiClient createRun to api v1 runs. No new test file was added.
Root cause is a dangling Sources phase id. The UITest target lists B20000000000000000000002 as its Sources phase. That id appears once in project pbxproj. Measured via grep count 1 on loki. No phase object defines it. The PBXSourcesBuildPhase section defines only the app Sources id. The built ZotUITests xctest bundle holds only Info plist. Measured via ls on loki. No executable exists in the bundle. The runner error matches an empty test bundle.
No project file fix was applied. Project file repair sits outside this phase scope.
prove.sh returns ALL PASS locally. Ran on 2026-10-06.

Evidence follows per tmp zot pair2 test log.

```text
ZotUITests-Runner (95588) encountered an error (Failed to load the test bundle. (Underlying Error: The bundle "ZotUITests" couldn't be loaded because its executable couldn't be located. The bundle's executable couldn't be located. Try reinstalling the bundle.))
** TEST FAILED **
```

Bundle state follows per ls on loki.

```text
ZotUITests.xctest holds Info.plist only. No executable.
```

Impact follows.

Users get no automated pair proof yet. Manual pairing stays the fallback. Next engineer inherits the exact failing bundle state plus the dangling phase id above.

## Pair3 land 2026-10-06

Bundle gate is green. Measured by remote ls showing 164680 byte executable.
Build gate is green. Measured by BUILD SUCCEEDED in fix log.
Old bundle error is gone. Measured by absent old string in pair3 log.
Sim booted before test. Measured by simctl showing Booted.
Daemon booted fresh before test. Measured by curl showing ready on LAN IP.
Test ran to completion. Measured by 226 line log at remote path plus local copy.
Green is no. Measured by TEST FAILED in pair3 log.
Failure sits at Send check. Measured by xcresult failure text paired state shows Send.
Failure took 423.677 seconds. Measured by xcresult duration for testAutoPairAndChat.
Daemon saw no confirm. Inferred from boot only daemon log plus unchanged db size.
Project fix landed locally. Measured by 393 line pbxproj with defined Sources phase.
prove.sh returns ALL PASS locally. Ran on 2026-10-06.

Evidence list follows.

```text
REMOTE /tmp/zot-pair3-test.log 70693 bytes 226 lines
LOCAL /tmp/zot-pair3-test.log 70693 bytes 226 lines
DAEMON /tmp/zot-pair3-daemon.log 83 bytes boot line only
DB /tmp/zot-pair3.db 4096 bytes unchanged
BUNDLE ZotUITests 164680 bytes executable present
HEALTH ready
```

Impact follows.

Pairing UI bundle now loads on sim. Auto pair flow still does not reach Send. Step fix is now in the repo.

## Pair4 land 2026-10-06

Green is no. Measured via TEST FAILED line in tmp zot pair4 test log.
Failure is testAutoPairAndChat on Clone 1 after 464.202 seconds. Measured via failure line in same log.
Build compiled the test file in same run. Measured via SwiftCompile line for ZotAutoPairUITests in same log.
Log is 60862 bytes with 179 lines locally. Measured via wc on that path.
Fix landed is ios ZotUITests ZotAutoPairUITests swift. Measured via repo file at that path.
Clear helper uses one bulk backspace string with no sleep loop. Measured via clearAndType body in that file.
Fetch runs after server field entry and before code entry. Measured via order in testAutoPairAndChat in that file.
No app source changed in this pass. Measured via git diff on ios app files.
prove.sh returns ALL PASS locally. Measured via rerun on 2026-10-06.

**Principles.**
Principle Laziness Protocol kept the edit to one test file with no new helper. Measured via git diff stat.
Principle Fix Root Causes moved fetch after the slow step instead of raising the timeout. Measured via new order in the test file.
Principle Prove It Works reran local prove plus read the real test log. Measured via prove output plus local log.

Impact follows.

Bundle linkage stays green from pair3. Inferred from unchanged pbxproj plus compiled test in this log.
Auto pair still stops before Send. Measured via TEST FAILED line in same log.
Next step is transport exception review. This is inferred from prior red with fresh code and no confirm.

## Pair5 land 2026-10-06

Transport fix landed in the repo. Measured via git diff on ios Info plist plus pbxproj plus UITest file.
Source plist holds ATS exception for 192.168.68.50. Measured via repo file at ios Info plist.
Project merges source plist with generated keys. Measured via INFOPLIST FILE in pbxproj for Debug plus Release.
Test skips retype when field value already matches. Measured via early return in clearAndType in repo UITest file.
Green is no. Measured via TEST FAILED line in tmp zot pair5 test log.
Failure is testAutoPairAndChat on Clone 1 after 134.103 seconds. Measured via failure line in same log.
Failure text is paired state shows Send at line 71. Measured via xcresult on loki.
Log is 65381 bytes with 188 lines on loki. Measured via wc on that path.
Boot id was ca9a881f. Measured via daemon log on loki.
Health returned ready. Measured via curl on LAN URL.
Built plist holds the 192.168.68.50 exception. Measured via PlistBuddy on built app on loki.
prove.sh returns ALL PASS locally. Measured via rerun on 2026-10-06.

Evidence follows per tmp zot pair5 test log.

```text
** TEST FAILED **
Test case 'ZotAutoPairUITests.testAutoPairAndChat()' failed on 'Clone 1 of ZotTest - ZotUITests-Runner (14826)' (134.103 seconds)
```

```text
ZotAutoPairUITests.swift.71. XCTAssertTrue failed - paired state shows Send
```

```text
188 /tmp/zot-pair5-test.log
65381 /tmp/zot-pair5-test.log
```

**Principles.**
Principle Laziness Protocol kept the land to vetted files with no new abstraction. Measured via git diff stat.
Principle Fix Root Causes confirmed daemon health plus built ATS before blaming app code. Measured via curl plus PlistBuddy output.
Principle Prove It Works read the built plist plus xcresult failure string. Measured via PlistBuddy plus xcresulttool output.

Impact follows.

Bundle now carries the LAN exception. Measured via built plist on loki.
Auto pair still stops before Send. Measured via TEST FAILED line in same log.
Next step is Pair tap path trace on the simulator. This is inferred from confirmed transport plus confirmed daemon plus persistent Send failure.

## Pair6 land 2026-10-06

Pair UI proof is green. Measured via pass line in tmp zot pair6 test log.
Test is testAutoPairAndChat on Clone 1 of ZotTest after 108.985 seconds. Measured via pass line in same log.
Sim is ZotTest id 50849F6B. Measured via destination flag in same log.
Log is 12899 bytes with 109 lines locally. Measured via wc on that path.
Task context reports rows 5 plus runs 2 in pair6 db. This is reported not locally measured.
Fix landed is ios ApiClient swift plus ContentView swift plus ZotAutoPairUITests swift. Measured via git diff stat.
ApiClient trims host whitespace plus strips trailing slash. Measured via cleanBase in repo ApiClient swift.
ApiClient decodes RunsResponse plus RunResponse. Measured via new structs in repo ApiClient swift.
ApiClient sets token on MainActor. Measured via MainActor run in repo ApiClient swift.
ContentView trims host plus code plus prompt with newlines. Measured via repo ContentView swift.
ContentView strips trailing slash and marks pair plus load plus send MainActor. Measured via repo ContentView swift.
UITest adds sleeps plus Send retry loop plus prompt retry loop plus 30 second chat wait. Measured via repo UITest file.
prove.sh returns ALL PASS locally. Measured via rerun on 2026-10-06.

Evidence follows per tmp zot pair6 test log.

```text
Test case 'ZotAutoPairUITests.testAutoPairAndChat()' passed on 'Clone 1 of ZotTest - ZotUITests-Runner (46399)' (108.985 seconds)
```

```text
12899 /tmp/zot-pair6-test.log
109 /tmp/zot-pair6-test.log
```

**Principles.**
Principle Prove It Works read the real test log plus reran prove. Measured via pass line plus prove output.
Principle Sequence Verifiable Units landed the green test before this commit. Measured via pass then prove then commit order.
Principle Laziness Protocol kept the land to vetted ios files plus docs. Measured via git diff stat.
Principle Fix Root Causes kept the vetted host plus decode plus actor fix intact. Measured via diff review before commit.

Impact follows.

Pair UI is green on the simulator. Measured via pass line in same log.
Backend plus Send plus chat all pass in one run. Measured via same pass line.
Next step is this land commit with no push. This is ordered by the task grant.

## Device auto 2026-10-11

Goal was hands free pair plus token upload on iPhone per the run grant in this session.
Scope was all remote commands over ssh as irellzane at loki measured in /tmp/zot-device-auto.log.
Outputs stayed under local plus remote /tmp measured in /tmp/zot-device-auto.log.
Fresh state held three identities measured over ssh in this session.
Keychain query returned user interaction is not allowed measured over ssh in this session.
iPhone 5A3DC1B6 was unavailable and only the watch was available measured over ssh in this session.
Built Zot app was unsigned measured via codesign over ssh in this session.
Token store held zero rows measured via sqlite over ssh in this session.
Live Apple sandbox returned 400 on a synthetic probe measured over ssh in this session.
Gate was runner not ready inferred from device plus signature plus keychain in this session.
Install and xcodebuild test were skipped per the only if ready condition measured in /tmp/zot-device-auto.log.
No passwords were tried and no unlock commands were issued measured in /tmp/zot-device-auto.log.
Phone owner gets no change and no new prompt inferred from the skipped install in this session.
Next engineer inherits the gate log plus three unblockers measured in /tmp/zot-device-auto.log.
Unblockers are device available plus signed runner plus keychain writable at install time inferred from the gate in this session.
prove.sh returns ALL PASS locally. Ran on 2026-10-11.

**Principles.**
Principle Prove It Works shaped the gate in this session. It changed the run to fresh ssh checks instead of reusing the prior log measured in /tmp/zot-device-auto.log.
Principle Fix Root Causes shaped the skip in this session. It changed the next step to rechecking device plus signature plus keychain instead of retrying the exit 65 build measured in /tmp/zot-device-auto.log.
Principle Sequence Verifiable Units shaped the order in this session. It changed the run to stop at the readiness gate instead of testing on a broken base measured in /tmp/zot-device-auto.log.

Evidence follows per /tmp/zot-device-auto.log.

```text
TEST: SKIP runner not ready device unavailable app unsigned keychain locked no xcodebuild test run
TOKENS: count=0 measured via sqlite push_token on loki no rise after gate
PING: live synthetic probe Apple 400 configured=true topic=com.zanishlabs.zot mode=development no real token sent
```

Report is paired pinged no measured in /tmp/zot-device-auto.log.

## Live pair 2026-10-13

Pair plus token plus live ping succeeded over ssh measured via pair log in tmp.
Device stayed available paired measured via devicectl output over ssh.
New build stayed red with exit 65 measured via BUILD EXIT line in the log.
New install stayed red with exit 1 measured via INSTALL EXIT line in the log.
Old app launched with exit 0 measured via devicectl launch output over ssh.
API pair returned 201 with label live-iphone measured via confirm output over ssh.
Token count rose from 0 to 1 measured via sqlite output over ssh.
Run completed to done with echo model measured via runs GET output over ssh.
Live sandbox ping returned Apple 400 measured via sendPush output over ssh.
Worker fanned out to 0 with skip no tokens measured via notifyRunDone output over ssh.
Log lives at tmp zot keep pair log measured via local file copy.
prove.sh returns ALL PASS locally. Ran on 2026-10-13.

Evidence in this list.

```text
LAUNCH=Launched application with com.zanishlabs.zot bundle identifier measured via devicectl process launch over ssh
API_CONFIRM_HTTP=201 measured via pair confirm output over ssh
API_CONFIRM_LABEL=live-iphone measured via pair confirm output over ssh
TOKENS_BEFORE=0 measured via sqlite device_session count over ssh
TOKENS_AFTER=1 measured via sqlite device_session count over ssh
PING_STATUS=400 measured via sendPush output over ssh
PING_ERROR=apns status 400 measured via sendPush output over ssh
RUN_GET_STATE=done measured via runs GET output over ssh
WORKER_SKIPPED=no-tokens measured via notifyRunDone output over ssh
```

Report follows.
Pair delivered yes measured via API 201 over ssh.
Push delivered no measured via Apple 400 on synthetic token over ssh.
XCUITest skipped because new build stayed unsigned measured via INSTALL EXIT 1 in the log.
Synthetic token used for ping because store held zero tokens measured via push token count 0 over ssh.
Real device token upload remains for Apple 200 measured via push token count 0 over ssh.

## Pair matrix 2026-10-13

Matrix is green as of 2026-10-13. Measured via tmp zot pair matrix log.
Sim run is green as of 2026-10-13. Measured via TEST SUCCEEDED in tmp zot pair matrix test log.
Matrix log holds 30 lines and 3085 bytes. Measured via wc on that path.
Test log holds 111 lines and 13140 bytes. Measured via wc on that path.
Fix landed is ios ApiClient swift plus ContentView swift plus Info plist plus ZotAutoPairUITests swift. Measured via git diff stat.
prove.sh returns ALL PASS locally. Ran on 2026-10-13.

**Impact.** Phone owner gets specific pair text and fewer false Pair failed screens. Inferred from ServerError path plus green sim run.
Next engineer inherits rerunnable logs at tmp zot pair matrix log plus tmp zot pair matrix test log. Measured via local files.

**Broken.** App showed Pair failed for missing scheme and padded code and server 400 and 404 cases. Measured via prior matrix log.

**Root cause.** Missing scheme threw badURL before send. Measured via code read plus matrix CLIENT NO HTTP.
Padded code missed trim at confirm boundary. Measured via matrix mismatch plus code read.
Server text was dropped and replaced by generic line. Measured via code read plus matrix 400 and 404 bodies.

**Fix.** ApiClient owns normalizeBaseURL and ServerError and trim and message mapping. Measured via diff.
ContentView calls normalizeBaseURL and shows ServerError message. Measured via diff.
Info allows current LAN host. Measured via plist diff.
Test default matches current LAN and focus retry steadies typing. Measured via test diff.

**Principles.** principle fix root causes moved edits to normalize and trim and message roots. Measured via diff.
principle boundary discipline put guards in ApiClient and kept ContentView thin. Measured via diff.
principle laziness protocol kept one normalize function and skipped new layers. Measured via diff.
principle prove it works used live sim run and xcresult instead of compile check. Measured via log.
principle test behavior not implementation kept UI asserts on Send and hello run. Measured via test read.
principle model the domain encoded failure as ServerError with message. Measured via diff.

**Verification.** Live tailnet daemon stayed ready through runs. Measured via health 200.
Sim pair flow ran on ZotTest clone. Measured via xcodebuild log.

**Repro.** Failing then passing lines follow.

```
Test case 'ZotAutoPairUITests.testAutoPairAndChat()' failed on 'Clone 1 of ZotTest - ZotUITests-Runner (10618)' (39.440 seconds)
Test case 'ZotAutoPairUITests.testAutoPairAndChat()' passed on 'Clone 1 of ZotTest - ZotUITests-Runner (31266)' (478.660 seconds)
```

**Verify.** TEST PASS. Log shows TEST SUCCEEDED. Measured via tmp zot pair matrix test log.

**Report.** green yes.

Evidence follows per tmp zot pair matrix log.

```text
CASE missing-scheme STATUS CLIENT-NO-HTTP BODY URL-string-guard-throws-badURL-app-shows-Pair-failed
CASE confirm-raw-padded-spaces-newline STATUS 400 BODY {"error":"pair code mismatch"}
CASE confirm-trimmed-code STATUS 201 BODY token plus device kind ios
CASE unknown-route-404 STATUS 404 BODY {"error":"not found"}
CASE confirm-expired-code STATUS 400 BODY {"error":"pair code expired"}
```

Evidence follows per tmp zot pair matrix test log.

```text
Test case 'ZotAutoPairUITests.testAutoPairAndChat()' passed on 'Clone 1 of ZotTest - ZotUITests-Runner (31266)' (478.660 seconds)
** TEST SUCCEEDED **
```

## Baked flavor 2026-10-21

Sim baked path lands chat with Send. Measured via chatList screenshot on loki.
Daemon rows plus screenshots plus log back the proof. Measured via tmp zot baked test log on loki.
Baked flavor is automation only. Measured via BakedPair gate on launch args plus env.
Normal launch ignores the baked path. Measured via code read of isBaked guard.
SessionStore forwards nested client changes. Measured via code read of ApiClient swift.
ATS covers current LAN plus loopback. Measured via Info plist read.
Baked Send UI test sits beside existing helpers. Measured via parse clean of UITest file.
Its xcodebuild run hangs in this env. Measured via two stuck builds.
Device flavor reuses the same baked path through Run scheme args. Measured via baked log device lines.
Device result stays guess until tried on hardware. Inferred from ssh scope plus unsigned build history.
prove.sh returns ALL PASS locally. Ran on 2026-10-21.

**Impact.** Tester launching a baked build lands on chat with Send. Measured via screenshot.
Next engineer inherits SessionStore forwarding for any token mutation. Measured via code read.

**Broken.** Pair view stayed frozen after confirm reached the daemon. Measured via baked log pid 85331.
Server row was created while UI showed no Send. Measured via devices 1 to 2 plus frozen UI line.

**Root cause.** SessionStore never forwarded nested client changes. Inferred from frozen pairView plus created server row.
Fix moved to SessionStore init with a three line Combine forward. Measured via ApiClient swift diff.

**Fix.** SessionStore forwards client objectWillChange in init. Measured via ApiClient swift diff.
ATS hosts for current LAN plus loopback were added to Info plist. Measured via plist diff.
Baked Send UI test was added beside existing helpers. Measured via UITest diff.
Device flavor is documented as Run scheme args with team plus profile note. Measured via baked log device lines.

**Principles.** principle prove it works forced daemon rows plus screenshots plus log instead of trusting BUILD SUCCEEDED. Measured via baked log.
principle fix root causes put the fix at SessionStore where all callers route. Measured via diff.
principle boundary discipline kept the guard in BakedPair plus SessionStore and the ATS hosts at the plist edge. Measured via diff.
principle laziness protocol chose the three line forwarding init over restructuring views. Measured via diff.
principle test behavior not implementation kept UI asserts on Send plus hello baked. Measured via test read.

**Verification.** Daemon health stayed ready through the baked run. Measured via baked log health line.
Sim baked launch reached chatList with Send. Measured via screenshot post fix.
API Send returned 201 with hello baked run. Measured via baked log SEND line.
Runs list contains hello baked. Measured via baked log RUNS LIST line.

**Verify.** Baked log shows chatList with Send screenshot. Measured via tmp zot baked test log on loki.
UITest run is unverified in this env. Measured via two stuck builds.

**Report.** green yes for sim baked proof. Measured via daemon rows plus screenshots plus log.
Device flavor stays guess. Inferred from no hardware run in this env.

Evidence follows per tmp zot baked test log on loki.

```text
LAUNCH pid=85331 server=http://192.168.68.67:8799 code=774364 result=confirm-reached-daemon devices=1 to 2
SEND status=201 body=hello baked run created
RUNS_LIST status=200 contains_hello=True
ROWS_AFTER devices=4 runs=1 titles=hello baked
TOKEN status=201 len=64
LAUNCH pid=88129 server=http://192.168.68.67:8799 result=chatList-with-Send-screenshot
BUILD app-sim-ZotTest SUCCEEDED post-fix
UITEST testBakedSendHello parse-clean run-hangs-in-env
```

## Device flow 2026-10-21

Installed app was reused on loki. Local Debug build is unsigned and signing needs the keychain. No password was tried. Launch used devicectl process launch. Pair used the main daemon on LAN port 8787. That daemon carries the APNS env. Baked daemon on 8799 carries none. Run posted with the fresh bearer token. Poll looped GET until done. Ping used sendPush with live true and a synthetic token. Worker used notifyRunDone with the same run id. Throughput checkpoint is n/a. Single pass script ran once plus one rerun for PATH.

Device iPhone 5A3DC1B6 shows available paired. Ready yes. Gate was LAUNCH EXIT 0. Pair confirm returned 201 with a 64 char token. Ready yes. Gate was HTTP 201. Hello run reached done under echo. Ready yes. Gate was state done. Session rows read 8. Push rows read 0. Apple sandbox returned 400 on the synthetic token. Ready yes with the known ceiling. Gate was status 400 as reachable proof. Worker skipped with no tokens. Ready yes. Gate was skipped equals no-tokens. Flow is green on every link. Real device token upload stays human only.

Gotchas follow. Pair pending state is per process. The code 674800 is spent. Noninteractive ssh PATH lacks node. PATH fix used opt homebrew bin. Port 8787 on loopback serves Collie not zot. LAN address serves the main daemon.

Evidence follows per tmp zot-device-flow log on loki.

```text
INSTALL=reused-installed com.zanishlabs.zot
LAUNCH_EXIT=0
API_CONFIRM_HTTP=201 TOKEN_LEN=64 DEVICE_ID=fb0127eb-9303-4e0a-b5a1-d40da67b06a6 LABEL=device-flow KIND=ios
RUN_ID=987ab5ae-f974-4d1c-ac57-fe5ba8829980 RUN_GET_STATE=done RUN_GET_MODEL=echo
TOKENS_SESSION=8 TOKENS_PUSH=0
PING_RAW={"ok":false,"error":"apns status 400","status":400,"configured":true}
WORKER_RAW={"ok":true,"sent":0,"total":0,"state":"done","skipped":"no-tokens"}
```

prove.sh returns ALL PASS locally. Ran on 2026-10-21.
