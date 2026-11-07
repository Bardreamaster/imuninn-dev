// Camera preview as an Expo native view (§4.4): ARSCNView in AR mode,
// AVCaptureVideoPreviewLayer in camera mode. Switches on mode change and follows
// the interface orientation. The whole frame is shown (aspect fit); the JS side
// draws masks over any area the chosen format does not cover.
import ARKit
import AVFoundation
import ExpoModulesCore
import UIKit

final class MuninnPreviewView: ExpoView {
  // Shared between all instances (inline + full-screen): attaching a second
  // AVCaptureVideoPreviewLayer to a running session, or building a second ARSCNView,
  // stalls the main thread for ~1 s. The view that is currently in a window owns them.
  private static let sharedArView: ARSCNView = {
    let v = ARSCNView()
    v.session = SessionManager.shared.ar.session
    v.automaticallyUpdatesLighting = false
    v.rendersCameraGrain = false
    v.backgroundColor = .black
    return v
  }()
  private static let sharedPreviewLayer: AVCaptureVideoPreviewLayer = {
    let l = AVCaptureVideoPreviewLayer(session: SessionManager.shared.camera.session)
    l.videoGravity = .resizeAspect
    return l
  }()
  private var arView: ARSCNView { Self.sharedArView }
  private var previewLayer: AVCaptureVideoPreviewLayer { Self.sharedPreviewLayer }
  private let cameraView = UIView()
  private var observers: [NSObjectProtocol] = []

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .black
    // ARSCNView can only aspect-fill, so it gets a centred sub-frame with the format's
    // aspect (letterboxed by layout); the capture preview layer aspect-fits by itself.
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

  /// Take the shared views when we appear; the previous owner is already gone or hidden.
  override func didMoveToWindow() {
    super.didMoveToWindow()
    guard window != nil else { return }
    CATransaction.begin(); CATransaction.setDisableActions(true)
    if arView.superview !== self { arView.removeFromSuperview(); addSubview(arView) }
    if previewLayer.superlayer !== cameraView.layer { previewLayer.removeFromSuperlayer(); cameraView.layer.addSublayer(previewLayer) }
    CATransaction.commit()
    bringSubviewToFront(cameraView)
    applyMode()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    guard arView.superview === self else { return }
    CATransaction.begin(); CATransaction.setDisableActions(true)
    previewLayer.frame = cameraView.bounds
    arView.frame = fitRect(for: SessionManager.shared.ar.videoFormatId)
    CATransaction.commit()
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
