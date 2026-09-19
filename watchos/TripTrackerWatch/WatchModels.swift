import Foundation

struct TrackedFlightsResponse: Decodable {
    let flights: [WatchFlight]
}

struct WatchAirport: Codable, Hashable {
    let code: String
    let timeZone: String
}

struct WatchFlight: Codable, Hashable, Identifiable {
    let id: String
    let flightNumber: String
    let status: String
    let origin: WatchAirport
    let destination: WatchAirport
    let departureTime: String
    let arrivalTime: String

    var route: String { "\(origin.code) → \(destination.code)" }

    func departureLabel() -> String { Self.timeLabel(departureTime, zone: origin.timeZone) }
    func arrivalLabel() -> String { Self.timeLabel(arrivalTime, zone: destination.timeZone) }

    private static func timeLabel(_ value: String, zone: String) -> String {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = parser.date(from: value) ?? ISO8601DateFormatter().date(from: value)
        guard let date else { return "Pending" }
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        formatter.dateStyle = .none
        formatter.timeZone = TimeZone(identifier: zone) ?? .current
        return formatter.string(from: date)
    }
}
