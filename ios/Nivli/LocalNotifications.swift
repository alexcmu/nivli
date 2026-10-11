import SwiftUI
import UserNotifications
import CryptoKit

@MainActor final class IOSNotificationSystem: NotificationSystem {
    private let center = UNUserNotificationCenter.current()
    static var suppressedNamespaces: Set<String> = []
    private let namespace: String
    init(namespace: String) { self.namespace = namespace }
    static func namespace(_ session: SavedSession) -> String { SHA256.hash(data: Data((session.server.absoluteString + "/" + session.credentials.ownerId + "/" + session.credentials.deviceId).utf8)).map { String(format: "%02x", $0) }.joined() }
    static func cancel(_ session: SavedSession) async {
        let center = UNUserNotificationCenter.current(); let namespace = namespace(session)
        suppressedNamespaces.insert(namespace)
        let pending = await center.pendingNotificationRequests().filter { $0.content.userInfo["installationIdentity"] as? String == namespace }.map(\.identifier)
        center.removePendingNotificationRequests(withIdentifiers: pending)
        let delivered = await center.deliveredNotifications().filter { $0.request.content.userInfo["installationIdentity"] as? String == namespace }.map { $0.request.identifier }
        center.removeDeliveredNotifications(withIdentifiers: delivered)
    }
    func authorization() async -> NotificationPermission {
        switch await center.notificationSettings().authorizationStatus {
        case .authorized, .provisional, .ephemeral: return .authorized
        case .notDetermined: return .notDetermined
        default: return .denied
        }
    }
    func requestAuthorization() async throws -> Bool { try await center.requestAuthorization(options: [.alert, .sound, .badge]) }
    func pending() async -> [NotificationRequest] {
        await center.pendingNotificationRequests().compactMap { request in
            let info = request.content.userInfo
            guard let occurrence = info["occurrenceId"] as? String, let revision = info["reminderRevision"] as? Int, let routing = info["routingVersion"] as? Int, let task = info["taskId"] as? String, let timestamp = info["instant"] as? Double else {
                // Unknown app requests still consume capacity.
                return NotificationRequest(requestId: request.identifier, occurrenceId: "", reminderRevision: 0, routingVersion: 0, taskId: "", instant: .distantFuture)
            }
            return NotificationRequest(requestId: request.identifier, occurrenceId: occurrence, reminderRevision: revision, routingVersion: routing, taskId: task, instant: Date(timeIntervalSince1970: timestamp), title: request.content.title, body: request.content.body)
        }
    }
    func add(_ request: NotificationRequest) async throws {
        let content = UNMutableNotificationContent()
        content.title = request.title; content.body = request.body; content.sound = .default
        content.interruptionLevel = .active
        content.userInfo = ["installationIdentity": namespace, "taskId": request.taskId, "occurrenceId": request.occurrenceId, "reminderRevision": request.reminderRevision, "routingVersion": request.routingVersion, "instant": request.instant.timeIntervalSince1970]
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        var components = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: request.instant)
        components.timeZone = TimeZone(secondsFromGMT: 0)
        try await center.add(UNNotificationRequest(identifier: request.requestId, content: content, trigger: UNCalendarNotificationTrigger(dateMatching: components, repeats: false)))
    }
    func remove(_ ids: [String]) async { center.removePendingNotificationRequests(withIdentifiers: ids) }
}

