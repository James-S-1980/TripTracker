import Foundation

struct Airline: Decodable, Identifiable {
    let code: String
    let icao: String
    let name: String
    let callsign: String
    let country: String
    let aliases: [String]
    let logoUrl: String
    var id: String { code }
}

enum AirlineCatalog {
    static let all: [Airline] = {
        guard let url = Bundle.main.url(forResource: "airlineCatalog", withExtension: "json"),
              let data = try? Data(contentsOf: url) else { return [] }
        return (try? JSONDecoder().decode([Airline].self, from: data)) ?? []
    }()

    static func matches(_ text: String) -> [Airline] {
        let query = text.trimmingCharacters(in: .whitespaces).lowercased()
        guard !query.isEmpty else { return [] }
        return all.compactMap { airline -> (Airline, Int)? in
            let code = airline.code.lowercased()
            let icao = airline.icao.lowercased()
            let name = airline.name.lowercased()
            let aliases = airline.aliases.map { $0.lowercased() }
            let score: Int
            if [code, icao, name].contains(query) || aliases.contains(query) { score = 0 }
            else if code.hasPrefix(query) { score = 1 }
            else if icao.hasPrefix(query) { score = 2 }
            else if name.hasPrefix(query) { score = 3 }
            else if airline.callsign.lowercased().hasPrefix(query) { score = 4 }
            else if name.contains(query) { score = 5 }
            else { return nil }
            return (airline, score)
        }.sorted { $0.1 == $1.1 ? $0.0.name < $1.0.name : $0.1 < $1.1 }.prefix(6).map(\.0)
    }

    static func resolve(_ text: String) -> String {
        matches(text).first?.code ?? String(text.trimmingCharacters(in: .whitespaces).uppercased().prefix(3))
    }
}
