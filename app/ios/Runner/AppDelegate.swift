import Flutter
import UIKit
import UserNotifications

// Push notifications without Firebase: iOS hands the APNs device token to
// this delegate, and Dart talks to it over the "bagspec/push" channel.
//   Dart -> iOS: requestToken (asks permission, returns the hex token or nil)
//   iOS -> Dart: opened ({dealId, url}) when a notification is tapped
@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  private var channel: FlutterMethodChannel?
  private var pendingTokenResult: FlutterResult?
  private var pendingOpen: [String: Any]?
  private var dartReady = false

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    UNUserNotificationCenter.current().delegate = self
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    guard let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "BagSpecPush") else { return }
    let channel = FlutterMethodChannel(name: "bagspec/push", binaryMessenger: registrar.messenger())
    channel.setMethodCallHandler { [weak self] call, result in
      switch call.method {
      case "requestToken":
        self?.requestToken(result)
      case "takeLaunchNotification":
        // A tap that launched the app arrives before Dart is listening;
        // Dart asks for it once at startup, and later taps are pushed.
        result(self?.pendingOpen)
        self?.pendingOpen = nil
        self?.dartReady = true
      default:
        result(FlutterMethodNotImplemented)
      }
    }
    self.channel = channel
  }

  private func requestToken(_ result: @escaping FlutterResult) {
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
      DispatchQueue.main.async {
        guard granted else {
          result(nil)
          return
        }
        self.pendingTokenResult = result
        UIApplication.shared.registerForRemoteNotifications()
      }
    }
  }

  override func application(
    _ application: UIApplication,
    didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
  ) {
    let token = deviceToken.map { String(format: "%02x", $0) }.joined()
    pendingTokenResult?(token)
    pendingTokenResult = nil
  }

  override func application(
    _ application: UIApplication,
    didFailToRegisterForRemoteNotificationsWithError error: Error
  ) {
    pendingTokenResult?(FlutterError(code: "register_failed", message: error.localizedDescription, details: nil))
    pendingTokenResult = nil
  }

  // Show alerts even while the app is open.
  override func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    if #available(iOS 14.0, *) {
      completionHandler([.banner, .list, .sound])
    } else {
      completionHandler([.alert, .sound])
    }
  }

  override func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    let info = response.notification.request.content.userInfo
    var payload: [String: Any] = [:]
    if let dealId = info["dealId"] { payload["dealId"] = dealId }
    if let url = info["url"] as? String { payload["url"] = url }
    if dartReady, let channel = channel {
      channel.invokeMethod("opened", arguments: payload)
    } else {
      pendingOpen = payload
    }
    completionHandler()
  }
}
