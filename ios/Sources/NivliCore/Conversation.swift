import Foundation

public struct AcceptedInput: Codable, Sendable { public let inputId: String; public let runId: String }
public struct ConversationRun: Codable, Sendable {
    public enum Status: String, Codable, Sendable { case queued, running, succeeded, clarification, failed }
    public let id: String; public let inputId: String; public let status: Status
    public let message: String?; public let taskId: String?
}
public struct ModelConfiguration: Codable, Sendable {
    public let configured: Bool; public let provider: String; public let model: String; public let dataDestination: String
}
extension NivliAPI {
    public func submitInput(text: String, timeZone: String, key: String, token: String) async throws -> AcceptedInput {
        try await request("v1/inputs", method: "POST", body: JSONEncoder().encode(["text": text, "timeZone": timeZone]), token: token, key: key, as: AcceptedInput.self)
    }
    public func run(id: String, token: String) async throws -> ConversationRun {
        try await request("v1/runs/" + id, token: token, as: ConversationRun.self)
    }
    public func retryRun(id: String, key: String, token: String) async throws -> AcceptedInput {
        try await request("v1/runs/" + id + "/retry", method: "POST", body: Data("{}".utf8), token: token, key: key, as: AcceptedInput.self)
    }
    public func model(token: String) async throws -> ModelConfiguration { try await request("v1/model", token: token, as: ModelConfiguration.self) }
}
