import SwiftUI

struct ContentView: View {
    @EnvironmentObject var session: SessionStore
    @State private var code = ""
    @State private var host = "http://zot.local:8787"
    @State private var runs: [AgentRun] = []
    @State private var error = ""
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
                    .textInputAutocapitalization(.never)
                    .disableAutocorrection(true)
            }
            Section("Pairing code") {
                TextField("6 digit code", text: $code)
                    .keyboardType(.numberPad)
                Button("Pair") { Task { await pair() } }
            }
            if !error.isEmpty { Text(error).foregroundColor(.red) }
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
                if !error.isEmpty { Text(error).foregroundColor(.red) }
            }
            .navigationTitle("Zot")
            .toolbar {
                Button("Refresh") { Task { await load() } }
                Button("Unpair") { session.client.signOut() }
            }
            .task { await load() }
        }
    }

    private func pair() async {
        error = ""
        session.client.baseURL = host
        let trimmed = code.trimmingCharacters(in: .whitespaces)
        guard trimmed.count == 6, Int(trimmed) != nil else {
            error = "Code must be 6 digits."
            return
        }
        do {
            try await session.client.confirmPair(code: trimmed, label: "iphone")
            await load()
        } catch {
            error = "Pair failed. Check code and host."
        }
    }

    private func load() async {
        do {
            runs = try await session.client.fetchRuns()
        } catch {
            error = "Fetch failed. Check LAN and token."
        }
    }

    private func send() async {
        let text = prompt.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }
        prompt = ""
        do {
            _ = try await session.client.createRun(title: String(text.prefix(40)), prompt: text)
            await load()
        } catch {
            error = "Send failed."
        }
    }
}
