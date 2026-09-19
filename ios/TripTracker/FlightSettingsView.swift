import SwiftUI

struct FlightSettingsView: View {
    @EnvironmentObject private var store: FlightStore
    @Environment(\.dismiss) private var dismiss
    @State private var key = ""
    @State private var message: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Flight data") {
                    Label(store.hasFlightAwareKey ? "AeroAPI key saved on this iPhone" : "AeroAPI key needed", systemImage: store.hasFlightAwareKey ? "checkmark.shield" : "key")
                    SecureField("FlightAware AeroAPI key", text: $key)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Button("Save key") {
                        do {
                            try FlightAwareKey.save(key)
                            key = ""
                            store.keyChanged()
                            message = "Key saved. Flight lookups now use AeroAPI directly."
                        } catch { message = error.localizedDescription }
                    }
                    .disabled(key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    if store.hasFlightAwareKey {
                        Button("Remove key", role: .destructive) {
                            FlightAwareKey.remove()
                            store.keyChanged()
                            message = "Key removed from this iPhone."
                        }
                    }
                    if let message { Text(message).font(.caption).foregroundStyle(Theme.muted) }
                }
                Section {
                    Text("Get a personal AeroAPI key from FlightAware, then paste it above. The key stays in this iPhone's Keychain. FlightAware may charge for API requests. Tracked flights stay on this device and refresh every 30 seconds while the app is open.")
                        .font(.caption)
                    Link("FlightAware AeroAPI", destination: URL(string: "https://www.flightaware.com/commercial/aeroapi/")!)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle("Flight Data Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
        }
        .preferredColorScheme(.dark)
    }
}
