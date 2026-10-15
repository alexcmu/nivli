import SwiftUI

@MainActor @Observable final class TaskRepository {
    var tasks: [TaskRecord] = []
    var error: String?
    var loading = false
    var status = "active"
    var nextCursor: String?
    private var identity: String?
    private var projection: TaskProjection?
    func configure(_ session: SavedSession?) throws {
        guard let session else { tasks = []; projection = nil; identity = nil; return }
        let key = session.server.absoluteString + "/" + session.credentials.ownerId + "/" + session.credentials.deviceId
        guard key != identity else { return }
        tasks = []; nextCursor = nil; projection = nil; identity = nil
        let directory = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        projection = try TaskProjection(url: directory.appendingPathComponent("tasks.sqlite"), identity: key)
        identity = key; tasks = try projection!.tasks(status: status)
    }
    func changeStatus() {
        do { tasks = try projection?.tasks(status: status) ?? []; nextCursor = nil } catch { self.error = error.localizedDescription }
    }
    func refresh(_ connection: Connection, more: Bool = false) async {
        do { try configure(connection.saved) } catch { self.error = error.localizedDescription; return }
        guard !loading else { return }
        let requestedIdentity = identity
        let requestedStatus = status
        let requestedToken = connection.saved?.credentials.accessToken
        loading = true
        defer {
            loading = false
            if status != requestedStatus || identity != requestedIdentity || connection.saved?.credentials.accessToken != requestedToken { Task { await refresh(connection) } }
        }
        do {
            guard let session = connection.saved else { return }
            let key = identity
            await LocationMonitoring.shared.synchronize(session)
            let page = try await HaijiAPI(server: session.server).tasks(token: session.credentials.accessToken, status: requestedStatus, cursor: more ? nextCursor : nil)
            guard connection.saved?.credentials.accessToken == session.credentials.accessToken, identity == key, status == requestedStatus, connection.saved?.server == session.server, connection.saved?.credentials.ownerId == session.credentials.ownerId, connection.saved?.credentials.deviceId == session.credentials.deviceId else { return }
            for task in page.tasks { try projection?.save(task) }
            let refreshed = page.tasks
            // Server pagination controls visible online results; stored projection is the offline fallback.
            tasks = more ? tasks + refreshed.filter { item in !tasks.contains(where: { $0.id == item.id }) } : refreshed
            nextCursor = page.nextCursor; error = nil
        } catch { if !Task.isCancelled,connection.saved?.credentials.accessToken == requestedToken {self.error = error.localizedDescription} }
    }
    func save(_ command: ManualTaskCommand, connection: Connection) async throws -> TaskRecord {
        try configure(connection.saved)
        guard let session = connection.saved else { throw PairingError.invalidResponse }
        let key = identity
        let committed = try await HaijiAPI(server: session.server).createTask(command, token: session.credentials.accessToken)
        await LocationMonitoring.shared.synchronize(session)
        let current = try? await HaijiAPI(server: session.server).task(id: committed.id, token: session.credentials.accessToken)
        let task = current ?? committed
        guard identity == key, connection.saved?.server == session.server, connection.saved?.credentials.ownerId == session.credentials.ownerId, connection.saved?.credentials.deviceId == session.credentials.deviceId else { throw PairingError.identityChanged }
        try projection?.save(task)
        tasks = try projection?.tasks(status: status) ?? []; error = nil
        return task
    }
}

