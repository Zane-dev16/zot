import Foundation
import Combine

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

struct ServerError: Error, LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

struct ErrorBody: Decodable {
    let error: String?
}

func normalizeBaseURL(_ raw: String) -> String {
    var b = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    while b.hasSuffix("/") {
        b = String(b.dropLast())
        b = b.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    if b.isEmpty { return b }
    if !b.contains("://") { b = "http://" + b }
    return b
}

final class ApiClient: ObservableObject {
    @Published var baseURL = "http://192.168.68.56:8787"
    @Published var token: String? = Keychain.load()
    private var decoder: JSONDecoder { JSONDecoder() }

    private func cleanBase() -> String {
        normalizeBaseURL(baseURL)
    }

    private func req(_ path: String, method: String = "GET", body: Data? = nil, auth: Bool = true) throws -> URLRequest {
        guard let url = URL(string: cleanBase() + path) else { throw ServerError(message: "Invalid host. Add http:// and check host.") }
        var r = URLRequest(url: url)
        r.httpMethod = method
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if auth, let t = token { r.setValue("Bearer \(t)", forHTTPHeaderField: "Authorization") }
        r.httpBody = body
        return r
    }

    func confirmPair(code: String, label: String) async throws {
        let cleanCode = code.trimmingCharacters(in: .whitespacesAndNewlines)
        let payload = try JSONSerialization.data(withJSONObject: ["code": cleanCode, "label": label, "kind": "ios"])
        let r = try req("/api/v1/pair/confirm", method: "POST", body: payload, auth: false)
        let (data, resp) = try await URLSession.shared.data(for: r)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard [200, 201].contains(status) else {
            if let eb = try? decoder.decode(ErrorBody.self, from: data), let m = eb.error, !m.isEmpty {
                throw ServerError(message: m)
            }
            if let s = String(data: data, encoding: .utf8), !s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, s.count < 300 {
                throw ServerError(message: s)
            }
            throw ServerError(message: "Pair failed (status \(status)). Check code and host.")
        }
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

    func registerPushToken(_ deviceToken: String) async throws {
        let cleaned = deviceToken.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let payload = try JSONSerialization.data(withJSONObject: ["token": cleaned, "platform": "ios"])
        let r = try req("/api/v1/push/tokens", method: "POST", body: payload)
        let (_, resp) = try await URLSession.shared.data(for: r)
        guard [200, 201].contains((resp as? HTTPURLResponse)?.statusCode ?? 0) else { throw URLError(.cannotWriteToFile) }
    }

    func signOut() {
        token = nil
        Keychain.delete()
    }
}

final class SessionStore: ObservableObject {
    @Published var client = ApiClient()
    private var bag = Set<AnyCancellable>()
    init() {
        client.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }.store(in: &bag)
    }
    var paired: Bool { client.token != nil }
}
