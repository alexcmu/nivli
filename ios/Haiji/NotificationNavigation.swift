import SwiftUI
import UserNotifications
import CryptoKit

/// Retire pending notifications from older app versions. Remote pushes have no local trigger.
@MainActor enum NotificationIdentity {
    static func namespace(_ session: SavedSession) -> String { SHA256.hash(data: Data((session.server.absoluteString + "/" + session.credentials.ownerId + "/" + session.credentials.deviceId).utf8)).map { String(format: "%02x", $0) }.joined() }
    static func retireLegacyRequests() async {
        let center = UNUserNotificationCenter.current()
        let ids = await center.pendingNotificationRequests().filter { !($0.trigger is UNPushNotificationTrigger) }.map(\.identifier)
        center.removePendingNotificationRequests(withIdentifiers: ids)
    }
    static func clearDelivered(_ session: SavedSession) async {
        let center = UNUserNotificationCenter.current()
        let ids = await center.deliveredNotifications().filter {
            let info = $0.request.content.userInfo
            return (info["ownerId"] as? String == session.credentials.ownerId && info["deviceId"] as? String == session.credentials.deviceId) || info["installationIdentity"] as? String == namespace(session)
        }.map { $0.request.identifier }
        center.removeDeliveredNotifications(withIdentifiers: ids)
    }
}

@MainActor func confirmRemoteReminder(_ task: TaskRecord, session: SavedSession) async throws -> TaskRecord {
    guard let occurrence = task.reminder?.remoteOccurrence else { return task }
    return try await HaijiAPI(server: session.server).confirmRemote(taskId: task.id, occurrence: occurrence, token: session.credentials.accessToken)
}

func reminderStatus(_ reminder: TaskReminder?) -> String {
    guard let reminder else { return "已保存 · 未设置提醒" }
    if let remote = reminder.remoteOccurrence {
        if !remote.quietHoursConfirmed && remote.status == "planned" { return "远程提醒 · 安静时段待确认" }
        switch remote.status {
        case "planned": return "服务器远程提醒 · 待发送"
        case "sending": return "远程通知正在发送"
        case "accepted": return "Apple 已受理 · 不代表已展示"
        case "unknown": return "发送结果未知 · 不会自动重发"
        case "failed": return "远程发送失败 · 请检查远程通知设置"
        case "expired": return "远程提醒已过期 · 事项仍未处理"
        case "cancelled": return "旧远程提醒已取消"
        default: return "远程提醒状态待更新"
        }
    }
    return reminder.schedulingStatus == "needs_confirmation" ? "安静时段 · 需要你确认时间" : "已保存，远程提醒尚未安排"
}

@MainActor @Observable final class NotificationNavigation: NSObject, UNUserNotificationCenterDelegate {
    var taskId: String?
    var actionError: String?
    var actionMutation: String?
    var reloadId = UUID()
    override init() {
        super.init()
        let complete = UNNotificationAction(identifier: "HAIJI_COMPLETE", title: "完成", options: [.authenticationRequired, .foreground])
        let snooze = UNNotificationAction(identifier: "HAIJI_SNOOZE", title: "30 分钟后", options: [.authenticationRequired, .foreground])
        UNUserNotificationCenter.current().setNotificationCategories([UNNotificationCategory(identifier: "HAIJI_REMOTE_TASK", actions: [complete, snooze], intentIdentifiers: [], options: [])])
        UNUserNotificationCenter.current().delegate = self
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        let id = response.notification.request.content.userInfo["taskId"] as? String
        let info = response.notification.request.content.userInfo
        let remoteOwner = info["ownerId"] as? String
        let remoteDevice = info["deviceId"] as? String
        let action = response.actionIdentifier
        let requestId = (info["requestId"] as? String) ?? response.notification.request.identifier
        let occurrenceId = info["occurrenceId"] as? String
        let revision = info["reminderRevision"] as? Int
        let routing = info["routingVersion"] as? Int
        Task { @MainActor [weak self] in
            guard let session = try? SecureStore().load(), session.credentials.ownerId == remoteOwner, session.credentials.deviceId == remoteDevice else { return }
            self?.taskId = id
            self?.actionError = nil
            self?.actionMutation = nil
            defer { self?.reloadId = UUID() }
            guard action == "HAIJI_COMPLETE" || action == "HAIJI_SNOOZE", let id, let occurrenceId, let revision, let routing else { return }
            do {
                let api = HaijiAPI(server: session.server)
                let latest = try await api.task(id: id, token: session.credentials.accessToken)
                let authority: TaskActionCommand.Occurrence
                if let remote = latest.reminder?.remoteOccurrence ?? latest.locationReminder?.remoteOccurrence, remoteOwner == latest.ownerId, remote.id == occurrenceId, remote.reminderRevision == revision, remote.routingVersion == routing, requestId == "haiji.remote." + remote.id + ".1" {
                    authority = .init(remote: remote)
                } else {
                    self?.actionError = "提醒已更新。已打开最新事项，旧提醒未改变当前计划。"; return
                }
                let existing = try TaskActionTransport.pending(id, session: session)
                let command = existing ?? TaskActionCommand(expectedRevision: latest.revision, operation: action == "HAIJI_COMPLETE" ? "complete" : "snooze", reminder: action == "HAIJI_SNOOZE" ? .init(instant: isoDate(Date().addingTimeInterval(1800)), timeZone: latest.reminder?.timeZone ?? TimeZone.current.identifier) : nil, occurrence: authority)
                _ = try await TaskActionTransport.execute(id, command: command, session: session)
                self?.actionError = nil
                self?.actionMutation = command.clientMutationId
            } catch { self?.actionError = error.localizedDescription }
        }
        completionHandler()
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) { completionHandler([.banner, .list, .sound]) }
}

struct NotificationDetailView: View {
    let taskId: String
    @Bindable var connection: Connection
    var undoMutation: String? = nil
    @State private var task: TaskRecord?
    @State private var error: String?
    var body: some View {
        Group {
            if let task { TaskDetailView(initial: task, undoMutation: undoMutation, connection: connection) }
            else if let error { ContentUnavailableView("无法打开当前事项", systemImage: "exclamationmark.circle", description: Text(error)) }
            else { ProgressView("正在读取最新事项…") }
        }.task {
            guard let session = connection.saved else { error = "请先连接个人环境。"; return }
            do { task = try await HaijiAPI(server: session.server).task(id: taskId, token: session.credentials.accessToken) }
            catch { self.error = error.localizedDescription }
        }
    }
}
