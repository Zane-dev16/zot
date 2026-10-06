import Foundation

struct AgentRun: Codable, Identifiable {
    let id: String
    let title: String
    let prompt: String
    let state: String
}

struct PairToken: Codable {
    let token: String
}

struct RunsResponse: Codable {
    let runs: [AgentRun]
}

struct RunResponse: Codable {
    let run: AgentRun
}

final class ApiClient: ObservableObject {
    @Published var baseURL = "http://192.168.68.50:8787"
    @Published var token: String? = Keychain.load()
    private var decoder: JSONDecoder { JSONDecoder() }

    private func cleanBase() -> String {
        var b = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        while b.hasSuffix("/") { b = String(b.dropLast()) }
        return b
    }

    private func req(_ path: String, method: String = "GET", body: Data? = nil, auth: Bool = true) throws -> URLRequest {
        guard let url = URL(string: cleanBase() + path) else { throw URLError(.badURL) }
        var r = URLRequest(url: url)
        r.httpMethod = method
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if auth, let t = token { r.setValue("Bearer \(t)", forHTTPHeaderField: "Authorization") }
        r.httpBody = body
        return r
    }

    func confirmPair(code: String, label: String) async throws {
        let payload = try JSONSerialization.data(withJSONObject: ["code": code, "label": label, "kind": "ios"])
        let r = try req("/api/v1/pair/confirm", method: "POST", body: payload, auth: false)
        let (data, resp) = try await URLSession.shared.data(for: r)
        guard [200, 201].contains((resp as? HTTPURLResponse)?.statusCode ?? 0) else { throw URLError(.userAuthenticationRequired) }
        let parsed = try decoder.decode(PairToken.self, from: data)
        await MainActor.run { token = parsed.token }
        Keychain.save(parsed.token)
    }

    func fetchRuns() async throws -> [AgentRun] {
        let r = try req("/api/v1/runs")
        let (data, _) = try await URLSession.shared.data(for: r)
        return try decoder.decode(RunsResponse.self, from: data).runs
    }

    func createRun(title: String, prompt: String) async throws -> AgentRun {
        let payload = try JSONSerialization.data(withJSONObject: ["title": title, "prompt": prompt])
        let r = try req("/api/v1/runs", method: "POST", body: payload)
        let (data, _) = try await URLSession.shared.data(for: r)
        return try decoder.decode(RunResponse.self, from: data).run
    }

    func signOut() {
        token = nil
        Keychain.delete()
    }
}

final class SessionStore: ObservableObject {
    @Published var client = ApiClient()
    var paired: Bool { client.token != nil }
}
