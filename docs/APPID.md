# Zot App ID path for push

**Context.** Bundle is com.zot.app. Team is 36V92GAJBT. Current wildcard profile has no aps-environment. Push needs an explicit App ID.

**Portal.** Create the explicit App ID in the portal.

Portal steps follow.

1. Open Identifiers in the developer portal.
2. Create a new App ID of type App.
3. Select Explicit and enter com.zot.app.
4. Enable the Push Notifications capability.
5. Save the App ID.
6. Create a development provisioning profile for this App ID.
7. Install the profile in Xcode.

**Entitlements.** Add aps-environment for development.

Draft file is Zot.entitlements in this folder.

1. Copy Zot.entitlements to ios slash Zot.entitlements in the repo.
2. Keep aps-environment set to development for debug builds.
3. Use production value only for release signing later.

**Patch plan.** Wire signing to the explicit App ID.

Patch steps follow.

1. Set PRODUCT_BUNDLE_IDENTIFIER to com.zot.app.
2. Set DEVELOPMENT_TEAM to 36V92GAJBT.
3. Set CODE_SIGN_ENTITLEMENTS to Zot.entitlements.
4. Enable automatic signing or select the new explicit profile.
5. Remove CODE_SIGN_ALLOWED equal NO overrides.
6. Build to a device and confirm aps-environment is present.
7. Do not create keys in this step.

**Verify.** Confirm the profile contains aps-environment. Confirm a device build installs and registers for push.

**Status.** Proof landed on loki on 2026-10-01. Entitlements file holds aps-environment development at ios slash Zot.entitlements. Project patch adds the file reference and the group entry and CODE_SIGN_ENTITLEMENTS in Debug and Release and the Push capability. Build settings proof shows CODE_SIGN_ENTITLEMENTS present. Local and remote entitlements files match. Bundle id mismatch remains open. Remote uses com.zanishlabs.zot. Task names com.zot.app. Portal step still needs the account holder. Profile refresh still needs an Xcode run. Full diff lives at slash tmp slash zot-push-cap.log.
