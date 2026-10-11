#if DEBUG
import SwiftUI
import UserNotifications

/// Explicit debug launch mode exercises the production platform adapter and journal on a physical device.
struct NotificationValidationView: View {
    @State private var evidence = "待验收"
    @State private var scheduler: LocalNotificationScheduler?
    @State private var plan: NotificationPlan?
    private let system = IOSNotificationSystem(namespace: "platform-validation")
    var body: some View {
        NavigationStack {
            Form {
                Text(evidence).accessibilityIdentifier("notificationEvidence")
                Button("验证本机容量与恢复") { Task { await capacity() } }
                Button("安排3分钟验收通知") { Task { await schedule(delay: 180) } }
                Button("安排自动化验收通知") { Task { await schedule(delay: 8) } }
                Button("检查系统投递记录") { Task { await check() } }
                Button("打开通知设置") { openNotificationSettings() }
                Button("清理验收通知") { Task { await clear(); evidence = "已清理" } }
                Text("锁屏和离线的显示结果须由真机观察。系统 pending 或 delivered 记录不代表用户已看到。")
            }.navigationTitle("通知平台验收")
        }
    }
    private func journal() throws -> LocalNotificationScheduler {
        let directory = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        return try LocalNotificationScheduler(url: directory.appendingPathComponent("validation-notifications.sqlite"), identity: "platform-validation", system: system, capacity: NotificationCoordinator.installationBudget)
    }
    private func makePlan(id: String, at date: Date) -> NotificationPlan {
        NotificationPlan(taskId: "validation-task", id: id, reminderRevision: 1, routingVersion: 1, requestId: "validation-" + id, scheduledAt: isoDate(date), timeZone: "Etc/UTC", installationStatus: "pending", quietHoursConfirmed: true)
    }
    private func clear() async {
        let center = UNUserNotificationCenter.current()
        let ids = await center.pendingNotificationRequests().filter { $0.content.userInfo["installationIdentity"] as? String == "platform-validation" }.map(\.identifier)
        center.removePendingNotificationRequests(withIdentifiers: ids)
        let delivered = await center.deliveredNotifications().filter { $0.request.content.userInfo["installationIdentity"] as? String == "platform-validation" }.map { $0.request.identifier }
        center.removeDeliveredNotifications(withIdentifiers: delivered)
    }
    private func capacity() async {
        do {
            await clear(); let scheduler = try journal(); self.scheduler = scheduler
            var installed = 0
            for index in 0..<NotificationCoordinator.installationBudget {
                let result = try await scheduler.install(makePlan(id: "capacity-\(index)", at: Date().addingTimeInterval(86400 + Double(index))), requestPermission: true)
                if result == .denied { evidence = "权限关闭：未安装，事项保留"; return }
                if result == .installed { installed += 1 }
            }
            let next = try await scheduler.install(makePlan(id: "over-budget", at: Date().addingTimeInterval(90000)), requestPermission: true)
            let pending = await system.pending().filter { $0.requestId.hasPrefix("validation-") }
            let reopened = try journal()
            let recovery = try await reopened.install(makePlan(id: "capacity-0", at: Date().addingTimeInterval(86400)), requestPermission: false)
            evidence = "OS pending \(pending.count)；安装 \(installed)；下一条 \(next.rawValue)；恢复 \(recovery.rawValue)；\(UIDevice.current.systemVersion)"
            await clear()
        } catch { evidence = error.localizedDescription }
    }
    private func schedule(delay: TimeInterval) async {
        do {
            await clear(); let scheduler = try journal(); self.scheduler = scheduler
            let plan = makePlan(id: UUID().uuidString, at: Date().addingTimeInterval(delay)); self.plan = plan
            let result = try await scheduler.install(plan, requestPermission: true)
            let pending = await system.pending().contains { $0.requestId == plan.requestId }
            evidence = "\(result.rawValue)；pending=\(pending)；UTC=\(plan.scheduledAt)；request=\(plan.requestId)；iOS \(UIDevice.current.systemVersion)"
            print("NIVLI_NOTIFICATION_VALIDATION \(evidence)")
        } catch { evidence = error.localizedDescription }
    }
    private func check() async {
        guard let plan else { evidence = "尚未安排本次验收"; return }
        let pending = await system.pending().contains { $0.requestId == plan.requestId }
        let delivered = await UNUserNotificationCenter.current().deliveredNotifications().contains { $0.request.identifier == plan.requestId }
        evidence = "pending=\(pending)；delivered=\(delivered)；request=\(plan.requestId)"
        print("NIVLI_NOTIFICATION_VALIDATION \(evidence)")
    }
}
#endif
