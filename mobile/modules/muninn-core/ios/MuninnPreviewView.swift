// AR camera preview as an Expo native view (§4.4): renders the shared ARSession.
import ARKit
import ExpoModulesCore
import UIKit

final class MuninnPreviewView: ExpoView {
  private let arView = ARSCNView()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    arView.session = SessionManager.shared.ar.session
    arView.automaticallyUpdatesLighting = false
    arView.rendersCameraGrain = false
    arView.translatesAutoresizingMaskIntoConstraints = false
    addSubview(arView)
    NSLayoutConstraint.activate([
      arView.leadingAnchor.constraint(equalTo: leadingAnchor),
      arView.trailingAnchor.constraint(equalTo: trailingAnchor),
      arView.topAnchor.constraint(equalTo: topAnchor),
      arView.bottomAnchor.constraint(equalTo: bottomAnchor),
    ])
  }
}
