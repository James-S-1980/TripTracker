import Foundation

struct APIClient {
    private let baseURL = URL(string: "https://aeroapi.flightaware.com/aeroapi")!
    private let session = URLSession.shared

    func lookup(airline: String, number: String, date: String, track: Bool = false, monitor: Bool = false, flightID: String? = nil) async throws -> LookupResult {
        guard let key = FlightAwareKey.read(), !key.isEmpty else { throw FlightDataError.missingKey }
        let code = AirlineCatalog.resolve(airline)
        let icao = AirlineCatalog.all.first { $0.code == code && !$0.icao.isEmpty }?.icao ?? code
        let ident = "\(icao)\(number)"
        let flights: [[String: Any]]
        if let flightID {
            flights = try await requestFlights(path: "flights/\(flightID)", key: key)
        } else {
            var components = URLComponents()
            components.queryItems = [
                .init(name: "ident_type", value: "designator"),
                .init(name: "start", value: Self.dayOffset(date, -1)),
                .init(name: "end", value: Self.dayOffset(date, 2)),
                .init(name: "max_pages", value: "1")
            ]
            flights = try await requestFlights(path: "flights/\(ident)", query: components.percentEncodedQuery, key: key)
        }
        let exactDate = flights.filter { Self.departureDay($0) == date }
        let candidates = exactDate.isEmpty ? flights.filter { Self.matchesDate($0, date: date) } : exactDate
        guard !candidates.isEmpty else { throw FlightDataError.notFound(ident, date) }
        let mapped = candidates.compactMap { try? Self.mapFlight($0, date: date, airlineCode: code, number: number) }
        guard !mapped.isEmpty else { throw FlightDataError.incomplete }
        if track && flightID == nil && mapped.count > 1 {
            return .choices(.init(ambiguous: true, flights: mapped, message: "\(mapped.count) matching \(code) \(number) flights were found for \(date). Select the route you want to track."))
        }
        var selected = mapped.first!
        if selected.status == "En Route" {
            let positions = (try? await requestPositions(for: selected.id, key: key)) ?? []
            let last = positions.last
            selected = selected.withTelemetry(position: last, track: positions)
        }
        if let raw = candidates.first, let inboundID = raw["inbound_fa_flight_id"] as? String,
           let inbound = try? await requestFlights(path: "flights/\(inboundID)", key: key).first,
           let inboundOrigin = FlightCatalogs.airport(inbound["origin"] as? [String: Any]) {
            selected = selected.withInbound(
                origin: inboundOrigin,
                number: (inbound["ident_iata"] as? String) ?? (inbound["ident"] as? String),
                status: Self.status(inbound)
            )
        }
        return .flight(selected)
    }

    func runways(for airports: [String]) -> [String: [AirportRunway]] {
        Dictionary(uniqueKeysWithValues: airports.map { ($0, FlightCatalogs.runways[$0] ?? []) })
    }

    private func requestFlights(path: String, query: String? = nil, key: String) async throws -> [[String: Any]] {
        let payload = try await request(path: path, query: query, key: key)
        if let flights = payload["flights"] as? [[String: Any]] { return flights }
        if payload["fa_flight_id"] != nil { return [payload] }
        return []
    }

    private func requestPositions(for id: String, key: String) async throws -> [AircraftPosition] {
        let payload = try await request(path: "flights/\(id)/track", query: "include_estimated_positions=true", key: key)
        let raw = (payload["positions"] ?? payload["track"]) as? [[String: Any]] ?? []
        return raw.compactMap(Self.mapPosition)
    }

