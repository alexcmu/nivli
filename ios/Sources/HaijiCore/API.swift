import Foundation
public struct EnvironmentInfo: Codable, Sendable { public let name: String; public let host: String; public let pushMode: String; public let modelDataDestination: String; public let capabilities: [String] }
public struct Credentials: Codable, Sendable {
    public struct Sync: Codable, Sendable { public let state: String }
    public let ownerId: String; public let deviceId: String; public let sessionId: String
    public let accessToken: String; public let refreshToken: String
    public let accessExpiresAt: String; public let refreshExpiresAt: String
    public let capabilities: [String]; public let sync: Sync
}
public struct SessionIdentity: Codable, Sendable { public let ownerId: String; public let deviceId: String; public let sessionId: String }
public struct APIError: Decodable, Error, LocalizedError, Sendable {
    public let code: String; public let message: String; public let requestId: String; public let retryable: Bool
    public var errorDescription: String? { "\(message)（请求 \(requestId)）" }
}
private final class SameHostTransport: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) { completionHandler(nil) }
}
public struct HaijiAPI: Sendable {
    private static let transport = URLSession(configuration: .ephemeral, delegate: SameHostTransport(), delegateQueue: nil)
    public let server: URL
    private let transport: URLSession
    public init(server: URL, session: URLSession? = nil) { self.server = server; self.transport = session ?? Self.transport }
    func request<T: Decodable>(_ path: String, method: String = "GET", body: Data? = nil, token: String? = nil, key: String? = nil, as: T.Type) async throws -> T {
        let pieces = path.split(separator: "?", maxSplits: 1).map(String.init)
        var components = URLComponents(url: server.appendingPathComponent(pieces[0]), resolvingAgainstBaseURL: false)!
        if pieces.count > 1 { components.percentEncodedQuery = pieces[1] }
        var request = URLRequest(url: components.url!)
        request.httpMethod = method; request.httpBody = body; request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let key { request.setValue(key, forHTTPHeaderField: "Idempotency-Key") }
        let (data, response) = try await transport.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw PairingError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            throw (try? JSONDecoder().decode(APIError.self, from: data)) ?? APIError(code: "transport_error", message: "环境暂时无法连接，请重试。", requestId: "unknown", retryable: true)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
    public func environment() async throws -> EnvironmentInfo { try await request("v1/environment", as: EnvironmentInfo.self) }
    public func claim(code: String, deviceName: String, key: String) async throws -> Credentials {
        try await request("v1/pairings/claim", method: "POST", body: JSONEncoder().encode(["code": code, "deviceName": deviceName]), key: key, as: Credentials.self)
    }
    public func session(token: String) async throws -> SessionIdentity { try await request("v1/session", token: token, as: SessionIdentity.self) }
    public func renew(refreshToken: String, key: String) async throws -> Credentials {
        try await request("v1/session/renew", method: "POST", body: JSONEncoder().encode(["refreshToken": refreshToken]), key: key, as: Credentials.self)
    }
    public func revoke(token: String, key: String) async throws {
        var request = URLRequest(url: server.appendingPathComponent("v1/session")); request.httpMethod = "DELETE"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(key, forHTTPHeaderField: "Idempotency-Key")
        let (data, response) = try await transport.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw (try? JSONDecoder().decode(APIError.self, from: data)) ?? PairingError.invalidResponse }
    }
}

extension HaijiAPI {
    public func createTask(_ command: ManualTaskCommand, token: String) async throws -> TaskRecord {
        try await request("v1/tasks", method: "POST", body: JSONEncoder().encode(command), token: token, key: command.commandId, as: TaskRecord.self)
    }
    public func tasks(token: String, status: String = "active", cursor: String? = nil) async throws -> TaskPage {
        var query = URLComponents(); query.queryItems = [URLQueryItem(name: "status", value: status), URLQueryItem(name: "limit", value: "50")]
        if let cursor { query.queryItems?.append(URLQueryItem(name: "cursor", value: cursor)) }
        return try await request("v1/tasks?" + (query.percentEncodedQuery ?? ""), token: token, as: TaskPage.self)
    }
    public func task(id: String, token: String) async throws -> TaskRecord { try await request("v1/tasks/" + id, token: token, as: TaskRecord.self) }
}

public struct PushStatus: Codable, Sendable {
    public let configured: Bool; public let topic: String?; public let environment: String?
    public let registered: Bool; public let enabled: Bool; public let authorized: Bool; public let invalidated: Bool
}
public struct PushRegistration: Codable, Sendable {
    public let token: String; public let topic: String; public let environment: String; public let enabled: Bool; public let authorized: Bool
    public init(token: String, topic: String, environment: String, enabled: Bool, authorized: Bool) { self.token = token; self.topic = topic; self.environment = environment; self.enabled = enabled; self.authorized = authorized }
}
extension HaijiAPI {
    public func pushStatus(deviceId: String, token: String) async throws -> PushStatus { try await request("v1/devices/\(deviceId)/push", token: token, as: PushStatus.self) }
    public func registerPush(deviceId: String, registration: PushRegistration, token: String) async throws -> PushStatus { try await request("v1/devices/\(deviceId)/push", method: "PUT", body: JSONEncoder().encode(registration), token: token, key: UUID().uuidString, as: PushStatus.self) }
    public func disablePush(deviceId: String, token: String) async throws -> PushStatus { try await request("v1/devices/\(deviceId)/push", method: "DELETE", token: token, key: UUID().uuidString, as: PushStatus.self) }
    public func confirmRemote(taskId: String, occurrence: RemoteOccurrence, token: String) async throws -> TaskRecord { try await request("v1/tasks/\(taskId)/remote-confirmation", method: "POST", body: JSONEncoder().encode(RemoteConfirmation(occurrenceId: occurrence.id, reminderRevision: occurrence.reminderRevision)), token: token, key: UUID().uuidString, as: TaskRecord.self) }
}
private struct RemoteConfirmation: Codable { let occurrenceId: String; let reminderRevision: Int }
