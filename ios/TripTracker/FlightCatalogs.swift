import Foundation

enum FlightCatalogs {
    static let airports: [String: Airport] = {
        guard let url = Bundle.main.url(forResource: "airportCatalog", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let airports = try? JSONDecoder().decode([Airport].self, from: data) else { return [:] }
        return Dictionary(uniqueKeysWithValues: airports.map { ($0.code, $0) })
    }()

    static let runways: [String: [AirportRunway]] = {
        guard let url = Bundle.main.url(forResource: "runwayCatalog", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let catalog = try? JSONDecoder().decode([String: [AirportRunway]].self, from: data) else { return [:] }
        return catalog
    }()

    static func airport(_ raw: [String: Any]?) -> Airport? {
        guard let raw else { return nil }
        let code = [raw["code_iata"], raw["code"], raw["iata"], raw["icao"]]
            .compactMap { $0 as? String }.first { !$0.isEmpty }?
            .replacingOccurrences(of: "^K(?=[A-Z]{3}$)", with: "", options: .regularExpression)
            .uppercased() ?? ""
        guard !code.isEmpty else { return nil }
        if let known = airports[code] { return known }
        return Airport(
            code: code,
            name: raw["name"] as? String ?? "\(code) Airport",
            city: raw["city"] as? String ?? code,
            lat: (raw["latitude"] as? NSNumber)?.doubleValue ?? 0,
            lon: (raw["longitude"] as? NSNumber)?.doubleValue ?? 0,
            timeZone: raw["timezone"] as? String ?? "UTC"
        )
    }
}
