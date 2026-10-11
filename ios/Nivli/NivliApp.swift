import SwiftUI

@main struct NivliApp: App {
    @State private var connection = Connection()
    var body: some Scene { WindowGroup { RootView(connection: connection).tint(Color(uiColor: UIColor { traits in
                traits.userInterfaceStyle == .dark ? UIColor(red: 0.47, green: 0.71, blue: 1, alpha: 1) : UIColor(red: 0, green: 0.36, blue: 0.75, alpha: 1)
            })) } }
}
struct RootView: View {
    @Bindable var connection: Connection
    @State private var selection = 0
    var body: some View {
        TabView(selection: $selection) {
            NavigationStack {
                UnavailableContent(title: "提醒功能尚未开放", symbol: "sun.max", explanation: "当前版本提供环境连接。事项与提醒将在后续版本开放。") {
                    Button { selection = 1 } label: { Text("去交代").frame(minWidth: 44, minHeight: 44).contentShape(Rectangle()) }
                }.navigationTitle("此刻")
            }.tabItem { Label("此刻", systemImage: "sun.max") }.tag(0)
            NavigationStack {
                UnavailableContent(title: "交代功能尚未开放", symbol: "text.bubble", explanation: "当前版本不会保存交代或创建提醒。请先在“我的”连接个人环境。") { EmptyView() }
                    .navigationTitle("交代")
            }.tabItem { Label("交代", systemImage: "text.bubble") }.tag(1)
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
                    Section("来源") { NavigationLink("Gmail") { GmailView(connection: connection) } }
                    Section("后续功能") { Text("记忆、地点、提醒设置与数据控制尚未开放。").foregroundStyle(.primary) }
                }.navigationTitle("我的")
            }.tabItem { Label("我的", systemImage: "person.crop.circle") }.tag(2)
        }.task { await connection.restore() }
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
                    LabeledContent("主机") { Text(saved.server.nivliAuthority).foregroundStyle(.primary) }
                    if let info = connection.environment { EnvironmentDetails(info: info) }
                    Text("提醒同步尚未开放。").foregroundStyle(.primary)
                    Button("重新检查连接") { Task { await connection.restore() } }.disabled(connection.busy)
                    Button("吊销并断开此设备", role: .destructive) { Task { await connection.disconnect() } }.disabled(connection.busy)
                    Button("移除此 iPhone 的连接", role: .destructive) { removingLocalCredentials = true }.disabled(connection.busy)
                }
            } else { PairingView(connection: connection) }
            if connection.busy { ProgressView("正在连接") }
            if let error = connection.error { Section("连接失败") { Text(error); Button("重试") { Task { await connection.restore() } }.disabled(connection.busy || connection.saved == nil) } }
        }.navigationTitle("环境连接")
            .confirmationDialog("仅移除本机凭据，服务器会话可能仍有效。需管理员吊销旧设备后重新配对。", isPresented: $removingLocalCredentials, titleVisibility: .visible) {
                Button("移除本机凭据", role: .destructive) { connection.forgetLocalCredentials() }
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
