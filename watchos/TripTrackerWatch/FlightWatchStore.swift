import Foundation
import Combine

@MainActor
final class FlightWatchStore: ObservableObject {
    @Published private(set) var flights: [WatchFlight] = []
    @Published private(set) var lastRefresh: Date?
    @Published private(set) var isRefreshing = false
    @Published private(set) var errorMessage: String?

    private let endpoint = URL(string: "http://69.138.9.74:8087/trip/api/tracked-flights")!
    private let cacheKey = "TripTracker.watch.trackedFlights"

    init() {
        if let data = UserDefaults.standard.data(forKey: cacheKey),
           let saved = try? JSONDecoder().decode([WatchFlight].self, from: data) {
            flights = saved
        }
    }

    func refresh() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            var request = URLRequest(url: endpoint)
            request.timeoutInterval = 15
            request.cachePolicy = .reloadIgnoringLocalCacheData
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
            let latest = try JSONDecoder().decode(TrackedFlightsResponse.self, from: data).flights
            flights = latest
            lastRefresh = Date()
            errorMessage = nil
            UserDefaults.standard.set(try JSONEncoder().encode(latest), forKey: cacheKey)
        } catch {
            errorMessage = "Could not refresh flights. Showing saved data."
        }
    }
}
