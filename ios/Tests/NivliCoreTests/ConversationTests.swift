import XCTest
@testable import NivliCore
final class ConversationTests: XCTestCase {
    func testQueuedInputIsNotASavedTaskAndRunReturnsRealEntityIdentity() throws {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let accepted = try JSONDecoder().decode(AcceptedInput.self, from: Data(contentsOf: root.appendingPathComponent("contracts/examples/input-accepted.json")))
        XCTAssertEqual(accepted.runId, "00000000-0000-4000-8000-000000000012")
        let run = try JSONDecoder().decode(ConversationRun.self, from: Data(contentsOf: root.appendingPathComponent("contracts/examples/run-succeeded.json")))
        XCTAssertEqual(run.taskId, "00000000-0000-4000-8000-000000000011")
        XCTAssertEqual(run.status, .succeeded)
        let model = try JSONDecoder().decode(ModelConfiguration.self, from: Data(contentsOf: root.appendingPathComponent("contracts/examples/model-status.json")))
        XCTAssertTrue(model.configured)
        XCTAssertEqual(model.provider, "anthropic")
        XCTAssertEqual(model.model, "claude-sonnet-5-5")
        XCTAssertEqual(model.dataDestination, "https://api.anthropic.com")
    }
}
