#if DEBUG
import SwiftUI
import UserNotifications

/// Opt-in device validation reads the external OS queue; it does not create or modify plans.
struct AgentNotificationEvidenceView: View {
    @State private var evidence = "读取系统通知队列…"
    var body: some View {
        Text(evidence).accessibilityIdentifier("agentSystemEvidence").padding().task {
            let arguments = ProcessInfo.processInfo.arguments
            guard let index = arguments.firstIndex(of: "-agent-evidence-task"), arguments.indices.contains(index + 1) else { evidence = "缺少验收事项"; return }
            let id = arguments[index + 1]
            let pending = await UNUserNotificationCenter.current().pendingNotificationRequests()
            let matches = pending.filter { $0.content.userInfo["taskId"] as? String == id }
            let generic = matches.allSatisfy { $0.content.title == "Nivli 提醒" && $0.content.body == "有一件事需要你查看。解锁后打开 Nivli。" }
            evidence = "实际系统计划=\(matches.count)；预览隐私=\(generic)"
        }
    }
}
#endif
