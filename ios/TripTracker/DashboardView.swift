import SwiftUI
import MapKit

struct DashboardView: View {
    @EnvironmentObject private var store: FlightStore
    @State private var showAdd = false
    @State private var showSettings = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    header
                    if !store.hasFlightAwareKey {
                        Button { showSettings = true } label: {
                            Label("Add a FlightAware API key in Settings to enable live flight lookup.", systemImage: "key")
                                .font(.caption.bold())
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(Theme.paleTeal)
                        .panel(padding: 12)
                    }
                    if let error = store.errorMessage, !showAdd {
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: "exclamationmark.triangle")
                            Text(error).font(.caption)
                            Spacer(minLength: 0)
                            Button { store.errorMessage = nil } label: {
                                Image(systemName: "xmark.circle.fill")
                            }
                            .accessibilityLabel("Dismiss error")
                        }
                        .foregroundStyle(Theme.red)
                        .panel(padding: 12)
                    }
                    if !store.flights.isEmpty { trackedFlights }
                    if let flight = store.selected {
                        RouteMap(flight: flight)
                        FlightCard(flight: flight)
                        HStack(spacing: 12) {
                            WeatherCard(title: "Origin weather", airport: flight.origin, weather: store.weather[flight.origin.code])
                            WeatherCard(title: "Destination weather", airport: flight.destination, weather: store.weather[flight.destination.code])
                        }
                        enRoute(flight)
                        timeline(flight)
                    } else {
                        emptyState
                    }
                    Button { showAdd = true } label: {
                        Label("Track a Flight", systemImage: "magnifyingglass")
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                            .padding(14)
                    }
                    .buttonStyle(.plain)
                    .background(Theme.teal.gradient, in: RoundedRectangle(cornerRadius: 8))
                    .foregroundStyle(.white)
                }
                .padding(16)
            }
            .background(Theme.background)
            .toolbar(.hidden, for: .navigationBar)
            .refreshable { await store.refresh() }
            .sheet(isPresented: $showAdd) { AddFlightView() }
            .sheet(isPresented: $showSettings) { FlightSettingsView() }
            .task { await store.start() }
            .task {
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(30))
                    if !Task.isCancelled { await store.refresh() }
                }
            }
        }
        .tint(Theme.teal)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Image(systemName: "airplane")
                    .font(.system(size: 28, weight: .medium))
                    .rotationEffect(.degrees(-25))
                    .foregroundStyle(Theme.paleTeal)
                    .frame(width: 54, height: 54)
                    .background(Theme.panelSoft.gradient, in: RoundedRectangle(cornerRadius: 13))
                    .overlay(RoundedRectangle(cornerRadius: 13).stroke(Theme.teal.opacity(0.35)))
                VStack(alignment: .leading, spacing: 2) {
                    Text("LIVE FLIGHT INTELLIGENCE")
                        .font(.system(size: 10, weight: .heavy))
                        .tracking(1.3)
                        .foregroundStyle(Theme.teal)
                    Text("TripTracker")
                        .font(.system(size: 32, weight: .bold, design: .rounded))
                        .foregroundStyle(Theme.ink)
                    Text("TripTracker v0.1.2")
                        .font(.caption2.bold())
                        .foregroundStyle(Theme.paleTeal)
                }
                Spacer()
                Button { showAdd = true } label: {
                    Image(systemName: "plus")
                        .font(.title3.bold())
                        .frame(width: 42, height: 42)
                        .background(Theme.panelSoft, in: Circle())
                }
                .accessibilityLabel("Track a flight")
            }
            HStack(spacing: 10) {
                Image(systemName: "dot.radiowaves.left.and.right")
                    .foregroundStyle(Theme.teal)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Auto-refresh every 30 seconds while open")
                        .font(.caption.bold())
                        .foregroundStyle(Theme.paleTeal)
                    Text("Last refresh: \(store.lastRefresh?.formatted(date: .omitted, time: .shortened) ?? "Pending")")
                        .font(.caption2)
                        .foregroundStyle(Theme.muted)
                }
                Spacer()
                Button { showSettings = true } label: {
                    Image(systemName: "gearshape")
                        .font(.title3)
                        .frame(width: 42, height: 42)
                        .background(Theme.panel, in: Circle())
                }
                .accessibilityLabel("Flight data settings")
                if store.isBusy { ProgressView().tint(Theme.teal) }
            }
            .padding(12)
            .background(Theme.panelSoft, in: RoundedRectangle(cornerRadius: 8))
        }
        .panel()
    }

    private var trackedFlights: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Tracked Flights", systemImage: "airplane")
                .font(.subheadline.bold())
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 9) {
                    ForEach(store.flights) { flight in
                        HStack(spacing: 0) {
                            Button { Task { await store.select(flight.id) } } label: {
                                HStack(spacing: 8) {
                                    AirlineLogo(url: flight.airlineLogoUrl, code: flight.airlineCode, size: 32)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(flight.flightNumber).font(.subheadline.bold()).foregroundStyle(Theme.ink)
                                        Text(flight.timeZoneRoute).font(.caption2).foregroundStyle(Theme.muted)
                                        Text(flight.status).font(.caption2.bold()).foregroundStyle(Theme.teal)
                                    }
                                }
                                .padding(9)
                            }
                            Button(role: .destructive) { Task { await store.delete(flight) } } label: {
                                Image(systemName: "trash")
                                    .font(.caption)
                                    .foregroundStyle(Theme.red)
                                    .frame(width: 35, height: 52)
                            }
                            .accessibilityLabel("Delete \(flight.flightNumber)")
                        }
                        .background(Theme.panelSoft, in: RoundedRectangle(cornerRadius: 7))
                        .overlay(RoundedRectangle(cornerRadius: 7).stroke(flight.id == store.selected?.id ? Theme.teal : Theme.line))
                    }
                }
            }
        }
        .panel(padding: 12)
    }

    private var emptyState: some View {
        VStack(spacing: 15) {
            Image(systemName: "airplane")
                .font(.system(size: 42))
                .foregroundStyle(Theme.teal)
            Text("Add a flight to monitor")
                .font(.title2.bold())
            Text("Enter airline, flight number, and date to create a tracked trip with gate, weather, route, and status monitoring.")
                .font(.subheadline)
                .foregroundStyle(Theme.muted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 70)
        .panel()
    }

    private func enRoute(_ flight: FlightLeg) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("En Route", systemImage: "exclamationmark.triangle")
                .font(.headline)
            InfoRow(label: "Progress", value: "\(Int(flight.progress))%")
            InfoRow(label: "Altitude", value: flight.altitudeFt > 0 ? "\(Int(flight.altitudeFt).formatted()) ft" : "Pending")
            InfoRow(label: "Speed", value: flight.groundSpeedMph > 0 ? "\(Int(flight.groundSpeedMph)) mph" : "Pending")
            InfoRow(label: "Updated", value: FlightFormat.ago(flight.lastUpdated))
        }
        .panel()
    }

    private func timeline(_ flight: FlightLeg) -> some View {
        let route = FlightAlert(id: "route", type: "status", priority: "normal", title: "Route monitored", message: "\(flight.timeZoneRoute) is being watched for departure, gate, and arrival changes. Source: \(flight.dataSource).", timestamp: flight.lastUpdated)
        return VStack(alignment: .leading, spacing: 15) {
            Label("Flight Timeline", systemImage: "bell")
                .font(.headline)
            ForEach(Array((flight.alerts + [route]).enumerated()), id: \.element.id) { index, alert in
                HStack(alignment: .top, spacing: 12) {
                    Text("\(index + 1)")
                        .font(.caption.bold())
                        .foregroundStyle(Theme.background)
                        .frame(width: 25, height: 25)
                        .background(alert.priority == "critical" ? Theme.red : Theme.teal, in: Circle())
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(alert.priority.uppercased()).font(.caption2.bold()).foregroundStyle(Theme.teal)
                            Spacer()
                            Text(FlightFormat.ago(alert.timestamp)).font(.caption2).foregroundStyle(Theme.muted)
                        }
                        Text(alert.title).font(.subheadline.bold())
                        Text(alert.message).font(.caption).foregroundStyle(Theme.muted)
                    }
                }
            }
        }
        .panel()
    }
}

