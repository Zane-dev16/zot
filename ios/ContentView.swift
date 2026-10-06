import SwiftUI

struct ContentView: View {
    @EnvironmentObject var session: SessionStore
    @State private var code = ""
    @State private var host = "http://192.168.68.50:8787"
    @State private var runs: [AgentRun] = []
    @State private var errorMessage = ""
    @State private var prompt = ""

    var body: some View {
        if session.client.token == nil {
            pairView
        } else {
            chatList
        }
    }

    private var pairView: some View {
        Form {
            Section("Server") {
                TextField("Base URL", text: $host)
                    .disableAutocorrection(true)
            }
            Section("Pairing code") {
                TextField("6 digit code", text: $code)
                    .keyboardType(.numberPad)
                Button("Pair") { Task { await pair() } }
            }
            if !errorMessage.isEmpty { Text(errorMessage).foregroundColor(.red) }
            Text("Ask the browser UI for the code. It expires in 5 minutes.")
                .font(.footnote)
        }
    }

    private var chatList: some View {
        NavigationView {
            List {
                Section("New run") {
                    TextField("Prompt", text: $prompt)
                    Button("Send") { Task { await send() } }
                }
                Section("Runs") {
                    ForEach(runs) { run in
                        VStack(alignment: .leading) {
                            Text(run.title).font(.headline)
                            Text(run.state).font(.caption)
                        }
                    }
                }
                if !errorMessage.isEmpty { Text(errorMessage).foregroundColor(.red) }
            }
            .navigationTitle("Zot")
            .toolbar {
                Button("Refresh") { Task { await load() } }
                Button("Unpair") { session.client.signOut() }
            }
            .task { await load() }
        }
    }

    @MainActor private func pair() async {
        errorMessage = ""
        var h = host.trimmingCharacters(in: .whitespacesAndNewlines)
        while h.hasSuffix("/") { h = String(h.dropLast()) }
        session.client.baseURL = h
        let trimmed = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count == 6, Int(trimmed) != nil else {
            errorMessage = "Code must be 6 digits."
            return
        }
        do {
            try await session.client.confirmPair(code: trimmed, label: "iphone")
            await load()
        } catch {
            errorMessage = "Pair failed. Check code and host."
        }
    }

    @MainActor private func load() async {
        do {
            runs = try await session.client.fetchRuns()
        } catch {
            errorMessage = "Fetch failed. Check LAN and token."
        }
    }

    @MainActor private func send() async {
        let text = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        prompt = ""
        do {
            _ = try await session.client.createRun(title: String(text.prefix(40)), prompt: text)
            await load()
        } catch {
            errorMessage = "Send failed."
        }
    }
}
