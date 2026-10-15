import SwiftUI

@main struct HaijiApp: App {
    @UIApplicationDelegateAdaptor(PushAppDelegate.self) private var pushDelegate
    @State private var connection = Connection.shared
    @State private var notificationNavigation = NotificationNavigation()
    var body: some Scene { WindowGroup {
            appContent.tint(Color(uiColor: UIColor { traits in
                traits.userInterfaceStyle == .dark ? UIColor(red: 0.47, green: 0.71, blue: 1, alpha: 1) : UIColor(red: 0, green: 0.36, blue: 0.75, alpha: 1)
            })) } }
    @ViewBuilder private var appContent: some View {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-conversation-keyboard-validation") { ConversationKeyboardValidationView() }
        else { RootView(connection: connection, notificationNavigation: notificationNavigation) }
        #else
        RootView(connection: connection, notificationNavigation: notificationNavigation)
        #endif
    }
}
struct RootView: View {
    @Bindable var connection: Connection
    @Bindable var notificationNavigation: NotificationNavigation
    @Environment(\.scenePhase) private var scenePhase
    @State private var selection = 0
    @State private var repository = TaskRepository()
    private var taskIdentity: String { (connection.saved?.server.absoluteString ?? "") + "/" + (connection.saved?.credentials.ownerId ?? "") + "/" + (connection.saved?.credentials.deviceId ?? "") }
    var body: some View {
        TabView(selection: $selection) {
            NavigationStack {
                TaskListView(connection: connection, repository: repository)
            }.id(taskIdentity).tabItem { Label("此刻", systemImage: "sun.max") }.tag(0)
            NavigationStack {
                if connection.saved != nil { ConversationView(connection: connection, repository: repository) }
                else { ContentUnavailableView("先连接个人环境", systemImage: "network", description: Text("在“我的”连接后即可手动创建事项。")) }
            }.id(taskIdentity).tabItem { Label("交代", systemImage: "text.bubble") }.tag(1)
            NavigationStack {
                List {
                    Section("个人环境") {
                        NavigationLink { EnvironmentView(connection: connection) } label: {
                            VStack(alignment: .leading) {
                                Text("环境连接")
                                Text(connection.saved == nil ? "尚未连接" : connection.verified ? "已连接" : "待验证连接").font(.subheadline).foregroundStyle(.primary)
                            }.padding(.vertical, 6)
                        }
                    }
                    Section("通知") { NavigationLink("远程通知") { RemotePushSettingsView(connection: connection) } }
                    Section("地点") { NavigationLink("我的地点") { PlacesView(connection: connection) }; NavigationLink("地点监测与权限") { LocationSettingsView() } }
                    Section("来源") { NavigationLink("Gmail") { GmailView(connection: connection) } }
                    Section("后续功能") { Text("记忆、地点、提醒设置与数据控制尚未开放。").foregroundStyle(.primary) }
                }.navigationTitle("我的")
            }.tabItem { Label("我的", systemImage: "person.crop.circle") }.tag(2)
        }.task { await NotificationIdentity.retireLegacyRequests(); await connection.restore(); if let session = connection.saved { await RemotePushController.shared.refresh(session); await LocationMonitoring.shared.synchronize(session) }; await repository.refresh(connection) }
            .onChange(of: scenePhase) { if scenePhase == .active { Task { await connection.restore(); if let session = connection.saved { await RemotePushController.shared.refresh(session); await LocationMonitoring.shared.synchronize(session) }; await repository.refresh(connection) } } }
            .sheet(isPresented: Binding(get: { notificationNavigation.taskId != nil }, set: { if !$0 { notificationNavigation.taskId = nil } })) {
                if let taskId = notificationNavigation.taskId { NavigationStack { VStack { if let error = notificationNavigation.actionError { Text(error).padding().foregroundStyle(.red) }; NotificationDetailView(taskId: taskId, connection: connection, undoMutation: notificationNavigation.actionMutation).id(notificationNavigation.reloadId) } } }
            }
    }
}
struct EnvironmentView: View {
    @Bindable var connection: Connection
    @State private var removingLocalCredentials = false
    var body: some View {
        Form {
            if let saved = connection.saved {
                Section("连接状态") {
                    Text(connection.verified ? "已连接" : "已保存凭据 · 待验证连接")
                    LabeledContent("主机") { Text(saved.server.haijiAuthority).foregroundStyle(.primary) }
                    if let info = connection.environment { EnvironmentDetails(info: info) }
                    Text("提醒由服务器通过 Apple 远程通知发送。").foregroundStyle(.primary)
                    Button("重新检查连接") { Task { await connection.restore() } }.disabled(connection.busy)
                    Button("吊销并断开此设备", role: .destructive) { Task { await connection.disconnect() } }.disabled(connection.busy)
                    Button("移除此 iPhone 的连接", role: .destructive) { removingLocalCredentials = true }.disabled(connection.busy)
                }
            } else { PairingView(connection: connection) }
            if connection.busy { ProgressView("正在连接") }
            if let error = connection.error { Section("连接失败") { Text(error); Button("重试") { Task { await connection.restore() } }.disabled(connection.busy || connection.saved == nil) } }
        }.navigationTitle("环境连接")
            .confirmationDialog("仅移除本机凭据，服务器会话可能仍有效。需管理员吊销旧设备后重新配对。", isPresented: $removingLocalCredentials, titleVisibility: .visible) {
                Button("移除本机凭据", role: .destructive) { Task { await connection.forgetLocalCredentials() } }
            }
    }
}
struct EnvironmentDetails: View {
    let info: EnvironmentInfo
    var body: some View {
        LabeledContent("环境名称") { Text(info.name).foregroundStyle(.primary) }
        LabeledContent("服务器主机") { Text(info.host).foregroundStyle(.primary) }
        LabeledContent("推送模式") { Text(info.pushMode).foregroundStyle(.primary) }
        LabeledContent("模型数据去向") { Text(info.modelDataDestination).foregroundStyle(.primary) }
    }
}

struct UnavailableContent<Actions: View>: View {
    let title: String
    let symbol: String
    let explanation: String
    @ViewBuilder let actions: () -> Actions
    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                Image(systemName: symbol).font(.largeTitle).accessibilityHidden(true)
                Text(title).font(.title2).bold()
                Text(explanation).font(.body)
                actions()
            }.multilineTextAlignment(.center).frame(maxWidth: .infinity).padding(20).padding(.top, 32)
        }
    }
}
