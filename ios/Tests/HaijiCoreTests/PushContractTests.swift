import XCTest
@testable import HaijiCore

final class PushContractTests: XCTestCase {
    private func example(_ name: String) throws -> Data {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        return try Data(contentsOf: root.appendingPathComponent("contracts/examples/" + name + ".json"))
    }
    func testRemoteTaskAndRegistrationDecodeWithoutCreatingLocalPlan() throws {
        let decoder = JSONDecoder()
        let task = try decoder.decode(TaskRecord.self, from: example("task-remote"))
        let occurrence = try XCTUnwrap(task.reminder?.remoteOccurrence)
        XCTAssertEqual(occurrence.status, "accepted")
        XCTAssertEqual(occurrence.deliveryOwner, "server")
        let authority = TaskActionCommand.Occurrence(remote: occurrence)
        XCTAssertEqual(authority.requestId, "haiji.remote." + occurrence.id + ".1")
        let status = try decoder.decode(PushStatus.self, from: example("push-status"))
        XCTAssertTrue(status.configured && status.registered && status.enabled)
        let registration = try decoder.decode(PushRegistration.self, from: example("push-registration"))
        XCTAssertEqual(registration.environment, "development")
        let command = ManualTaskCommand(title: "远程事项", background: "", reminder: .init(instant: occurrence.scheduledAt, timeZone: "UTC"), deadline: nil, remoteDeviceId: task.ownerId)
        let encoded = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(command)) as? [String:Any])
        XCTAssertNil(encoded["localDeviceId"])
        XCTAssertEqual(encoded["remoteDeviceId"] as? String, task.ownerId)
    }
}
