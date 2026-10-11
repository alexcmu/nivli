import Foundation
import SQLite3

public struct NotificationPlan: Codable, Sendable, Equatable {
    public let taskId: String?
    public let id: String
    public let reminderRevision: Int
    public let routingVersion: Int
    public let requestId: String
    public let scheduledAt: String
    public let timeZone: String
    public let installationStatus: String
    public let quietHoursConfirmed: Bool
    public init(taskId: String? = nil, id: String, reminderRevision: Int, routingVersion: Int, requestId: String, scheduledAt: String, timeZone: String, installationStatus: String, quietHoursConfirmed: Bool) {
        self.taskId = taskId; self.id = id; self.reminderRevision = reminderRevision; self.routingVersion = routingVersion; self.requestId = requestId; self.scheduledAt = scheduledAt; self.timeZone = timeZone; self.installationStatus = installationStatus; self.quietHoursConfirmed = quietHoursConfirmed
    }
}
public struct NotificationPlanPage: Codable, Sendable { public let plans: [NotificationPlan] }
public struct NotificationPlanCommand: Codable, Sendable {
    public let operation: String; public let occurrenceId: String; public let routingVersion: Int; public let reminderRevision: Int; public let requestId: String; public let result: String?
    public init(operation: String, plan: NotificationPlan, result: String? = nil) { self.operation = operation; occurrenceId = plan.id; routingVersion = plan.routingVersion; reminderRevision = plan.reminderRevision; requestId = plan.requestId; self.result = result }
}
extension NivliAPI {
    public func notificationPlans(deviceId: String, token: String) async throws -> NotificationPlanPage { try await request("v1/devices/\(deviceId)/notification-plans", token: token, as: NotificationPlanPage.self) }
    public func notificationPlan(deviceId: String, command: NotificationPlanCommand, token: String) async throws -> TaskRecord { try await request("v1/devices/\(deviceId)/notification-plans", method: "POST", body: JSONEncoder().encode(command), token: token, key: UUID().uuidString, as: TaskRecord.self) }
}
public enum NotificationPermission: Sendable { case notDetermined, denied, authorized }
public struct NotificationRequest: Sendable, Equatable {
    public let requestId: String; public let occurrenceId: String; public let reminderRevision: Int; public let routingVersion: Int; public let taskId: String; public let instant: Date
    public let title: String; public let body: String
    public init(requestId: String, occurrenceId: String, reminderRevision: Int, routingVersion: Int, taskId: String, instant: Date, title: String = "Nivli 提醒", body: String = "有一件事需要你查看。解锁后打开 Nivli。") { self.requestId = requestId; self.occurrenceId = occurrenceId; self.reminderRevision = reminderRevision; self.routingVersion = routingVersion; self.taskId = taskId; self.instant = instant; self.title = title; self.body = body }
}
@MainActor public protocol NotificationSystem {
    func authorization() async -> NotificationPermission
    func requestAuthorization() async throws -> Bool
    func pending() async -> [NotificationRequest]
    func add(_ request: NotificationRequest) async throws
    func remove(_ ids: [String]) async
}
public enum NotificationInstallation: String, Sendable { case installed, denied, capacity, failed, needsConfirmation, expired }