private struct InfoRow: View {
    let label: String
    let value: String
    var body: some View {
        HStack {
            Text(label).foregroundStyle(Theme.muted)
            Spacer()
            Text(value).fontWeight(.semibold).foregroundStyle(Theme.ink)
        }
        .font(.subheadline)
    }
}

private struct AirlineLogo: View {
    let url: String?
    let code: String
    let size: CGFloat
    var body: some View {
        Group {
            if let url, let imageURL = URL(string: url) {
                AsyncImage(url: imageURL) { image in image.resizable().scaledToFit().padding(4) }
                    placeholder: { Text(code).font(.caption.bold()).foregroundStyle(Theme.teal) }
            } else {
                Text(code).font(.caption.bold()).foregroundStyle(Theme.teal)
            }
        }
        .frame(width: size, height: size)
        .background(.white, in: RoundedRectangle(cornerRadius: 6))
    }
}

private struct FlightCard: View {
    let flight: FlightLeg
    var body: some View {
        VStack(alignment: .leading, spacing: 15) {
            HStack(spacing: 12) {
                AirlineLogo(url: flight.airlineLogoUrl, code: flight.airlineCode, size: 50)
                VStack(alignment: .leading, spacing: 1) {
                    Text(flight.airline).font(.caption).foregroundStyle(Theme.muted)
                    Text(flight.flightNumber).font(.system(size: 29, weight: .bold))
                    Text("\(flight.date) / \(flight.timeZoneRoute)").font(.caption2.bold()).foregroundStyle(Theme.muted)
                }
                Spacer()
            }
            HStack {
                Text(FlightFormat.statusLead(flight)).font(.subheadline.bold())
                Spacer()
                Text(flight.status.uppercased()).font(.caption2.bold())
            }
            .foregroundStyle(flight.status == "Cancelled" || flight.status == "Delayed" ? Theme.red : Color(red: 34/255, green: 199/255, blue: 111/255))
            .padding(12)
            .background(flight.status == "Cancelled" || flight.status == "Delayed" ? Color(red: 63/255, green: 23/255, blue: 18/255) : Color(red: 5/255, green: 59/255, blue: 36/255), in: RoundedRectangle(cornerRadius: 6))
            HStack(alignment: .top, spacing: 8) {
                airportStop(flight.origin, time: flight.departureTime)
                VStack(spacing: 5) {
                    Image(systemName: "airplane").foregroundStyle(Theme.teal)
                    Text("\(Int(flight.progress))%").font(.caption2.bold())
                    ProgressView(value: min(max(flight.progress, 0), 100), total: 100).tint(Theme.teal)
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 15)
                airportStop(flight.destination, time: flight.arrivalTime)
            }
            HStack {
                gate(label: "BOARDING", value: FlightFormat.gate(flight.terminal, flight.boardingGate))
                Spacer()
                gate(label: "ARRIVAL", value: FlightFormat.gate(flight.arrivalTerminal, flight.arrivalGate))
            }
            .padding(12)
            .background(Theme.panelSoft, in: RoundedRectangle(cornerRadius: 6))
            VStack(alignment: .leading, spacing: 7) {
                Label(flight.groundSpeedMph > 0 ? "\(Int(flight.groundSpeedMph)) mph" : "Speed pending", systemImage: "speedometer")
                Label(flight.altitudeFt > 0 ? "\(Int(flight.altitudeFt).formatted()) ft" : "Altitude pending", systemImage: "airplane")
                Label("Tail \(flight.tailNumber ?? "pending")", systemImage: "airplane.circle")
                Label("Inbound \(flight.inboundFrom?.code ?? "pending")", systemImage: "mappin")
                Label("Updated \(FlightFormat.ago(flight.lastUpdated))", systemImage: "clock")
            }
            .font(.caption)
            .foregroundStyle(Theme.muted)
            Text("Source: \(flight.dataSource)")
                .font(.caption2.bold())
                .foregroundStyle(Theme.muted)
            if let source = flight.sourceUrl, let url = URL(string: source) {
                Link("Open flight source", destination: url)
                    .font(.caption.bold())
            }
        }
        .panel()
    }

