import SwiftUI
import MapKit

struct LocationSettingsView: View {
    @State private var monitor = LocationMonitoring.shared
    var body: some View {
        Form {
            Section("后台地点提醒") { Text(monitor.permissionDescription); Text(monitor.status); Button("启用或重新检查地点监测") {Task {await monitor.enable()}};Button("打开系统设置") {if let url=URL(string:UIApplication.openSettingsURLString){UIApplication.shared.open(url)}} }
            Section("工作方式") {Text("手机只监测你指定的范围。进入或离开时上报一次事件，服务器通过 Apple 远程推送通知；不持续上传轨迹。");Text("后台监测需要“始终”定位和后台 App 刷新。事件发送需要网络；离线事件只在 15 分钟内仍可发送；重新打开 App 或系统允许后台执行时重试，过期不会补发。");Text("系统区域检测可能延迟，不能保证在出门前提示。需要准时行动时，请选择时间提醒。")}
            if monitor.cleanupPending {Section("清理状态"){Text("旧范围清理待确认，请保持 App 打开后重试。")}}
            if let error=monitor.error {Section("需要处理"){Text(error)}}
        }.navigationTitle("地点监测与权限")
    }
}
struct PlacesView: View {
    @Bindable var connection: Connection
    @State private var places: [NamedPlace] = []
    @State private var error: String?
    @State private var adding = false
    var body: some View {
        List {
            Section {Text("为常用地点确认名称与范围，例如“家”“公司”。只保存你选择的区域，不保存移动轨迹。").font(.footnote).foregroundStyle(.secondary)}
            if places.isEmpty {ContentUnavailableView("还没有保存地点",systemImage:"mappin.and.ellipse",description:Text("点右上角添加地点，再创建到达或离开提醒。"))}
            ForEach(places) {place in NavigationLink {PlaceEditor(place:place,connection:connection){Task{await reload()}}} label:{VStack(alignment:.leading){Text(place.name);Text("半径 \(Int(place.radius)) 米").font(.caption).foregroundStyle(.secondary)}}}
            NavigationLink("地点监测与权限"){LocationSettingsView()}
            if let error {Text(error).foregroundStyle(.red);Button("重试"){Task{await reload()}}}
        }.navigationTitle("我的地点").toolbar{Button("添加地点",systemImage:"plus"){adding=true}.disabled(connection.saved==nil)}
        .sheet(isPresented:$adding){NavigationStack{PlaceEditor(connection:connection){adding=false;Task{await reload()}}}}
        .task{await reload()}.refreshable{await reload()}
    }
    private func reload() async {guard let s=connection.saved else{return};do{places=try await HaijiAPI(server:s.server).places(token:s.credentials.accessToken);error=nil}catch{self.error=error.localizedDescription}}
}
struct PlaceEditor: View {
    let place: NamedPlace?
    @Bindable var connection: Connection
    let saved: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var latitude: Double
    @State private var longitude: Double
    @State private var radius: Double
    @State private var camera: MapCameraPosition
    @State private var query = ""
    @State private var results: [MKMapItem] = []
    @State private var confirmed = false
    @State private var busy = false
    @State private var error: String?
    @State private var reviewing = false
    @State private var deleting = false
    @State private var affected: [HaijiAPI.PlaceImpact.Item] = []
    @State private var key = UUID().uuidString
    @State private var newID = UUID().uuidString
    @State private var monitor = LocationMonitoring.shared
    init(place:NamedPlace?=nil,connection:Connection,saved:@escaping()->Void){self.place=place;self.connection=connection;self.saved=saved;_name=State(initialValue:place?.name ?? "");_latitude=State(initialValue:place?.latitude ?? 0);_longitude=State(initialValue:place?.longitude ?? 0);_radius=State(initialValue:place?.radius ?? 200);_camera=State(initialValue:.region(.init(center:.init(latitude:place?.latitude ?? 0,longitude:place?.longitude ?? 0),span:.init(latitudeDelta:place==nil ? 90 : 0.015,longitudeDelta:place==nil ? 90 : 0.015))))}
    private var center:CLLocationCoordinate2D{.init(latitude:latitude,longitude:longitude)}
    private var signature:String{"\(name)|\(latitude)|\(longitude)|\(radius)"}
    var body: some View {
        Form {
            Section("名称"){TextField("例如：家、公司",text:$name)}
            Section("选择范围") {
                TextField("搜索地址或地点",text:$query).onSubmit{Task{await search()}}
                Button("搜索地址"){Task{await search()}}.disabled(query.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty)
                ForEach(Array(results.enumerated()),id:\.offset){_,item in Button(item.name ?? "选择此地址"){let c=item.location.coordinate;latitude=c.latitude;longitude=c.longitude;camera = .region(.init(center:c,span:.init(latitudeDelta:0.015,longitudeDelta:0.015)));results=[];confirmed=false}}
                Button("使用当前位置作为中心"){monitor.requestCurrentLocation()}
                Map(position:$camera){MapCircle(center:center,radius:radius).foregroundStyle(.blue.opacity(0.18))}.frame(height:280).overlay{Image(systemName:"plus").font(.title2).allowsHitTesting(false)}.onMapCameraChange(frequency:.onEnd){context in latitude=context.region.center.latitude;longitude=context.region.center.longitude;confirmed=false}
                Text("移动地图，让十字对准地点中心。").font(.footnote)
                Slider(value:$radius,in:100...1000,step:50){Text("范围半径")}
                LabeledContent("范围半径",value:"\(Int(radius)) 米")
                Text(String(format:"中心：%.5f, %.5f",latitude,longitude)).font(.caption).monospacedDigit()
                Toggle("我已核对名称、中心与范围",isOn:$confirmed)
            }
            if let error{Section("操作未完成"){Text(error)}}
            if let message=monitor.error{Text(message).font(.footnote)}
            Button(busy ? "正在保存…" : "保存地点"){Task{deleting=false;await prepare()}}.disabled(!confirmed || name.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty || busy)
            if place != nil {Button("删除地点",role:.destructive){Task{deleting=true;await prepare()}}.disabled(busy)}
        }.navigationTitle(place==nil ? "添加地点" : "修改地点").disabled(busy)
        .toolbar{if place==nil{Button("取消"){dismiss()}}}
        .onChange(of:signature){key=UUID().uuidString;confirmed=false}
        .onChange(of:"\(monitor.currentCoordinate?.latitude ?? 0),\(monitor.currentCoordinate?.longitude ?? 0)"){if let c=monitor.currentCoordinate{latitude=c.latitude;longitude=c.longitude;camera = .region(.init(center:c,span:.init(latitudeDelta:0.015,longitudeDelta:0.015)));confirmed=false}}
        .sheet(isPresented:$reviewing){NavigationStack{List{Section("受影响的进行中事项"){if affected.isEmpty{Text("没有关联的进行中事项。")}else{ForEach(affected){Text($0.title)}}};Section{Text("旧区域条件将失效，事项与来源会保留。请为这些事项重新选择地点，或改成时间提醒。离线设备需联网后清理旧监测，但旧事件不会触发新的远程通知。")};Button(deleting ? "确认删除地点" : "确认修改地点",role:deleting ? .destructive : nil){Task{await commit()}}.disabled(busy);if let error{Text(error)}}.navigationTitle("确认受影响提醒").toolbar{Button("返回"){reviewing=false}}}}
    }
    private func search() async {busy=true;defer{busy=false};do{let request=MKLocalSearch.Request();request.naturalLanguageQuery=query;results=try await MKLocalSearch(request:request).start().mapItems;error=results.isEmpty ? "未找到地址，请换个关键词或移动地图选择。" : nil}catch{self.error="地址搜索暂时不可用，请重试或移动地图选择。"}}
    private func prepare() async {guard let s=connection.saved else{return};if let place{busy=true;defer{busy=false};do{affected=try await HaijiAPI(server:s.server).placeImpact(id:place.id,token:s.credentials.accessToken).tasks;reviewing=true;error=nil}catch{self.error=error.localizedDescription}}else{await commit()}}
    private func commit() async {guard let s=connection.saved else{return};busy=true;defer{busy=false};let api=HaijiAPI(server:s.server);do{if let place{if deleting{_ = try await api.deletePlace(place,affectedTaskIds:affected.map(\.id),key:key,token:s.credentials.accessToken)}else{_ = try await api.changePlace(id:place.id,command:.init(expectedRevision:place.revision,name:name,latitude:latitude,longitude:longitude,radius:radius,expectedAffectedTaskIds:affected.map(\.id)),key:key,token:s.credentials.accessToken)}}else{_ = try await api.createPlace(.init(id:newID,name:name,latitude:latitude,longitude:longitude,radius:radius),key:key,token:s.credentials.accessToken)};await LocationMonitoring.shared.synchronize(s);reviewing=false;saved();dismiss()}catch{self.error=error.localizedDescription}}
}
func locationStatus(_ plan:LocationPlan)->String {
    if plan.installationStatus == "needs_configuration" {return "地点已变更 · 请重新配置或改成时间提醒"}
    if let remote=plan.remoteOccurrence {switch remote.status{case "accepted":return "Apple 已受理 · 不代表已展示";case "planned":return remote.quietHoursConfirmed ? "地点事件已上报 · 等待远程发送" : "安静时段 · 需确认发送";case "unknown":return "发送结果未知 · 不会自动重发";case "failed":return "远程发送失败";case "expired":return "地点事件已过期 · 未补发";case "cancelled":return "旧远程提醒已取消";default:return "远程通知正在发送"}}
    switch plan.installationStatus {case "monitoring":return "正在监测地点范围";case "needs_configuration":return "地点已变更 · 请重新配置或改成时间提醒";case "permission_denied":return "定位权限不足 · 可改成时间提醒";case "capacity":return "监测范围数量已满 · 可改成时间提醒";case "unavailable":return "后台区域监测不可用";case "triggered":return "地点事件已记录";default:return "已保存 · 地点监测待确认"}
}