    private func request(path: String, query: String? = nil, key: String) async throws -> [String: Any] {
        var components = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        components.percentEncodedQuery = query
        var request = URLRequest(url: components.url!)
        request.setValue(key, forHTTPHeaderField: "x-apikey")
        request.timeoutInterval = 20
        let (data, response) = try await session.data(for: request)
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else {
            if code == 401 || code == 403 { throw FlightDataError.invalidKey }
            if code == 402 { throw FlightDataError.paymentRequired }
            if code == 429 { throw FlightDataError.rateLimited }
            throw FlightDataError.provider(code)
        }
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw FlightDataError.incomplete }
        return object
    }

    private static func dayOffset(_ date: String, _ offset: Int) -> String {
        guard let original = ISO8601DateFormatter.tripDay.date(from: date),
              let shifted = Calendar(identifier: .gregorian).date(byAdding: .day, value: offset, to: original) else { return date }
        return ISO8601DateFormatter.tripDay.string(from: shifted)
    }

    private static func departureDay(_ flight: [String: Any]) -> String? {
        ["scheduled_out", "scheduled_off", "estimated_out", "estimated_off", "actual_out", "actual_off"]
            .compactMap { flight[$0] as? String }.first.map { String($0.prefix(10)) }
    }

    private static func matchesDate(_ flight: [String: Any], date: String) -> Bool {
        guard let departure = departureDay(flight) else { return false }
        return Set([dayOffset(date, -1), date, dayOffset(date, 1)]).contains(departure)
    }

    static func mapFlight(_ raw: [String: Any], date: String, airlineCode: String, number: String) throws -> FlightLeg {
        guard let id = raw["fa_flight_id"] as? String,
              let origin = FlightCatalogs.airport(raw["origin"] as? [String: Any]),
              let destination = FlightCatalogs.airport(raw["destination"] as? [String: Any]),
              let departure = ["actual_out", "estimated_out", "scheduled_out", "actual_off", "estimated_off", "scheduled_off"].compactMap({ raw[$0] as? String }).first,
              let arrival = ["actual_in", "estimated_in", "scheduled_in", "actual_on", "estimated_on", "scheduled_on"].compactMap({ raw[$0] as? String }).first else { throw FlightDataError.incomplete }
        let state = status(raw)
        let brand = AirlineCatalog.all.first { $0.code == airlineCode }
        let progress = (raw["progress_percent"] as? NSNumber)?.doubleValue ?? (state == "Arrived" ? 100 : state == "En Route" ? 50 : 0)
        let alert = FlightAlert(id: "\(id)-status", type: "status", priority: ["Delayed", "Cancelled"].contains(state) ? "critical" : "normal", title: state, message: raw["status"] as? String ?? "FlightAware reports \(state.lowercased()) status.", timestamp: Self.now)
        return FlightLeg(
            id: id, airline: raw["operator"] as? String ?? brand?.name ?? airlineCode,
            airlineCode: airlineCode, airlineLogoUrl: brand?.logoUrl,
            flightNumber: "\(airlineCode) \(number)", date: date,
            origin: origin, destination: destination, departureTime: departure, arrivalTime: arrival,
            boardingGate: useful(raw["gate_origin"]), arrivalGate: useful(raw["gate_destination"]),
            terminal: useful(raw["terminal_origin"]), arrivalTerminal: useful(raw["terminal_destination"]),
            status: state, progress: progress,
            altitudeFt: ((raw["filed_altitude"] as? NSNumber)?.doubleValue ?? 0) * 100,
            groundSpeedMph: ((raw["filed_airspeed"] as? NSNumber)?.doubleValue ?? 0) * 1.15078,
            tailNumber: optional(raw["registration"]), inboundFrom: nil, inboundFlightNumber: nil,
            inboundStatus: nil, inboundSource: nil, aircraftPosition: nil, track: nil,
            lastUpdated: now, dataSource: "FlightAware AeroAPI", sourceUrl: nil,
            landedAt: state == "Arrived" ? now : nil, alerts: [alert]
        )
    }

    private static func mapPosition(_ raw: [String: Any]) -> AircraftPosition? {
        guard let lat = ((raw["latitude"] ?? raw["lat"]) as? NSNumber)?.doubleValue,
              let lon = ((raw["longitude"] ?? raw["lon"]) as? NSNumber)?.doubleValue else { return nil }
        let altitude = ((raw["altitude"] ?? raw["altitude_ft"]) as? NSNumber)?.doubleValue
        let speed = ((raw["groundspeed"] ?? raw["groundspeed_mph"]) as? NSNumber)?.doubleValue
        return AircraftPosition(lat: lat, lon: lon, altitudeFt: altitude.map { $0 > 1000 ? $0 : $0 * 100 },
            groundSpeedMph: speed.map { $0 * 1.15078 }, headingDeg: ((raw["heading"] ?? raw["course"]) as? NSNumber)?.doubleValue,
            timestamp: (raw["timestamp"] ?? raw["time"]) as? String, source: "FlightAware track", callsign: nil)
    }

    static func status(_ raw: [String: Any]) -> String {
        if raw["cancelled"] as? Bool == true { return "Cancelled" }
        if present(raw["actual_in"]) || present(raw["actual_on"]) { return "Arrived" }
        if present(raw["actual_off"]) || ((raw["progress_percent"] as? NSNumber)?.doubleValue ?? 0) > 0 { return "En Route" }
        let text = (raw["status"] as? String ?? "").lowercased()
        if text.contains("delay") { return "Delayed" }
        if present(raw["actual_out"]) { return "Boarding" }
        return "Scheduled"
    }

    private static func present(_ value: Any?) -> Bool { value != nil && !(value is NSNull) }

    private static func optional(_ value: Any?) -> String? {
        guard let text = value as? String, !text.isEmpty, !["unknown", "tbd", "n/a", "null"].contains(text.lowercased()) else { return nil }
        return text
    }
    private static func useful(_ value: Any?) -> String { optional(value) ?? "TBD" }
    private static var now: String { ISO8601DateFormatter().string(from: Date()) }
}

