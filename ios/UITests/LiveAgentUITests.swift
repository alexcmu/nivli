import XCTest

/// Explicit opt-in live-provider acceptance. Never supplied with a fixture in ordinary CI.
final class LiveAgentUITests: XCTestCase {
    struct Fixture: Decodable { let serverUrl: String; let code: String; let instruction: String; let answer: String; let change: String; let proofUrl: URL }
    struct Proof: Decodable {
        struct TaskRecord: Decodable {
            struct Reminder: Decodable { let instant: String; let schedulingStatus: String }
            let id: String; let title: String; let revision: Int; let reminder: Reminder
        }
        struct Run: Decodable {
            struct Cost: Decodable { let usageUsd: Double; let reservedUsd: Double; let unknownRequests: Int }
            let status: String; let requests: Int; let toolCalls: Int; let message: String?; let cost: Cost
        }
        let tasks: [TaskRecord]; let runs: [Run]
    }
    @MainActor private func proof(_ fixture: Fixture, count: Int, status: String, until predicate: (Proof) -> Bool) async throws -> Proof {
        let deadline = Date().addingTimeInterval(75)
        while Date() < deadline {
            let (data, response) = try await URLSession.shared.data(for: URLRequest(url: fixture.proofUrl, timeoutInterval: 5))
            XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
            let current = try JSONDecoder().decode(Proof.self, from: data)
            if predicate(current) { return current }
            if current.runs.count == count, let last = current.runs.last, !["queued", "running", status].contains(last.status) {
                throw NSError(domain: "Live provider returned unexpected terminal state: " + last.status + "; " + (last.message ?? ""), code: 2)
            }
            try await Task.sleep(for: .milliseconds(500))
        }
        throw NSError(domain: "Live acceptance did not reach required public state", code: 1)
    }
    @MainActor func testLiveClaudeClarificationCreationModificationAndSystemReceipt() async throws {
        guard let url = Bundle(for: Self.self).url(forResource: "LiveAgentFixture", withExtension: "json") else { throw XCTSkip("Provide an explicitly authorized isolated live-Claude fixture") }
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
        let app = XCUIApplication(); app.launch()
        app.tabBars.buttons["我的"].tap()
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "环境连接")).firstMatch.tap()
        XCTAssertTrue(app.textFields["serverAddress"].waitForExistence(timeout: 5))
        app.textFields["serverAddress"].tap(); app.textFields["serverAddress"].typeText(fixture.serverUrl)
        app.secureTextFields["pairingCode"].tap(); app.secureTextFields["pairingCode"].typeText(fixture.code)
        app.swipeUp(); app.buttons["inspectEnvironment"].tap()
        XCTAssertTrue(app.staticTexts["请确认环境"].waitForExistence(timeout: 20))
        for _ in 0..<5 { if app.buttons["confirmPairing"].isHittable { break }; app.swipeUp() }
        app.buttons["confirmPairing"].tap(); XCTAssertTrue(app.staticTexts["已连接"].waitForExistence(timeout: 20))
        app.tabBars.buttons["交代"].tap()
        let editor = app.textViews["交代内容"]
        XCTAssertTrue(editor.waitForExistence(timeout: 10)); editor.tap(); editor.typeText(fixture.instruction); editor.typeText("\n")
        XCTAssertTrue(app.staticTexts["正在处理，原话已保留…"].waitForExistence(timeout: 10))
        let clarified = try await proof(fixture, count: 1, status: "needs_clarification") { $0.runs.count == 1 && $0.runs[0].status == "needs_clarification" }
        XCTAssertEqual(clarified.tasks.count, 0)
        let question = try XCTUnwrap(clarified.runs[0].message)
        XCTAssertTrue(app.staticTexts[question].firstMatch.waitForExistence(timeout: 10))
        app.terminate(); app.launch(); app.tabBars.buttons["交代"].tap()
        XCTAssertTrue(app.staticTexts[question].firstMatch.waitForExistence(timeout: 15))
        editor.tap(); editor.typeText(fixture.answer); editor.typeText("\n")
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let allow = springboard.buttons.matching(NSPredicate(format: "label == 'Allow' OR label == '允许'")).firstMatch
        if allow.waitForExistence(timeout: 20) { allow.tap() }
        let created = try await proof(fixture, count: 2, status: "succeeded") { $0.runs.count == 2 && $0.runs[1].status == "succeeded" && $0.tasks.first?.reminder.schedulingStatus == "local_installed" }
        XCTAssertEqual(created.tasks.count, 1)
        let task = try XCTUnwrap(created.tasks.first)
        XCTAssertTrue(app.staticTexts[task.title].firstMatch.waitForExistence(timeout: 10))
        for _ in 0..<4 { if app.staticTexts["本机已安排"].firstMatch.isHittable { break }; app.swipeUp() }
        XCTAssertTrue(app.staticTexts["本机已安排"].firstMatch.waitForExistence(timeout: 10))
        for _ in 0..<5 { if editor.isHittable { break }; app.swipeDown() }
        editor.tap(); editor.typeText(fixture.change); editor.typeText("\n")
        let changed = try await proof(fixture, count: 3, status: "succeeded") { $0.runs.count == 3 && $0.runs[2].status == "succeeded" && $0.tasks.first?.revision == 2 && $0.tasks.first?.reminder.schedulingStatus == "local_installed" }
        XCTAssertEqual(changed.tasks.count, 1); XCTAssertEqual(changed.tasks[0].id, task.id)
        XCTAssertNotEqual(changed.tasks[0].reminder.instant, task.reminder.instant)
        for run in changed.runs { XCTAssertTrue((1...3).contains(run.requests)); XCTAssertLessThanOrEqual(run.toolCalls, 6); XCTAssertEqual(run.cost.unknownRequests, 0) }
        app.terminate(); app.launch(); app.tabBars.buttons["交代"].tap()
        XCTAssertTrue(app.staticTexts[fixture.change].firstMatch.waitForExistence(timeout: 15))
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = "Live Claude current task history"; image.lifetime = .keepAlways; add(image)
        app.terminate(); app.launchArguments = ["-agent-system-evidence", "-agent-evidence-task", task.id]; app.launch()
        XCTAssertTrue(app.staticTexts["实际系统计划=1；预览隐私=true"].waitForExistence(timeout: 10), app.staticTexts["agentSystemEvidence"].label)
        print("HAIJI_LIVE_DEVICE model=claude-sonnet-5-5 pi=1.1.0 clarify=true linked_answer=true edit=true history_relaunch=true OS_pending=1 usageUsd=\(changed.runs.reduce(0) { $0 + $1.cost.usageUsd }) requests=\(changed.runs.map(\.requests)) tools=\(changed.runs.map(\.toolCalls))")
        app.terminate(); app.launchArguments = []; app.launch()
        app.tabBars.buttons["我的"].tap(); app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "环境连接")).firstMatch.tap()
        app.buttons["吊销并断开此设备"].tap(); XCTAssertTrue(app.textFields["serverAddress"].waitForExistence(timeout: 20))
    }
}
