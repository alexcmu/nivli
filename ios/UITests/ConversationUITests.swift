import XCTest
final class ConversationUITests: XCTestCase {
    @MainActor func testLinkedClarificationModificationAndCurrentHistoryAfterRelaunch() async throws {
        guard let url = Bundle(for: Self.self).url(forResource: "AgentFixture", withExtension: "json") else { throw XCTSkip("Provide a private isolated HTTPS controlled-provider fixture") }
        struct Fixture: Decodable { let serverUrl: String; let code: String; let instruction: String; let title: String; let answer:String;let change:String;let proofUrl: URL }
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
        editor.typeText("\n")
        XCTAssertTrue(app.staticTexts["请问几点提醒？"].waitForExistence(timeout:20))
        app.terminate();app.launch();app.tabBars.buttons["交代"].tap()
        XCTAssertTrue(app.staticTexts["请问几点提醒？"].waitForExistence(timeout:15))
        editor.tap();editor.typeText(fixture.answer);editor.typeText("\n")
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let allow = springboard.buttons.matching(NSPredicate(format: "label == 'Allow' OR label == '允许'")).firstMatch
        if allow.waitForExistence(timeout: 15) { allow.tap() }
        XCTAssertTrue(app.staticTexts[fixture.title].firstMatch.waitForExistence(timeout: 30))
        for _ in 0..<4 { if app.staticTexts["本机已安排"].isHittable { break }; app.swipeUp() }
        XCTAssertTrue(app.staticTexts["本机已安排"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format:"label CONTAINS %@",fixture.instruction)).firstMatch.exists)
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = "Agent saved current task and system receipt"; screenshot.lifetime = .keepAlways; add(screenshot)
        struct Proof: Decodable {
            struct Task: Decodable { struct Reminder: Decodable { let schedulingStatus: String }; let id: String; let title: String;let revision:Int;let reminder: Reminder }
            let requests: Int; let tasks: [Task]
        }
        let (data, response) = try await URLSession.shared.data(from: fixture.proofUrl)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        let proof = try JSONDecoder().decode(Proof.self, from: data)
        XCTAssertEqual(proof.requests, 2); XCTAssertEqual(proof.tasks.count, 1)
        let task = try XCTUnwrap(proof.tasks.first); XCTAssertEqual(task.title, fixture.title); XCTAssertEqual(task.reminder.schedulingStatus, "local_installed")
        for _ in 0..<5 {if editor.isHittable{break};app.swipeDown()}
        editor.tap();editor.typeText(fixture.change);editor.typeText("\n")
        for _ in 0..<40 {let (current,_) = try await URLSession.shared.data(from:fixture.proofUrl);let p=try JSONDecoder().decode(Proof.self,from:current);if p.tasks.first?.revision==2 {break};try await Task.sleep(for:.milliseconds(500))}
        let (updated,_) = try await URLSession.shared.data(from:fixture.proofUrl);let final=try JSONDecoder().decode(Proof.self,from:updated)
        XCTAssertEqual(final.requests,3);XCTAssertEqual(final.tasks.count,1);XCTAssertEqual(final.tasks[0].revision,2)
        app.terminate();app.launch();app.tabBars.buttons["交代"].tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format:"label CONTAINS %@",fixture.change)).firstMatch.waitForExistence(timeout:20))
        let image=XCTAttachment(screenshot:app.screenshot());image.name="Linked clarification and current conversation task history";image.lifetime = .keepAlways;add(image)
        print("NIVLI_CONVERSATION_DEVICE linked_answer=true persisted_history=true one_task=true revision=2 requests=3 committed_Unicode=true")
        app.tabBars.buttons["我的"].tap(); app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "环境连接")).firstMatch.tap()
        app.buttons["吊销并断开此设备"].tap(); XCTAssertTrue(app.textFields["serverAddress"].waitForExistence(timeout: 20))
    }
}
