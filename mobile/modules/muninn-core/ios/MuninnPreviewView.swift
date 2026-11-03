// Camera preview as an Expo native view (§4.4): ARSCNView in AR mode,
// AVCaptureVideoPreviewLayer in camera mode. Switches on mode change.
import ARKit
import AVFoundation
import ExpoModulesCore
import UIKit

final class MuninnPreviewView: ExpoView {
  private let arView = ARSCNView()
  private let cameraView = UIView()
  private let previewLayer: AVCaptureVideoPreviewLayer
  private var observer: NSObjectProtocol?

  required init(appContext: AppContext? = nil) {
    previewLayer = AVCaptureVideoPreviewLayer(session: SessionManager.shared.camera.session)
    super.init(appContext: appContext)
    arView.session = SessionManager.shared.ar.session
    arView.automaticallyUpdatesLighting = false
    arView.rendersCameraGrain = false
    previewLayer.videoGravity = .resizeAspectFill
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
    observer = NotificationCenter.default.addObserver(forName: .muninnModeChanged, object: nil, queue: .main) { [weak self] _ in
      self?.applyMode()
    }
  }

  deinit {
    if let observer { NotificationCenter.default.removeObserver(observer) }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    previewLayer.frame = cameraView.bounds
  }

  private func applyMode() {
    let cam = SessionManager.shared.isCameraMode
    arView.isHidden = cam
    cameraView.isHidden = !cam
  }
}