struct TaskListView: View {
    @Bindable var connection: Connection
    @Bindable var repository: TaskRepository
    @State private var presentingForm = false
    var body: some View {
        Group {
            if connection.saved == nil {
                ContentUnavailableView("先连接个人环境", systemImage: "network", description: Text("在“我的”中连接后即可手动创建事项。"))
            } else {
                List {
                    Picker("事项状态", selection: $repository.status) { Text("进行中").tag("active"); Text("已完成").tag("completed"); Text("已取消").tag("cancelled") }.pickerStyle(.segmented)
                    if repository.tasks.isEmpty { ContentUnavailableView("此刻没有事项", systemImage: "sun.max", description: Text("交代一件事，让需要做的行动留在这里。")) }
                    ForEach(repository.tasks) { task in
                        NavigationLink { TaskDetailView(initial: task, connection: connection) } label: {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(task.title).font(.headline)
                                if let reminder = task.reminder { Text(taskDate(reminder.instant, zone: reminder.timeZone)).font(.subheadline) }
                                Text(task.status == "active" ? (task.locationReminder.map(locationStatus) ?? reminderStatus(task.reminder)) : task.status == "completed" ? "已完成" : "已取消").font(.caption).foregroundStyle(.secondary)
                            }.padding(.vertical, 4)
                        }
                    }
                    if repository.nextCursor != nil { Button("加载更多") { Task { await repository.refresh(connection, more: true) } }.disabled(repository.loading) }
                    if let error = repository.error { Section("暂时无法更新 · 显示本机已保存事项") { Text(error); Button("重试") { Task { await repository.refresh(connection) } } } }
                }.refreshable { await repository.refresh(connection) }
                .onAppear { Task { await repository.refresh(connection) } }
            }
        }.navigationTitle("此刻")
            .toolbar { Button("新增事项", systemImage: "plus") { presentingForm = true }.disabled(connection.saved == nil) }
            .sheet(isPresented: $presentingForm) { NavigationStack { ManualTaskView(connection: connection, repository: repository) } }
            .task(id: (connection.saved?.server.absoluteString ?? "") + (connection.saved?.credentials.deviceId ?? "")) { await repository.refresh(connection) }
            .onChange(of: repository.status) { repository.changeStatus(); Task { await repository.refresh(connection) } }
    }
}

