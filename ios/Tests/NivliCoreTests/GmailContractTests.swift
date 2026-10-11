import XCTest
@testable import NivliCore
final class GmailContractTests: XCTestCase {
    func testGmailConsentAndRecoveryStatusDecodeSharedExamples() throws {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let status = try JSONDecoder().decode(GmailStatus.self, from: Data(contentsOf: root.appendingPathComponent("contracts/examples/gmail-status.json")))
        XCTAssertEqual(status.state, "reauthorization_required")
        XCTAssertEqual(status.lastSuccessfulSync, "2026-10-11T09:00:00.000Z")
        XCTAssertEqual(status.syncError, "REAUTH_REQUIRED")
        let consent = try JSONDecoder().decode(GmailConsent.self, from: Data(contentsOf: root.appendingPathComponent("contracts/examples/gmail-consent.json")))
        XCTAssertEqual(consent.labelIds, ["INBOX"])
        XCTAssertEqual(consent.initialDays, 7)
        XCTAssertTrue(consent.confirmed)
    }
}
