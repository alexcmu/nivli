import XCTest

/// Opt-in physical acceptance against an isolated public-API fixture.
final class NotificationInteractionUITests: XCTestCase {
    struct Fixture: Decodable {
        let serverUrl: String
        let code: String
        let fixtureUrl: URL
    }
    struct Proof: Decodable {
        struct Reminder: Decodable { let schedulingStatus: String; let instant: String }
        let id: String
        let title: String
        let revision: Int
        let status: String
        let reminder: Reminder?
    }
    private func fixture() throws -> Fixture {
        guard let url = Bundle(for: Self.self).url(forResource: "NotificationFixture", withExtension: "json") else {
            throw XCTSkip("Provide a private isolated notification fixture; never use a personal environment")
        }
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }
    @MainActor private func call(_ fixture: Fixture, _ operation: String, method: String = "GET") async throws -> Proof {
        var request = URLRequest(url: fixture.fixtureUrl.appendingPathComponent(operation))
        request.httpMethod = method
        request.timeoutInterval = 10
        let (data, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        return try JSONDecoder().decode(Proof.self, from: data)
    }
    @MainActor private func pair(_ app: XCUIApplication, fixture: Fixture) {
        app.tabBars.buttons["我的"].tap()
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "环境连接")).firstMatch.tap()
        if app.staticTexts["已连接"].exists {
            return
        }
        XCTAssertTrue(app.textFields["serverAddress"].waitForExistence(timeout: 5))
        app.textFields["serverAddress"].tap()
        app.textFields["serverAddress"].typeText(fixture.serverUrl)
        app.secureTextFields["pairingCode"].tap()
        app.secureTextFields["pairingCode"].typeText(fixture.code)
        app.swipeUp()
        app.buttons["inspectEnvironment"].tap()
        XCTAssertTrue(app.staticTexts["请确认环境"].waitForExistence(timeout: 20))
        for _ in 0..<5 { if app.buttons["confirmPairing"].isHittable { break }; app.swipeUp() }
        app.buttons["confirmPairing"].tap()
        XCTAssertTrue(app.staticTexts["已连接"].waitForExistence(timeout: 20))
    }
    @MainActor func testPermissionDeniedKeepsSavedTaskAndSettingsLink() async throws {
        let fixture = try fixture()
        let app = XCUIApplication(bundleIdentifier: "app.haiji.acceptance.Haiji")
        app.launch()
        pair(app, fixture: fixture)
        _ = try await call(fixture, "create", method: "POST")
        let created = try await call(fixture, "reset", method: "POST")
        // Fixture creation is an external public-API write. Relaunch to fetch the
        // current server projection instead of relying on an earlier empty page.
        app.terminate()
        app.launch()
        app.tabBars.buttons["此刻"].tap()
        XCTAssertTrue(app.staticTexts[created.title].firstMatch.waitForExistence(timeout: 15))
        app.staticTexts[created.title].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["通知权限未开启 · 事项已保存"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["打开通知设置"].exists)
        XCTAssertFalse(app.alerts.firstMatch.exists)
        let proof = try await call(fixture, "proof")
        XCTAssertEqual(proof.id, created.id)
        XCTAssertEqual(proof.status, "active")
        XCTAssertEqual(proof.revision, created.revision)
        XCTAssertEqual(proof.reminder?.schedulingStatus, "permission_denied")
        print("HAIJI_DEVICE_PERMISSION saved=true active=true revision_unchanged=true permission_denied=true settings_link=true")
        app.buttons["打开通知设置"].tap()
    }
    @MainActor func testOldDeliveredNotificationOpensCurrentTaskAfterColdLaunch() async throws {
        let fixture = try fixture()
        let app = XCUIApplication(bundleIdentifier: "app.haiji.acceptance.Haiji")
        app.launch()
        let original = try await call(fixture, "reset", method: "POST")
        app.terminate()
        app.launch()
        app.tabBars.buttons["此刻"].tap()
        XCTAssertTrue(app.staticTexts[original.title].firstMatch.waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["本机已安排"].firstMatch.waitForExistence(timeout: 15))
        XCUIDevice.shared.press(.home)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let banner = springboard.staticTexts["Haiji 提醒"].firstMatch
        XCTAssertTrue(banner.waitForExistence(timeout: 40), "An actual generic delivered notification is required")
        let updated = try await call(fixture, "edit", method: "POST")
        XCTAssertEqual(updated.id, original.id)
        XCTAssertEqual(updated.revision, original.revision + 1)
        app.terminate()
        // Open Notification Center to use the already delivered obsolete occurrence.
        springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.01))
            .press(forDuration: 0.1, thenDragTo: springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.65)))
        let delivered = springboard.staticTexts["Haiji 提醒"].firstMatch
        XCTAssertTrue(delivered.waitForExistence(timeout: 10))
        delivered.tap()
        XCTAssertTrue(app.staticTexts[updated.title].firstMatch.waitForExistence(timeout: 20))
        XCTAssertTrue(app.navigationBars["事项详情"].waitForExistence(timeout: 10))
        let proof = try await call(fixture, "proof")
        XCTAssertEqual(proof.id, updated.id)
        XCTAssertEqual(proof.revision, updated.revision)
        XCTAssertEqual(proof.status, "active")
        print("HAIJI_OLD_NOTIFICATION cold_launch=true current_title=true revision_unchanged=true active=true")
    }
    @MainActor func testPrepareRealTaskForLockedAuthenticationObservation() async throws {
        let fixture = try fixture()
        let app = XCUIApplication(bundleIdentifier: "app.haiji.acceptance.Haiji")
        app.launch()
        let task = try await call(fixture, "prepare-locked", method: "POST")
        app.terminate()
        app.launch()
        XCTAssertTrue(app.staticTexts[task.title].firstMatch.waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["本机已安排"].firstMatch.waitForExistence(timeout: 15))
        let proof = try await call(fixture, "proof")
        XCTAssertEqual(proof.reminder?.schedulingStatus, "local_installed")
        app.terminate()
        app.launchArguments = ["-agent-system-evidence", "-agent-evidence-task", task.id]
        app.launch()
        XCTAssertTrue(app.staticTexts["实际系统计划=1；预览隐私=true"].waitForExistence(timeout: 10))
        app.terminate()
        app.launchArguments = []
        app.launch()
        XCUIDevice.shared.press(.home)
        print("HAIJI_LOCKED_ACTION_READY instant=\(proof.reminder?.instant ?? "") task=\(task.id)")
    }
    @MainActor func testDisconnectIsolatedNotificationEnvironment() throws {
        _ = try fixture()
        let app = XCUIApplication(bundleIdentifier: "app.haiji.acceptance.Haiji")
        app.launch()
        app.tabBars.buttons["我的"].tap()
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "环境连接")).firstMatch.tap()
        app.buttons["吊销并断开此设备"].tap()
        XCTAssertTrue(app.textFields["serverAddress"].waitForExistence(timeout: 20))
    }
}