struct ManualTaskView: View {
    @Bindable var connection: Connection
    @Bindable var repository: TaskRepository
    @Environment(\.dismiss) private var dismiss
    let initialTitle: String
    @State private var title: String
    @State private var background = ""
    @State private var hasReminder = true
    @State private var reminderKind = "time"
    @State private var places: [NamedPlace] = []
    @State private var selectedPlace = ""
    @State private var transition = "enter"
    @State private var allowQuiet = false
    @State private var reminderDate = Date().addingTimeInterval(3600)
    @State private var zone = TimeZone.current.identifier
    @State private var deadlineKind = "none"
    @State private var deadlineDate = Date().addingTimeInterval(86400)
    @State private var command: ManualTaskCommand?
    @State private var busy = false
    @State private var error: String?
    @State private var saved: TaskRecord?
    init(connection: Connection, repository: TaskRepository, initialTitle: String = "") {
        self.connection = connection; self.repository = repository; self.initialTitle = initialTitle
        _title = State(initialValue: initialTitle)
    }
    private var timeZone: TimeZone { TimeZone(identifier: zone) ?? .current }
    private var draftSignature: String { "\(reminderKind)|\(selectedPlace)|\(transition)|\(allowQuiet)|\(title)|\(background)|\(hasReminder)|\(reminderDate.timeIntervalSince1970)|\(zone)|\(deadlineKind)|\(deadlineDate.timeIntervalSince1970)" }
    var body: some View {
        Form {
            Section("事项") { TextField("标题", text: $title); TextField("必要背景（选填）", text: $background, axis: .vertical).lineLimit(3...8) }
            Section("提醒条件") {
                Toggle("设置提醒", isOn: $hasReminder)
                if hasReminder {Picker("提醒方式",selection:$reminderKind){Text("时间").tag("time");Text("地点").tag("location")}}
                if hasReminder && reminderKind == "location" {
                    Picker("地点",selection:$selectedPlace){Text("请选择地点").tag("");ForEach(places){Text($0.name).tag($0.id)}}
                    Picker("触发条件",selection:$transition){Text("到达时").tag("enter");Text("离开时").tag("exit")}
                    Toggle("安静时段也允许此提醒",isOn:$allowQuiet)
                    NavigationLink("管理我的地点"){PlacesView(connection:connection)}
                    Text("后台监测需要“始终”定位和后台 App 刷新。范围检测可能延迟，事件需联网上报后由服务器推送。")
                }
                if hasReminder { Text("通过 Apple 远程通知提醒。请先在“我的 → 远程通知”启用。") }
                TextField("IANA 时区，如 Asia/Shanghai", text: $zone).textInputAutocapitalization(.never).autocorrectionDisabled()
                if TimeZone(identifier: zone) == nil { Text("请输入有效的 IANA 时区。").foregroundStyle(.red) }
                if hasReminder && reminderKind == "time" { DatePicker("提醒时间", selection: $reminderDate).environment(\.timeZone, timeZone); Text(taskDate(isoDate(reminderDate), zone: zone)) }
                Text("使用此处确认的时区与时刻排程，旅行不会移动提醒。请在远程通知设置中允许通知；通知只显示通用文案。").font(.footnote).foregroundStyle(.secondary)
            }
            Section("独立截止时间") {
                Picker("类型", selection: $deadlineKind) { Text("无").tag("none"); Text("仅日期").tag("date"); Text("具体时间").tag("instant") }
                if deadlineKind != "none" { DatePicker("截止", selection: $deadlineDate, displayedComponents: deadlineKind == "date" ? [.date] : [.date, .hourAndMinute]).environment(\.timeZone, timeZone) }
            }
            if let error { Section("保存失败 · 输入已保留") { Text(error) } }
            if let saved { Section("已保存") { NavigationLink("查看事项") { TaskDetailView(initial: saved, connection: connection) }; Text(saved.locationReminder.map(locationStatus) ?? reminderStatus(saved.reminder));
                if saved.locationReminder != nil {NavigationLink("启用地点监测与权限"){LocationSettingsView()}}
                if saved.reminder?.schedulingStatus == "needs_confirmation" { Text("所选时间在安静时段 22:00–08:00，尚未安排通知。确认将保留该时间；系统专注模式仍按你的设置生效。"); Button("仍在此时间提醒") { Task { await confirmQuietHours(saved) } }; Button("修改提醒时间") { self.saved = nil; command = nil } }
                Button("再交代一件事") { title = ""; background = ""; command = nil; self.saved = nil; error = nil } } }
            else { Button(busy ? "正在保存…" : error == nil ? "保存事项" : "重试保存") { Task { await save() } }.disabled(busy || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || TimeZone(identifier: zone) == nil) }
        }.navigationTitle("手动交代").disabled(busy)
            .toolbar { Button(saved == nil ? "取消" : "完成") { dismiss() }.disabled(busy) }
            .task { if let session=connection.saved {do{places=try await HaijiAPI(server:session.server).places(token:session.credentials.accessToken)}catch{self.error=error.localizedDescription}} }
            .onChange(of: draftSignature) { command = nil; saved = nil }
    }
    private func confirmQuietHours(_ task: TaskRecord) async {
        guard let session = connection.saved else { return }; busy = true; defer { busy = false }
        do { saved = try await confirmRemoteReminder(task, session: session); error = nil } catch { self.error = error.localizedDescription }
        await repository.refresh(connection)
    }
    private func save() async {
        busy = true; defer { busy = false }
        let dateFormatter = DateFormatter(); dateFormatter.locale = Locale(identifier: "en_US_POSIX"); dateFormatter.calendar = Calendar(identifier: .gregorian); dateFormatter.timeZone = timeZone; dateFormatter.dateFormat = "yyyy-MM-dd"
        let deadline: TaskDeadline? = deadlineKind == "none" ? nil : TaskDeadline(kind: deadlineKind, date: deadlineKind == "date" ? dateFormatter.string(from: deadlineDate) : nil, instant: deadlineKind == "instant" ? isoDate(deadlineDate) : nil, timeZone: zone)
        let location = hasReminder && reminderKind == "location" ? places.first(where:{$0.id==selectedPlace}).map{LocationReminderInput(place:$0,transition:transition,timeZone:zone,quietHoursConfirmed:allowQuiet)} : nil
        if hasReminder && reminderKind == "location" && location == nil {error="请先保存并选择地点。";return}
        let attempt = command ?? ManualTaskCommand(title: title.trimmingCharacters(in: .whitespacesAndNewlines), background: background, reminder: hasReminder && reminderKind == "time" ? .init(instant: isoDate(reminderDate), timeZone: zone) : nil, deadline: deadline, locationReminder: location)
        command = attempt
        do { saved = try await repository.save(attempt, connection: connection); error = nil } catch { self.error = error.localizedDescription; if let api=error as? APIError,!api.retryable,api.code=="PLACE_CHANGED" {command=nil;if let session=connection.saved {places=(try? await HaijiAPI(server:session.server).places(token:session.credentials.accessToken)) ?? places};selectedPlace=""} }
    }
}

