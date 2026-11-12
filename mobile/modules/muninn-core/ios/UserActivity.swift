// User-activity signal for the black-screen idle timer. A JS onTouchStart on the main
// view misses touches inside modals (remote sheet, fullscreen preview), long drags and
// slider holds (only the first touch counts) and keyboard typing, so the screen went
// dark while the user was still operating it. This watches every touch in the app's
// windows (a recognizer that never recognizes and never cancels touches) plus text
// edits, and reports "the user did something" at most every `minInterval` seconds.
import UIKit
import UIKit.UIGestureRecognizerSubclass

final class UserActivityMonitor: NSObject, UIGestureRecognizerDelegate {
  static let shared = UserActivityMonitor()

  var onActivity: (() -> Void)?
  private let minInterval: CFTimeInterval = 0.5
  private var last: CFTimeInterval = 0
  private var started = false
  private var observers: [NSObjectProtocol] = []

  func start() {
    DispatchQueue.main.async {
      guard !self.started else { return }
      self.started = true
      self.attachToWindows()
      let nc = NotificationCenter.default
      // New windows (key window changes) get a recognizer too.
      self.observers.append(nc.addObserver(forName: UIWindow.didBecomeKeyNotification, object: nil, queue: .main) { _ in
        self.attachToWindows()
      })
      // Keyboard taps never reach the app's windows; text edits stand in for them.
      for name in [UITextField.textDidChangeNotification, UITextView.textDidChangeNotification] {
        self.observers.append(nc.addObserver(forName: name, object: nil, queue: .main) { _ in
          self.report()
        })
      }
    }
  }

  private func attachToWindows() {
    for scene in UIApplication.shared.connectedScenes {
      guard let ws = scene as? UIWindowScene else { continue }
      for w in ws.windows where !(w.gestureRecognizers ?? []).contains(where: { $0 is TouchWatcher }) {
        let r = TouchWatcher { [weak self] in self?.report() }
        r.delegate = self
        w.addGestureRecognizer(r)
      }
    }
  }

  fileprivate func report() {
    let now = CACurrentMediaTime()
    guard now - last >= minInterval else { return }
    last = now
    onActivity?()
  }

  func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
  func gestureRecognizer(_ g: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool { true }
}

/// Observes touches without ever recognizing, so it never steals or delays them.
private final class TouchWatcher: UIGestureRecognizer {
  private let hit: () -> Void

  init(_ hit: @escaping () -> Void) {
    self.hit = hit
    super.init(target: nil, action: nil)
    cancelsTouchesInView = false
    delaysTouchesBegan = false
    delaysTouchesEnded = false
  }

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) { hit() }
  override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) { hit() }
  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) { hit(); finish(event) }
  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) { finish(event) }

  private func finish(_ event: UIEvent) {
    // Once every finger is up, fail so UIKit resets us for the next touch sequence.
    let active = (event.allTouches ?? []).filter { $0.phase != .ended && $0.phase != .cancelled }
    if active.isEmpty { state = .failed }
  }

  // Never block or be blocked by other recognizers.
  override func canPrevent(_ preventedGestureRecognizer: UIGestureRecognizer) -> Bool { false }
  override func canBePrevented(by preventingGestureRecognizer: UIGestureRecognizer) -> Bool { false }
}
