import Foundation
import React
import UIKit
import UserNotifications

// Legacy bridge module exported to JS as NativeModules.ZotNative through
// ZotNativeBridge.m (RCT_EXTERN_MODULE). The app builds with RCTNewArchEnabled;
// legacy modules load through the TurboModule interop layer, so this small
// surface avoids a codegen spec + podspec that cannot be compiled on this host.
//
// Contract (ios/ZotApp.swift + ios/BakedPair.swift):
// - launchArguments/launchEnvironment constants feed the baked pair adapter;
// - requestPushRegistration asks for permission then registers with APNs;
// - getStashedPushToken rereads UserDefaults["ZotPushToken"] so a token that
//   arrived before JS loaded is not lost;
// - zotPushToken events deliver each new lowercase hex token immediately.
@objc(ZotNative)
final class ZotNative: RCTEventEmitter {
  static let pushTokenKey = "ZotPushToken"
  static let tokenEvent = "zotPushToken"

  private var hasListeners = false

  // Optional RCTBridgeModule method (RCTBridgeModule.h:372); RCTEventEmitter
  // does not implement it, so this must not be marked `override`.
  @objc func constantsToExport() -> [AnyHashable: Any]! {
    return [
      "launchArguments": ProcessInfo.processInfo.arguments,
      "launchEnvironment": ProcessInfo.processInfo.environment,
    ]
  }

  @objc static func requiresMainQueueSetup() -> Bool {
    return false
  }

  override func supportedEvents() -> [String]! {
    return [Self.tokenEvent]
  }

  override func startObserving() {
    hasListeners = true
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(pushTokenChanged(_:)),
      name: .zotPushToken,
      object: nil)
  }

  override func stopObserving() {
    hasListeners = false
    NotificationCenter.default.removeObserver(
      self,
      name: .zotPushToken,
      object: nil)
  }

  @objc private func pushTokenChanged(_ note: Notification) {
    guard hasListeners, let hex = note.object as? String else { return }
    sendEvent(withName: Self.tokenEvent, body: hex)
  }

  @objc(requestPushRegistration:rejecter:)
  func requestPushRegistration(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    UNUserNotificationCenter.current().requestAuthorization(
      options: [.alert, .badge, .sound]
    ) { granted, _ in
      DispatchQueue.main.async {
        if granted {
          UIApplication.shared.registerForRemoteNotifications()
        }
        resolve(granted)
      }
    }
  }

  @objc(getStashedPushToken:rejecter:)
  func getStashedPushToken(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let hex = UserDefaults.standard.string(forKey: Self.pushTokenKey)
    // NSNull bridges to JS null when no token has ever been stored.
    resolve(hex ?? NSNull())
  }
}

extension Notification.Name {
  // Same notification ios/ZotApp.swift posts from the APNs callback.
  static let zotPushToken = Notification.Name("zotPushToken")
}
