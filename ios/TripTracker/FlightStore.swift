import Foundation
import Combine
import UserNotifications

@MainActor
final class FlightStore: ObservableObject {
    @Published private(set) var flights: [FlightLeg] = []
    @Published var selectedID: String?
    @Published var isBusy = false
    @Published var errorMessage: String?
    @Published var choices: [FlightLeg] = []
    @Published private(set) var weather: [String: Weather.Current] = [:]
    @Published private(set) var lastRefresh: Date?
    @Published private(set) var notifications: [FlightNotification] = []

    private let api = APIClient()
    private let cacheKey = "TripTracker.iOS.flights"
    private let notificationCacheKey = "TripTracker.iOS.notifications"
    private let seenEventKey = "TripTracker.iOS.seenServerEvents"
    private let eventFeedInitializedKey = "TripTracker.iOS.eventFeedInitialized"
    private var seenEventIDs: Set<String> = []
    private var seenEventOrder: [String] = []
    private var isPollingNotifications = false
    private var started = false

    var selected: FlightLeg? { flights.first { $0.id == selectedID } ?? flights.first }
    var unreadNotificationCount: Int { notifications.filter { !$0.isRead }.count }

    init() {
        if let data = UserDefaults.standard.data(forKey: cacheKey),
           let cached = try? JSONDecoder().decode([FlightLeg].self, from: data) {
            flights = cached
            selectedID = cached.first?.id
        }
        if let data = UserDefaults.standard.data(forKey: notificationCacheKey),
           let cached = try? JSONDecoder().decode([FlightNotification].self, from: data) {
            notifications = cached
        }
        seenEventOrder = UserDefaults.standard.stringArray(forKey: seenEventKey) ?? []
        seenEventIDs = Set(seenEventOrder)
    }

    func start() async {
        guard !started else { return }
        started = true
        await sync()
        await pollNotificationEvents()
        Task { await LocalFlightAlerts.requestPermission() }
    }

    func sync() async {
        do {
            let serverFlights = try await api.trackedFlights()
            var merged = flights
            for flight in serverFlights {
                if let index = merged.firstIndex(where: { $0.id == flight.id }) {
                    merged[index] = flight
                } else {
                    merged.append(flight)
                }
            }
            flights = merged
            if selectedID == nil { selectedID = flights.first?.id }
            save()
            lastRefresh = Date()
            if !flights.isEmpty { try? await api.register(flights) }
            await loadWeatherForSelected()
        } catch {
            errorMessage = readableError(error)
        }
    }

    func add(airline: String, number: String, date: Date) async {
        let digits = number.filter(\.isNumber)
        guard !airline.trimmingCharacters(in: .whitespaces).isEmpty, !digits.isEmpty else {
            errorMessage = "Enter an airline and flight number."
            return
        }
        isBusy = true
        errorMessage = nil
        choices = []
        defer { isBusy = false }
        do {
            let result = try await api.lookup(airline: airline.trimmingCharacters(in: .whitespaces), number: digits, date: Self.apiDate(date), track: true)
            switch result {
            case .flight(let flight): accept(flight)
            case .choices(let options):
                choices = options.flights
                errorMessage = options.message
            }
        } catch { errorMessage = readableError(error) }
    }

    func choose(_ choice: FlightLeg) async {
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        do {
            let result = try await api.lookup(airline: choice.airlineCode, number: choice.numberOnly, date: choice.date, track: true, flightID: choice.id)
            switch result {
            case .flight(let flight): accept(flight); choices = []
            case .choices(let options): choices = options.flights; errorMessage = options.message
            }
        } catch { errorMessage = readableError(error) }
    }

    func refresh() async {
        guard !flights.isEmpty else { return }
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        var failures: [String] = []
        for old in flights {
            do {
                let result = try await api.lookup(airline: old.airlineCode, number: old.numberOnly, date: old.date, monitor: true, flightID: old.id)
                if case .flight(let updated) = result {
                    if let index = flights.firstIndex(where: { $0.id == old.id }) { flights[index] = updated }
                    save()
                }
            } catch { failures.append("\(old.flightNumber): \(readableError(error))") }
        }
        lastRefresh = Date()
        if !failures.isEmpty { errorMessage = failures.joined(separator: "\n") }
    }

