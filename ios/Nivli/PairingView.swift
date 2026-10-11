import SwiftUI

private struct PairingAttempt: Codable { let server: String; let code: String; let key: String }
struct PairingView: View {
    let connection: Connection
    @State private var server = ""
    @State private var code = ""
    @State private var candidate: PairingInput?
    @State private var info: EnvironmentInfo?
    @State private var error: String?
    @State private var busy = false
    @State private var scanning = false
    @AccessibilityFocusState private var scanFocused: Bool
    @State private var claimKey = UUID().uuidString
    private let attemptStore = SecureStore(account: "pairing-attempt")
    init(connection: Connection) {
        self.connection = connection
        if let attempt = try? SecureStore(account: "pairing-attempt").read(PairingAttempt.self) {
            _server = State(initialValue: attempt.server); _code = State(initialValue: attempt.code); _claimKey = State(initialValue: attempt.key)
        }
    }
    var body: some View {
        Section("连接个人环境") {
            LabeledContent("HTTPS 地址") { TextField("HTTPS 地址", text: $server, prompt: Text("https://服务器主机").foregroundStyle(.primary)).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityIdentifier("serverAddress").disabled(busy) }
            LabeledContent("一次性配对码") { SecureField("一次性配对码", text: $code, prompt: Text("配对码").foregroundStyle(.primary)).accessibilityIdentifier("pairingCode").disabled(busy) }
            Text("先查看环境和数据去向，确认后才会发送配对码。").foregroundStyle(.primary)
            Button("查看环境") { Task { await inspect() } }.disabled(busy).accessibilityIdentifier("inspectEnvironment")
            Button("扫描配对二维码") { scanning = true }.disabled(busy).accessibilityFocused($scanFocused)
        }
        if let candidate, let info {
            Section("请确认环境") {
                LabeledContent("HTTPS 主机") { Text(candidate.authority).foregroundStyle(.primary) }
                EnvironmentDetails(info: info)
                Text("环境会保存你的信息，模型提供方将处理你授权的内容。确认此主机及数据去向后连接。")
                Button("确认环境并连接") { Task { await claim(candidate, info) } }.disabled(busy).accessibilityIdentifier("confirmPairing")
            }
        }
        if busy { ProgressView("正在连接") }
        if let error { Section("连接失败") { Text(error).accessibilityIdentifier("pairingError"); Button("重试查看环境") { Task { await inspect() } }.disabled(busy) } }
        Text("此阶段不会请求通知、位置或邮箱权限。").font(.body).foregroundStyle(.primary)
            .sheet(isPresented: $scanning) {
                QRScanner { result in
                    scanning = false
                    do {
                        let input = try PairingInput(qr: result)
                        server = input.serverURL.absoluteString; code = input.code
                        candidate = nil; info = nil; claimKey = UUID().uuidString
                    } catch { self.error = "无法读取配对二维码，请手动输入 HTTPS 地址与一次性配对码。" }
                }
            }
            .onChange(of: server) { _, _ in clearConfirmation() }
            .onChange(of: code) { _, _ in clearConfirmation() }
            .onChange(of: scanning) { _, presented in if !presented { scanFocused = true } }
    }
    private func clearConfirmation() { candidate = nil; info = nil; claimKey = UUID().uuidString; try? attemptStore.remove() }
    private func inspect() async {
        busy = true; error = nil; candidate = nil; info = nil; defer { busy = false }
        do {
            let input = try PairingInput(server: server, code: code)
            let environment = try await NivliAPI(server: input.serverURL).environment()
            guard environment.host == input.authority else { throw PairingError.identityChanged }
            candidate = input; info = environment
        } catch { self.error = error.localizedDescription }
    }
    private func claim(_ input: PairingInput, _ environment: EnvironmentInfo) async {
        busy = true; error = nil; defer { busy = false }
        do {
            try attemptStore.save(PairingAttempt(server: input.serverURL.absoluteString, code: input.code, key: claimKey))
            let credentials = try await NivliAPI(server: input.serverURL).claim(code: input.code, deviceName: UIDevice.current.name, key: claimKey)
            try connection.save(server: input.serverURL, credentials: credentials, environment: environment)
            try attemptStore.remove()
            code = ""
        } catch { self.error = error.localizedDescription }
    }
}
