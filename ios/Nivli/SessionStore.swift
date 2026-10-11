import SwiftUI
import Security

struct SavedSession: Codable { let server: URL; var credentials: Credentials; var renewalKey: String?; var revocationKey: String? }
struct SecureStore {
    private let account: String
    init(account: String = "device-session") { self.account = account }
    private var query: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "app.nivli.session", kSecAttrAccount as String: account] }
    func load() throws -> SavedSession? { try read(SavedSession.self) }
    func read<T: Decodable>(_ type: T.Type) throws -> T? {
        var q = query; q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?; let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw StoreError.failed }
        return try JSONDecoder().decode(type, from: data)
    }
    func save<T: Encodable>(_ saved: T) throws {
        let data = try JSONEncoder().encode(saved)
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var q = query; q[kSecValueData as String] = data; q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            guard SecItemAdd(q as CFDictionary, nil) == errSecSuccess else { throw StoreError.failed }
        } else if status != errSecSuccess { throw StoreError.failed }
    }
    func remove() throws { let status = SecItemDelete(query as CFDictionary); guard status == errSecSuccess || status == errSecItemNotFound else { throw StoreError.failed } }
    enum StoreError: Error, LocalizedError { case failed; var errorDescription: String? { "无法保存设备凭据，请解锁设备后重试。" } }
}

@MainActor @Observable final class Connection {
    var saved: SavedSession?
    var environment: EnvironmentInfo?
    var error: String?
    var busy = false
    var verified = false
    private let store = SecureStore()
    init() {
        do { saved = try store.load() } catch { self.error = error.localizedDescription }
    }
    func restore() async {
        guard var session = saved, !busy else { return }
        busy = true; defer { busy = false }
        do {
            let api = NivliAPI(server: session.server)
            // Keep the same mutation key across retries and app restarts if the response was lost.
            let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if session.renewalKey != nil || (formatter.date(from: session.credentials.accessExpiresAt) ?? .distantPast) <= Date() {
                session.renewalKey = session.renewalKey ?? UUID().uuidString
                try store.save(session); saved = session
                session.credentials = try await api.renew(refreshToken: session.credentials.refreshToken, key: session.renewalKey!)
                session.renewalKey = nil; try store.save(session); saved = session
            }
            let identity = try await api.session(token: session.credentials.accessToken)
            guard identity.ownerId == session.credentials.ownerId, identity.deviceId == session.credentials.deviceId, identity.sessionId == session.credentials.sessionId else { throw PairingError.identityChanged }
            environment = try await api.environment(); verified = true; error = nil
        } catch { verified = false; self.error = error.localizedDescription }
    }
    func save(server: URL, credentials: Credentials, environment: EnvironmentInfo) throws {
        let saved = SavedSession(server: server, credentials: credentials)
        try store.save(saved); self.saved = saved; self.environment = environment; verified = true; error = nil
    }
    func forgetLocalCredentials() {
        do {
            try store.remove(); try SecureStore(account: "pairing-attempt").remove()
            saved = nil; environment = nil; verified = false; error = nil
        } catch { self.error = error.localizedDescription }
    }
    func disconnect() async {
        guard var saved, !busy else { return }
        busy = true; defer { busy = false }
        do {
            saved.revocationKey = saved.revocationKey ?? UUID().uuidString
            try store.save(saved); self.saved = saved
            try await NivliAPI(server: saved.server).revoke(token: saved.credentials.accessToken, key: saved.revocationKey!)
            try store.remove(); self.saved = nil; environment = nil; verified = false; error = nil
        } catch { self.error = error.localizedDescription }
    }
}
