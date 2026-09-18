import SwiftUI

enum Theme {
    static let background = Color(red: 8/255, green: 12/255, blue: 17/255)
    static let panel = Color(red: 17/255, green: 24/255, blue: 32/255)
    static let panelSoft = Color(red: 23/255, green: 33/255, blue: 42/255)
    static let line = Color(red: 38/255, green: 51/255, blue: 58/255)
    static let ink = Color(red: 238/255, green: 247/255, blue: 244/255)
    static let muted = Color(red: 148/255, green: 168/255, blue: 163/255)
    static let teal = Color(red: 79/255, green: 209/255, blue: 197/255)
    static let paleTeal = Color(red: 159/255, green: 245/255, blue: 236/255)
    static let amber = Color(red: 247/255, green: 201/255, blue: 72/255)
    static let red = Color(red: 255/255, green: 139/255, blue: 123/255)
}

extension View {
    func panel(padding: CGFloat = 16) -> some View {
        self.padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.panel, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.line, lineWidth: 1))
    }
}

enum FlightFormat {
    private static func parse(_ iso: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let value = formatter.date(from: iso) { return value }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: iso)
    }

    static func time(_ iso: String, zone: String) -> String {
        guard let date = parse(iso) else { return "Pending" }
        let formatter = DateFormatter()
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        formatter.timeZone = TimeZone(identifier: zone) ?? .current
        return formatter.string(from: date)
    }

    static func ago(_ iso: String) -> String {
        guard let date = parse(iso) else { return "Pending" }
        let minutes = max(1, Int(Date().timeIntervalSince(date) / 60))
        return "\(minutes) min ago"
    }

    static func gate(_ terminal: String, _ gate: String) -> String {
        let values = [terminal, gate].filter { !$0.isEmpty && $0 != "—" && $0.lowercased() != "pending" }
        return values.isEmpty ? "Pending" : values.joined(separator: " / ")
    }

    static func statusLead(_ flight: FlightLeg) -> String {
        switch flight.status {
        case "En Route": return "Flight is in the air"
        case "Boarding": return "Boarding now"
        case "Delayed": return "Flight delayed"
        case "Landed", "Arrived": return "Flight has landed"
        case "Cancelled": return "Flight cancelled"
        default: return "Flight is scheduled"
        }
    }
}
