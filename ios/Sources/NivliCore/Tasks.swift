import Foundation
import SQLite3

public struct TaskReminder: Codable, Sendable { public let id: String; public let revision: Int; public let instant: String; public let timeZone: String; public let schedulingStatus: String }
public struct TaskDeadline: Codable, Sendable {
    public let kind: String; public let date: String?; public let instant: String?; public let timeZone: String
    public init(kind: String, date: String? = nil, instant: String? = nil, timeZone: String) { self.kind = kind; self.date = date; self.instant = instant; self.timeZone = timeZone }
}
public struct TaskSource: Codable, Sendable { public let id: String; public let kind: String; public let text: String; public let createdAt: String }
public struct TaskRecord: Codable, Identifiable, Sendable {
    public let id: String; public let ownerId: String; public let revision: Int; public let status: String
    public let title: String; public let background: String; public let reminder: TaskReminder?; public let deadline: TaskDeadline?
    public let sources: [TaskSource]; public let createdAt: String; public let updatedAt: String
}
public struct ManualTaskCommand: Codable, Sendable {
    public struct Reminder: Codable, Sendable { public let instant: String; public let timeZone: String; public init(instant: String, timeZone: String) { self.instant = instant; self.timeZone = timeZone } }
    public let taskId: String; public let commandId: String; public let title: String; public let background: String
    public let reminder: Reminder?; public let deadline: TaskDeadline?
    public init(taskId: String = UUID().uuidString, commandId: String = UUID().uuidString, title: String, background: String, reminder: Reminder?, deadline: TaskDeadline?) {
        self.taskId = taskId; self.commandId = commandId; self.title = title; self.background = background; self.reminder = reminder; self.deadline = deadline
    }
}
public struct TaskPage: Codable, Sendable { public let tasks: [TaskRecord]; public let nextCursor: String? }

/// A local projection is namespaced by server, owner and device; it never stores credentials.
public final class TaskProjection {
    private var db: OpaquePointer?
    private let identity: String
    public init(url: URL, identity: String) throws {
        self.identity = identity
        guard sqlite3_open_v2(url.path, &db, SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else { sqlite3_close(db); db = nil; throw ProjectionError.storage }
        do { try execute("CREATE TABLE IF NOT EXISTS task_projection (identity TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(identity,id))") } catch { sqlite3_close(db); db = nil; throw error }
    }
    deinit { sqlite3_close(db) }
    private func execute(_ sql: String, values: [String] = [], row: ((OpaquePointer) throws -> Void)? = nil) throws {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK, let statement else { throw ProjectionError.storage }
        defer { sqlite3_finalize(statement) }
        for (index, value) in values.enumerated() {
            let result = value.withCString { sqlite3_bind_text(statement, Int32(index + 1), $0, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self)) }
            guard result == SQLITE_OK else { throw ProjectionError.storage }
        }
        while true {
            let result = sqlite3_step(statement)
            if result == SQLITE_DONE { break }
            guard result == SQLITE_ROW else { throw ProjectionError.storage }
            try row?(statement)
        }
    }
    public func save(_ task: TaskRecord) throws {
        let payload = String(decoding: try JSONEncoder().encode(task), as: UTF8.self)
        try execute("INSERT INTO task_projection(identity,id,payload) VALUES(?,?,?) ON CONFLICT(identity,id) DO UPDATE SET payload=excluded.payload", values: [identity, task.id, payload])
    }
    public func tasks(status: String) throws -> [TaskRecord] {
        var tasks: [TaskRecord] = []
        try execute("SELECT payload FROM task_projection WHERE identity=?", values: [identity]) { statement in
            guard let text = sqlite3_column_text(statement, 0) else { throw ProjectionError.storage }
            let task = try JSONDecoder().decode(TaskRecord.self, from: Data(String(cString: text).utf8))
            if task.status == status { tasks.append(task) }
        }
        return tasks.sorted { ($0.reminder?.instant ?? "~", $0.id) < ($1.reminder?.instant ?? "~", $1.id) }
    }
    public func clear() throws { try execute("DELETE FROM task_projection WHERE identity=?", values: [identity]) }
    public enum ProjectionError: Error, LocalizedError { case storage; public var errorDescription: String? { "无法读取或保存本机事项。请检查设备存储后重试。" } }
}
