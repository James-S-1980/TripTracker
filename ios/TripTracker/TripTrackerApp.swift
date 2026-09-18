import SwiftUI

@main
struct TripTrackerApp: App {
    @UIApplicationDelegateAdaptor(AppNotificationDelegate.self) private var notificationDelegate
    @StateObject private var store = FlightStore()

    var body: some Scene {
        WindowGroup {
            DashboardView()
                .environmentObject(store)
                .preferredColorScheme(.dark)
        }
    }
}
