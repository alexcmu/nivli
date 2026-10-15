import Foundation

public struct NamedPlace: Codable, Identifiable, Sendable, Equatable {
    public let id: String; public let revision: Int; public let name: String; public let latitude: Double; public let longitude: Double; public let radius: Double
}
public struct PlaceCommand: Codable, Sendable {
    public let expectedAffectedTaskIds: [String]?; public let id: String?; public let expectedRevision: Int?; public let name: String; public let latitude: Double; public let longitude: Double; public let radius: Double
    public init(id: String? = nil, expectedRevision: Int? = nil, name: String, latitude: Double, longitude: Double, radius: Double, expectedAffectedTaskIds: [String]? = nil) { self.expectedAffectedTaskIds=expectedAffectedTaskIds; self.id=id;self.expectedRevision=expectedRevision;self.name=name;self.latitude=latitude;self.longitude=longitude;self.radius=radius }
}
public struct LocationReminderInput: Codable, Sendable {
    public let placeId: String; public let placeRevision: Int; public let transition: String; public let timeZone: String; public let quietHoursConfirmed: Bool
    public init(place: NamedPlace, transition: String, timeZone: String, quietHoursConfirmed: Bool = false) { placeId=place.id;placeRevision=place.revision;self.transition=transition;self.timeZone=timeZone;self.quietHoursConfirmed=quietHoursConfirmed }
}
public struct LocationPlan: Codable, Identifiable, Sendable {
    public let id: String; public let reminderRevision: Int; public let taskId: String; public let place: NamedPlace; public let transition: String; public let timeZone: String; public let installationStatus: String; public let quietHoursConfirmed: Bool; public let triggeredAt: String?; public let remoteOccurrence: RemoteOccurrence?
}
public struct LocationEvent: Codable, Identifiable, Sendable, Equatable {
    public let id: String; public let planId: String; public let reminderRevision: Int; public let transition: String; public let observedAt: String
    private enum CodingKeys: String, CodingKey { case id,planId,reminderRevision,transition,observedAt }
    public func payload() throws -> Data { try JSONEncoder().encode(Body(planId:planId,reminderRevision:reminderRevision,transition:transition,observedAt:observedAt)) }
    private struct Body: Codable { let planId:String;let reminderRevision:Int;let transition:String;let observedAt:String }
}
/// Persist the event identity before network transport; retries after relaunch use the same body and key.
public final class LocationEventOutbox {
    private let url: URL
    public private(set) var events: [LocationEvent]
    public init(url:URL) throws {self.url=url;events=FileManager.default.fileExists(atPath:url.path) ? try JSONDecoder().decode([LocationEvent].self,from:Data(contentsOf:url)) : []}
    private func save(_ next:[LocationEvent]) throws {try JSONEncoder().encode(next).write(to:url,options:.atomic);events=next}
    public func enqueue(plan:LocationPlan,transition:String,now:Date=Date()) throws {
        guard plan.transition==transition,plan.triggeredAt==nil,plan.installationStatus != "needs_configuration",!events.contains(where:{$0.planId==plan.id}) else{return}
        let f=ISO8601DateFormatter();f.formatOptions=[.withInternetDateTime,.withFractionalSeconds]
        try save(events+[LocationEvent(id:UUID().uuidString,planId:plan.id,reminderRevision:plan.reminderRevision,transition:transition,observedAt:f.string(from:now))])
    }
    public func remove(_ id:String) throws {try save(events.filter{$0.id != id})}
}
extension HaijiAPI {
    private struct Places:Decodable {let places:[NamedPlace]};private struct Plans:Decodable{let plans:[LocationPlan]}
    public struct PlaceImpact:Decodable,Sendable {public struct Item:Decodable,Identifiable,Sendable{public let id:String;public let title:String};public let tasks:[Item]}
    public struct PlaceChange:Decodable,Sendable {public let affectedTaskIds:[String];public let deviceCleanup:String}
    private struct Receipt:Encodable{let planId:String;let reminderRevision:Int;let status:String}
    private struct DeleteBody:Encodable {let expectedRevision:Int;let expectedAffectedTaskIds:[String]}
    private struct Recorded:Decodable{let recorded:Bool}
    public func places(token:String) async throws->[NamedPlace]{try await request("v1/places",token:token,as:Places.self).places}
    public func createPlace(_ command:PlaceCommand,key:String,token:String) async throws->NamedPlace{try await request("v1/places",method:"POST",body:JSONEncoder().encode(command),token:token,key:key,as:NamedPlace.self)}
    public func changePlace(id:String,command:PlaceCommand,key:String,token:String) async throws->PlaceChange{try await request("v1/places/\(id)",method:"PUT",body:JSONEncoder().encode(command),token:token,key:key,as:PlaceChange.self)}
    public func placeImpact(id:String,token:String) async throws->PlaceImpact{try await request("v1/places/\(id)/impact",token:token,as:PlaceImpact.self)}
    public func deletePlace(_ place:NamedPlace,affectedTaskIds:[String],key:String,token:String) async throws->PlaceChange{try await request("v1/places/\(place.id)",method:"DELETE",body:JSONEncoder().encode(DeleteBody(expectedRevision:place.revision,expectedAffectedTaskIds:affectedTaskIds)),token:token,key:key,as:PlaceChange.self)}
    public func locationPlans(token:String) async throws->[LocationPlan]{try await request("v1/location-plans",token:token,as:Plans.self).plans}
    public func locationReceipt(_ plan:LocationPlan,status:String,token:String) async throws{let _:Recorded=try await request("v1/location-plans/receipts",method:"POST",body:JSONEncoder().encode(Receipt(planId:plan.id,reminderRevision:plan.reminderRevision,status:status)),token:token,key:UUID().uuidString,as:Recorded.self)}
    public func locationEvent(_ event:LocationEvent,token:String) async throws{let _:Recorded=try await request("v1/location-events",method:"POST",body:event.payload(),token:token,key:event.id,as:Recorded.self)}
}
