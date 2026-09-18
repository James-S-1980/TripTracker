import UIKit
import UserNotifications

final class AppNotificationDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        #if DEBUG
        let environment = "sandbox"
        #else
        let environment = "production"
        #endif
        guard let secret = Bundle.main.object(forInfoDictionaryKey: "TripTrackerPushRegistrationSecret") as? String,
              !secret.isEmpty else {
            UserDefaults.standard.set(false, forKey: "TripTracker.iOS.pushRegistered")
            return
        }
        Task {
            do {
                try await APIClient().registerPushDevice(token: token, environment: environment, secret: secret)
                UserDefaults.standard.set(true, forKey: "TripTracker.iOS.pushRegistered")
            } catch {
                UserDefaults.standard.set(false, forKey: "TripTracker.iOS.pushRegistered")
            }
        }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        UserDefaults.standard.set(false, forKey: "TripTracker.iOS.pushRegistered")
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }
}

enum LocalFlightAlerts {
    static func requestPermission() async {
        let allowed = (try? await UNUserNotificationCenter.current()
            .requestAuthorization(options: [.alert, .badge, .sound])) ?? false
        if allowed { await MainActor.run { UIApplication.shared.registerForRemoteNotifications() } }
    }

    static func deliver(_ notification: FlightNotification) async {
        let content = UNMutableNotificationContent()
        content.title = notification.title
        content.body = notification.body
        content.sound = .default
        let request = UNNotificationRequest(identifier: notification.id, content: content, trigger: nil)
        try? await UNUserNotificationCenter.current().add(request)
    }
}