    func pollNotificationEvents() async {
        guard !isPollingNotifications else { return }
        isPollingNotifications = true
        defer { isPollingNotifications = false }
        do {
            let events = try await api.notificationEvents()
            let firstLoad = !UserDefaults.standard.bool(forKey: eventFeedInitializedKey)
            let unseen = events.filter { !seenEventIDs.contains($0.eventID) }
            seenEventOrder.append(contentsOf: unseen.map(\.eventID))
            seenEventOrder = Array(seenEventOrder.suffix(200))
            seenEventIDs = Set(seenEventOrder)
            UserDefaults.standard.set(seenEventOrder, forKey: seenEventKey)
            UserDefaults.standard.set(true, forKey: eventFeedInitializedKey)
            guard !firstLoad else { return }

            let delivered = unseen
                .filter { $0.result == "sent" && ["tracked", "updated", "concluded"].contains($0.eventType) }
                .sorted { $0.timestamp < $1.timestamp }
                .map(\.display)
            guard !delivered.isEmpty else { return }
            notifications.insert(contentsOf: delivered.reversed(), at: 0)
            notifications = Array(notifications.prefix(100))
            saveNotifications()
            if !UserDefaults.standard.bool(forKey: "TripTracker.iOS.pushRegistered") {
                for notification in delivered {
                    await LocalFlightAlerts.deliver(notification)
                }
            }
            await updateBadge()
        } catch {
            // The flight UI remains usable if the notification feed is unavailable.
        }
    }

    func markNotificationRead(_ id: String) {
        guard let index = notifications.firstIndex(where: { $0.id == id }) else { return }
        notifications[index].isRead = true
        saveNotifications()
        Task { await updateBadge() }
    }

    func markAllNotificationsRead() {
        for index in notifications.indices { notifications[index].isRead = true }
        saveNotifications()
        Task { await updateBadge() }
    }

    func delete(_ flight: FlightLeg) async {
        flights.removeAll { $0.id == flight.id }
        if selectedID == flight.id { selectedID = flights.first?.id }
        save()
        do { try await api.untrack(flight) }
        catch { errorMessage = readableError(error) }
    }

    func select(_ id: String) async {
        selectedID = id
        await loadWeatherForSelected()
    }

    private func accept(_ flight: FlightLeg, reorder: Bool = true) {
        flights.removeAll { $0.id == flight.id }
        if reorder { flights.insert(flight, at: 0) }
        else { flights.append(flight) }
        selectedID = flight.id
        choices = []
        lastRefresh = Date()
        save()
        Task { await loadWeatherForSelected() }
    }

    private func loadWeatherForSelected() async {
        guard let flight = selected else { return }
        for airport in [flight.origin, flight.destination] {
            do { weather[airport.code] = try await WeatherClient().fetch(airport) }
            catch { /* Weather is supplemental; flight data remains available. */ }
        }
    }

    private func save() {
        if let data = try? JSONEncoder().encode(flights) { UserDefaults.standard.set(data, forKey: cacheKey) }
    }

    private func saveNotifications() {
        if let data = try? JSONEncoder().encode(notifications) {
            UserDefaults.standard.set(data, forKey: notificationCacheKey)
        }
    }

    private func updateBadge() async {
        try? await UNUserNotificationCenter.current().setBadgeCount(unreadNotificationCount)
    }

    private static func apiDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = .current
        return formatter.string(from: date)
    }

    private func readableError(_ error: Error) -> String {
        if let urlError = error as? URLError {
            switch urlError.code {
            case .cannotConnectToHost, .cannotFindHost, .timedOut:
                return "Cannot reach the TripTracker server at 69.138.9.74:8080."
            case .serverCertificateUntrusted, .secureConnectionFailed:
                return "The server certificate is not trusted by this iPhone. Configure a trusted HTTPS certificate for the TripTracker host."
            default: break
            }
        }
        return error.localizedDescription
    }
}
