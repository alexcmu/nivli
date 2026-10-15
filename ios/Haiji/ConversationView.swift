import SwiftUI
import UIKit


struct ConversationView: View {
    @Bindable var connection: Connection
    @Bindable var repository: TaskRepository
    @Environment(\.scenePhase) private var scenePhase
    @State private var draft = ConversationDraft()
    @State private var history:ConversationHistory?
    @State private var busy = false
    @State private var failedRun = false
    @State private var message: String?
    @State private var error: String?
    @State private var saved: TaskRecord?
    @State private var cost:RunCost?
    @State private var model: ModelConfiguration?
    @State private var manual = false
    @State private var pollTrigger = 0
    private var store: SecureStore {
        let session = connection.saved
        return SecureStore(account: "conversation-draft/" + (session?.server.absoluteString ?? "") + "/" + (session?.credentials.ownerId ?? "") + "/" + (session?.credentials.deviceId ?? ""))
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("交代一次，记住要做的事。").font(.title2).bold()
                Text("请说明事项与具体提醒时间；日期不明确时会请你补充。").foregroundStyle(.secondary)
                ConversationEditor(text: $draft.text, disabled: busy, submit: { submit() }).frame(minHeight: 140)
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(.secondary.opacity(0.3)))
                if let model {
                    Text(model.configured ? "\(model.provider) · \(model.model)\n内容将发送至：\(model.dataDestination)" : "模型尚未配置，仍可手动设置。").font(.footnote).foregroundStyle(.secondary)
                }
                if busy { ProgressView("正在处理，原话已保留…");Button("停止此次处理") { Task { await cancel() } } }
                if let history {ForEach(history.messages) {item in
                    GroupBox { VStack(alignment:.leading,spacing:8) {
                        Text(item.text).font(.body)
                        if let task=item.task {
                            Text(task.title).bold();if let location=task.locationReminder {Text((location.transition=="enter" ? "到达 " : "离开 ")+location.place.name)};Text(task.locationReminder.map(locationStatus) ?? reminderStatus(task.reminder));ForEach(task.sources,id: \.id){Text("来源："+$0.text).font(.footnote)};Text(task.status == "active" ? "当前事项" : task.status == "completed" ? "已完成" : "已取消")
                            if let reminder=task.reminder {Text(taskDate(reminder.instant,zone:reminder.timeZone));Text("时区："+reminder.timeZone)}
                            if let deadline=task.deadline {Text("截止："+(deadline.date ?? deadline.instant ?? ""))}
                            NavigationLink("查看最新事项和来源") {TaskDetailView(initial:task,connection:connection)}
                            if task.status == "active" {Button("修改此事项") {draft.taskId=task.id;persist()}}
                        } else if let message=item.message {Text(message).foregroundStyle(.secondary)}
                    }.frame(maxWidth:.infinity,alignment:.leading)}
                }}
                if let message { Text(message) }
                if let cost {Text("已确认用量估价 $\(cost.usageUsd, specifier: "%.4f") · 请求预留估算 $\(cost.reservedUsd, specifier: "%.4f")，不代表供应商账单。" ).font(.footnote);if cost.unknownRequests>0 {Text("有请求未返回用量，预算暂按上限计入。").font(.footnote)}}
                if let error { Text(error).foregroundStyle(.red); Text("原话已保留。重试会沿用同一次交代；再次调用模型可能产生费用。").font(.footnote) }
                if let saved,history?.messages.contains(where:{$0.task?.id==saved.id}) != true {
                    GroupBox("已保存事项") {
                        VStack(alignment: .leading, spacing: 10) {
                            Text(saved.title).font(.headline)
                            if let location=saved.locationReminder {Text((location.transition=="enter" ? "到达 " : "离开 ")+location.place.name)}
                            if let reminder = saved.reminder { Text(taskDate(reminder.instant, zone: reminder.timeZone)); Text("时区：\(reminder.timeZone)") }
                            if let deadline = saved.deadline { Text("截止：" + (deadline.kind == "date" ? (deadline.date ?? "") : taskDate(deadline.instant ?? "", zone: deadline.timeZone))) }
                            Text(saved.locationReminder.map(locationStatus) ?? reminderStatus(saved.reminder))
                            ForEach(saved.sources, id: \.id) { Text("来源：\($0.text)").font(.footnote) }
                            NavigationLink("查看当前事项与提醒设置") { TaskDetailView(initial: saved, connection: connection) }
                            Button("再交代一件事") { draft = ConversationDraft(); self.saved = nil; message = nil; error = nil; persist() }
                        }.frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                    Button(error == nil ? "交代" : "重试") { submit() }.buttonStyle(.borderedProminent).disabled(busy || draft.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                Button("手动设置提醒") { manual = true }.disabled(busy)
            }.padding()
        }.navigationTitle("交代")
            .sheet(isPresented: $manual) { NavigationStack { ManualTaskView(connection: connection, repository: repository, initialTitle: draft.text) } }
            .onChange(of: draft.text) { if !busy && draft.text != draft.submittedText { draft.key = nil; draft.runId = nil; draft.retryKey = nil; draft.cancelKey = nil; draft.cancellationRequested = nil; failedRun = false; draft.submittedText = nil; draft.timeZone = nil; saved = nil; message = nil }; persist() }
            .task {
                do { draft = try store.read(ConversationDraft.self) ?? ConversationDraft() } catch { self.error = error.localizedDescription }
                if let session = connection.saved { model = try? await HaijiAPI(server: session.server).model(token: session.credentials.accessToken) }
                if let session=connection.saved,let id=draft.conversationId {history=try? await HaijiAPI(server:session.server).conversation(id:id,token:session.credentials.accessToken)}
                if draft.runId != nil || (draft.cancellationRequested == true && draft.key != nil) { pollTrigger += 1 }
            }
            .onAppear {Task {await refreshHistory()};if (draft.runId != nil || (draft.cancellationRequested == true && draft.key != nil)) && !busy { pollTrigger += 1 } }
            .onChange(of: scenePhase) {if scenePhase == .active {Task {await refreshHistory()};if (draft.runId != nil || (draft.cancellationRequested == true && draft.key != nil)) && !busy {pollTrigger += 1}} }
            .task(id: pollTrigger) { if pollTrigger > 0 { await process() } }
    }
    private func refreshHistory() async {
        guard let session=connection.saved,let id=draft.conversationId else{return}
        let result=try? await HaijiAPI(server:session.server).conversation(id:id,token:session.credentials.accessToken)
        guard connection.saved?.server==session.server,connection.saved?.credentials.deviceId==session.credentials.deviceId else{return}
        history=result
    }
    private func cancel() async {
        draft.requestCancellation()
        do { try store.save(draft) } catch { self.error = error.localizedDescription; return }
        guard let session = connection.saved else { return }
        do { try await sendPendingCancellation(session) } catch { self.error = error.localizedDescription }
    }
    private func sendPendingCancellation(_ session: SavedSession) async throws {
        guard let id = draft.runId, let key = draft.pendingCancellationKey() else { return }
        try store.save(draft)
        _ = try await HaijiAPI(server:session.server).cancelRun(id:id,key:key,token:session.credentials.accessToken)
        try Task.checkCancellation()
        draft.acknowledgeCancellation(key: key)
        try store.save(draft)
    }
    private func persist() { do { try store.save(draft) } catch { self.error = error.localizedDescription } }
    private func submit() {
        guard !busy, !draft.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        draft.key = draft.key ?? UUID().uuidString
        if failedRun { draft.prepareRetry() }
        draft.submittedText = draft.text
        draft.timeZone = draft.timeZone ?? TimeZone.current.identifier
        do { try store.save(draft); busy = true; error = nil; pollTrigger += 1 } catch { self.error = error.localizedDescription }
    }
    private func process() async {
        guard let session = connection.saved else { busy = false; return }
        busy = true; defer { busy = false }
        let api = HaijiAPI(server: session.server)
        do {
            if draft.runId == nil {
                let accepted = try await api.submitInput(text: draft.text, timeZone: draft.timeZone ?? TimeZone.current.identifier, key: draft.key ?? UUID().uuidString, token: session.credentials.accessToken,conversationId:draft.conversationId,replyToInputId:draft.replyToInputId,taskId:draft.taskId)
                try Task.checkCancellation(); draft.conversationId=accepted.conversationId ?? draft.conversationId;draft.runId = accepted.runId; try store.save(draft)
            }
            guard let runId = draft.runId else { return }
            if let retryKey = draft.retryKey {
                _ = try await api.retryRun(id: runId, key: retryKey, token: session.credentials.accessToken)
                try Task.checkCancellation(); draft.acknowledgeRetry(key: retryKey); failedRun = false; try store.save(draft)
            }
            try await sendPendingCancellation(session)
            while !Task.isCancelled {
                let run = try await api.run(id: runId, token: session.credentials.accessToken)
                try Task.checkCancellation()
                guard connection.saved?.credentials.deviceId == session.credentials.deviceId, connection.saved?.credentials.ownerId == session.credentials.ownerId, connection.saved?.server == session.server else { return }
                cost=run.cost
                switch run.status {
                case .queued, .running: if run.stillProcessing == true {message="仍在处理中，可以停止；原话会保留。"};try await Task.sleep(for: .seconds(1))
                case .succeeded:
                    if let taskId = run.taskId {
                        let task = try await api.task(id: taskId, token: session.credentials.accessToken)
                        try Task.checkCancellation()
                        guard connection.saved?.credentials.deviceId == session.credentials.deviceId, connection.saved?.credentials.ownerId == session.credentials.ownerId, connection.saved?.server == session.server else { return }
                        saved = task
                        await repository.refresh(connection)
                        message = nil; error = nil
                    } else { message = run.message ?? "本次没有创建事项。" }
                    await refreshHistory()
                    draft.text="";draft.submittedText=nil;draft.key=nil;draft.runId=nil;draft.cancelKey=nil;draft.cancellationRequested=nil;draft.replyToInputId=nil;draft.taskId=nil;draft.timeZone=nil;persist();return
                case .clarification,.needs_clarification:
                    message = run.message ?? "请补充具体日期、时间与事项。"
                    draft.replyToInputId=run.clarificationReplyInputId;draft.text="";draft.submittedText=nil;draft.key = nil; draft.runId = nil;draft.cancelKey=nil;draft.cancellationRequested=nil;draft.timeZone=nil;try store.save(draft);await refreshHistory(); return
                case .failed,.cancelled,.timed_out:
                    await refreshHistory()
                    failedRun = true; error = run.message ?? "模型暂时无法处理，请手动设置或稍后再试。"; return
                }
            }
        } catch is CancellationError { } catch { self.error = error.localizedDescription }
    }
}

