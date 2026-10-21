import Foundation

// Automation only. Baked pair flavor for sim and device runs via scheme args.
// Normal app path ignores this file. Baked path activates only with the flag below.
struct BakedPairConfig {
  let serverURL: String
  let code: String
}

enum BakedPair {
  static var isBaked: Bool {
    let args = ProcessInfo.processInfo.arguments
    if args.contains("-ZOT_BAKED") { return true }
    return ProcessInfo.processInfo.environment["ZOT_BAKED"] == "1"
  }
  static func config() -> BakedPairConfig? {
    guard isBaked else { return nil }
    guard let server = value(flag: "-ZOT_SERVER_URL", env: "ZOT_SERVER_URL"), !server.isEmpty else { return nil }
    guard let code = value(flag: "-ZOT_PAIR_CODE", env: "ZOT_PAIR_CODE"), !code.isEmpty else { return nil }
    return BakedPairConfig(serverURL: server, code: code)
  }
  private static func value(flag: String, env: String) -> String? {
    let args = ProcessInfo.processInfo.arguments
    if let i = args.firstIndex(of: flag), i + 1 < args.count { return args[i + 1] }
    let prefix = flag + "="
    if let hit = args.first(where: { $0.hasPrefix(prefix) }) { return String(hit.dropFirst(prefix.count)) }
    return ProcessInfo.processInfo.environment[env]
  }
}
