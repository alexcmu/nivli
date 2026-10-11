import XCTest
final class GmailUITests: XCTestCase {
    @MainActor func testMyGmailEntryRequiresPersonalEnvironment() {
        let app = XCUIApplication(); app.launch()
        app.tabBars.buttons["我的"].tap(); app.buttons["Gmail"].tap()
        XCTAssertTrue(app.staticTexts["先连接个人环境，再授权 Gmail。"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["连接个人环境"].exists)
    }
    @MainActor func testZGmailNativeConsentRangeAndStatusAgainstPublicAPI() throws {
        guard let url = Bundle(for: Self.self).url(forResource: "GmailFixture", withExtension: "json") else { throw XCTSkip("Provide ephemeral HTTPS Gmail fixture") }
        struct Fixture: Decodable { let serverUrl: String; let code: String }
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
        let app = XCUIApplication(); app.launch()
        app.tabBars.buttons["我的"].tap(); app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "环境连接")).firstMatch.tap()
        if app.textFields["serverAddress"].waitForExistence(timeout: 2) {
        app.textFields["serverAddress"].tap(); app.textFields["serverAddress"].typeText(fixture.serverUrl)
        app.secureTextFields["pairingCode"].tap(); app.secureTextFields["pairingCode"].typeText(fixture.code)
        app.swipeUp(); app.buttons["inspectEnvironment"].tap()
        XCTAssertTrue(app.staticTexts["请确认环境"].waitForExistence(timeout: 20))
        for _ in 0..<5 { if app.buttons["confirmPairing"].isHittable { break }; app.swipeUp() }
        app.buttons["confirmPairing"].tap(); XCTAssertTrue(app.staticTexts["已连接"].waitForExistence(timeout: 20))
        }
        app.navigationBars.buttons.firstMatch.tap(); app.buttons["Gmail"].tap()
        XCTAssertTrue(app.staticTexts["已停止读取"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "尚无成功同步")).firstMatch.exists)
        XCTAssertTrue(app.switches["收件箱 INBOX"].exists)
        for _ in 0..<4 { if app.buttons["gmailConnect"].isHittable { break }; app.swipeUp() }
        XCTAssertTrue(app.buttons["gmailConnect"].isEnabled); app.buttons["gmailConnect"].tap()
        XCTAssertTrue(app.navigationBars["Gmail 连接说明"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "整个 Gmail 邮箱的只读权限")).firstMatch.exists)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "初始最近 7 天")).firstMatch.exists)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "不会向模型发送邮件")).firstMatch.exists)
        app.buttons["取消"].tap()
        app.swipeDown()
        XCTAssertTrue(app.buttons["gmailStatusRefresh"].exists)
        // This validates native disclosure/status; real Google sign-in requires actual credentials.
    }
}