struct LocationReplacementView:View {
    let task:TaskRecord
    @Bindable var connection:Connection
    let updated:(TaskRecord)->Void
    @State private var places:[NamedPlace]=[]
    @State private var placeID=""
    @State private var transition="enter"
    @State private var busy=false
    @State private var error:String?
    @State private var command:TaskActionCommand?
    var body:some View {
        Picker("重新选择地点",selection:$placeID){Text("请选择").tag("");ForEach(places){Text($0.name).tag($0.id)}}
        Picker("到达或离开",selection:$transition){Text("到达").tag("enter");Text("离开").tag("exit")}
        Button("确认新的地点条件") {Task{await save()}}.disabled(busy||placeID.isEmpty)
        if let error{Text(error)}
        Color.clear.frame(height:0).task(id:task.revision){command=nil;guard let s=connection.saved else{return};do{places=try await HaijiAPI(server:s.server).places(token:s.credentials.accessToken)}catch{self.error=error.localizedDescription}}
            .onChange(of:placeID){command=nil}.onChange(of:transition){command=nil}
    }
    private func save()async {guard let s=connection.saved,let p=places.first(where:{$0.id==placeID}) else{return};busy=true;defer{busy=false};let c=command ?? TaskActionCommand(expectedRevision:task.revision,operation:"edit",locationReminder:.init(place:p,transition:transition,timeZone:TimeZone.current.identifier));command=c;do{let latest=try await TaskActionTransport.execute(task.id,command:c,session:s);updated(latest);error=nil;command=nil}catch{self.error=error.localizedDescription;if let api=error as? APIError,!api.retryable{command=nil;if let latest=try? await HaijiAPI(server:s.server).task(id:task.id,token:s.credentials.accessToken){updated(latest)}}}}
}
