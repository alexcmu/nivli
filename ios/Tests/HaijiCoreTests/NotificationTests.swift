import XCTest
@testable import HaijiCore

final class VersionedNotificationContractTests: XCTestCase {
    func testSwiftDecodesPublishedNotificationPlanAndReceipt() throws {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("contracts/examples")
        let page = try JSONDecoder().decode(NotificationPlanPage.self, from: Data(contentsOf: root.appendingPathComponent("notification-plans.json")))
        let receipt = try JSONDecoder().decode(NotificationPlanCommand.self, from: Data(contentsOf: root.appendingPathComponent("notification-plan-command.json")))
        let plan = try XCTUnwrap(page.plans.first)
        XCTAssertNotNil(UUID(uuidString: plan.id))
        XCTAssertNotNil(UUID(uuidString: try XCTUnwrap(plan.taskId)))
        XCTAssertEqual(receipt.occurrenceId, plan.id)
        XCTAssertEqual(receipt.reminderRevision, plan.reminderRevision)
        XCTAssertEqual(receipt.routingVersion, plan.routingVersion)
        XCTAssertEqual(receipt.requestId, plan.requestId)
        XCTAssertEqual(receipt.operation, "installed")
        XCTAssertEqual(plan.timeZone, "Asia/Shanghai")
    }
}

@MainActor final class NotificationTests: XCTestCase {
    func testPermissionQuietHoursAndCapacityDoNotPromiseAnInstalledReminder() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: url) }
        let system = TestNotificationSystem()
        let scheduler = try LocalNotificationScheduler(url: url, identity: "home/owner/device", system: system, capacity: 1)
        func plan(_ id: String, confirmed: Bool = true) -> NotificationPlan { .init(taskId: "task-\(id)", id: id, reminderRevision: 1, routingVersion: 1, requestId: "request-\(id)", scheduledAt: "2030-01-02T09:00:00Z", timeZone: "Etc/UTC", installationStatus: "pending", quietHoursConfirmed: confirmed) }
        let quiet = try await scheduler.install(plan("quiet", confirmed: false), requestPermission: true)
        XCTAssertEqual(quiet, .needsConfirmation)
        XCTAssertEqual(system.permissionRequests, 0)
        system.permission = .denied
        let denied = try await scheduler.install(plan("denied"), requestPermission: true)
        XCTAssertEqual(denied, .denied)
        XCTAssertEqual(system.permissionRequests, 0)
        XCTAssertTrue(system.added.isEmpty)
        system.permission = .authorized
        let installed = try await scheduler.install(plan("first"), requestPermission: false)
        XCTAssertEqual(installed, .installed)
        let capacity = try await scheduler.install(plan("second"), requestPermission: false)
        XCTAssertEqual(capacity, .capacity)
        XCTAssertEqual(system.added.map(\.requestId), ["request-first"])
        try await scheduler.reconcile(current: [plan("second")])
        XCTAssertTrue(system.requests.isEmpty)
        let recovered = try await scheduler.install(plan("second"), requestPermission: false)
        XCTAssertEqual(recovered, .installed)
        try await scheduler.clear()
        XCTAssertTrue(system.requests.isEmpty)
        XCTAssertTrue(try scheduler.unacknowledged().isEmpty)
    }
    func testInstallationSurvivesLostReceiptAndRestartWithoutDuplicatingRequest() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: url) }
        let system = TestNotificationSystem()
        let plan = NotificationPlan(taskId: "task", id: "occurrence", reminderRevision: 1, routingVersion: 1, requestId: "stable-request", scheduledAt: "2030-01-02T09:00:00.000Z", timeZone: "Asia/Shanghai", installationStatus: "pending", quietHoursConfirmed: true)
        do {
            let scheduler = try LocalNotificationScheduler(url: url, identity: "home/owner/device", system: system, capacity: 2)
            let first = try await scheduler.install(plan, requestPermission: true)
            XCTAssertEqual(first, .installed)
        }
        let reopened = try LocalNotificationScheduler(url: url, identity: "home/owner/device", system: system, capacity: 2)
        let second = try await reopened.install(plan, requestPermission: false)
        XCTAssertEqual(second, .installed)
        XCTAssertEqual(system.added.map(\.requestId), ["stable-request"])
        XCTAssertEqual(try reopened.unacknowledged().map(\.id), ["occurrence"])
        try reopened.acknowledge(plan)
        XCTAssertTrue(try reopened.unacknowledged().isEmpty)
        XCTAssertEqual(system.added.first?.title, "Haiji 提醒")
        XCTAssertEqual(system.added.first?.body, "有一件事需要你查看。解锁后打开 Haiji。")
        XCTAssertEqual(system.added.first?.instant, ISO8601DateFormatter().date(from: "2030-01-02T09:00:00Z"))
    }
}
@MainActor private final class TestNotificationSystem: NotificationSystem {
    var permission = NotificationPermission.notDetermined
    var requests: [String: NotificationRequest] = [:]
    var added: [NotificationRequest] = []
    var permissionRequests = 0
    func authorization() async -> NotificationPermission { permission }
    func requestAuthorization() async throws -> Bool { permissionRequests += 1; permission = .authorized; return true }
    func pending() async -> [NotificationRequest] { Array(requests.values) }
    func add(_ request: NotificationRequest) async throws { added.append(request); requests[request.requestId] = request }
    func remove(_ ids: [String]) async { for id in ids { requests.removeValue(forKey: id) } }
}