private extension ISO8601DateFormatter {
    static let tripDay: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter
    }()
}

private extension FlightLeg {
    func withTelemetry(position: AircraftPosition?, track: [AircraftPosition]) -> FlightLeg {
        FlightLeg(id: id, airline: airline, airlineCode: airlineCode, airlineLogoUrl: airlineLogoUrl,
            flightNumber: flightNumber, date: date, origin: origin, destination: destination,
            departureTime: departureTime, arrivalTime: arrivalTime, boardingGate: boardingGate,
            arrivalGate: arrivalGate, terminal: terminal, arrivalTerminal: arrivalTerminal,
            status: status, progress: progress, altitudeFt: position?.altitudeFt ?? altitudeFt,
            groundSpeedMph: position?.groundSpeedMph ?? groundSpeedMph, tailNumber: tailNumber,
            inboundFrom: inboundFrom, inboundFlightNumber: inboundFlightNumber, inboundStatus: inboundStatus,
            inboundSource: inboundSource, aircraftPosition: position, track: track,
            lastUpdated: lastUpdated, dataSource: dataSource, sourceUrl: sourceUrl, landedAt: landedAt, alerts: alerts)
    }

    func withInbound(origin: Airport, number: String?, status: String) -> FlightLeg {
        FlightLeg(id: id, airline: airline, airlineCode: airlineCode, airlineLogoUrl: airlineLogoUrl,
            flightNumber: flightNumber, date: date, origin: self.origin, destination: destination,
            departureTime: departureTime, arrivalTime: arrivalTime, boardingGate: boardingGate,
            arrivalGate: arrivalGate, terminal: terminal, arrivalTerminal: arrivalTerminal,
            status: self.status, progress: progress, altitudeFt: altitudeFt,
            groundSpeedMph: groundSpeedMph, tailNumber: tailNumber,
            inboundFrom: origin, inboundFlightNumber: number, inboundStatus: status,
            inboundSource: "FlightAware AeroAPI", aircraftPosition: aircraftPosition, track: track,
            lastUpdated: lastUpdated, dataSource: dataSource, sourceUrl: sourceUrl, landedAt: landedAt, alerts: alerts)
    }
}

enum FlightDataError: LocalizedError {
    case missingKey, invalidKey, paymentRequired, rateLimited, incomplete
    case notFound(String, String), provider(Int)
    var errorDescription: String? {
        switch self {
        case .missingKey: "Add your FlightAware AeroAPI key in Settings to look up flights."
        case .invalidKey: "FlightAware rejected the AeroAPI key. Check it in Settings."
        case .paymentRequired: "FlightAware billing is required for this AeroAPI request."
        case .rateLimited: "FlightAware's request limit was reached. Try again later."
        case .incomplete: "FlightAware returned incomplete flight details."
        case .notFound(let ident, let date): "No flight found for \(ident) on \(date)."
        case .provider(let status): "FlightAware returned HTTP \(status)."
        }
    }
}

struct RadarClient {
    func latestTileURL() async throws -> String {
        let url = URL(string: "https://api.rainviewer.com/public/weather-maps.json")!
        let (data, response) = try await URLSession.shared.data(from: url)
        guard (response as? HTTPURLResponse)?.statusCode == 200,
              let template = try JSONDecoder().decode(RainViewerResponse.self, from: data).latestTileURL else { throw URLError(.badServerResponse) }
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
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
        return try JSONDecoder().decode(Weather.self, from: data).current ?? .init(temperature_2m: nil, wind_speed_10m: nil, precipitation: nil, weather_code: nil)
    }
}
