import XCTest
@testable import HaijiCore

final class LocationTests:XCTestCase {
    private func plan(transition:String="enter",triggered:Bool=false)throws->LocationPlan {
        let data=Data("""
        {"id":"plan","reminderRevision":2,"taskId":"task","place":{"id":"place","revision":3,"name":"公司","latitude":37.3,"longitude":-122,"radius":200},"transition":"\(transition)","timeZone":"UTC","installationStatus":"monitoring","quietHoursConfirmed":false,"triggeredAt":\(triggered ? "\"2026-10-15T12:00:00Z\"" : "null")}
        """.utf8)
        return try JSONDecoder().decode(LocationPlan.self,from:data)
    }
    func testEventSurvivesReopenWithSameIdentityAndNoCoordinatesInUpload()throws {
        let url=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString);defer{try? FileManager.default.removeItem(at:url)}
        let original=try plan(),queue=try LocationEventOutbox(url:url)
        try queue.enqueue(plan:original,transition:"enter",now:Date(timeIntervalSince1970:1000))
        let first=try XCTUnwrap(queue.events.first),body=try first.payload()
        let reopened=try LocationEventOutbox(url:url);try reopened.enqueue(plan:original,transition:"enter",now:Date(timeIntervalSince1970:2000))
        XCTAssertEqual(reopened.events,[first]);XCTAssertEqual(try reopened.events[0].payload().count,body.count)
        let values=try XCTUnwrap(JSONSerialization.jsonObject(with:body) as? [String:Any]);XCTAssertEqual(Set(values.keys),["planId","reminderRevision","transition","observedAt"])
        try reopened.remove(first.id);XCTAssertTrue(try LocationEventOutbox(url:url).events.isEmpty)
    }
    func testWrongTransitionAndAlreadyTriggeredPlanNeverQueueAnotherEvent()throws {
        let url=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString);defer{try? FileManager.default.removeItem(at:url)}
        let queue=try LocationEventOutbox(url:url);try queue.enqueue(plan:plan(),transition:"exit");try queue.enqueue(plan:plan(triggered:true),transition:"enter");XCTAssertTrue(queue.events.isEmpty)
    }
    func testSwiftReadsPublishedLocationTaskWithoutATimeReminder() throws {
        let root=URL(fileURLWithPath:#filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("contracts/examples")
        let task=try JSONDecoder().decode(TaskRecord.self,from:Data(contentsOf:root.appendingPathComponent("task-location.json")))
        XCTAssertNil(task.reminder);XCTAssertEqual(task.locationReminder?.place.name,"公司");XCTAssertEqual(task.locationReminder?.installationStatus,"pending")
        let input=try JSONDecoder().decode(ManualTaskCommand.self,from:Data(contentsOf:root.appendingPathComponent("task-location-command.json")))
        XCTAssertNil(input.reminder);XCTAssertEqual(input.locationReminder?.placeId,task.locationReminder?.place.id)
    }
    func testManualLocationCommandHasNoInventedTimestampOrLocalNotificationRoute()throws {
        let p=try plan();let command=ManualTaskCommand(title:"报销",background:"",reminder:nil,deadline:nil,locationReminder:.init(place:p.place,transition:"enter",timeZone:"UTC"))
        let values=try XCTUnwrap(JSONSerialization.jsonObject(with:JSONEncoder().encode(command)) as? [String:Any]);XCTAssertNil(values["reminder"]);XCTAssertNil(values["localDeviceId"]);let location=try XCTUnwrap(values["locationReminder"] as? [String:Any]);XCTAssertEqual(location["placeRevision"] as? Int,3);XCTAssertEqual(location["transition"] as? String,"enter")
    }
}
