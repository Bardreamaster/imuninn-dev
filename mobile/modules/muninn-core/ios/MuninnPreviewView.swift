// Camera preview as an Expo native view (§4.4): ARSCNView in AR mode,
// AVCaptureVideoPreviewLayer in camera mode. Switches on mode change and follows
// the interface orientation. The whole frame is shown (aspect fit); the JS side
// draws masks over any area the chosen format does not cover.
import ARKit
import AVFoundation
import ExpoModulesCore
import UIKit

final class MuninnPreviewView: ExpoView {
  private let arView = ARSCNView()
  private let cameraView = UIView()
  private let previewLayer: AVCaptureVideoPreviewLayer
  private var observers: [NSObjectProtocol] = []

  required init(appContext: AppContext? = nil) {
    previewLayer = AVCaptureVideoPreviewLayer(session: SessionManager.shared.camera.session)
    super.init(appContext: appContext)
    backgroundColor = .black
    arView.session = SessionManager.shared.ar.session
    arView.automaticallyUpdatesLighting = false
    arView.rendersCameraGrain = false
    arView.backgroundColor = .black
    previewLayer.videoGravity = .resizeAspect
    cameraView.layer.addSublayer(previewLayer)
    // ARSCNView can only aspect-fill, so it gets a centred sub-frame with the format's
    // aspect (letterboxed by layout); the capture preview layer aspect-fits by itself.
    addSubview(arView)
    cameraView.translatesAutoresizingMaskIntoConstraints = false
    addSubview(cameraView)
    NSLayoutConstraint.activate([
      cameraView.leadingAnchor.constraint(equalTo: leadingAnchor),
      cameraView.trailingAnchor.constraint(equalTo: trailingAnchor),
      cameraView.topAnchor.constraint(equalTo: topAnchor),
      cameraView.bottomAnchor.constraint(equalTo: bottomAnchor),
    ])
    applyMode()
    let nc = NotificationCenter.default
    observers.append(nc.addObserver(forName: .muninnModeChanged, object: nil, queue: .main) { [weak self] _ in self?.applyMode() })
    observers.append(nc.addObserver(forName: UIDevice.orientationDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
      self?.setNeedsLayout()
    })
  }

  deinit {
    observers.forEach { NotificationCenter.default.removeObserver($0) }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    previewLayer.frame = cameraView.bounds
    arView.frame = fitRect(for: SessionManager.shared.ar.videoFormatId)
    applyRotation()
  }

  /// Aspect-fit rect for a "WxH@fps" format inside our bounds, rotated for portrait.
  private func fitRect(for formatId: String) -> CGRect {
    var w: CGFloat = 4, h: CGFloat = 3
    if let wh = formatId.split(separator: "@").first?.split(separator: "x"), wh.count == 2,
       let fw = Double(wh[0]), let fh = Double(wh[1]), fw > 0, fh > 0 { w = fw; h = fh }
    let io = window?.windowScene?.interfaceOrientation ?? .portrait
    if io.isPortrait { swap(&w, &h) }
    let b = bounds
    guard b.width > 0, b.height > 0 else { return b }
    let scale = min(b.width / w, b.height / h)
    let fw = w * scale, fh = h * scale
    return CGRect(x: (b.width - fw) / 2, y: (b.height - fh) / 2, width: fw, height: fh)
  }

  /// Rotate the capture preview to match the interface orientation (ARSCNView does this itself).
  private func applyRotation() {
    guard let conn = previewLayer.connection else { return }
    let io = window?.windowScene?.interfaceOrientation ?? .portrait
    let angle: CGFloat
    switch io {
    case .landscapeLeft: angle = 180
    case .landscapeRight: angle = 0
    case .portraitUpsideDown: angle = 270
    default: angle = 90
    }
    if #available(iOS 17.0, *) {
      if conn.isVideoRotationAngleSupported(angle) { conn.videoRotationAngle = angle }
    } else {
      switch io {
      case .landscapeLeft: conn.videoOrientation = .landscapeLeft
      case .landscapeRight: conn.videoOrientation = .landscapeRight
      case .portraitUpsideDown: conn.videoOrientation = .portraitUpsideDown
      default: conn.videoOrientation = .portrait
      }
    }
  }

  private func applyMode() {
    let cam = SessionManager.shared.isCameraMode
    arView.isHidden = cam
    cameraView.isHidden = !cam
    setNeedsLayout()
  }
}
