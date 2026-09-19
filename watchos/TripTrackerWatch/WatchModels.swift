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
    let boardingGate: String?
    let arrivalGate: String?
    let terminal: String?
    let arrivalTerminal: String?
    let progress: Double?
    let lastUpdated: String?

    var route: String { "\(origin.code) → \(destination.code)" }

    func departureLabel() -> String { Self.timeLabel(departureTime, zone: origin.timeZone) }
    func arrivalLabel() -> String { Self.timeLabel(arrivalTime, zone: destination.timeZone) }

    var departureGateLabel: String { Self.gateLabel(terminal: terminal, gate: boardingGate) }
    var arrivalGateLabel: String { Self.gateLabel(terminal: arrivalTerminal, gate: arrivalGate) }
    var completionPercent: Int { Int(min(100, max(0, progress ?? 0)).rounded()) }

    var updatedTimeLabel: String {
        guard let lastUpdated, let date = Self.parseDate(lastUpdated) else { return "Pending" }
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    var updatedDateTimeLabel: String {
        guard let lastUpdated, let date = Self.parseDate(lastUpdated) else { return "Pending" }
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    private static func gateLabel(terminal: String?, gate: String?) -> String {
        let terminal = clean(terminal)
        let gate = clean(gate)
        let terminalLabel = terminal.map { $0.uppercased().hasPrefix("T") ? $0 : "T\($0)" }
        if let terminalLabel, let gate { return "\(terminalLabel) / \(gate)" }
        if let gate { return gate }
        if let terminalLabel { return terminalLabel }
        return "Pending"
    }

    private static func clean(_ value: String?) -> String? {
        guard let text = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !text.isEmpty,
              !["tbd", "unknown", "n/a", "pending", "--", "-"].contains(text.lowercased()) else { return nil }
        return text
    }

    private static func timeLabel(_ value: String, zone: String) -> String {
        guard let date = parseDate(value) else { return "Pending" }
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        formatter.dateStyle = .none
        formatter.timeZone = TimeZone(identifier: zone) ?? .current
        return formatter.string(from: date)
    }

    private static func parseDate(_ value: String) -> Date? {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return parser.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}
