import SwiftUI
import UserNotifications

final class PushAppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        _ = LocationMonitoring.shared
        return true
    }
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        Task { @MainActor in await RemotePushController.shared.registered(token) }
    }
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        Task { @MainActor in RemotePushController.shared.registrationFailed() }
    }
}

@MainActor @Observable final class RemotePushController {
    static let shared = RemotePushController()
    var status: PushStatus?
    var error: String?
    var busy = false
    private var session: SavedSession?
    private var registering = false
    private func preference(_ session: SavedSession) -> SecureStore { SecureStore(account: "remote-push-" + NotificationIdentity.namespace(session)) }
    func refresh(_ session: SavedSession) async {
        self.session = session
        do {
            status = try await HaijiAPI(server: session.server).pushStatus(deviceId: session.credentials.deviceId, token: session.credentials.accessToken)
            if try preference(session).read(Bool.self) == true, status?.configured == true {
                UIApplication.shared.registerForRemoteNotifications()
            }
        } catch { self.error = error.localizedDescription }
    }
    func enable(_ session: SavedSession) async {
        busy = true; defer { busy = false }
        self.session = session
        do {
            let api = HaijiAPI(server: session.server)
            status = try await api.pushStatus(deviceId: session.credentials.deviceId, token: session.credentials.accessToken)
            guard status?.configured == true else { error = "管理员尚未配置 APNs，请先完成服务器配置。"; return }
            guard try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert,.sound,.badge]) else { error = "通知权限未开启，请在系统设置中允许通知。"; return }
            try preference(session).save(true)
            error = nil
            UIApplication.shared.registerForRemoteNotifications()
        } catch { self.error = error.localizedDescription }
    }
    func disable(_ session: SavedSession) async {
        busy = true; defer { busy = false }
        do {
            // Suppress callbacks before transport; keep preference off even if server is unreachable.
            try preference(session).save(false)
            while registering { try await Task.sleep(for: .milliseconds(20)) }
            status = try await HaijiAPI(server: session.server).disablePush(deviceId: session.credentials.deviceId, token: session.credentials.accessToken)
            error = nil
        } catch { self.error = "关闭尚未得到服务器确认，请重试。" + error.localizedDescription }
    }
    func registered(_ value: String) async {
        guard let session, (try? preference(session).read(Bool.self)) == true else { return }
        registering = true; defer { registering = false }
        do {
            let permission = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
            let authorized = permission == .authorized || permission == .provisional || permission == .ephemeral
            guard (try? preference(session).read(Bool.self)) == true else { return }
            let topic = Bundle.main.bundleIdentifier ?? ""
            let environment = Bundle.main.object(forInfoDictionaryKey: "APNSEnvironment") as? String ?? ""
            let updated = try await HaijiAPI(server: session.server).registerPush(deviceId: session.credentials.deviceId, registration: .init(token: value, topic: topic, environment: environment, enabled: true, authorized: authorized), token: session.credentials.accessToken)
            guard self.session?.server == session.server, self.session?.credentials.deviceId == session.credentials.deviceId else { return }
            status = updated; error = nil
        } catch { self.error = error.localizedDescription }
    }
    func registrationFailed() { error = "设备无法注册远程通知，请检查网络、Push Notifications 能力和签名配置后重试。" }
    func clear(_ session: SavedSession) { try? preference(session).remove(); self.session = nil; status = nil }
}

struct RemotePushSettingsView: View {
    @Bindable var connection: Connection
    @State private var push = RemotePushController.shared
    var body: some View {
        Form {
            Section("服务器远程通知") {
                Text("服务器有新提醒时，通过 Apple 推送到此 iPhone。远程通知始终显示通用文案，打开后读取当前事项。")
                if let status = push.status {
                    Text(!status.configured ? "服务器尚未配置 APNs" : status.invalidated ? "设备注册已失效，请重新启用" : status.enabled && status.authorized ? "远程通知已启用" : "远程通知未就绪")
                    if let topic = status.topic { LabeledContent("App 身份", value: topic) }
                    if let environment = status.environment { LabeledContent("推送环境", value: environment) }
                }
                Button("启用或重新注册远程通知") { if let session = connection.saved { Task { await push.enable(session) } } }
                Button("关闭远程通知") { if let session = connection.saved { Task { await push.disable(session) } } }
                Button("打开通知设置") { openNotificationSettings() }
                Text("所有提醒都通过远程通知发送。关闭后，事项仍保留；已被 Apple 受理的通知无法撤回。系统权限和专注模式仍会影响显示。") .font(.footnote)
            }.disabled(push.busy || connection.saved == nil)
            if let error = push.error { Section("尚未完成") { Text(error) } }
        }.navigationTitle("远程通知").task { if let session = connection.saved { await push.refresh(session) } }
    }
}
