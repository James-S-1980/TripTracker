import SwiftUI

@main
struct TripTrackerApp: App {
    @StateObject private var store = FlightStore()

    var body: some Scene {
        WindowGroup {
            DashboardView()
                .environmentObject(store)
                .preferredColorScheme(.dark)
        }
    }
}