    private func airportStop(_ airport: Airport, time: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(airport.code).font(.caption.bold()).foregroundStyle(Theme.muted)
            Text(FlightFormat.time(time, zone: airport.timeZone))
                .font(.system(size: 19, weight: .bold))
                .foregroundStyle(Color(red: 35/255, green: 208/255, blue: 122/255))
                .minimumScaleFactor(0.7)
                .lineLimit(1)
            Text(airport.city).font(.caption2).foregroundStyle(Theme.muted).lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func gate(label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.caption2.bold()).foregroundStyle(Theme.muted)
            Text(value).font(.subheadline.bold()).foregroundStyle(Theme.ink)
        }
    }
}

private struct WeatherCard: View {
    let title: String
    let airport: Airport
    let weather: Weather.Current?

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text(title).font(.caption.bold()).foregroundStyle(Theme.paleTeal)
            Text(airport.code).font(.title2.bold())
            if let weather {
                Text("\(Int(weather.temperature_2m ?? 0))°F").font(.title3.bold())
                Text("Wind \(Int(weather.wind_speed_10m ?? 0)) mph")
                Text(condition(weather.weather_code))
            } else {
                Text("Loading weather…")
            }
            Text("Open-Meteo").font(.caption2).foregroundStyle(Theme.muted)
        }
        .font(.caption)
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel(padding: 12)
    }

    private func condition(_ code: Int?) -> String {
        switch code ?? -1 {
        case 0: "Clear"
        case 1: "Mostly clear"
        case 2: "Partly cloudy"
        case 3: "Overcast"
        case 45: "Fog"
        case 51: "Light drizzle"
        case 61: "Rain"
        case 71: "Snow"
        case 80: "Showers"
        case 95: "Thunderstorms"
        default: "Changing"
        }
    }
}

