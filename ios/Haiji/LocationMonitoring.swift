import SwiftUI
import CoreLocation

@MainActor @Observable final class LocationMonitoring: NSObject, CLLocationManagerDelegate {
    static let shared = LocationMonitoring()
    var error: String?
    var status = "尚未启用地点监测"
    var cleanupPending = false
    var currentCoordinate: CLLocationCoordinate2D?
    private let manager = CLLocationManager()
    private var identity: String?
    private var plans: [LocationPlan] = []
    private var cleanup: Set<String> = []
    private var ready: Set<String> = []
    private var fired: Set<String> = []
    private var outbox: LocationEventOutbox?
    private var journal: SecureStore?
    private var pendingStopStatus: String?
    private var enabled = false
    private var requesting = false
    private var locating = false
    private var busy = false
    private var flushing = false
    private struct Snapshot: Codable {let plans:[LocationPlan];let ready:Set<String>;let fired:Set<String>;let enabled:Bool;let pendingStopStatus:String?;let cleanup:Set<String>?}
    override init() {
        super.init(); manager.delegate = self
        if let session=Connection.shared.saved { try? configure(session) } else {for region in manager.monitoredRegions where region.identifier.hasPrefix("haiji.location."){manager.stopMonitoring(for:region)}}
    }
    private func regionID(_ plan:LocationPlan)->String { "haiji.location." + (identity ?? "") + "." + plan.id }
    private func configure(_ session:SavedSession) throws {
        let key=NotificationIdentity.namespace(session)
        guard identity != key || outbox == nil else{return}
        for region in manager.monitoredRegions where region.identifier.hasPrefix("haiji.location.") && !region.identifier.hasPrefix("haiji.location."+key+".") { manager.stopMonitoring(for:region) }
        identity=key;journal=SecureStore(account:"location-plans-"+key)
        let snapshot=try journal?.read(Snapshot.self);plans=snapshot?.plans ?? [];ready=snapshot?.ready ?? [];fired=snapshot?.fired ?? [];enabled=snapshot?.enabled ?? false;pendingStopStatus=snapshot?.pendingStopStatus;cleanup=snapshot?.cleanup ?? []
        let directory=try FileManager.default.url(for:.applicationSupportDirectory,in:.userDomainMask,appropriateFor:nil,create:true)
        outbox=try LocationEventOutbox(url:directory.appendingPathComponent("location-events-"+key+".json"))
    }
    private func persist() {do{try journal?.save(Snapshot(plans:plans,ready:ready,fired:fired,enabled:enabled,pendingStopStatus:pendingStopStatus,cleanup:cleanup))}catch{self.error="地点监测状态无法保存。"}}
    var permissionDescription:String {
        guard CLLocationManager.locationServicesEnabled() else{return "系统定位服务已关闭"}
        switch manager.authorizationStatus {case .authorizedAlways:return manager.accuracyAuthorization == .fullAccuracy ? "始终允许定位 · 精确位置已开启" : "精确位置未开启，区域监测尚未就绪";case .authorizedWhenInUse:return "仅使用期间允许，后台地点提醒尚未就绪";case .denied,.restricted:return "定位权限未允许";default:return "尚未请求定位权限"}
    }
    func enable() async {
        guard let session=Connection.shared.saved else{error="请先连接个人环境。";return}
        do{try configure(session)}catch{self.error=error.localizedDescription;return}
        requesting=true;self.error=nil
        switch manager.authorizationStatus {
        case .notDetermined:manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse:manager.requestAlwaysAuthorization();status="请在系统设置中将定位改为“始终”。"
        case .authorizedAlways:
            requesting=false;enabled=true;fired.subtract(plans.filter{$0.triggeredAt==nil}.map(\.id));persist();await synchronize(session)
        default:requesting=false;error="请在系统设置中允许“始终”定位；也可以将事项改成时间提醒。"
        }
    }
    func requestCurrentLocation() {
        locating=true
        if manager.authorizationStatus == .notDetermined {manager.requestWhenInUseAuthorization()}
        else if manager.authorizationStatus == .authorizedAlways || manager.authorizationStatus == .authorizedWhenInUse {manager.requestLocation()}
        else {error="定位权限未开启；仍可通过搜索或移动地图选择地点。";locating=false}
    }
    private func stop(_ plan:LocationPlan) {
        for region in manager.monitoredRegions where region.identifier==regionID(plan) {manager.stopMonitoring(for:region)}
        let id=regionID(plan);if manager.monitoredRegions.contains(where:{$0.identifier==id}){cleanup.insert(id)}else{cleanup.remove(id)};cleanupPending = !cleanup.isEmpty
        ready.remove(plan.id)
    }
    func clear(_ session:SavedSession) {
        guard identity==NotificationIdentity.namespace(session) else{return}
        for region in manager.monitoredRegions where region.identifier.hasPrefix("haiji.location."){manager.stopMonitoring(for:region)}
        for event in outbox?.events ?? [] {try? outbox?.remove(event.id)}
        try? journal?.remove();plans=[];ready=[];fired=[];enabled=false;identity=nil;journal=nil;outbox=nil;status="尚未启用地点监测"
    }
    func resumeInBackground() {
        let task=UIApplication.shared.beginBackgroundTask(withName:"Haiji 地点事件上报")
        Task {await Connection.shared.restore();if let session=Connection.shared.saved {await synchronize(session)};if task != .invalid {UIApplication.shared.endBackgroundTask(task)}}
    }
    private func suspend(status:String) {
        enabled=false;pendingStopStatus=status
        for p in plans{stop(p)}
        for event in outbox?.events ?? []{try? outbox?.remove(event.id)}
        persist();self.status="地点监测已暂停 · 请重新启用或改成时间提醒"
    }
    func synchronize(_ session:SavedSession) async {
        guard !busy,!Connection.shared.busy else{return};busy=true;defer{busy=false; if let current=Connection.shared.saved,identity==NotificationIdentity.namespace(current),current.credentials.accessToken != session.credentials.accessToken {Task{await self.synchronize(current)}}}
        do {
            try configure(session)
            let expected=identity,api=HaijiAPI(server:session.server)
            if enabled && (!CLLocationManager.locationServicesEnabled() || manager.authorizationStatus != .authorizedAlways || manager.accuracyAuthorization != .fullAccuracy) {suspend(status:"permission_denied")}
            if enabled && UIApplication.shared.backgroundRefreshStatus != .available {suspend(status:"unavailable")}
            if let pending=pendingStopStatus {
                var completed=true
                for p in plans where p.triggeredAt==nil {do{try await api.locationReceipt(p,status:pending,token:session.credentials.accessToken)}catch let e as APIError where e.code=="STALE_PLAN"||e.code=="PLAN_NOT_FOUND"{}catch{completed=false}}
                if completed{pendingStopStatus=nil;persist()}
            }
            let latest=try await api.locationPlans(token:session.credentials.accessToken)
            guard identity==expected,Connection.shared.saved?.credentials.deviceId==session.credentials.deviceId else{return}
            let wanted=Set(latest.filter{$0.triggeredAt==nil && $0.installationStatus != "needs_configuration" && $0.installationStatus != "cancelled"}.map(\.id))
            for event in outbox?.events ?? [] where !wanted.contains(event.planId) {try outbox?.remove(event.id)}
            for id in cleanup {
                if let region=manager.monitoredRegions.first(where:{$0.identifier==id}) {manager.stopMonitoring(for:region)}
                if !manager.monitoredRegions.contains(where:{$0.identifier==id}){cleanup.remove(id)}
            }
            cleanupPending = !cleanup.isEmpty
            for old in plans where !wanted.contains(old.id){stop(old);if manager.monitoredRegions.contains(where:{$0.identifier==regionID(old)}){cleanupPending=true}}
            plans=latest;ready.formIntersection(wanted);fired.formIntersection(Set(latest.map(\.id)));persist()
            guard enabled else {status="尚未启用地点监测";return}
            guard CLLocationManager.locationServicesEnabled(),manager.authorizationStatus == .authorizedAlways else {
                enabled=false;for p in plans{stop(p);if p.triggeredAt==nil{try? await api.locationReceipt(p,status:"permission_denied",token:session.credentials.accessToken)}}
                for e in outbox?.events ?? []{try? outbox?.remove(e.id)};persist();status="定位权限不足 · 请重新启用或改成时间提醒";return
            }
            guard CLLocationManager.isMonitoringAvailable(for:CLCircularRegion.self),UIApplication.shared.backgroundRefreshStatus == .available else {
                for p in plans where wanted.contains(p.id){stop(p);try? await api.locationReceipt(p,status:"unavailable",token:session.credentials.accessToken)}
                status="后台区域监测不可用 · 可改成时间提醒";persist();return
            }
            for p in plans where wanted.contains(p.id) && !fired.contains(p.id) {
                if manager.monitoredRegions.contains(where:{$0.identifier==regionID(p)}) && ready.contains(p.id) {
                    if p.installationStatus != "monitoring" {try await api.locationReceipt(p,status:"monitoring",token:session.credentials.accessToken)}
                    continue
                }
                stop(p)
                guard manager.monitoredRegions.count<16 else{try await api.locationReceipt(p,status:"capacity",token:session.credentials.accessToken);continue}
                let radius=p.place.radius
                guard radius>=100 && radius<=manager.maximumRegionMonitoringDistance else{try await api.locationReceipt(p,status:"unavailable",token:session.credentials.accessToken);continue}
                let region=CLCircularRegion(center:.init(latitude:p.place.latitude,longitude:p.place.longitude),radius:radius,identifier:regionID(p))
                region.notifyOnEntry=p.transition=="enter";region.notifyOnExit=p.transition=="exit"
                manager.startMonitoring(for:region)
            }
            await flush(session)
            status=cleanupPending ? "旧范围清理待确认" : "已启用 · 系统区域检测可能延迟"
        }catch{self.error="地点状态等待同步："+error.localizedDescription}
    }
    private func flush(_ session:SavedSession) async {
        guard !flushing,enabled,manager.authorizationStatus == .authorizedAlways else{return}
        flushing=true;defer{flushing=false}
        let expected=identity,api=HaijiAPI(server:session.server)
        for event in outbox?.events ?? [] {
            guard identity==expected else{return}
            guard let plan=plans.first(where:{$0.id==event.planId}),plan.triggeredAt==nil,plan.installationStatus != "needs_configuration" else{try? outbox?.remove(event.id);continue}
            do {
                try await api.locationReceipt(plan,status:"monitoring",token:session.credentials.accessToken)
                try await api.locationEvent(event,token:session.credentials.accessToken)
                try outbox?.remove(event.id)
            }catch let error as APIError where !error.retryable && error.code != "UNAUTHENTICATED" && error.code != "LOCATION_NOT_READY" {
                try? outbox?.remove(event.id);self.error=error.message
            }catch{self.error="地点事件已保留，联网后重试。"}
        }
    }
    private func observed(_ identifier:String,transition:String) {
        guard enabled,manager.authorizationStatus == .authorizedAlways,let p=plans.first(where:{regionID($0)==identifier}),!fired.contains(p.id),p.transition==transition else{return}
        do{guard let outbox else{self.error="地点事件存储尚未就绪。";return};try outbox.enqueue(plan:p,transition:transition);fired.insert(p.id);persist();stop(p);resumeInBackground()}catch{self.error="地点事件未能保存，请检查设备存储。"}
    }
    nonisolated func locationManager(_ manager:CLLocationManager,didEnterRegion region:CLRegion){let id=region.identifier;Task{@MainActor in self.observed(id,transition:"enter")}}
    nonisolated func locationManager(_ manager:CLLocationManager,didExitRegion region:CLRegion){let id=region.identifier;Task{@MainActor in self.observed(id,transition:"exit")}}
    nonisolated func locationManager(_ manager:CLLocationManager,didStartMonitoringFor region:CLRegion){let id=region.identifier;Task{@MainActor in
        guard let p=self.plans.first(where:{self.regionID($0)==id}),self.enabled,!self.fired.contains(p.id) else{
            if let region=self.manager.monitoredRegions.first(where:{$0.identifier==id}) {self.manager.stopMonitoring(for:region);if self.manager.monitoredRegions.contains(where:{$0.identifier==id}){self.cleanup.insert(id)};self.cleanupPending = !self.cleanup.isEmpty;self.persist()}
            return
        }
        self.cleanup.remove(id);self.cleanupPending = !self.cleanup.isEmpty;self.ready.insert(p.id);self.persist()
        if let s=Connection.shared.saved{do{try await HaijiAPI(server:s.server).locationReceipt(p,status:"monitoring",token:s.credentials.accessToken)}catch{self.error="区域监测回执等待同步。"}}
    }}
    nonisolated func locationManager(_ manager:CLLocationManager,monitoringDidFailFor region:CLRegion?,withError error:Error){let id=region?.identifier;Task{@MainActor in
        self.error="系统无法监测此范围，可改成时间提醒。";guard let p=self.plans.first(where:{self.regionID($0)==id}) else{return};self.stop(p);self.persist();if let s=Connection.shared.saved{try? await HaijiAPI(server:s.server).locationReceipt(p,status:"unavailable",token:s.credentials.accessToken)}
    }}
    nonisolated func locationManagerDidChangeAuthorization(_ manager:CLLocationManager){Task{@MainActor in
        if self.enabled && (self.manager.authorizationStatus != .authorizedAlways || self.manager.accuracyAuthorization != .fullAccuracy) {self.suspend(status:"permission_denied");if let s=Connection.shared.saved{await self.synchronize(s)};return}
        if self.locating && (self.manager.authorizationStatus == .authorizedAlways || self.manager.authorizationStatus == .authorizedWhenInUse){self.manager.requestLocation()}
        if self.requesting && self.manager.authorizationStatus == .authorizedAlways {await self.enable()}
        else if self.requesting && self.manager.authorizationStatus == .authorizedWhenInUse{self.requesting=false;self.manager.requestAlwaysAuthorization();self.status="后台提醒需要在系统设置选择“始终”定位。"}
        else if self.enabled,let s=Connection.shared.saved{await self.synchronize(s)}
    }}
    nonisolated func locationManager(_ manager:CLLocationManager,didUpdateLocations locations:[CLLocation]){guard let c=locations.last?.coordinate else{return};let latitude=c.latitude,longitude=c.longitude;Task{@MainActor in self.currentCoordinate = .init(latitude:latitude,longitude:longitude);self.locating=false}}
    nonisolated func locationManager(_ manager:CLLocationManager,didFailWithError error:Error){Task{@MainActor in self.error="暂时无法获取当前位置，可用搜索或地图选择。";self.locating=false}}
}
