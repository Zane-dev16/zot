# Zot App ID path for push

**Context.** Bundle is com.zanishlabs.zot. Team is 36V92GAJBT. Wildcard profile lacks push rights. Push needs an explicit App ID. Measured live on loki on 2026-10-03.

**Machine done.** All items measured today. No human action needed here.

- Live decode shows XC Wildcard with 36V92GAJBT star and no aps-environment key. Log lives at /tmp/zot-appid-fix.log.
- Entitlements on disk request aps-environment development. File lives at ios/Zot.entitlements. No change needed.
- Settings show bundle com.zanishlabs.zot plus team 36V92GAJBT plus entitlements path. Measured via showBuildSettings on loki.
- Simulator build returns BUILD SUCCEEDED. Device build with signing off returns the same line. Log lives at /tmp/zot-testpath-20261003.log.
- Simulator app is adhoc signed and installable. Device app is unsigned as expected. Measured via codesign.
- pbxproj patch dry run exits 0. Patch sets bundle plus team plus entitlements ref. Full diff lives in the fix log.
- prove.sh returns ALL PASS. Ran locally today.

**Human left.** Each step takes under 2 minutes. Do them in order.

1. Sit at loki console. Open Terminal as irellzane. See the prompt. Under 1 minute.
2. Allow codesign to use the login keychain. Run the partition command with the login password. See no error. Under 1 minute.
3. List codesigning identities. Confirm one line shows 36V92GAJBT. Under 1 minute.
4. Sign in to the portal. Open Identifiers under team 36V92GAJBT. See the list. Under 2 minutes.
5. Create App ID with Explicit bundle com.zanishlabs.zot. Enable Push. Press Register. See the new row. Under 2 minutes.
6. Create iOS App Development profile for that App ID. Pick the 36V92GAJBT certificate and the test device. Name it Zot Dev Push. Press Generate. Under 2 minutes.
7. Download the profile. Double click to install on loki. Confirm it appears in Xcode. Under 1 minute.
8. Open ~/zot-ios in Xcode. Confirm team and bundle. Clean build to device 5A3DC1B6. Confirm install exits 0. Under 2 minutes.
9. Decode the new profile. Confirm aps-environment is present. Under 1 minute.

**Portal land 2026-10-03.**

- App ID com.zanishlabs.zot explicit persists. Measured via prior portal log.
- No downloaded profile exists. Measured via empty find result.
- Portal flow stopped at Select an App ID. Measured via prior portal log.
- Device mapping to 5A3DC1B6 persists. Measured via prior portal log.
- Install did not run. Measured via ssh timeout.
- Ssh target showed relay mad with zero receive. Measured via tailscale output.
- Ssh probe showed connection timed out. Measured via verbose log.
- Open plus decode plus build plus install were skipped. Measured via task gate.
- Full run lives at /tmp/zot-portal-install.log. Measured via write output.
- Portal prompt text was none. All pages loaded logged in as Irell Zane. Measured via portal log.
- Ssh prompt text was connection timed out on port 22. Measured via install log.
- Installed status is no. Measured via missing build output.

**Verify.** Build output was none. Install output was none. Aps environment line was none. Measured via missing profile file.

**Profile install 2026-10-05.**

- Install status is no. Measured via missing profile file in tmp and Downloads.
- BUILD line is none. No build ran without a downloaded profile.
- INSTALL line is none. No install ran to 5A3DC1B6 without a downloaded profile.
- Aps environment line is none. Existing wildcard profile has no aps environment entry.
- Downloads on loki hold no mobileprovision file. Measured via live ssh find.
- Local tmp holds no mobileprovision file. Measured via local find.
- Device 5A3DC1B6 is available paired. Measured via live devicectl.
- Full run lives at tmp zot profile install log. Measured via local write.
- Next prompt is Apple signin for profiles add. Exact text is Sign In Apple plus Sign in to your Apple Account.
- prove.sh returns ALL PASS locally. Ran on 2026-10-05.

**Install only 2026-10-05.**

- OPEN exit is 0 measured via tmp zot install only log.
- Aps environment is development measured via profile decode in same log.
- BUILD exit is 0 with BUILD SUCCEEDED measured via same log.
- Codesign display exit is 1 with code object is not signed at all measured via same log.
- Codesign verify exit is 1 with same text measured via same log.
- INSTALL exit is 1 with integrity could not be verified plus ApplicationVerificationFailed measured via devicectl output in same log.
- Installed status is no measured via INSTALL exit 1 in same log.
- Full log lives at tmp zot install only log measured via local file copy.
- prove.sh returns ALL PASS locally. Ran on 2026-10-05.
