import Foundation
import Combine

@MainActor
final class FlightStore: ObservableObject {
    @Published private(set) var flights: [FlightLeg] = []
    @Published var selectedID: String?
    @Published var isBusy = false
    @Published var errorMessage: String?
    @Published var choices: [FlightLeg] = []
    @Published private(set) var weather: [String: Weather.Current] = [:]
    @Published private(set) var lastRefresh: Date?
    @Published private(set) var hasFlightAwareKey = FlightAwareKey.read() != nil

    private let api = APIClient()
    private let cacheKey = "TripTracker.iOS.flights"
    private var started = false

    var selected: FlightLeg? { flights.first { $0.id == selectedID } ?? flights.first }

    init() {
        if let data = UserDefaults.standard.data(forKey: cacheKey),
           let cached = try? JSONDecoder().decode([FlightLeg].self, from: data) {
            flights = cached
            selectedID = cached.first?.id
        }
    }

    func start() async {
        guard !started else { return }
        started = true
        await sync()
    }

    func sync() async {
        hasFlightAwareKey = FlightAwareKey.read() != nil
        await loadWeatherForSelected()
        if hasFlightAwareKey && !flights.isEmpty { await refresh() }
    }

    func keyChanged() {
        hasFlightAwareKey = FlightAwareKey.read() != nil
        errorMessage = nil
        if hasFlightAwareKey { Task { await refresh() } }
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
        guard !flights.isEmpty, hasFlightAwareKey, !isBusy else { return }
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        var failures: [String] = []
        for old in flights where Self.shouldRefresh(old) {
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

    func delete(_ flight: FlightLeg) async {
        flights.removeAll { $0.id == flight.id }
        if selectedID == flight.id { selectedID = flights.first?.id }
        save()
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

    private static func shouldRefresh(_ flight: FlightLeg) -> Bool {
        if flight.isConcluded { return false }
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = .current
        guard let day = formatter.date(from: flight.date) else { return false }
        return day >= Calendar.current.date(byAdding: .day, value: -2, to: Date())!
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
                return "Cannot reach FlightAware. Check your internet connection."
            case .serverCertificateUntrusted, .secureConnectionFailed:
                return "Could not establish a secure connection to the flight data provider."
            default: break
            }
        }
        return error.localizedDescription
    }
}
