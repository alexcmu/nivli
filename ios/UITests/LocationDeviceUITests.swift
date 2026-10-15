import XCTest

/// Read-only USB UI acceptance. No location permission is granted and no place is saved.
final class LocationDeviceUITests: XCTestCase {
    @MainActor func testPlaceEditorAndPermissionControls() throws {
        guard let url=Bundle(for:Self.self).url(forResource:"LocationFixture",withExtension:"json") else {throw XCTSkip("Provide an isolated LocationFixture.json for an authorized USB UI check")}
        struct Fixture:Decodable {let serverHost:String}
        let fixture=try JSONDecoder().decode(Fixture.self,from:Data(contentsOf:url))
        let app=XCUIApplication(bundleIdentifier:"app.haiji.Haiji")
        app.launch()
        let springboard=XCUIApplication(bundleIdentifier:"com.apple.springboard")
        if springboard.alerts["Device Added to Your Account"].waitForExistence(timeout:2) {springboard.alerts["Device Added to Your Account"].buttons["OK"].tap()}
        XCTAssertTrue(app.tabBars.buttons["我的"].waitForExistence(timeout:15));app.tabBars.buttons["我的"].tap()
        let environment=app.buttons.matching(NSPredicate(format:"label CONTAINS %@","环境连接")).firstMatch
        XCTAssertTrue(environment.waitForExistence(timeout:10));environment.tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format:"label CONTAINS %@",fixture.serverHost)).firstMatch.waitForExistence(timeout:10),"Do not operate a connection to another environment")
        app.navigationBars.buttons.element(boundBy:0).tap()
        app.buttons["我的地点"].tap()
        XCTAssertTrue(app.buttons["添加地点"].waitForExistence(timeout:10));app.buttons["添加地点"].tap()
        XCTAssertTrue(app.textFields["例如：家、公司"].waitForExistence(timeout:10))
        XCTAssertTrue(app.buttons["搜索地址"].exists)
        XCTAssertTrue(app.buttons["使用当前位置作为中心"].exists)
        let image=XCTAttachment(screenshot:app.screenshot());image.name="Location editor without requesting permission";image.lifetime = .keepAlways;add(image)
        app.navigationBars.buttons["取消"].tap()
        app.buttons["地点监测与权限"].tap()
        XCTAssertTrue(app.buttons["启用或重新检查地点监测"].waitForExistence(timeout:10))
        XCTAssertTrue(app.buttons["打开系统设置"].exists)
        XCTAssertFalse(app.alerts.firstMatch.exists)
        print("HAIJI_LOCATION_UI editor=true settings=true no_permission_request=true no_saved_place=true")
    }
}
