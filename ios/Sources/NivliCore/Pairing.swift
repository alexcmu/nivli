import Foundation

public struct PairingInput: Sendable {
    public let serverURL: URL
    public let code: String
    public var authority: String { serverURL.nivliAuthority }
    public init(server: String, code: String) throws {
        guard let url = URL(string: server.trimmingCharacters(in: .whitespacesAndNewlines)), url.scheme == "https", url.host != nil, url.user == nil, url.password == nil, url.query == nil, url.fragment == nil, url.path.isEmpty || url.path == "/", !code.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw PairingError.invalidInput }
        serverURL = url
        self.code = code.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    public init(qr: String) throws {
        struct QR: Decodable { let serverUrl: String; let code: String }
        let input = try JSONDecoder().decode(QR.self, from: Data(qr.utf8))
        try self.init(server: input.serverUrl, code: input.code)
    }
}
public enum PairingError: Error, LocalizedError {
    case invalidInput, invalidResponse, identityChanged
    public var errorDescription: String? {
        switch self {
        case .invalidInput: "请输入 HTTPS 主机地址和一次性配对码，地址不能包含凭据或查询参数。"
        case .invalidResponse: "服务器响应无法读取，请检查环境版本后重试。"
        case .identityChanged: "环境身份已变化，请重新确认环境。"
        }
    }
}

public extension URL {
    var nivliAuthority: String { (host ?? "") + (port != nil && port != 443 ? ":\(port!)" : "") }
}
