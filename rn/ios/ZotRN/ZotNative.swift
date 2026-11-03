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

  /// The only launch flags ios/BakedPair.swift:15-22 looks at: presence-only
  /// `-ZOT_BAKED`, then the two that take a `-flag value` neighbour.
  static let valuedFlags = ["-ZOT_SERVER_URL", "-ZOT_PAIR_CODE"]
  /// The only environment keys it reads (ios/BakedPair.swift:22-28).
  static let bakedEnvKeys = ["ZOT_BAKED", "ZOT_SERVER_URL", "ZOT_PAIR_CODE"]

  // A registration request settles on the first of: device token, APNs
  // failure, or the timeout below. Only the failure rejects.
  private var pendingResolve: RCTPromiseResolveBlock?
  private var pendingReject: RCTPromiseRejectBlock?
  private var pendingObservers: [NSObjectProtocol] = []
  private let registrationTimeout: TimeInterval = 10

  /// Optional RCTBridgeModule method (RCTBridgeModule.h:372); RCTEventEmitter
  /// does not implement it, so this must not be marked `override`.
  ///
  /// Only the baked-pair inputs cross the bridge. Swift's original reads those
  /// three keys out of ProcessInfo (ios/BakedPair.swift:22-28); exporting the
  /// whole environment and argv instead would hand JS every secret the app was
  /// launched with, and nothing on the JS side reads the rest.
  @objc func constantsToExport() -> [AnyHashable: Any]! {
    let info = ProcessInfo.processInfo
    return [
      "launchArguments": Self.bakedArguments(from: info.arguments),
      "launchEnvironment": Self.bakedEnvironment(from: info.environment),
    ]
  }

  /// Keeps each -ZOT_* flag plus the value a `-flag value` pair needs, in the
  /// original order and adjacency, so BakedPair's precedence still reads the
  /// same neighbour. Presence-only flags (-ZOT_BAKED) never consume a value:
  /// doing so ate the following -ZOT_SERVER_URL and orphaned its value.
  static func bakedArguments(from args: [String]) -> [String] {
    var keep = Set<Int>()
    for (index, arg) in args.enumerated() {
      guard arg.hasPrefix("-ZOT_") else { continue }
      keep.insert(index)
      if Self.valuedFlags.contains(arg), index + 1 < args.count {
        keep.insert(index + 1)
      }
    }
    // Subset in place: a kept value stays adjacent to its flag because nothing
    // can be kept between two consecutive indices anyway.
    return args.enumerated()
      .filter { keep.contains($0.offset) }
      .map { $0.element }
  }

  /// Just the ZOT_* keys that are actually set; nothing else leaves the process.
  static func bakedEnvironment(from env: [String: String]) -> [String: String] {
    var kept: [String: String] = [:]
    for key in Self.bakedEnvKeys {
      if let value = env[key] {
        kept[key] = value
      }
    }
    return kept
  }

  @objc static func requiresMainQueueSetup() -> Bool {
    return false
  }

  override func supportedEvents() -> [String]! {
    return [Self.tokenEvent]
  }

  override func startObserving() {
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(pushTokenChanged(_:)),
      name: .zotPushToken,
      object: nil)
  }

  override func stopObserving() {
    NotificationCenter.default.removeObserver(
      self,
      name: .zotPushToken,
      object: nil)
  }

  // RCTEventEmitter already gates sendEvent on its own listener count, so a
  // second flag here was dead state.
  @objc private func pushTokenChanged(_ note: Notification) {
    guard let hex = note.object as? String else { return }
    sendEvent(withName: Self.tokenEvent, body: hex)
  }

  @objc(requestPushRegistration:rejecter:)
  func requestPushRegistration(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    UNUserNotificationCenter.current().requestAuthorization(
      options: [.alert, .badge, .sound]
    ) { [weak self] granted, error in
      DispatchQueue.main.async {
        if let error = error {
          reject(
            "E_PUSH_PERMISSION",
            "Notification permission request failed: \(error.localizedDescription)",
            error)
          return
        }
        // Declining permission is a user choice, not a failure: resolve false
        // and let JS stay silent.
        guard granted else {
          resolve(false)
          return
        }
        self?.awaitRegistration(resolve: resolve, reject: reject)
        UIApplication.shared.registerForRemoteNotifications()
      }
    }
  }

  /// APNs answers through AppDelegate: a device token (posted as .zotPushToken)
  /// or a failure (posted as .zotPushRegistrationFailed). Resolving true right
  /// away hid a bad entitlement, so the promise waits for the first real answer.
  private func awaitRegistration(
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    clearPending()
    pendingResolve = resolve
    pendingReject = reject
    let center = NotificationCenter.default
    pendingObservers.append(
      center.addObserver(
        forName: .zotPushToken, object: nil, queue: .main
      ) { [weak self] _ in
        self?.finishResolved(true)
      })
    pendingObservers.append(
      center.addObserver(
        forName: .zotPushRegistrationFailed, object: nil, queue: .main
      ) { [weak self] note in
        self?.finishRejected(note.object as? Error)
      })
    // No answer in time means the OS accepted the registration but the token
    // has not arrived yet; JS rereads UserDefaults on the next foreground.
    DispatchQueue.main.asyncAfter(deadline: .now() + registrationTimeout) { [weak self] in
      self?.finishResolved(true)
    }
  }

  private func clearPending() {
    pendingResolve = nil
    pendingReject = nil
    for observer in pendingObservers {
      NotificationCenter.default.removeObserver(observer)
    }
    pendingObservers.removeAll()
  }

  private func finishResolved(_ value: Bool) {
    guard let resolve = pendingResolve else { return }
    clearPending()
    resolve(value)
  }

  private func finishRejected(_ error: Error?) {
    guard let reject = pendingReject else { return }
    clearPending()
    let message = error?.localizedDescription ?? "APNs registration failed"
    reject("E_PUSH_REGISTRATION", message, error)
  }

  @objc(getStashedPushToken:rejecter:)
  func getStashedPushToken(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    // RCTPromiseResolveBlock already takes Any?, so a missing token bridges to
    // JS null on its own; wrapping it in NSNull only worked by convention.
    resolve(UserDefaults.standard.string(forKey: Self.pushTokenKey))
  }
}

extension Notification.Name {
  // Same notification ios/ZotApp.swift posts from the APNs callback.
  static let zotPushToken = Notification.Name("zotPushToken")
  // APNs refused registration (usually entitlements or provisioning).
  static let zotPushRegistrationFailed = Notification.Name(
    "zotPushRegistrationFailed")
}
