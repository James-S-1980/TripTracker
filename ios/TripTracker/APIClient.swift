import Foundation

struct APIClient {
    // Existing TripTracker HTTP server. Change this to HTTPS when the hosted
    // service has a certificate valid for its public hostname.
    static let baseURL = URL(string: "http://69.138.9.74:8087/trip/api")!
    private let session = URLSession.shared
    private let decoder = JSONDecoder()

    func lookup(airline: String, number: String, date: String, track: Bool = false, monitor: Bool = false, flightID: String? = nil) async throws -> LookupResult {
        var query = [
            URLQueryItem(name: "airline", value: airline.uppercased()),
            URLQueryItem(name: "flightNumber", value: number),
            URLQueryItem(name: "date", value: date)
        ]
        if track { query.append(.init(name: "track", value: "true")) }
        if monitor { query.append(.init(name: "monitor", value: "true")) }
        if let flightID { query.append(.init(name: "flightId", value: flightID)) }
        let (data, status) = try await get("flights/lookup", query: query)
        if let choices = try? decoder.decode(LookupChoices.self, from: data), choices.ambiguous {
            return .choices(choices)
        }
        guard (200..<300).contains(status) else { throw decodeError(data, status: status) }
        return .flight(try decoder.decode(FlightLeg.self, from: data))
    }

    func trackedFlights() async throws -> [FlightLeg] {
        let (data, status) = try await get("tracked-flights")
        guard (200..<300).contains(status) else { throw decodeError(data, status: status) }
        return try decoder.decode(TrackedFlightResponse.self, from: data).flights
    }

    func register(_ flights: [FlightLeg]) async throws {
        guard !flights.isEmpty else { return }
        try await post("notifications/register-tracked", body: ["flights": flights])
    }

    func untrack(_ flight: FlightLeg) async throws {
        try await post("notifications/untrack", body: ["flight": flight])
    }

    func runways(for airports: [String]) async throws -> [String: [AirportRunway]] {
        let (data, status) = try await get("runways", query: [
            .init(name: "airports", value: airports.joined(separator: ","))
        ])
        guard (200..<300).contains(status) else { throw decodeError(data, status: status) }
        return try decoder.decode([String: [AirportRunway]].self, from: data)
    }

    private func get(_ path: String, query: [URLQueryItem] = []) async throws -> (Data, Int) {
        var components = URLComponents(url: Self.baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        components.queryItems = query.isEmpty ? nil : query
        let (data, response) = try await session.data(from: components.url!)
        return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
    }

    private func post<T: Encodable>(_ path: String, body: T) async throws {
        var request = URLRequest(url: Self.baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else { throw decodeError(data, status: status) }
    }

    private func decodeError(_ data: Data, status: Int) -> Error {
        let message = (try? decoder.decode(APIError.self, from: data).message) ?? ""
        return NSError(domain: "TripTracker", code: status, userInfo: [NSLocalizedDescriptionKey: message.isEmpty ? "Server returned HTTP \(status)." : message])
    }
}

struct RadarClient {
    func latestTileURL() async throws -> String {
        let url = URL(string: "https://api.rainviewer.com/public/weather-maps.json")!
        let (data, response) = try await URLSession.shared.data(from: url)
        guard (response as? HTTPURLResponse)?.statusCode == 200,
              let template = try JSONDecoder().decode(RainViewerResponse.self, from: data).latestTileURL else {
            throw URLError(.badServerResponse)
        }
        return template
    }
}

struct WeatherClient {
    func fetch(_ airport: Airport) async throws -> Weather.Current {
        var components = URLComponents(string: "https://api.open-meteo.com/v1/forecast")!
        components.queryItems = [
            .init(name: "latitude", value: String(airport.lat)),
            .init(name: "longitude", value: String(airport.lon)),
            .init(name: "current", value: "temperature_2m,wind_speed_10m,precipitation,weather_code"),
            .init(name: "temperature_unit", value: "fahrenheit"),
            .init(name: "wind_speed_unit", value: "mph")
        ]
        let (data, response) = try await URLSession.shared.data(from: components.url!)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }
        return try JSONDecoder().decode(Weather.self, from: data).current ?? .init(temperature_2m: nil, wind_speed_10m: nil, precipitation: nil, weather_code: nil)
    }
}
