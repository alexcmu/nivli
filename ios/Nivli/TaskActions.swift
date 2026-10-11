import SwiftUI
import CryptoKit

/// Stores the exact request before transport; a lost response can be retried after relaunch.
@MainActor enum TaskActionTransport {
    private struct Attempt: Codable { let taskId: String; let command: TaskActionCommand }
    private static func store(_ session: SavedSession, _ taskId: String) -> SecureStore {
        let identity = IOSNotificationSystem.namespace(session)
        return SecureStore(account: "task-action-" + identity + "-" + taskId)
    }
    static func pending(_ taskId: String, session: SavedSession) throws -> TaskActionCommand? { try store(session, taskId).read(Attempt.self)?.command }
    static func execute(_ taskId: String, command: TaskActionCommand, session: SavedSession) async throws -> TaskRecord {
        let storage = store(session, taskId)
        try storage.save(Attempt(taskId: taskId, command: command))
        do {
            _ = try await NivliAPI(server: session.server).taskAction(id: taskId, command: command, token: session.credentials.accessToken)
            // Replay result is historical. Always project current state before updating plans.
            let latest = try await NivliAPI(server: session.server).task(id: taskId, token: session.credentials.accessToken)
            try storage.remove()
            _ = await NotificationCoordinator().synchronize(session)
            return (try? await NivliAPI(server: session.server).task(id: taskId, token: session.credentials.accessToken)) ?? latest
        } catch {
            if let error = error as? APIError, !error.retryable { try? storage.remove() }
            throw error
        }
    }
}

struct TaskActionControls: View {
    let task: TaskRecord
    @Bindable var connection: Connection
    var initialUndoMutation: String? = nil
    let updated: (TaskRecord) -> Void
    @State private var reminderDate = Date().addingTimeInterval(1800)
    @State private var title = ""
    @State private var background = ""
    @State private var busy = false
    @State private var error: String?
    @State private var retry: TaskActionCommand?
    @State private var undoMutation: String?
    @State private var chooseTime = false
    @State private var editing = false
    @State private var deadlineKind = "keep"
    @State private var deadlineDate = Date().addingTimeInterval(86400)
    var body: some View {
        Section("处理事项") {
            if task.status == "active" {
                Button("完成事项", systemImage: "checkmark.circle") { act("complete") }
                Button("30 分钟后提醒", systemImage: "clock") { act("snooze", reminder: Date().addingTimeInterval(1800)) }
                Button("选择提醒时间") { chooseTime = true }
                Button("修改事项") { title = task.title; background = task.background; editing = true }
                Button("取消事项", role: .destructive) { act("cancel") }
            } else { Button("恢复事项并选择新提醒时间") { chooseTime = true } }
            if let undoMutation { Button("撤销上次操作", systemImage: "arrow.uturn.backward") { act("undo", target: undoMutation) } }
            if let retry { Button("重试未确认的操作") { submit(retry) } }
            if let error { Text(error).foregroundStyle(.red) }
            if busy { ProgressView("正在更新…") }
        }.disabled(busy || connection.saved == nil)
        .sheet(isPresented: $chooseTime) {
            NavigationStack { Form {
                DatePicker("新的提醒时间", selection: $reminderDate, in: Date()...)
                Text(taskDate(isoDate(reminderDate), zone: task.reminder?.timeZone ?? TimeZone.current.identifier))
                if let deadline = task.deadline { Text("截止时间保持为：" + (deadline.date ?? taskDate(deadline.instant ?? "", zone: deadline.timeZone))) }
                Text("若选择安静时段，保存后需要明确确认才会安排通知。")
                Button("保存提醒时间") { chooseTime = false; act(task.status == "active" ? "snooze" : "restore", reminder: reminderDate) }
            }.navigationTitle("调整提醒").toolbar { Button("取消") { chooseTime = false } } }
        }
        .sheet(isPresented: $editing) {
            NavigationStack { Form { TextField("事项标题", text: $title); TextField("背景", text: $background, axis: .vertical); Picker("截止时间", selection: $deadlineKind) { Text("保持原截止").tag("keep"); Text("无截止").tag("none"); Text("仅日期").tag("date"); Text("具体时间").tag("instant") }; if deadlineKind == "date" || deadlineKind == "instant" { DatePicker("新截止", selection: $deadlineDate, displayedComponents: deadlineKind == "date" ? [.date] : [.date, .hourAndMinute]) }; Button("保存修改") { editing = false; act("edit", title: title, background: background) }.disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }.navigationTitle("修改事项").toolbar { Button("取消") { editing = false } } }
        }.task(id: task.id) { if undoMutation == nil { undoMutation = initialUndoMutation }; if let session = connection.saved { retry = try? TaskActionTransport.pending(task.id, session: session) } }
    }
    private func act(_ operation: String, reminder: Date? = nil, target: String? = nil, title: String? = nil, background: String? = nil) {
        guard retry == nil else { error = "上次操作尚未确认，请先重试该操作。"; return }
        var deadline: TaskDeadlineChange?
        if operation == "edit", deadlineKind != "keep" {
            let zone = task.deadline?.timeZone ?? task.reminder?.timeZone ?? TimeZone.current.identifier
            let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = TimeZone(identifier: zone); formatter.dateFormat = "yyyy-MM-dd"
            deadline = deadlineKind == "none" ? .clear : .value(TaskDeadline(kind: deadlineKind, date: deadlineKind == "date" ? formatter.string(from: deadlineDate) : nil, instant: deadlineKind == "instant" ? isoDate(deadlineDate) : nil, timeZone: zone))
        }
        let command = TaskActionCommand(expectedRevision: task.revision, operation: operation, title: title, background: background, reminder: reminder.map { .init(instant: isoDate($0), timeZone: task.reminder?.timeZone ?? TimeZone.current.identifier) }, targetMutationId: target, deadline: deadline)
        submit(command)
    }
    private func submit(_ command: TaskActionCommand) {
        guard let session = connection.saved else { return }
        busy = true; retry = command
        Task {
            defer { busy = false }
            do {
                let latest = try await TaskActionTransport.execute(task.id, command: command, session: session)
                guard connection.saved?.server == session.server, connection.saved?.credentials.deviceId == session.credentials.deviceId else { return }
                updated(latest); undoMutation = command.operation == "undo" ? nil : command.clientMutationId; retry = nil; error = nil
            } catch {
                self.error = error.localizedDescription
                if let api = error as? APIError, !api.retryable { retry = nil; if let latest = try? await NivliAPI(server: session.server).task(id: task.id, token: session.credentials.accessToken) { updated(latest) } }
            }
        }
    }
}
