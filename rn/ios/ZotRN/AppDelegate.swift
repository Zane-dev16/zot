import UIKit
import UserNotifications

@main
class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {
  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    // Without a delegate in front of it, a foreground push shows nothing
    // (ios/ZotApp.swift:7,23-25 does the same).
    UNUserNotificationCenter.current().delegate = self
    return true
  }

  // Foreground presentation: banner + badge + sound, as the SwiftUI app did.
  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification
  ) async -> UNNotificationPresentationOptions {
    [.banner, .badge, .sound]
  }

  // APNs callback (port of ios/ZotApp.swift:22-26): stash the lowercase hex in
  // UserDefaults so JS can reread it on launch, and notify ZotNative for the
  // in-app event. The token can arrive before the JS bundle finishes loading.
  func application(
    _ application: UIApplication,
    didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
  ) {
    let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
    UserDefaults.standard.set(hex, forKey: ZotNative.pushTokenKey)
    NotificationCenter.default.post(name: .zotPushToken, object: hex)
  }

  // Registration failure (typically a bad entitlement or provisioning profile)
  // used to vanish into an empty body, which made G2/G3 undebuggable. Log it for
  // the device console and hand the error to ZotNative so an in-flight
  // requestPushRegistration promise rejects instead of resolving true. JS turns
  // that rejection into its one error line, never a crash.
  func application(
    _ application: UIApplication,
    didFailToRegisterForRemoteNotificationsWithError error: Error
  ) {
    NSLog("ZotRN: APNs registration failed: %@", error.localizedDescription)
    NotificationCenter.default.post(
      name: .zotPushRegistrationFailed, object: error)
  }
}
