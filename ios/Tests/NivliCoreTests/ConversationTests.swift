import XCTest
@testable import NivliCore
final class ConversationTests: XCTestCase {
    func testLinkedConversationAndLifecycleDecoding() throws {
        let data=Data(#"{"id":"conversation","revision":1,"acceptedRevision":2,"messages":[{"inputId":"original","runId":"run","revision":1,"text":"明天提醒我提交材料","timeZone":"Asia/Shanghai","status":"needs_clarification","message":"几点？"}]}"#.utf8)
        let history=try JSONDecoder().decode(ConversationHistory.self,from:data)
        XCTAssertEqual(history.messages.first?.text,"明天提醒我提交材料")
        let run=try JSONDecoder().decode(ConversationRun.self,from:Data(#"{"id":"run","inputId":"original","status":"timed_out","stillProcessing":false}"#.utf8))
        XCTAssertEqual(run.status,.timed_out)
    }
    func testModelRefusalKeepsFeedbackAndOriginalInputWithoutLinkedReplyAuthority() throws {
        let run = try JSONDecoder().decode(ConversationRun.self, from: Data(#"{"id":"refused-run","inputId":"refused-input","status":"needs_clarification","errorCode":"MODEL_REFUSED","text":"原始交代","message":"此次请求无法处理，请另行交代事项与提醒时间。"}"#.utf8))
        XCTAssertEqual(run.errorCode, "MODEL_REFUSED")
        XCTAssertEqual(run.text, "原始交代")
        XCTAssertEqual(run.message, "此次请求无法处理，请另行交代事项与提醒时间。")
        XCTAssertNil(run.clarificationReplyInputId)
        let clarification = try JSONDecoder().decode(ConversationRun.self, from: Data(#"{"id":"clarify-run","inputId":"original-input","status":"needs_clarification","message":"几点？"}"#.utf8))
        XCTAssertEqual(clarification.clarificationReplyInputId, "original-input")
    }
    func testRefusalHistoryRetainsDomainFeedbackAfterRelaunchAndOlderHistoryStillDecodes() throws {
        let data = Data(#"{"id":"conversation","revision":1,"acceptedRevision":1,"messages":[{"inputId":"refused-input","runId":"refused-run","revision":1,"text":"原始交代","timeZone":"Asia/Shanghai","status":"needs_clarification","errorCode":"MODEL_REFUSED","message":"此次请求无法处理，请另行交代事项与提醒时间。"}]}"#.utf8)
        let history = try JSONDecoder().decode(ConversationHistory.self, from: data)
        let restored = try JSONDecoder().decode(ConversationHistory.self, from: JSONEncoder().encode(history))
        XCTAssertEqual(restored.messages.first?.errorCode, "MODEL_REFUSED")
        XCTAssertEqual(restored.messages.first?.text, "原始交代")
        XCTAssertEqual(restored.messages.first?.message, "此次请求无法处理，请另行交代事项与提醒时间。")
        let old = try JSONDecoder().decode(ConversationHistory.self, from: Data(#"{"id":"conversation","revision":1,"acceptedRevision":1,"messages":[{"inputId":"original","runId":"run","revision":1,"text":"原话","timeZone":"Asia/Shanghai","status":"needs_clarification","message":"几点？"}]}"#.utf8))
        XCTAssertNil(old.messages.first?.errorCode)
    }
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

final class ConversationRetryTests: XCTestCase {
    func testPersistedCancellationIdentitySurvivesUncertainRetryButChangesAfterAcknowledgement() throws {
        var draft = ConversationDraft()
        draft.text = "明天提醒我提交材料"
        draft.runId = "same-run"
        let firstCancellation = draft.cancellationKey()
        draft.prepareRetry()
        let retry = try XCTUnwrap(draft.retryKey)
        // Relaunch after transport loss must replay the same operations.
        draft = try JSONDecoder().decode(ConversationDraft.self, from: JSONEncoder().encode(draft))
        draft.prepareRetry()
        XCTAssertEqual(draft.retryKey, retry)
        XCTAssertEqual(draft.cancellationKey(), firstCancellation)
        draft.acknowledgeRetry(key: retry)
        let secondCancellation = draft.cancellationKey()
        XCTAssertNotEqual(secondCancellation, firstCancellation)
        draft.acknowledgeRetry(key: retry) // A duplicate old acknowledgement cannot discard the new cancel.
        XCTAssertEqual(draft.cancellationKey(), secondCancellation)
        XCTAssertEqual(draft.runId, "same-run")
        XCTAssertEqual(draft.text, "明天提醒我提交材料")
    }
}

final class PendingStopTests: XCTestCase {
    func testStopDuringUnknownInitialAndRetryAcknowledgementsSurvivesRelaunchAndTargetsAcceptedAttempt() throws {
        var draft = ConversationDraft()
        draft.text = "明天提醒我提交材料"
        draft.key = "initial-input"
        draft.requestCancellation()
        XCTAssertNil(draft.pendingCancellationKey()) // No run acknowledgement yet.
        draft = try JSONDecoder().decode(ConversationDraft.self, from: JSONEncoder().encode(draft))
        draft.runId = "accepted-run"
        let firstStop = try XCTUnwrap(draft.pendingCancellationKey())
        draft.acknowledgeCancellation(key: firstStop)
        XCTAssertNil(draft.pendingCancellationKey())
        draft.prepareRetry()
        let retry = try XCTUnwrap(draft.retryKey)
        draft.requestCancellation() // Server accepted retry, response is delayed or lost.
        XCTAssertNil(draft.pendingCancellationKey()) // Must not replay the first attempt's stop.
        draft = try JSONDecoder().decode(ConversationDraft.self, from: JSONEncoder().encode(draft))
        draft.prepareRetry() // Uncertain acknowledgement must preserve Stop intent.
        XCTAssertEqual(draft.retryKey, retry)
        XCTAssertEqual(draft.cancellationRequested, true)
        draft.acknowledgeRetry(key: retry)
        let secondStop = try XCTUnwrap(draft.pendingCancellationKey())
        XCTAssertNotEqual(secondStop, firstStop)
        draft = try JSONDecoder().decode(ConversationDraft.self, from: JSONEncoder().encode(draft))
        XCTAssertEqual(draft.pendingCancellationKey(), secondStop) // Lost cancel response replays safely.
        draft.acknowledgeCancellation(key: secondStop)
        XCTAssertNil(draft.pendingCancellationKey())
        draft.prepareRetry() // An explicit new retry resets prior stop intent.
        XCTAssertNil(draft.cancellationRequested)
        XCTAssertEqual(draft.text, "明天提醒我提交材料")
    }
    func testOldDraftWithoutStopIntentStillDecodes() throws {
        let old = Data(#"{"text":"原话","runId":"existing","cancelKey":"previous"}"#.utf8)
        var draft = try JSONDecoder().decode(ConversationDraft.self, from: old)
        XCTAssertNil(draft.cancellationRequested)
        XCTAssertNil(draft.pendingCancellationKey())
    }
}
