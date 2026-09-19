import SwiftUI

private enum WatchStyle {
    static let teal = Color(red: 0.38, green: 0.84, blue: 0.80)
    static let muted = Color(red: 0.68, green: 0.74, blue: 0.77)
    static let card = Color(red: 0.09, green: 0.13, blue: 0.16)
}

struct FlightListView: View {
    @EnvironmentObject private var store: FlightWatchStore

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Label("TripTracker", systemImage: "airplane")
                            .font(.headline)
                            .foregroundStyle(WatchStyle.teal)
                        Spacer(minLength: 0)
                        if store.isRefreshing { ProgressView().scaleEffect(0.7) }
                    }
                    if let error = store.errorMessage {
                        Text(error).font(.caption2).foregroundStyle(.orange)
                    }
                    if store.flights.isEmpty {
                        VStack(spacing: 8) {
                            Image(systemName: "airplane.circle")
                                .font(.largeTitle)
                                .foregroundStyle(WatchStyle.teal)
                            Text("No tracked flights")
                                .font(.headline)
                            Text("Track a flight on your iPhone or in the web app.")
                                .font(.caption2)
                                .multilineTextAlignment(.center)
                                .foregroundStyle(WatchStyle.muted)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 18)
                    } else {
                        ForEach(store.flights) { flight in
                            NavigationLink(value: flight) {
                                FlightRow(flight: flight)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    Button {
                        Task { await store.refresh() }
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                            .font(.caption)
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    if let date = store.lastRefresh {
                        Text("Updated \(date.formatted(date: .omitted, time: .shortened))")
                            .font(.caption2)
                            .foregroundStyle(WatchStyle.muted)
                            .frame(maxWidth: .infinity)
                    }
                }
                .padding(.horizontal, 4)
            }
            .navigationDestination(for: WatchFlight.self) { FlightDetailView(flight: $0) }
            .task {
                await store.refresh()
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(30))
                    if !Task.isCancelled { await store.refresh() }
                }
            }
        }
    }
}

private struct FlightRow: View {
    let flight: WatchFlight

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(flight.flightNumber).font(.headline).foregroundStyle(.white)
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.caption2).foregroundStyle(WatchStyle.muted)
            }
            Text(flight.route).font(.caption).foregroundStyle(WatchStyle.teal)
            Text(flight.status).font(.caption2.bold()).foregroundStyle(flight.status == "Delayed" || flight.status == "Cancelled" ? .orange : WatchStyle.muted)
            HStack {
                Text("DEP \(flight.departureLabel())")
                Spacer(minLength: 2)
                Text("ARR \(flight.arrivalLabel())")
            }
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(.white)
        }
        .padding(9)
        .background(WatchStyle.card, in: RoundedRectangle(cornerRadius: 10))
    }
}

private struct FlightDetailView: View {
    let flight: WatchFlight

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text(flight.flightNumber)
                    .font(.title3.bold())
                Text(flight.route)
                    .font(.headline)
                    .foregroundStyle(WatchStyle.teal)
                Label(flight.status, systemImage: "airplane")
                    .font(.subheadline.bold())
                timeBlock("Departure", airport: flight.origin.code, time: flight.departureLabel())
                timeBlock("Arrival", airport: flight.destination.code, time: flight.arrivalLabel())
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 4)
        }
    }

    private func timeBlock(_ title: String, airport: String, time: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("\(title) · \(airport)").font(.caption2).foregroundStyle(WatchStyle.muted)
            Text(time).font(.title3.bold()).foregroundStyle(.white)
            Text("Local airport time").font(.system(size: 10)).foregroundStyle(WatchStyle.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(9)
        .background(WatchStyle.card, in: RoundedRectangle(cornerRadius: 10))
    }
}