@MainActor @Observable final class NotificationCoordinator {
    var localStatus: [String: String] = [:]
    var error: String?
    private var scheduler: LocalNotificationScheduler?
    private var identity: String?
    private var busy = false
    // Conservative initial installation budget; measured platform evidence is kept in ios/VALIDATION.md.
    static let installationBudget = 16
    static func clearLocal(_ session: SavedSession) async {
        await IOSNotificationSystem.cancel(session)
        do { let coordinator = NotificationCoordinator(); try coordinator.configure(session); try await coordinator.scheduler?.clear() } catch { /* OS cancellation remains effective if local storage is unavailable. */ }
    }
    private func configure(_ session: SavedSession) throws {
        let key = session.server.absoluteString + "/" + session.credentials.ownerId + "/" + session.credentials.deviceId
        guard key != identity else { return }
        let directory = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        scheduler = try LocalNotificationScheduler(url: directory.appendingPathComponent("notification-installation.sqlite"), identity: key, system: IOSNotificationSystem(namespace: IOSNotificationSystem.namespace(session)), capacity: Self.installationBudget)
        identity = key; localStatus = [:]; error = nil
    }
    private func update(_ plan: NotificationPlan, session: SavedSession, requestPermission: Bool) async throws -> TaskRecord? {
        let namespace = IOSNotificationSystem.namespace(session)
        guard !IOSNotificationSystem.suppressedNamespaces.contains(namespace), let scheduler, let taskId = plan.taskId else { return nil }
        let result = try await scheduler.install(plan, requestPermission: requestPermission)
        guard !IOSNotificationSystem.suppressedNamespaces.contains(namespace) else { await IOSNotificationSystem.cancel(session); return nil }
        switch result {
        case .needsConfirmation: localStatus[taskId] = "安静时段 · 需要你确认时间"; return nil
        case .expired: localStatus[taskId] = "原定时间已过 · 未安排通知"; return nil
        case .installed: localStatus[taskId] = "已在系统安装 · 等待服务器确认"
        case .denied: localStatus[taskId] = "通知权限未开启 · 事项已保存"
        case .capacity: localStatus[taskId] = "本机排程容量不足 · 此提醒未安排"
        case .failed: localStatus[taskId] = "本机安装失败 · 此提醒未安排"
        }
        let api = NivliAPI(server: session.server)
        let command = NotificationPlanCommand(operation: result == .installed ? "installed" : "failed", plan: plan, result: result == .installed ? nil : result.rawValue)
        let task = try await api.notificationPlan(deviceId: session.credentials.deviceId, command: command, token: session.credentials.accessToken)
        if result == .installed { try scheduler.acknowledge(plan) }
        localStatus[taskId] = reminderStatus(task.reminder)
        return task
    }
    func synchronize(_ session: SavedSession) async -> [TaskRecord] {
        guard !busy else { return [] }; busy = true; defer { busy = false }
        do {
            try configure(session)
            let page = try await NivliAPI(server: session.server).notificationPlans(deviceId: session.credentials.deviceId, token: session.credentials.accessToken)
            try await scheduler?.reconcile(current: page.plans)
            var updates: [TaskRecord] = []
            for plan in page.plans.sorted(by: { $0.scheduledAt < $1.scheduledAt }) {
                do { if let task = try await update(plan, session: session, requestPermission: false) { updates.append(task) } }
                catch { self.error = "本机安装状态等待同步。\(error.localizedDescription)" }
            }
            return updates
        } catch { self.error = error.localizedDescription; return [] }
    }
    func install(_ task: TaskRecord, session: SavedSession, confirmQuietHours: Bool = false) async -> TaskRecord {
        guard let occurrence = task.reminder?.occurrence else { return task }
        do {
            try configure(session)
            var current = task
            if confirmQuietHours { current = try await NivliAPI(server: session.server).notificationPlan(deviceId: session.credentials.deviceId, command: NotificationPlanCommand(operation: "confirm-quiet-hours", plan: occurrence), token: session.credentials.accessToken) }
            guard let value = current.reminder?.occurrence else { return current }
            let plan = NotificationPlan(taskId: current.id, id: value.id, reminderRevision: value.reminderRevision, routingVersion: value.routingVersion, requestId: value.requestId, scheduledAt: value.scheduledAt, timeZone: value.timeZone, installationStatus: value.installationStatus, quietHoursConfirmed: value.quietHoursConfirmed)
            return try await update(plan, session: session, requestPermission: true) ?? current
        } catch { self.error = error.localizedDescription; return task }
    }
}

func reminderStatus(_ reminder: TaskReminder?) -> String {
    guard let reminder else { return "已保存 · 未设置提醒" }
    switch reminder.schedulingStatus {
    case "local_installed": return "本机已安排"
    case "local_pending": return "已保存 · 本机安装待确认"
    case "needs_confirmation": return "安静时段 · 需要你确认时间"
    case "permission_denied": return "通知权限未开启 · 事项已保存"
    case "capacity_exceeded": return "本机排程容量不足 · 此提醒未安排"
    case "installation_failed": return "本机安装失败 · 此提醒未安排"
    default: return "已保存，提醒尚未安排"
    }
}

@MainActor @Observable final class NotificationNavigation: NSObject, UNUserNotificationCenterDelegate {
    var taskId: String?
    override init() { super.init(); UNUserNotificationCenter.current().delegate = self }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        let id = response.notification.request.content.userInfo["taskId"] as? String
        Task { @MainActor [weak self] in self?.taskId = id }
        completionHandler()
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) { completionHandler([.banner, .list, .sound]) }
}

struct NotificationDetailView: View {
    let taskId: String
    @Bindable var connection: Connection
    @State private var task: TaskRecord?
    @State private var error: String?
    var body: some View {
        Group {
            if let task { TaskDetailView(initial: task, connection: connection) }
            else if let error { ContentUnavailableView("无法打开当前事项", systemImage: "exclamationmark.circle", description: Text(error)) }
            else { ProgressView("正在读取最新事项…") }
        }.task {
            guard let session = connection.saved else { error = "请先连接个人环境。"; return }
            do { task = try await NivliAPI(server: session.server).task(id: taskId, token: session.credentials.accessToken) }
            catch { self.error = error.localizedDescription }
        }
    }
}
