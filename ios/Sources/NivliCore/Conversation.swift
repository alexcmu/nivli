import Foundation

public struct AcceptedInput: Codable, Sendable { public let inputId: String; public let runId: String; public let conversationId:String?; public let conversationRevision:Int? }
public struct ConversationRun: Codable, Sendable {
    public enum Status: String, Codable, Sendable { case queued, running, succeeded, clarification, needs_clarification, failed, cancelled, timed_out }
    public let id: String; public let inputId: String; public let status: Status
    public let message: String?; public let taskId: String?
    public let cost:RunCost?
    public let stillProcessing:Bool?; public let errorCode:String?;public let text:String?;public let timeZone:String?
}
public struct ModelConfiguration: Codable, Sendable {
    public let configured: Bool; public let provider: String; public let model: String; public let dataDestination: String
}
public struct RunCost:Codable,Sendable {public let reservedUsd:Double;public let usageUsd:Double;public let unknownRequests:Int;public let invoiceAvailable:Bool}
public struct ConversationHistory:Codable,Sendable {
    public let id:String; public let revision:Int;public let acceptedRevision:Int;public let messages:[ConversationMessage]
}
public struct ConversationMessage:Codable,Sendable,Identifiable {
    public var id:String {inputId};public let inputId:String;public let runId:String;public let revision:Int;public let text:String;public let timeZone:String;public let status:String;public let message:String?;public let replyToInputId:String?;public let task:TaskRecord?
}
extension NivliAPI {
    public func submitInput(text: String, timeZone: String, key: String, token: String, conversationId:String?=nil,replyToInputId:String?=nil,taskId:String?=nil) async throws -> AcceptedInput {
        var body=["text":text,"timeZone":timeZone];body["conversationId"]=conversationId;body["replyToInputId"]=replyToInputId;body["taskId"]=taskId
        return try await request("v1/inputs", method: "POST", body: JSONEncoder().encode(body), token: token, key: key, as: AcceptedInput.self)
    }
    public func run(id: String, token: String) async throws -> ConversationRun {
        try await request("v1/runs/" + id, token: token, as: ConversationRun.self)
    }
    public func retryRun(id: String, key: String, token: String) async throws -> AcceptedInput {
        try await request("v1/runs/" + id + "/retry", method: "POST", body: Data("{}".utf8), token: token, key: key, as: AcceptedInput.self)
    }
    public func conversation(id:String,token:String) async throws -> ConversationHistory {try await request("v1/conversations/"+id,token:token,as:ConversationHistory.self)}
    public func cancelRun(id:String,key:String,token:String) async throws -> ConversationRun {try await request("v1/runs/"+id+"/cancel",method:"POST",body:Data("{}".utf8),token:token,key:key,as:ConversationRun.self)}
    public func model(token: String) async throws -> ModelConfiguration { try await request("v1/model", token: token, as: ModelConfiguration.self) }
}

public struct ConversationDraft: Codable {
    public var text = ""
    public var submittedText: String?
    public var timeZone: String?
    public var key: String?
    public var runId: String?
    public var retryKey: String?
    public var conversationId:String?
    public var replyToInputId:String?
    public var taskId:String?
    public var cancelKey:String?
    public var cancellationRequested: Bool?
    public init() {}
    public mutating func cancellationKey() -> String {
        cancelKey = cancelKey ?? UUID().uuidString
        return cancelKey!
    }
    public mutating func prepareRetry() {
        if retryKey == nil {
            cancellationRequested = nil
            retryKey = UUID().uuidString
        }
    }
    public mutating func requestCancellation() { cancellationRequested = true }
    public mutating func pendingCancellationKey() -> String? {
        guard cancellationRequested == true, runId != nil, retryKey == nil else { return nil }
        return cancellationKey()
    }
    public mutating func acknowledgeCancellation(key: String) {
        guard cancelKey == key else { return }
        cancellationRequested = nil
    }
    /// A confirmed new attempt needs a new cancellation operation. Uncertain retries keep both keys.
    public mutating func acknowledgeRetry(key: String) {
        guard retryKey == key else { return }
        retryKey = nil
        cancelKey = nil
    }
}
