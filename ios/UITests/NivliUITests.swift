import XCTest
final class NivliUITests: XCTestCase {
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
    @MainActor func testNotificationActionsReplaceAndCancelAcrossJournalReopen() {
        let app = XCUIApplication(); app.launchArguments = ["-notification-platform-validation"]; app.launch()
        app.buttons["验证通知动作与替换取消"].tap()
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let allow = springboard.buttons.matching(NSPredicate(format: "label == 'Allow' OR label == '允许'")).firstMatch
        if allow.waitForExistence(timeout: 2) { allow.tap() }
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS '认证动作=true；替换=true；取消=true；新计划=installed'")).firstMatch.waitForExistence(timeout: 15), app.staticTexts["notificationEvidence"].label)
    }
    @MainActor func testPrepareLockedOfflineNotificationObservation() throws {
        let app = XCUIApplication(); app.launchArguments = ["-notification-platform-validation"]; app.launch()
        app.buttons["安排3分钟验收通知"].tap()
        let accepted = app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'installed；pending=true'")).firstMatch
        XCTAssertTrue(accepted.waitForExistence(timeout: 10), app.staticTexts["notificationEvidence"].label)
        print("NIVLI_MANUAL_NOTIFICATION_READY \(app.staticTexts["notificationEvidence"].label)")
        XCUIDevice.shared.press(.home)
    }

    @MainActor func testNotificationPermissionOffPreservesUnscheduledState() throws {
        let app = XCUIApplication(); app.launchArguments = ["-notification-platform-validation"]; app.launch()
        // A fresh isolated installation must request authorization before Settings
        // exposes its notification switch.
        app.buttons["验证本机容量与恢复"].tap()
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let allow = springboard.buttons.matching(NSPredicate(format: "label == 'Allow' OR label == '允许'")).firstMatch
        if allow.waitForExistence(timeout: 3) { allow.tap() }
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'OS pending' OR label CONTAINS '权限关闭'")).firstMatch.waitForExistence(timeout: 15))
        app.buttons["打开通知设置"].tap()
        let settings = XCUIApplication(bundleIdentifier: "com.apple.Preferences")
        let permission = settings.switches.matching(NSPredicate(format: "label CONTAINS[c] 'Allow Notifications' OR label CONTAINS '允许通知'")).firstMatch
        XCTAssertTrue(permission.waitForExistence(timeout: 10))
        guard permission.exists else { return }
        print("NIVLI_PERMISSION_BEFORE \(String(describing: permission.value))")
        if permission.value as? String == "1" { permission.tap() }
        let off = NSPredicate(format: "value == '0'")
        guard off.evaluate(with: permission) || XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: off, object: permission)], timeout: 5) == .completed else { throw XCTSkip("Device Settings did not turn notification authorization off; manual permission-off acceptance remains required.") }
        print("NIVLI_PERMISSION_AFTER \(String(describing: permission.value))")
        app.activate()
        app.buttons["验证本机容量与恢复"].tap()
        XCTAssertTrue(app.staticTexts["权限关闭：未安装，事项保留"].waitForExistence(timeout: 10), app.staticTexts["notificationEvidence"].label)
        app.buttons["打开通知设置"].tap()
        XCTAssertTrue(permission.waitForExistence(timeout: 10))
        print("NIVLI_PERMISSION_RESTORE \(String(describing: permission.value))")
        if permission.value as? String == "0" { permission.tap() }
        app.activate()
    }

    @MainActor func testNotificationPlatformCapacityRecoveryAndBackgroundDelivery() throws {
        let app = XCUIApplication(); app.launchArguments = ["-notification-platform-validation"]; app.launch()
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        app.buttons["验证本机容量与恢复"].tap()
        let allow = springboard.buttons.matching(NSPredicate(format: "label == 'Allow' OR label == '允许'")).firstMatch
        if allow.waitForExistence(timeout: 3) { allow.tap() }
        let capacity = app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'OS pending 16' AND label CONTAINS '下一条 capacity' AND label CONTAINS '恢复 installed'")).firstMatch
        XCTAssertTrue(capacity.waitForExistence(timeout: 20), app.staticTexts["notificationEvidence"].label)
        app.buttons["安排自动化验收通知"].tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'installed；pending=true'")).firstMatch.waitForExistence(timeout: 10))
        XCUIDevice.shared.press(.home)
        let generic = springboard.staticTexts["Nivli 提醒"].firstMatch
        let visuallyObserved = generic.waitForExistence(timeout: 15)
        print("NIVLI_NOTIFICATION_BANNER_OBSERVED \(visuallyObserved)")
        app.activate()
        app.buttons["检查系统投递记录"].tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'pending=false；delivered=true'")).firstMatch.waitForExistence(timeout: 5))
        app.buttons["清理验收通知"].tap()
    }

    @MainActor func testZLivePairingRestoresAndRevokesSession() throws {
        guard let url = Bundle(for: Self.self).url(forResource: "LiveFixture", withExtension: "json") else { throw XCTSkip("Provide ephemeral HTTPS fixture to run live pairing") }
        struct Fixture: Decodable { let serverUrl: String; let code: String }
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
        let app = XCUIApplication(); app.launchArguments = ["-AppleInterfaceStyle", "Light"]; app.launch()
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
        app.tabBars.buttons["交代"].tap()
        let title = "Native manual task " + UUID().uuidString
        app.textFields["标题"].tap(); app.textFields["标题"].typeText(title)
        app.textFields["必要背景（选填）"].tap(); app.textFields["必要背景（选填）"].typeText("Native source evidence")
        for _ in 0..<5 { if app.buttons["保存事项"].isHittable { break }; app.swipeUp() }
        app.buttons["保存事项"].tap()
        XCTAssertTrue(app.buttons["查看事项"].waitForExistence(timeout: 20))
        app.buttons["查看事项"].tap()
        XCTAssertTrue(app.staticTexts["已保存，提醒尚未安排"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["手动交代"].exists)
        app.terminate(); app.launchArguments = ["-AppleInterfaceStyle", "Dark"]; app.launch(); app.tabBars.buttons["此刻"].tap()
        XCTAssertTrue(app.staticTexts[title].waitForExistence(timeout: 20))
        app.staticTexts[title].tap()
        XCTAssertTrue(app.staticTexts["Native source evidence"].waitForExistence(timeout: 5))
        app.tabBars.buttons["我的"].tap()
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "环境连接")).firstMatch.tap()
        app.buttons["吊销并断开此设备"].tap()
        XCTAssertTrue(app.textFields["serverAddress"].waitForExistence(timeout: 20))
    }

}
