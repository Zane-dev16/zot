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
