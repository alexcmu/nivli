import SwiftUI
import AuthenticationServices

@MainActor private final class GmailBrowser: NSObject, ASWebAuthenticationPresentationContextProviding {
    var session: ASWebAuthenticationSession?
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows).first(where: \.isKeyWindow) ?? ASPresentationAnchor()
    }
    func authorize(_ url: URL) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            session = ASWebAuthenticationSession(url: url, callbackURLScheme: "nivli") { callback, error in
                if let error { continuation.resume(throwing: error); return }
                guard let callback, callback.host == "gmail",
                      URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems?.contains(where: { $0.name == "result" && $0.value == "connected" }) == true
                else { continuation.resume(throwing: GmailViewError.authorizationFailed); return }
                continuation.resume()
            }
            session?.presentationContextProvider = self
            session?.prefersEphemeralWebBrowserSession = true
            if session?.start() != true { continuation.resume(throwing: GmailViewError.authorizationFailed) }
        }
    }
}
private enum GmailViewError: Error, LocalizedError { case authorizationFailed; var errorDescription: String? { "Gmail 授权未完成，请重试或重新授权。" } }
private struct GmailAttempt: Codable { let fingerprint: String; let key: String }
struct GmailView: View {
    let connection: Connection
    @State private var status: GmailStatus?
    @State private var inbox = true
    @State private var important = false
    @State private var sent = false
    @State private var customLabels = ""
    @State private var initialDays = 7
    @State private var retentionDays = 7
    @State private var consentPresented = false
    @State private var stopPresented = false
    @State private var busy = false
    @State private var error: String?
    @State private var browser = GmailBrowser()
    private var labels: [String] { Array(Set((inbox ? ["INBOX"] : []) + (important ? ["IMPORTANT"] : []) + (sent ? ["SENT"] : []) + customLabels.split(separator: ",").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) })).sorted() }
    var body: some View {
        Form {
            if connection.saved == nil {
                Section { Text("先连接个人环境，再授权 Gmail。"); NavigationLink("连接个人环境") { EnvironmentView(connection: connection) } }
            } else {
                Section("Gmail 来源") {
                    Text(status?.state == "active" ? "正在读取授权范围" : status?.state == "reauthorization_required" ? "需要重新授权" : "已停止读取")
                    if let account = status?.account { LabeledContent("账户", value: account) }
                    LabeledContent("最近同步成功", value: status?.lastSuccessfulSync.map(dateText) ?? "尚无成功同步")
                    if let syncError = status?.syncError { Text("同步失败：\(syncError == "REAUTH_REQUIRED" ? "凭据失效，请重新授权" : "暂时失败，将按退避重试")").foregroundStyle(.red) }
                    Text("默认约每 5 分钟检查一次，加入随机间隔及失败退避；不保证实时发现。")
                    if let status { Text("当前 label：\(status.labelIds.joined(separator: ", ")) · 初始\(status.initialDays == 0 ? "仅新邮件" : "最近 \(status.initialDays) 天") · 正文缓存 \(status.retentionDays) 天") }
                    Button("刷新来源状态") { Task { await load() } }.disabled(busy).accessibilityIdentifier("gmailStatusRefresh")
                    if status?.state == "active" {
                        Button("手动同步") { Task { await mutate(stop: false) } }.disabled(busy).accessibilityIdentifier("gmailManualSync")
                        Button("停止读取 Gmail", role: .destructive) { stopPresented = true }.disabled(busy).accessibilityIdentifier("gmailStop")
                    }
                }
                Section("选择应用内读取范围") {
                    Toggle("收件箱 INBOX", isOn: $inbox)
                    Toggle("重要邮件 IMPORTANT", isOn: $important)
                    Toggle("已发送 SENT", isOn: $sent)
                    TextField("其他 label ID，用逗号分隔", text: $customLabels).textInputAutocapitalization(.never).autocorrectionDisabled()
                    Text("可在已连接账户中使用 Gmail label ID；多个 label 按任一匹配读取。")
                    Picker("初始历史窗口", selection: $initialDays) { Text("最近 7 天").tag(7); Text("最近 3 天").tag(3); Text("最近 1 天").tag(1); Text("仅新邮件").tag(0) }
                    Picker("正文缓存时间", selection: $retentionDays) { Text("7 天").tag(7); Text("3 天").tag(3); Text("1 天").tag(1) }
                    Button(status?.state == "reauthorization_required" ? "重新授权 Gmail" : status?.state == "active" ? "确认修改范围并重新授权" : "连接 Gmail") { consentPresented = true }.disabled(busy || status == nil || status?.configured != true || labels.isEmpty || labels.count > 10).accessibilityIdentifier("gmailConnect")
                    if status?.configured == false { Text("管理员尚未配置 Google OAuth 客户端与服务端加密密钥。") }
                }.disabled(busy)
            }
            if busy { ProgressView("正在处理 Gmail 授权") }
            if let error { Section("操作失败") { Text(error); Button("重新读取状态") { Task { await load() } }.disabled(busy) } }
        }.navigationTitle("Gmail").task { await load() }
        .sheet(isPresented: $consentPresented) {
            NavigationStack {
                Form {
                    Section("请确认访问范围") {
                        Text("Google OAuth 将授予整个 Gmail 邮箱的只读权限，不允许发送、修改或删除邮件。以下 label 和时间限制是 Nivli 应用内过滤，不是 Google 的细分授权。")
                        Text("读取 label：\(labels.joined(separator: ", "))；\(initialDays == 0 ? "仅从本次授权开始的新邮件" : "初始最近 \(initialDays) 天")。扩大范围需再次确认。")
                        Text("令牌仅在可信服务端加密保存，iPhone 不保存 Gmail token。邮件正文缓存 \(retentionDays) 天；备份最多保留 7 天。必要摘要及已确认事项将另行说明。")
                        Text("模型数据去向：\(status?.modelDataDestination ?? connection.environment?.modelDataDestination ?? "未配置")。当前连接与同步阶段不会向模型发送邮件，也不会自动创建事项。")
                    }
                    Button("确认范围并前往 Google 授权") { consentPresented = false; Task { await authorize() } }.accessibilityIdentifier("gmailConfirmConsent")
                }.navigationTitle("Gmail 连接说明").toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { consentPresented = false } } }
            }
        }
        .confirmationDialog("停止读取将使服务端凭据失效并阻止新同步及旧任务写回。已有原文缓存按保留期过期；完整衍生数据删除将在数据控制中提供。", isPresented: $stopPresented, titleVisibility: .visible) { Button("确认停止读取", role: .destructive) { Task { await mutate(stop: true) } } }
    }
    private func dateText(_ value: String) -> String { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f.date(from: value)?.formatted(date: .abbreviated, time: .shortened) ?? value }
    @MainActor private func load() async {
        guard !busy else { return }
        busy = true; defer { busy = false }
        await connection.restore()
        guard let saved = connection.saved, connection.verified else { error = connection.error; return }
        do { status = try await NivliAPI(server: saved.server).gmailStatus(token: saved.credentials.accessToken); error = nil } catch { self.error = error.localizedDescription }
    }
    private func operationKey(_ kind: String, revision: Int) throws -> String {
        let fingerprint = "\(kind):\(revision):\(labels.joined(separator: ",")):\(initialDays):\(retentionDays)"
        let store = SecureStore(account: "gmail-\(kind)")
        if let old = try store.read(GmailAttempt.self), old.fingerprint == fingerprint { return old.key }
        let key = UUID().uuidString; try store.save(GmailAttempt(fingerprint: fingerprint, key: key)); return key
    }
    @MainActor private func authorize() async {
        guard !busy else { return }
        busy = true; defer { busy = false }
        await connection.restore()
        guard let saved = connection.saved, connection.verified, let status else { error = connection.error; return }
        do {
            let auth = try await NivliAPI(server: saved.server).gmailConnect(token: saved.credentials.accessToken, consent: GmailConsent(labelIds: labels, initialDays: initialDays, retentionDays: retentionDays, expectedRevision: status.revision), key: operationKey("connect", revision: status.revision))
            guard let url = URL(string: auth.authorizationUrl) else { throw GmailViewError.authorizationFailed }
            try await browser.authorize(url)
            try SecureStore(account: "gmail-connect").remove()
            self.status = try await NivliAPI(server: saved.server).gmailStatus(token: saved.credentials.accessToken); error = nil
        } catch {
            // An abandoned OAuth state must be replaced on the next user-authorized attempt.
            try? SecureStore(account: "gmail-connect").remove()
            self.error = error.localizedDescription
        }
    }
    @MainActor private func mutate(stop: Bool) async {
        guard !busy else { return }
        busy = true; defer { busy = false }
        await connection.restore()
        guard let saved = connection.saved, connection.verified, let status else { error = connection.error; return }
        let kind = stop ? "stop" : "refresh"
        do {
            let api = NivliAPI(server: saved.server), key = try operationKey(kind, revision: status.revision)
            if stop { try await api.gmailStop(token: saved.credentials.accessToken, revision: status.revision, key: key) }
            else { try await api.gmailRefresh(token: saved.credentials.accessToken, revision: status.revision, key: key) }
            try SecureStore(account: "gmail-\(kind)").remove()
            self.status = try await api.gmailStatus(token: saved.credentials.accessToken); error = nil
        } catch { self.error = error.localizedDescription }
    }
}
