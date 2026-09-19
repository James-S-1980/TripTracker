import SwiftUI

@main
struct TripTrackerWatchApp: App {
    @StateObject private var store = FlightWatchStore()

    var body: some Scene {
        WindowGroup {
            FlightListView()
                .environmentObject(store)
        }
    }
}
