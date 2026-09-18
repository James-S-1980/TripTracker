import SwiftUI

struct NotificationsView: View {
    @EnvironmentObject private var store: FlightStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if store.notifications.isEmpty {
                        VStack(spacing: 12) {
                            Image(systemName: "bell")
                                .font(.system(size: 38))
                                .foregroundStyle(Theme.teal)
                            Text("No flight notifications yet")
                                .font(.headline)
                            Text("Tracking, status, gate, time, aircraft, inbound, and conclusion events will appear here after the server sends its matching email.")
                                .font(.subheadline)
                                .foregroundStyle(Theme.muted)
                                .multilineTextAlignment(.center)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 80)
                        .panel()
                    } else {
                        ForEach(store.notifications) { notification in
                            Button {
                                store.markNotificationRead(notification.id)
                                if let flight = store.flights.first(where: { $0.flightNumber == notification.flightNumber }) {
                                    Task { await store.select(flight.id) }
                                }
                                dismiss()
                            } label: {
                                HStack(alignment: .top, spacing: 10) {
                                    Image(systemName: notification.isRead ? "bell" : "bell.badge.fill")
                                        .foregroundStyle(Theme.teal)
                                        .frame(width: 22)
                                    VStack(alignment: .leading, spacing: 5) {
                                        Text(notification.title)
                                            .font(.subheadline.bold())
                                            .foregroundStyle(Theme.ink)
                                        Text(notification.body)
                                            .font(.caption)
                                            .foregroundStyle(Theme.muted)
                                        Text(FlightFormat.ago(notification.timestamp))
                                            .font(.caption2)
                                            .foregroundStyle(Theme.muted)
                                    }
                                    Spacer(minLength: 0)
                                }
                                .panel(padding: 14)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 10)
                                        .stroke(notification.isRead ? Theme.line : Theme.teal.opacity(0.55))
                                )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding(16)
            }
            .background(Theme.background)
            .navigationTitle("Flight Notifications")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if store.unreadNotificationCount > 0 {
                        Button("Mark all read") { store.markAllNotificationsRead() }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
