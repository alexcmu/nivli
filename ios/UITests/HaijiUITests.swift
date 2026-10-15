import XCTest
final class HaijiUITests: XCTestCase {
    @MainActor func testKeyboardCommandDispatchKeepsNewlineInDraft() {
        let app = XCUIApplication()
        app.launchArguments = ["-conversation-keyboard-validation"]
        app.launch()
        let editor = app.textViews["交代内容"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        editor.tap()
        editor.typeText("First line")
        app.buttons["执行换行快捷键"].tap()
        XCTAssertEqual(app.staticTexts["keyboardDraftText"].label, "First line\n")
        editor.typeText("Second line")
        XCTAssertEqual(app.staticTexts["keyboardDraftText"].label, "First line\nSecond line")
        XCTAssertEqual(app.staticTexts["keyboardSubmissionCount"].label, "提交次数：0")
        editor.typeText("\n")
        XCTAssertEqual(app.staticTexts["keyboardSubmissionCount"].label, "提交次数：1")
        XCTAssertEqual(app.staticTexts["keyboardSubmittedText"].label, "First line\nSecond line")
    }
    @MainActor func testShiftReturnInsertsNewlineAndReturnSubmits() throws {
        guard Bundle(for: Self.self).url(forResource: "KeyboardFixture", withExtension: "json") != nil else {
            throw XCTSkip("Provide an isolated KeyboardFixture.json only with a verified hardware keyboard input path; synthetic committed text does not verify Shift+Return.")
        }
        let app = XCUIApplication()
        app.launchArguments = ["-conversation-keyboard-validation"]
        app.launch()
        let editor = app.textViews["交代内容"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        editor.tap()
        editor.typeKey("x", modifierFlags: [])
        guard app.staticTexts["keyboardDraftText"].label == "x" else {
            throw XCTSkip("This automation session did not deliver a hardware key to the editor; physical keyboard acceptance remains required.")
        }
        editor.typeText(XCUIKeyboardKey.delete.rawValue)
        editor.typeText("First line")
        XCTAssertEqual(app.staticTexts["keyboardDraftText"].label, "First line")
        editor.typeKey(XCUIKeyboardKey.return.rawValue, modifierFlags: .shift)
        editor.typeText("Second line")
        XCTAssertEqual(app.staticTexts["keyboardDraftText"].label, "First line\nSecond line")
        XCTAssertEqual(app.staticTexts["keyboardSubmissionCount"].label, "提交次数：0")
        editor.typeText("\n")
        XCTAssertEqual(app.staticTexts["keyboardSubmissionCount"].label, "提交次数：1")
        XCTAssertEqual(app.staticTexts["keyboardSubmittedText"].label, "First line\nSecond line")
    }
    @MainActor func testNativeTabsAndManualPairingFailure() { verifyNavigation(style: "Light", size: "UICTContentSizeCategoryL") }
    @MainActor func testDarkNavigation() { verifyNavigation(style: "Dark", size: "UICTContentSizeCategoryL") }
    @MainActor private func verifyNavigation(style: String, size: String) {
        let app = XCUIApplication(); app.launchArguments = ["-AppleInterfaceStyle", style, "-UIPreferredContentSizeCategoryName", size]; app.launch()
        XCTAssertTrue(app.tabBars.buttons["此刻"].exists)
        XCTAssertFalse(app.alerts.firstMatch.exists)
        app.tabBars.buttons["交代"].tap()
        XCTAssertTrue(app.staticTexts["先连接个人环境"].exists)
        app.tabBars.buttons["我的"].tap()
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "环境连接")).firstMatch.tap()
        XCTAssertTrue(app.textFields["serverAddress"].exists)
        XCTAssertTrue(app.secureTextFields["pairingCode"].exists)
        let address = app.textFields["serverAddress"]
        address.tap()
        if !app.keyboards.firstMatch.waitForExistence(timeout: 2) { address.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap() }
        address.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: (address.value as? String ?? "").count))
        address.typeText("http://invalid.example")
        if !app.buttons["inspectEnvironment"].isHittable { app.swipeUp() }
        app.buttons["inspectEnvironment"].tap()
        if !app.staticTexts["pairingError"].waitForExistence(timeout: 2) { app.swipeUp() }
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
}
