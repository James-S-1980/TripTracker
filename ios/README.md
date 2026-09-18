# TripTracker for iPhone

This is the native SwiftUI client for the existing TripTracker server. It does
not run a second backend. Flight lookups, shared tracked flights, server
monitoring, and untracking use the existing HTTPS TripTracker API at
69.138.9.74:8443/trip/api.

The iPhone screen follows the web app's dark teal design: tracked flights,
route map with RainViewer radar and airport runway overlays, flight status
card, gates, weather, en route facts, and alert timeline. Airline suggestions
use a bundled copy of the web airline catalog.
Airport weather uses Open-Meteo, as the web app does.

## Open and install

1. Open TripTracker.xcodeproj in Xcode.
2. Select the TripTracker target and set Signing & Capabilities → Team
   to your Apple development team. If Xcode reports that the bundle ID is
   taken, change it to an ID registered to your team.
3. Connect and trust your iPhone, choose it as the run destination, and press
   Run. Your iPhone must be able to reach the server.

The project targets iOS 17 or later. project.yml is the XcodeGen source used
to regenerate the checked-in Xcode project, but XcodeGen is not needed just to
open or build the project.

## Backend TLS

iOS validates the server's HTTPS certificate. A certificate for a DNS name
usually will not validate for the bare IP address above. If the server has a
certificate for a DNS name, change APIClient.baseURL to that HTTPS name and
keep the same /trip/api path. The app deliberately does not disable
certificate validation. The server was not reachable from the development Mac
while this client was built, so live API behavior must be verified once the
server is available.

## Local build

Set DEVELOPER_DIR to /Applications/Xcode.app/Contents/Developer and run
xcodebuild with the TripTracker scheme and an iPhone simulator destination.
