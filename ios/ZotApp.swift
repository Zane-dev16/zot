import SwiftUI

@main
struct ZotApp: App {
    @StateObject private var session = SessionStore()
    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(session)
        }
    }
}