struct TaskDetailView: View {
    let initial: TaskRecord
    var undoMutation: String? = nil
    @Bindable var connection: Connection
    @State private var latest: TaskRecord?
    @State private var error: String?
    @State private var scheduling = false
    private var task: TaskRecord { latest ?? initial }
    var body: some View {
        Form {
            Section("事项") { Text(task.title).font(.headline); Text(task.status == "active" ? "进行中" : task.status == "completed" ? "已完成" : "已取消"); if !task.background.isEmpty { Text(task.background) } }
            Section("提醒") {
                if let reminder = task.reminder { Text(taskDate(reminder.instant, zone: reminder.timeZone)); LabeledContent("时区", value: reminder.timeZone); Text(reminderStatus(reminder));
                    if reminder.schedulingStatus == "needs_confirmation" { Text("此时间在安静时段 22:00–08:00，尚未安排通知。"); Button("仍在此时间提醒") { Task { await install(confirm: true) } }.disabled(scheduling) }
                    }
                else if task.locationReminder == nil { Text("未设置提醒") }
            }
            if let location=task.locationReminder {Section("地点条件"){
                Text((location.transition=="enter" ? "到达 " : "离开 ")+location.place.name);Text("范围半径 \(Int(location.place.radius)) 米");Text(locationStatus(location));NavigationLink("地点监测与权限"){LocationSettingsView()}
                LocationReplacementView(task:task,connection:connection){latest=$0}
                if let remote=location.remoteOccurrence,!remote.quietHoursConfirmed,remote.status=="planned" {Button("确认本次安静时段提醒"){Task{guard let session=connection.saved else{return};do{latest=try await HaijiAPI(server:session.server).confirmRemote(taskId:task.id,occurrence:remote,token:session.credentials.accessToken)}catch{self.error=error.localizedDescription}}}}
                Text("系统范围检测可能延迟。可在下方选择具体提醒时间，替换地点条件。").font(.footnote)
            }}
            Section("截止") {
                if let deadline = task.deadline { Text(deadline.kind == "date" ? (deadline.date ?? "") + "（仅日期）" : taskDate(deadline.instant ?? "", zone: deadline.timeZone)); LabeledContent("时区", value: deadline.timeZone) }
                else { Text("未设置截止时间") }
            }
            TaskActionControls(task: task, connection: connection, initialUndoMutation: undoMutation) { latest = $0 }
            Section("来源") { ForEach(task.sources, id: \.id) { source in VStack(alignment: .leading) { Text(source.kind == "manual" ? "手动交代" : source.kind).font(.headline); Text(source.text); Text(taskDate(source.createdAt, zone: TimeZone.current.identifier)).font(.caption).foregroundStyle(.secondary) } } }
            if let error { Section("暂时无法更新") { Text(error) } }
        }.navigationTitle("事项详情").task { await refresh() }.refreshable { await refresh() }
    }
    private func install(confirm: Bool) async {
        guard let session = connection.saved else { return }; scheduling = true; defer { scheduling = false }
        do { latest = try await confirmRemoteReminder(task, session: session); error = nil } catch { self.error = error.localizedDescription }
    }
    private func refresh() async {
        guard let session = connection.saved else { return }
        do { latest = try await HaijiAPI(server: session.server).task(id: initial.id, token: session.credentials.accessToken); error = nil } catch { self.error = error.localizedDescription }
    }
}
func isoDate(_ date: Date) -> String { let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return formatter.string(from: date) }
func taskDate(_ instant: String, zone: String) -> String {
    let parser = ISO8601DateFormatter(); parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let date = parser.date(from: instant) ?? ISO8601DateFormatter().date(from: instant)
    guard let date else { return instant }
    let formatter = DateFormatter(); formatter.locale = Locale(identifier: "zh_CN"); formatter.timeZone = TimeZone(identifier: zone); formatter.dateFormat = "yyyy年MM月dd日 HH:mm:ss zzz"
    return formatter.string(from: date)
}

@MainActor func openNotificationSettings() { if let url = URL(string: UIApplication.openNotificationSettingsURLString) { UIApplication.shared.open(url) } }
