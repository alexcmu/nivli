import Foundation
public struct GmailStatus: Codable, Sendable {
    public let configured: Bool
    public let state: String
    public let account: String?
    public let revision: Int
    public let labelIds: [String]
    public let initialDays: Int
    public let retentionDays: Int
    public let lastSuccessfulSync: String?
    public let syncError: String?
    public let nextSyncAt: String?
    public let pollIntervalMinutes: Int
    public let modelDataDestination: String
}
public struct GmailConsent: Codable, Sendable {
    public let labelIds: [String]
    public let initialDays: Int
    public let retentionDays: Int
    public let confirmed: Bool
    public let expectedRevision: Int
    public init(labelIds: [String], initialDays: Int, retentionDays: Int, expectedRevision: Int) {
        self.labelIds = labelIds; self.initialDays = initialDays; self.retentionDays = retentionDays
        self.expectedRevision = expectedRevision; self.confirmed = true
    }
}
public struct GmailAuthorization: Codable, Sendable { public let authorizationUrl: String; public let expiresAt: String }
private struct GmailRevision: Encodable { let expectedRevision: Int }
private struct GmailAccepted: Decodable { let accepted: Bool }
extension HaijiAPI {
    public func gmailStatus(token: String) async throws -> GmailStatus { try await request("v1/gmail", token: token, as: GmailStatus.self) }
    public func gmailConnect(token: String, consent: GmailConsent, key: String) async throws -> GmailAuthorization {
        try await request("v1/gmail/connect", method: "POST", body: JSONEncoder().encode(consent), token: token, key: key, as: GmailAuthorization.self)
    }
    public func gmailRefresh(token: String, revision: Int, key: String) async throws {
        let _: GmailAccepted = try await request("v1/gmail/refresh", method: "POST", body: JSONEncoder().encode(GmailRevision(expectedRevision: revision)), token: token, key: key, as: GmailAccepted.self)
    }
    public func gmailStop(token: String, revision: Int, key: String) async throws {
        let _: GmailAccepted = try await request("v1/gmail/stop", method: "POST", body: JSONEncoder().encode(GmailRevision(expectedRevision: revision)), token: token, key: key, as: GmailAccepted.self)
    }
}