/// UITextView keeps IME composition native; only committed Return submits.
private struct ConversationEditor: UIViewRepresentable {
    @Binding var text: String
    let disabled: Bool
    let submit: () -> Void
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> ComposerTextView {
        let view = ComposerTextView(); view.delegate = context.coordinator; view.font = .preferredFont(forTextStyle: .body)
        view.backgroundColor = .clear; view.textContainerInset = UIEdgeInsets(top: 12, left: 8, bottom: 12, right: 8)
        view.returnKeyType = .send; view.accessibilityLabel = "交代内容"; return view
    }
    func updateUIView(_ view: ComposerTextView, context: Context) {
        context.coordinator.parent = self
        if view.text != text && view.markedTextRange == nil { view.text = text }
        view.isEditable = !disabled
    }
    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: ConversationEditor
        init(_ parent: ConversationEditor) { self.parent = parent }
        func textViewDidChange(_ textView: UITextView) { parent.text = textView.text }
        func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
            guard text == "\n", textView.markedTextRange == nil, !((textView as? ComposerTextView)?.insertingLineBreak ?? false) else { return true }
            parent.submit(); return false
        }
    }
}
private final class ComposerTextView: UITextView {
    var insertingLineBreak = false
    override var keyCommands: [UIKeyCommand]? { [UIKeyCommand(input: "\r", modifierFlags: .shift, action: #selector(lineBreak))] }
    @objc private func lineBreak() { insertingLineBreak = true; insertText("\n"); insertingLineBreak = false }
}

#if DEBUG
/// Isolated keyboard acceptance uses the production editor without a server or model.
struct ConversationKeyboardValidationView: View {
    @State private var text = ""
    @State private var submissions = 0
    @State private var submitted = ""
    var body: some View {
        VStack {
            ConversationEditor(text: $text, disabled: false) {
                submissions += 1
                submitted = text
            }.frame(height: 180)
            Button("执行换行快捷键") {
                UIApplication.shared.sendAction(NSSelectorFromString("lineBreak"), to: nil, from: nil, for: nil)
            }
            Text("提交次数：\(submissions)").accessibilityIdentifier("keyboardSubmissionCount")
            Text(text).accessibilityIdentifier("keyboardDraftText")
            Text(submitted).accessibilityIdentifier("keyboardSubmittedText")
        }.padding()
    }
}
#endif
