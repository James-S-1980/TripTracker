import Foundation
import CoreLocation

struct Airport: Codable, Hashable {
    let code: String
    let name: String
    let city: String
    let lat: Double
    let lon: Double
    let timeZone: String

    var coordinate: CLLocationCoordinate2D { .init(latitude: lat, longitude: lon) }
}

struct AircraftPosition: Codable, Hashable {
    let lat: Double
    let lon: Double
    let altitudeFt: Double?
    let groundSpeedMph: Double?
    let headingDeg: Double?
    let timestamp: String?
    let source: String?
    let callsign: String?

    var coordinate: CLLocationCoordinate2D { .init(latitude: lat, longitude: lon) }
}

struct FlightAlert: Codable, Identifiable, Hashable {
    let id: String
    let type: String
    let priority: String
    let title: String
    let message: String
    let timestamp: String
}

struct FlightLeg: Codable, Identifiable, Hashable {
    let id: String
    let airline: String
    let airlineCode: String
    let airlineLogoUrl: String?
    let flightNumber: String
    let date: String
    let origin: Airport
    let destination: Airport
    let departureTime: String
    let arrivalTime: String
    let boardingGate: String
    let arrivalGate: String
    let terminal: String
    let arrivalTerminal: String
    let status: String
    let progress: Double
    let altitudeFt: Double
    let groundSpeedMph: Double
    let tailNumber: String?
    let inboundFrom: Airport?
    let inboundFlightNumber: String?
    let inboundStatus: String?
    let inboundSource: String?
    let aircraftPosition: AircraftPosition?
    let track: [AircraftPosition]?
    let lastUpdated: String
    let dataSource: String
    let sourceUrl: String?
    let landedAt: String?
    let alerts: [FlightAlert]

    var numberOnly: String {
        let parts = flightNumber.split(whereSeparator: \.isWhitespace)
        if let last = parts.last, last.allSatisfy(\.isNumber) { return String(last) }
        let suffix = flightNumber.uppercased().hasPrefix(airlineCode.uppercased())
            ? flightNumber.dropFirst(airlineCode.count)
            : Substring(flightNumber)
        return String(suffix.filter(\.isNumber))
    }
    var timeZoneRoute: String { "\(origin.code) to \(destination.code)" }
    var isConcluded: Bool { status == "Arrived" || status == "Cancelled" }
}

struct LookupChoices: Decodable {
    let ambiguous: Bool
    let flights: [FlightLeg]
    let message: String
}

enum LookupResult {
    case flight(FlightLeg)
    case choices(LookupChoices)
}

struct TrackedFlightResponse: Decodable { let flights: [FlightLeg] }

struct APIError: Decodable {
    let error: String?
    let detail: String?

    var message: String {
        [error, detail].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
    }
}

struct Weather: Decodable {
    struct Current: Decodable {
        let temperature_2m: Double?
        let wind_speed_10m: Double?
        let precipitation: Double?
        let weather_code: Int?
    }
    let current: Current?
}

struct RunwayEnd: Decodable {
    let ident: String
    let lat: Double
    let lon: Double
    let headingDeg: Double

    var coordinate: CLLocationCoordinate2D { .init(latitude: lat, longitude: lon) }
}

struct AirportRunway: Decodable {
    let id: String
    let airportCode: String
    let ident: String
    let le: RunwayEnd?
    let he: RunwayEnd?
}

struct RainViewerResponse: Decodable {
    struct Frame: Decodable {
        let time: Int
        let path: String
    }
    struct Radar: Decodable { let past: [Frame] }
    let host: String
    let radar: Radar

    var latestTileURL: String? {
        guard let frame = radar.past.last else { return nil }
        return "\(host)\(frame.path)/512/{z}/{x}/{y}/2/1_1.png"
    }
}
