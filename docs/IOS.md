# iOS

Zot iOS talks to the same daemon as the browser UI. It pairs over LAN with a six digit code. It stores the device token in Keychain. It never logs the token.

## Routes used

The app uses these paths from tmp zot arch.

List:

```text
POST /api/v1/pair/confirm
GET /api/v1/runs
POST /api/v1/runs
GET /healthz
```

Auth is a bearer token on every route except health and pairing start. Pairing is rate limited to five tries per minute. Tokens are 256 bit random hex. The server stores only hashes.

## Files

The stub lives in ios on Linux and in tmp zot ios stub on the Mac.

List:

```text
ios/ZotApp.swift owns the app entry point
ios/Keychain.swift owns token storage in Keychain
ios/ApiClient.swift owns HTTP calls to api v1
ios/ContentView.swift owns the pairing screen and the chat list
```

## Pairing flow

The browser calls pair start and shows a six digit code. The phone enters the code within five minutes. The server issues a device token. The phone saves it in Keychain. Later launches load it from Keychain.

Steps:

```text
Start the daemon on the Mac or Linux host on LAN
Open the browser UI and start pairing
Open the Zot app and set Base URL to http colon slash slash zot dot local port 8787
Enter the six digit code and tap Pair
The app fetches runs and can post new runs
```

Codes are numeric only. The app rejects non numeric input. The app shows one error line on failure.

## LAN and transport note

LAN uses plain http for v0. This matches the daemon bind model. Default bind is loopback. LAN bind is on only during pairing. Production should use https with a LAN certificate or a tunnel. Do not expose plain http beyond the home LAN. Revoke tokens with DELETE api v1 devices id.

## Keychain

Service is zot token. Account is device token. Load runs at launch. Save runs after pair confirm. Delete runs on Unpair. No token goes to UserDefaults. No token goes to logs.

## Mac proof

Remote stub was built over ssh on an ARM Mac. Xcode exists but no full xcodebuild ran. Proof is swift version plus file list.

Output:

```text
Darwin Irells-MacBook-Air-2.local 25.5.0 Darwin Kernel Version 25.5.0 Mon Apr 27 20:40:51 PDT 2026 root:xnu-12377.121.6~2/RELEASE_ARM64_T8112 arm64
swift-driver version 1.148.6 Apple Swift version 6.3.3 (swiftlang-6.3.3.1.3 clang-2100.1.1.101)
Target arm64-apple-macosx26.0
/tmp/zot-ios-stub/Zot/ApiClient.swift 61 lines
/tmp/zot-ios-stub/Zot/ContentView.swift 98 lines
/tmp/zot-ios-stub/Zot/Keychain.swift 42 lines
/tmp/zot-ios-stub/Zot/ZotApp.swift 12 lines
```

Local check is ls ios on Linux. Remote check is uname plus swift version over ssh. Both passed.