private struct RouteMap: View {
    let flight: FlightLeg
    @State private var radarEnabled = true
    @State private var radarTileURL: String?
    @State private var radarUnavailable = false
    @State private var runways: [AirportRunway] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("Live Route", systemImage: "map")
                    .font(.subheadline.bold())
                Spacer()
                Button {
                    radarEnabled.toggle()
                } label: {
                    Label(radarEnabled ? "Radar On" : "Radar Off", systemImage: "cloud.rain")
                        .font(.caption2.bold())
                        .foregroundStyle(radarEnabled ? Theme.paleTeal : Theme.muted)
                        .padding(7)
                        .background(Theme.panelSoft, in: Capsule())
                }
                .accessibilityLabel("Toggle weather radar")
            }
            NativeRouteMap(flight: flight, radarTileURL: radarEnabled ? radarTileURL : nil, runways: runways)
            .frame(height: 285)
            .clipShape(RoundedRectangle(cornerRadius: 7))
            .task(id: flight.id) {
                runways = APIClient().runways(for: [flight.origin.code, flight.destination.code])
                    .values.flatMap { $0 }
            }
            .task {
                while !Task.isCancelled {
                    do {
                        radarTileURL = try await RadarClient().latestTileURL()
                        radarUnavailable = false
                    } catch {
                        radarUnavailable = true
                    }
                    try? await Task.sleep(for: .seconds(30))
                }
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(flight.aircraftPosition?.source ?? "No aircraft position available")
                    .fontWeight(.semibold)
                    .foregroundStyle(Theme.ink)
                if let callsign = flight.aircraftPosition?.callsign {
                    Text("Callsign: \(callsign)")
                }
                Text("Altitude: \(flight.altitudeFt > 0 ? "\(Int(flight.altitudeFt).formatted()) ft" : "Unavailable")")
                Text("Radar: \(radarUnavailable ? "Unavailable" : radarEnabled ? "On" : "Off")")
            }
            .font(.caption)
            .foregroundStyle(Theme.muted)
            Text("Route source: \(flight.dataSource) · Radar: RainViewer · Runways: OurAirports")
                .font(.caption2)
                .foregroundStyle(Theme.muted)
        }
        .panel(padding: 12)
    }
}

