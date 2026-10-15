import XCTest

/// Opt-in USB acceptance. The private, short-lived fixture belongs only to a disposable local backend.
final class RemotePushDeviceUITests: XCTestCase {
    private struct Fixture: Decodable { let serverUrl: String; let code: String; let fixtureUrl: URL; let registrationOnly: Bool? }
    private struct Proof: Decodable { let registered: Bool; let taskId: String?; let taskStatus: String?; let remoteStatus: String?; let lastError: String?; let localOccurrence: Bool; let attempts: Int }
    @MainActor private func proof(_ fixture: Fixture) async throws -> Proof {
        let (data, response) = try await URLSession.shared.data(from: fixture.fixtureUrl.appendingPathComponent("proof"))
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        return try JSONDecoder().decode(Proof.self, from: data)
    }
    @MainActor func testRealRemoteNotificationFromLocalBackend() async throws {
        guard let fixtureURL = Bundle(for: Self.self).url(forResource: "PushFixture", withExtension: "json") else { throw XCTSkip("Provide a private local PushFixture.json for real APNs acceptance") }
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: fixtureURL))
        let app = XCUIApplication(bundleIdentifier: "app.haiji.Haiji")
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["我的"].waitForExistence(timeout: 15))
        app.tabBars.buttons["我的"].tap()
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "环境连接")).firstMatch.tap()
        let address = app.textFields["serverAddress"]
        if address.waitForExistence(timeout: 5) {
            address.tap(); address.typeText(fixture.serverUrl)
            app.secureTextFields["pairingCode"].tap(); app.secureTextFields["pairingCode"].typeText(fixture.code)
            if !app.buttons["inspectEnvironment"].isHittable { app.swipeUp() }
            app.buttons["inspectEnvironment"].tap()
            XCTAssertTrue(app.staticTexts["请确认环境"].waitForExistence(timeout: 20))
            for _ in 0..<5 { if app.buttons["confirmPairing"].isHittable { break }; app.swipeUp() }
            app.buttons["confirmPairing"].tap()
        }
        let host = try XCTUnwrap(URL(string: fixture.serverUrl)?.host)
        app.swipeDown(); app.swipeDown()
        let sameEnvironment = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", host)).firstMatch.waitForExistence(timeout: 10)
        XCTAssertTrue(sameEnvironment, "Do not alter a connection to another environment")
        guard sameEnvironment else { return }
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.buttons["远程通知"].tap()
        XCTAssertTrue(app.buttons["启用或重新注册远程通知"].waitForExistence(timeout: 10))
        app.buttons["启用或重新注册远程通知"].tap()
        if springboard.alerts.firstMatch.waitForExistence(timeout: 5) {
            let allow = springboard.alerts.buttons.matching(NSPredicate(format: "label == %@ OR label == %@", "Allow", "允许")).firstMatch
            XCTAssertTrue(allow.exists); allow.tap()
        }
        if fixture.registrationOnly == true {
            XCTAssertTrue(app.staticTexts["远程通知已启用"].waitForExistence(timeout: 20))
            print("HAIJI_PORTAL_DEVICE_REGISTRATION enabled=true")
            return
        }
        var registered = false
        for _ in 0..<40 { if try await proof(fixture).registered { registered = true; break }; try await Task.sleep(for: .seconds(1)) }
        XCTAssertTrue(registered, "Real device APNs registration must reach the local public API")
        guard registered else { return }
        app.swipeDown()
        XCTAssertTrue(app.staticTexts["远程通知已启用"].waitForExistence(timeout: 10))
        var create = URLRequest(url: fixture.fixtureUrl.appendingPathComponent("create")); create.httpMethod = "POST"
        let (_, response) = try await URLSession.shared.data(for: create)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { return }
        let createdProof = try await proof(fixture)
        XCTAssertFalse(createdProof.localOccurrence)
        XCUIDevice.shared.press(.home)
        var accepted = false
        for _ in 0..<100 {
            let p = try await proof(fixture)
            if p.remoteStatus == "accepted" { accepted = true; break }
            if p.remoteStatus == "failed" || p.remoteStatus == "unknown" { XCTFail("APNs result: \(p.remoteStatus ?? "none") / \(p.lastError ?? "none")"); break }
            try await Task.sleep(for: .seconds(1))
        }
        XCTAssertTrue(accepted)
        guard accepted else { return }
        let notification = springboard.staticTexts["Haiji 提醒"].firstMatch
        if !notification.waitForExistence(timeout: 8) {
            let start = springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.01))
            let end = springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.8))
            start.press(forDuration: 0.1, thenDragTo: end)
        }
        let visible = notification.waitForExistence(timeout: 20)
        let attachment = XCTAttachment(screenshot: springboard.screenshot()); attachment.name = "Real APNs notification"; attachment.lifetime = .keepAlways; add(attachment)
        XCTAssertTrue(visible, "APNs accepted alone does not prove an OS notification was visible")
        guard visible else { return }
        notification.tap()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 15))
        XCTAssertTrue(app.staticTexts["Haiji 远程推送验收"].firstMatch.waitForExistence(timeout: 20))
        let p = try await proof(fixture)
        XCTAssertEqual(p.taskStatus, "active"); XCTAssertEqual(p.attempts, 1); XCTAssertFalse(p.localOccurrence)
        print("HAIJI_REAL_APNS registered=true accepted=true visible=true opened_current_task=true attempts=1 local_plan=false")
    }
    @MainActor func testPortalTestNotificationIsVisible() throws {
        guard let fixtureURL = Bundle(for: Self.self).url(forResource: "PushFixture", withExtension: "json"), try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: fixtureURL)).registrationOnly == true else { throw XCTSkip("Provide the private Portal device fixture") }
        let app = XCUIApplication(bundleIdentifier: "app.haiji.Haiji")
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        XCUIDevice.shared.press(.home)
        let notification = springboard.staticTexts["Haiji 测试通知"].firstMatch
        if !notification.waitForExistence(timeout: 5) {
            let start = springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.01))
            let end = springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.8))
            start.press(forDuration: 0.1, thenDragTo: end)
        }
        XCTAssertTrue(notification.waitForExistence(timeout: 15), "Apple acceptance alone does not prove display")
        guard notification.exists else { return }
        notification.tap()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 15))
        XCTAssertTrue(app.tabBars.buttons["我的"].waitForExistence(timeout: 10))
        print("HAIJI_PORTAL_REAL_APNS visible=true opens_app=true")
    }
    @MainActor func testZCleanupLocalPushFixture() throws {
        guard let fixtureURL = Bundle(for: Self.self).url(forResource: "PushFixture", withExtension: "json") else { throw XCTSkip("No private local push fixture") }
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: fixtureURL))
        let host = try XCTUnwrap(URL(string: fixture.serverUrl)?.host)
        let app = XCUIApplication(bundleIdentifier: "app.haiji.Haiji")
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["我的"].waitForExistence(timeout: 15))
        app.tabBars.buttons["我的"].tap()
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "环境连接")).firstMatch.tap()
        if app.textFields["serverAddress"].waitForExistence(timeout: 3) { return }
        app.swipeDown(); app.swipeDown()
        let expected = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", host)).firstMatch.exists
        XCTAssertTrue(expected, "Cleanup must only revoke the disposable local test connection")
        guard expected else { return }
        let disconnect = app.buttons["吊销并断开此设备"]
        for _ in 0..<4 { if disconnect.isHittable { break }; app.swipeUp() }
        disconnect.tap()
        XCTAssertTrue(app.textFields["serverAddress"].waitForExistence(timeout: 20))
        print("HAIJI_APNS_LOCAL_CLEANUP revoked=true local_credentials_removed=true")
    }

}
