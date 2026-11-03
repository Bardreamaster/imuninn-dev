// Bonjour discovery of iMuninn gateways (§6.7). Plain Swift.
import Foundation
import Network

public struct GatewayEndpoint: Equatable {
  public let name: String
  public let endpoint: NWEndpoint

  public static func == (a: GatewayEndpoint, b: GatewayEndpoint) -> Bool {
    a.name == b.name && "\(a.endpoint)" == "\(b.endpoint)"
  }
}

public final class Discovery {
  public static let serviceType = "_imuninn._tcp"

  private var browser: NWBrowser?
  private let queue = DispatchQueue(label: "imuninn.discovery")
  public private(set) var results: [GatewayEndpoint] = []
  public var onChange: (([GatewayEndpoint]) -> Void)?

  public init() {}

  public func start() {
    stop()
    let params = NWParameters.tcp
    params.includePeerToPeer = true
    let b = NWBrowser(for: .bonjour(type: Self.serviceType, domain: nil), using: params)
    b.browseResultsChangedHandler = { [weak self] results, _ in
      guard let self else { return }
      let list = results.compactMap { r -> GatewayEndpoint? in
        if case let .service(name, _, _, _) = r.endpoint {
          return GatewayEndpoint(name: name, endpoint: r.endpoint)
        }
        return nil
      }.sorted { $0.name < $1.name }
      self.results = list
      self.onChange?(list)
    }
    b.stateUpdateHandler = { state in
      if case let .failed(err) = state { NSLog("[imuninn] discovery failed: \(err)") }
    }
    b.start(queue: queue)
    browser = b
  }

  public func stop() {
    browser?.cancel()
    browser = nil
  }
}
