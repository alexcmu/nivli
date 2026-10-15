import XCTest
final class AgentUITests: XCTestCase {
    @MainActor func testZDurableAgentInputCreatesSystemReminderAndRecoversAfterRelaunch() async throws {
        guard let url = Bundle(for: Self.self).url(forResource: "AgentFixture", withExtension: "json") else { throw XCTSkip("Provide a private isolated HTTPS controlled-provider fixture") }
        struct Fixture: Decodable { let serverUrl: String; let code: String; let instruction: String; let title: String; let proofUrl: URL }
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
        XCTAssertTrue(editor.waitForExistence(timeout: 10)); editor.tap(); editor.typeText(fixture.instruction)
        // Unicode text exercises committed input, not a claim about IME marked-text composition.
        editor.typeText("\n")
        XCTAssertTrue(app.staticTexts["正在处理，原话已保留…"].waitForExistence(timeout: 10))
        app.terminate(); app.launch(); app.tabBars.buttons["交代"].tap()
        XCTAssertTrue(editor.waitForExistence(timeout: 10)); XCTAssertEqual(editor.value as? String, fixture.instruction)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let allow = springboard.buttons.matching(NSPredicate(format: "label == 'Allow' OR label == '允许'")).firstMatch
        if allow.waitForExistence(timeout: 15) { allow.tap() }
        XCTAssertTrue(app.staticTexts[fixture.title].waitForExistence(timeout: 30))
        for _ in 0..<4 { if app.staticTexts["本机已安排"].isHittable { break }; app.swipeUp() }
        XCTAssertTrue(app.staticTexts["本机已安排"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["来源：" + fixture.instruction].exists)
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = "Agent saved current task and system receipt"; screenshot.lifetime = .keepAlways; add(screenshot)
        struct Proof: Decodable {
            struct Task: Decodable { struct Reminder: Decodable { let schedulingStatus: String }; let id: String; let title: String; let reminder: Reminder }
            let requests: Int; let tasks: [Task]
        }
        let (data, response) = try await URLSession.shared.data(from: fixture.proofUrl)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        let proof = try JSONDecoder().decode(Proof.self, from: data)
        XCTAssertEqual(proof.requests, 1); XCTAssertEqual(proof.tasks.count, 1)
        let task = try XCTUnwrap(proof.tasks.first); XCTAssertEqual(task.title, fixture.title); XCTAssertEqual(task.reminder.schedulingStatus, "local_installed")
        app.terminate(); app.launchArguments = ["-agent-system-evidence", "-agent-evidence-task", task.id]; app.launch()
        let systemConfirmed = app.staticTexts["实际系统计划=1；预览隐私=true"].waitForExistence(timeout: 10)
        XCTAssertTrue(systemConfirmed, app.staticTexts["agentSystemEvidence"].label)
        guard systemConfirmed else { return }
        print("HAIJI_AGENT_DEVICE durable_relaunch=true single_task=true single_provider_request=true OS_pending=1 private_preview=true")
        app.terminate(); app.launchArguments = []; app.launch(); app.tabBars.buttons["交代"].tap()
        XCTAssertTrue(app.staticTexts[fixture.title].waitForExistence(timeout: 20))
        app.tabBars.buttons["我的"].tap(); app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "环境连接")).firstMatch.tap()
        app.buttons["吊销并断开此设备"].tap(); XCTAssertTrue(app.textFields["serverAddress"].waitForExistence(timeout: 20))
    }
}
