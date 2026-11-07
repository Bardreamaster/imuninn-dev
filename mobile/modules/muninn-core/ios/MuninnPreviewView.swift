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
    for v in [arView, cameraView] {
      v.translatesAutoresizingMaskIntoConstraints = false
      addSubview(v)
      NSLayoutConstraint.activate([
        v.leadingAnchor.constraint(equalTo: leadingAnchor),
        v.trailingAnchor.constraint(equalTo: trailingAnchor),
        v.topAnchor.constraint(equalTo: topAnchor),
        v.bottomAnchor.constraint(equalTo: bottomAnchor),
      ])
    }
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
    applyRotation()
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