/// Journals before touching the OS, then before acknowledging the server. Retries use the server's same request identity.
@MainActor public final class LocalNotificationScheduler {
    private struct Entry: Codable { let plan: NotificationPlan; let installed: Bool; let acknowledged: Bool }
    private var db: OpaquePointer?
    private let identity: String
    private let system: any NotificationSystem
    private let capacity: Int
    public init(url: URL, identity: String, system: any NotificationSystem, capacity: Int) throws {
        self.identity = identity; self.system = system; self.capacity = capacity
        guard sqlite3_open_v2(url.path, &db, SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else { sqlite3_close(db); db = nil; throw TaskProjection.ProjectionError.storage }
        do { try execute("CREATE TABLE IF NOT EXISTS notification_journal (identity TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(identity,id))") } catch { sqlite3_close(db); db = nil; throw error }
    }
    isolated deinit { sqlite3_close(db) }
    private func execute(_ sql: String, values: [String] = [], row: ((OpaquePointer) throws -> Void)? = nil) throws {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK, let statement else { throw TaskProjection.ProjectionError.storage }
        defer { sqlite3_finalize(statement) }
        for (index, value) in values.enumerated() {
            let result = value.withCString { sqlite3_bind_text(statement, Int32(index + 1), $0, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self)) }
            guard result == SQLITE_OK else { throw TaskProjection.ProjectionError.storage }
        }
        while true { let result = sqlite3_step(statement); if result == SQLITE_DONE { break }; guard result == SQLITE_ROW else { throw TaskProjection.ProjectionError.storage }; try row?(statement) }
    }
    private func entries() throws -> [Entry] {
        var entries: [Entry] = []
        try execute("SELECT payload FROM notification_journal WHERE identity=?", values: [identity]) { statement in
            guard let text = sqlite3_column_text(statement, 0) else { throw TaskProjection.ProjectionError.storage }
            entries.append(try JSONDecoder().decode(Entry.self, from: Data(String(cString: text).utf8)))
        }
        return entries
    }
    private func save(_ entry: Entry) throws {
        try execute("INSERT INTO notification_journal(identity,id,payload) VALUES(?,?,?) ON CONFLICT(identity,id) DO UPDATE SET payload=excluded.payload", values: [identity, entry.plan.id, String(decoding: try JSONEncoder().encode(entry), as: UTF8.self)])
    }
    public func unacknowledged() throws -> [NotificationPlan] { try entries().filter { $0.installed && !$0.acknowledged }.map(\.plan) }
    public func acknowledge(_ plan: NotificationPlan) throws { try save(Entry(plan: plan, installed: true, acknowledged: true)) }
    public func clear() async throws {
        await system.remove(try entries().map { $0.plan.requestId })
        try execute("DELETE FROM notification_journal WHERE identity=?", values: [identity])
    }
    public func reconcile(current plans: [NotificationPlan]) async throws {
        let current = Set(plans.map(\.requestId))
        let obsolete = try entries().filter { !current.contains($0.plan.requestId) }
        await system.remove(obsolete.map { $0.plan.requestId })
        for entry in obsolete { try execute("DELETE FROM notification_journal WHERE identity=? AND id=?", values: [identity, entry.plan.id]) }
    }
    public func install(_ plan: NotificationPlan, requestPermission: Bool, now: Date = Date()) async throws -> NotificationInstallation {
        guard plan.quietHoursConfirmed else { return .needsConfirmation }
        var permission = await system.authorization()
        if permission == .notDetermined && requestPermission { permission = try await system.requestAuthorization() ? .authorized : .denied }
        guard permission == .authorized else { return .denied }
        let parser = ISO8601DateFormatter(); parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let instant = parser.date(from: plan.scheduledAt) ?? ISO8601DateFormatter().date(from: plan.scheduledAt), TimeZone(identifier: plan.timeZone) != nil, let taskId = plan.taskId else { return .failed }
        let pending = await system.pending()
        if let existing = pending.first(where: { $0.requestId == plan.requestId }), existing.occurrenceId == plan.id, existing.reminderRevision == plan.reminderRevision, existing.routingVersion == plan.routingVersion {
            try save(Entry(plan: plan, installed: true, acknowledged: false)); return .installed
        }
        if instant <= now {
            // A request can have fired between the OS add and receipt. Preserve the installed journal as evidence.
            if try entries().contains(where: { $0.plan.id == plan.id && $0.plan.reminderRevision == plan.reminderRevision && $0.plan.routingVersion == plan.routingVersion && $0.installed }) { return .installed }
            return .expired
        }
        guard pending.filter({ $0.requestId != plan.requestId }).count < capacity else { return .capacity }
        try save(Entry(plan: plan, installed: false, acknowledged: false))
        do { try await system.add(NotificationRequest(requestId: plan.requestId, occurrenceId: plan.id, reminderRevision: plan.reminderRevision, routingVersion: plan.routingVersion, taskId: taskId, instant: instant)) }
        catch { return .failed }
        try save(Entry(plan: plan, installed: true, acknowledged: false)); return .installed
    }
}