private struct AddFlightView: View {
    @EnvironmentObject private var store: FlightStore
    @Environment(\.dismiss) private var dismiss
    @State private var airline = ""
    @State private var number = ""
    @State private var date = Date()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Label("Track a Flight", systemImage: "magnifyingglass")
                        .font(.title2.bold())
                        .foregroundStyle(Theme.paleTeal)
                    fieldLabel("AIRLINE")
                    TextField("Enter Airline", text: $airline)
                        .textInputAutocapitalization(.words)
                        .autocorrectionDisabled()
                        .textFieldStyle(.roundedBorder)
                    if !airline.isEmpty {
                        ForEach(AirlineCatalog.matches(airline)) { match in
                            Button {
                                airline = match.name
                            } label: {
                                HStack {
                                    Text(match.code).fontWeight(.bold).frame(width: 42, alignment: .leading)
                                    Text(match.name).lineLimit(1)
                                    Spacer()
                                }
                                .font(.subheadline)
                                .foregroundStyle(Theme.ink)
                                .padding(9)
                                .background(Theme.panelSoft, in: RoundedRectangle(cornerRadius: 6))
                            }
                        }
                    }
                    fieldLabel("FLIGHT NUMBER")
                    TextField("Enter flight number", text: $number)
                        .keyboardType(.numberPad)
                        .textFieldStyle(.roundedBorder)
                    fieldLabel("DATE")
                    DatePicker("Flight date", selection: $date, displayedComponents: .date)
                        .datePickerStyle(.compact)
                    Button {
                        Task {
                            await store.add(airline: AirlineCatalog.resolve(airline), number: number, date: date)
                            if store.errorMessage == nil && store.choices.isEmpty { dismiss() }
                        }
                    } label: {
                        HStack {
                            if store.isBusy { ProgressView().tint(.white) }
                            Text(store.isBusy ? "Checking" : "Track flight")
                        }
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(13)
                    }
                    .disabled(store.isBusy)
                    .buttonStyle(.plain)
                    .foregroundStyle(.white)
                    .background(Theme.teal.gradient, in: RoundedRectangle(cornerRadius: 7))
                    if let error = store.errorMessage {
                        Text(error).font(.subheadline).foregroundStyle(Theme.red)
                            .padding(12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Theme.red.opacity(0.1), in: RoundedRectangle(cornerRadius: 7))
                    }
                    ForEach(store.choices) { choice in
                        Button {
                            Task {
                                await store.choose(choice)
                                if store.errorMessage == nil { dismiss() }
                            }
                        } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(choice.timeZoneRoute).font(.headline)
                                Text("\(choice.origin.city) → \(choice.destination.city)")
                                Text("\(FlightFormat.time(choice.departureTime, zone: choice.origin.timeZone)) · \(choice.status)")
                            }
                            .font(.caption)
                            .foregroundStyle(Theme.ink)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .panel(padding: 12)
                        }
                    }
                }
                .padding(18)
            }
            .background(Theme.background)
            .navigationTitle("Track a Flight")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
        }
    }

    private func fieldLabel(_ text: String) -> some View {
        Text(text).font(.caption.bold()).foregroundStyle(Theme.muted)
    }
}
