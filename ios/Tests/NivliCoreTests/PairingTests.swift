import XCTest
@testable import NivliCore
final class PairingTests: XCTestCase {
    func testQRRequiresHTTPSAndKeepsCredentialOutOfURL() throws {
        let input = try PairingInput(qr: "{\"serverUrl\":\"https://home.example\",\"code\":\"123456\"}")
        XCTAssertEqual(input.serverURL.host, "home.example")
        XCTAssertEqual(input.code, "123456")
        XCTAssertEqual(try PairingInput(server: "https://home.example:8443", code: "123").authority, "home.example:8443")
        XCTAssertEqual(try PairingInput(server: "https://home.example:443", code: "123").authority, "home.example")
        XCTAssertThrowsError(try PairingInput(server: "http://home.example", code: "123"))
        XCTAssertThrowsError(try PairingInput(server: "https://home.example?code=123", code: "123"))
    }
}
final class PublicContractTests: XCTestCase {
    func testEnvironmentAndCredentialsDecodePublicJSON() throws {
        let environment = try JSONDecoder().decode(EnvironmentInfo.self, from: Data(#"{"name":"My Nivli","host":"home.example","pushMode":"self_signed","modelDataDestination":"Configured model provider","capabilities":["pairing","session"]}"#.utf8))
        XCTAssertEqual(environment.host, "home.example")
        let credentials = try JSONDecoder().decode(Credentials.self, from: Data(#"{"ownerId":"owner","deviceId":"device","sessionId":"session","accessToken":"access","refreshToken":"refresh","accessExpiresAt":"2026-10-11T09:15:00.000Z","refreshExpiresAt":"2026-11-10T09:00:00.000Z","capabilities":["pairing","session"],"sync":{"state":"not_available"}}"#.utf8))
        XCTAssertEqual(credentials.deviceId, "device")
        XCTAssertEqual(credentials.sync.state, "not_available")
    }
}
final class HTTPBoundary: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var requests: [URLRequest] = []
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.requests.append(request)
        let payload: String
        switch request.url!.path {
        case "/v1/environment": payload = #"{"name":"My Nivli","host":"home.example","pushMode":"self_signed","modelDataDestination":"Configured model provider","capabilities":["pairing","session"]}"#
        default: payload = #"{"code":"invalid_pairing","message":"Pairing rejected","requestId":"test-request","retryable":false}"#
        }
        let status = request.url!.path == "/v1/environment" ? 200 : 401
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(payload.utf8)); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
final class APIBoundaryTests: XCTestCase {
    func testEnvironmentInspectionDoesNotTransmitCodeAndClaimUsesPublicErrorContract() async throws {
        HTTPBoundary.requests = []
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [HTTPBoundary.self]
        let api = NivliAPI(server: URL(string: "https://home.example")!, session: URLSession(configuration: config))
        let environment = try await api.environment()
        XCTAssertEqual(environment.name, "My Nivli")
        XCTAssertNil(HTTPBoundary.requests.first?.httpBody)
        XCTAssertNil(HTTPBoundary.requests.first?.value(forHTTPHeaderField: "Authorization"))
        do { _ = try await api.claim(code: "123456", deviceName: "Test iPhone", key: "retry-key"); XCTFail("Must reject invalid code") }
        catch let error as APIError { XCTAssertEqual(error.requestId, "test-request"); XCTAssertFalse(error.retryable) }
        XCTAssertEqual(HTTPBoundary.requests.last?.url?.path, "/v1/pairings/claim")
        XCTAssertEqual(HTTPBoundary.requests.last?.value(forHTTPHeaderField: "Idempotency-Key"), "retry-key")
    }
}

final class VersionedContractTests: XCTestCase {
    func testSwiftReadsVersionedBackendContractExamples() throws {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        func read<T: Decodable>(_ name: String, _ type: T.Type) throws -> T { try JSONDecoder().decode(type, from: Data(contentsOf: root.appendingPathComponent("contracts/examples/\(name).json"))) }
        let environment = try read("environment", EnvironmentInfo.self)
        XCTAssertFalse(environment.name.isEmpty)
        let credentials = try read("credentials", Credentials.self)
        XCTAssertNotNil(UUID(uuidString: credentials.sessionId))
        let identity = try read("session", SessionIdentity.self)
        XCTAssertEqual(identity.sessionId, credentials.sessionId)
        let error = try read("error", APIError.self)
        XCTAssertFalse(error.code.isEmpty)
    }
}
