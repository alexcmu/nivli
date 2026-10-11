import XCTest
@testable import NivliCore
final class ConversationTests: XCTestCase {
    func testQueuedInputIsNotASavedTaskAndRunReturnsRealEntityIdentity() throws {
        let accepted = try JSONDecoder().decode(AcceptedInput.self, from: Data(#"{"inputId":"input-1","runId":"run-1"}"#.utf8))
        XCTAssertEqual(accepted.runId, "run-1")
        let run = try JSONDecoder().decode(ConversationRun.self, from: Data(#"{"id":"run-1","inputId":"input-1","status":"succeeded","message":"已保存","taskId":"task-1"}"#.utf8))
        XCTAssertEqual(run.taskId, "task-1")
        XCTAssertEqual(run.status, .succeeded)
    }
}
