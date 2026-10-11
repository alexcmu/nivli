import XCTest
@testable import NivliCore
final class TaskTests: XCTestCase {
    func testSavedTaskReopensWithoutCrossingEnvironmentOrDeviceIdentity() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: url) }
        let data = Data(#"{"id":"a","ownerId":"owner","revision":1,"status":"active","title":"提交材料","background":"表单来源","reminder":{"id":"r","revision":1,"instant":"2026-11-01T09:00:00.000Z","timeZone":"America/Los_Angeles","schedulingStatus":"not_scheduled"},"deadline":{"kind":"date","date":"2026-11-06","timeZone":"America/Los_Angeles"},"sources":[{"id":"s","kind":"manual","text":"提交材料","createdAt":"2026-10-11T00:00:00.000Z"}],"createdAt":"2026-10-11T00:00:00.000Z","updatedAt":"2026-10-11T00:00:00.000Z"}"#.utf8)
        let task = try JSONDecoder().decode(TaskRecord.self, from: data)
        do { let store = try TaskProjection(url: url, identity: "environment/owner/device"); try store.save(task) }
        let reopened = try TaskProjection(url: url, identity: "environment/owner/device")
        XCTAssertEqual(try reopened.tasks(status: "active").first?.deadline?.date, "2026-11-06")
        XCTAssertEqual(try reopened.tasks(status: "active").first?.reminder?.schedulingStatus, "not_scheduled")
        let other = try TaskProjection(url: url, identity: "other/owner/device")
        XCTAssertTrue(try other.tasks(status: "active").isEmpty)
        let otherDevice = try TaskProjection(url: url, identity: "environment/owner/new-device")
        XCTAssertTrue(try otherDevice.tasks(status: "active").isEmpty)
    }
}
final class TaskAPIBoundaryTests: XCTestCase {
    func testFailedManualCommandRetainsStableIdentityAndPaginationUsesQuery() async throws {
        HTTPBoundary.requests = []
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [HTTPBoundary.self]
        let api = NivliAPI(server: URL(string: "https://home.example")!, session: URLSession(configuration: configuration))
        let command = ManualTaskCommand(title: "材料", background: "", reminder: nil, deadline: .init(kind: "date", date: "2026-11-06", timeZone: "Asia/Shanghai"))
        for _ in 0..<2 {
            do { _ = try await api.createTask(command, token: "test-token"); XCTFail("Must propagate rejection") } catch let error as APIError { XCTAssertEqual(error.code, "invalid_pairing") }
        }
        XCTAssertEqual(HTTPBoundary.requests.map { $0.value(forHTTPHeaderField: "Idempotency-Key") }, [command.commandId, command.commandId])
        do { _ = try await api.tasks(token: "test-token", status: "completed", cursor: "task-id"); XCTFail("Must propagate rejection") } catch is APIError {}
        let url = try XCTUnwrap(HTTPBoundary.requests.last?.url)
        XCTAssertEqual(url.path, "/v1/tasks")
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems
        XCTAssertEqual(query?.first(where: { $0.name == "status" })?.value, "completed")
        XCTAssertEqual(query?.first(where: { $0.name == "cursor" })?.value, "task-id")
    }
}
final class VersionedTaskContractTests: XCTestCase {
    func testSwiftReadsPublishedTaskCommandPageAndDetail() throws {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("contracts/examples")
        let task = try JSONDecoder().decode(TaskRecord.self, from: Data(contentsOf: root.appendingPathComponent("task.json")))
        let page = try JSONDecoder().decode(TaskPage.self, from: Data(contentsOf: root.appendingPathComponent("task-page.json")))
        let command = try JSONDecoder().decode(ManualTaskCommand.self, from: Data(contentsOf: root.appendingPathComponent("task-command.json")))
        XCTAssertEqual(task.deadline?.date, "2026-10-16")
        XCTAssertEqual(task.reminder?.instant, "2026-10-12T16:00:00.000Z")
        XCTAssertEqual(page.tasks.first?.id, task.id)
        XCTAssertNil(page.nextCursor)
        XCTAssertEqual(command.taskId, task.id)
        XCTAssertEqual(command.deadline?.kind, "date")
    }
}
final class TaskActionContractTests: XCTestCase {
    func testActionRetryUsesStableIdentityAndExplicitDeadlineRemoval() async throws {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("contracts/examples")
        let command = try JSONDecoder().decode(TaskActionCommand.self, from: Data(contentsOf: root.appendingPathComponent("task-action.json")))
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [HTTPBoundary.self]
        HTTPBoundary.requests = []
        let api = NivliAPI(server: URL(string: "https://home.example")!, session: URLSession(configuration: configuration))
        for _ in 0..<2 { do { _ = try await api.taskAction(id: "task", command: command, token: "token"); XCTFail("Expected public error") } catch is APIError {} }
        XCTAssertEqual(HTTPBoundary.requests.map { $0.value(forHTTPHeaderField: "Idempotency-Key") }, [command.commandId, command.commandId])
        let body = try JSONSerialization.jsonObject(with: JSONEncoder().encode(command)) as! [String: Any]
        XCTAssertTrue(body["deadline"] is NSNull)
        XCTAssertEqual(HTTPBoundary.requests.last?.url?.path, "/v1/tasks/task/commands")
    }
}
