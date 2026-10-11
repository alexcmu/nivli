import XCTest
final class NivliUITests: XCTestCase {
    @MainActor func testNativeTabsAndManualPairingFailure() { verifyNavigation(style: "Light", size: "UICTContentSizeCategoryL") }
    @MainActor func testDarkNavigation() { verifyNavigation(style: "Dark", size: "UICTContentSizeCategoryL") }
    @MainActor private func verifyNavigation(style: String, size: String) {
        let app = XCUIApplication(); app.launchArguments = ["-AppleInterfaceStyle", style, "-UIPreferredContentSizeCategoryName", size]; app.launch()
        XCTAssertTrue(app.tabBars.buttons["此刻"].exists)
        XCTAssertFalse(app.alerts.firstMatch.exists)
        app.tabBars.buttons["交代"].tap()
        XCTAssertTrue(app.staticTexts["交代功能尚未开放"].exists)
        app.tabBars.buttons["我的"].tap()
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "环境连接")).firstMatch.tap()
        XCTAssertTrue(app.textFields["serverAddress"].exists)
        XCTAssertTrue(app.secureTextFields["pairingCode"].exists)
        if !app.buttons["inspectEnvironment"].isHittable { app.swipeUp() }
        app.buttons["inspectEnvironment"].tap()
        app.swipeUp()
        XCTAssertTrue(app.staticTexts["pairingError"].waitForExistence(timeout: 3))
    }
    @MainActor func testCameraFallbackPreservesManualPairing() {
        let app = XCUIApplication(); app.launch()
        app.tabBars.buttons["我的"].tap()
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "环境连接")).firstMatch.tap()
        app.buttons["扫描配对二维码"].tap()
        if app.alerts.firstMatch.waitForExistence(timeout: 2) {
            let deny = app.alerts.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@ OR label CONTAINS %@", "Don", "不允许")).firstMatch
            if deny.exists { deny.tap() }
        }
        XCTAssertTrue(app.buttons["返回手动输入"].waitForExistence(timeout: 5))
        app.buttons["返回手动输入"].tap()
        XCTAssertTrue(app.textFields["serverAddress"].exists)
    }
    @MainActor func testZLivePairingRestoresAndRevokesSession() throws {
        guard let url = Bundle(for: Self.self).url(forResource: "LiveFixture", withExtension: "json") else { throw XCTSkip("Provide ephemeral HTTPS fixture to run live pairing") }
        struct Fixture: Decodable { let serverUrl: String; let code: String }
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
        let app = XCUIApplication(); app.launch()
        app.tabBars.buttons["我的"].tap()
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "环境连接")).firstMatch.tap()
        app.textFields["serverAddress"].tap(); app.textFields["serverAddress"].typeText(fixture.serverUrl)
        app.secureTextFields["pairingCode"].tap(); app.secureTextFields["pairingCode"].typeText(fixture.code)
        app.swipeUp()
        app.buttons["inspectEnvironment"].tap()
        XCTAssertTrue(app.staticTexts["请确认环境"].waitForExistence(timeout: 20))
        for _ in 0..<5 { if app.buttons["confirmPairing"].isHittable { break }; app.swipeUp() }
        XCTAssertTrue(app.buttons["confirmPairing"].exists)
        app.buttons["confirmPairing"].tap()
        XCTAssertTrue(app.staticTexts["已连接"].waitForExistence(timeout: 20))
        app.terminate(); app.launch()
        app.tabBars.buttons["我的"].tap()
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "环境连接")).firstMatch.tap()
        XCTAssertTrue(app.staticTexts["已连接"].waitForExistence(timeout: 20))
        app.buttons["吊销并断开此设备"].tap()
        XCTAssertTrue(app.textFields["serverAddress"].waitForExistence(timeout: 20))
    }

}
