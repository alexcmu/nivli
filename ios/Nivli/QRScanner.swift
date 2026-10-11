import SwiftUI
import AVFoundation

struct QRScanner: View {
    let onCode: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var authorized = false
    @State private var checked = false
    var body: some View {
        NavigationStack {
            Group {
                if authorized { CameraView(onCode: onCode).accessibilityLabel("将配对二维码放入摄像头画面") }
                else if checked { ContentUnavailableView("无法使用摄像头", systemImage: "camera", description: Text("你仍可返回，手动输入 HTTPS 地址和一次性配对码。也可在系统设置允许摄像头访问。")) }
                else { ProgressView("检查摄像头权限") }
            }.navigationTitle("扫描配对二维码").toolbar { ToolbarItem(placement: .cancellationAction) { Button("返回手动输入") { dismiss() } } }
        }.task {
            authorized = await AVCaptureDevice.requestAccess(for: .video); checked = true
        }
    }
}
struct CameraView: UIViewControllerRepresentable {
    let onCode: (String) -> Void
    func makeUIViewController(context: Context) -> ScannerController { ScannerController(onCode: onCode) }
    func updateUIViewController(_ controller: ScannerController, context: Context) {}
    static func dismantleUIViewController(_ controller: ScannerController, coordinator: ()) { controller.session.stopRunning() }
}
final class ScannerController: UIViewController, @preconcurrency AVCaptureMetadataOutputObjectsDelegate {
    let session = AVCaptureSession()
    private let onCode: (String) -> Void
    private var preview: AVCaptureVideoPreviewLayer?
    private var delivered = false
    init(onCode: @escaping (String) -> Void) { self.onCode = onCode; super.init(nibName: nil, bundle: nil) }
    required init?(coder: NSCoder) { fatalError("Not supported") }
    override func viewDidLoad() {
        super.viewDidLoad()
        guard let device = AVCaptureDevice.default(for: .video), let input = try? AVCaptureDeviceInput(device: device), session.canAddInput(input) else { return }
        session.addInput(input)
        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else { return }
        session.addOutput(output); output.setMetadataObjectsDelegate(self, queue: .main); output.metadataObjectTypes = [.qr]
        let preview = AVCaptureVideoPreviewLayer(session: session); preview.videoGravity = .resizeAspectFill
        view.layer.addSublayer(preview); self.preview = preview
        session.startRunning()
    }
    override func viewDidLayoutSubviews() { super.viewDidLayoutSubviews(); preview?.frame = view.bounds }
    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput objects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard !delivered, let code = (objects.first as? AVMetadataMachineReadableCodeObject)?.stringValue else { return }
        delivered = true; session.stopRunning(); onCode(code)
    }
}
