import UIKit

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    true
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

  // Registration failure must not take the app down; JS keeps any stashed token.
  func application(
    _ application: UIApplication,
    didFailToRegisterForRemoteNotificationsWithError error: Error
  ) {}
}
