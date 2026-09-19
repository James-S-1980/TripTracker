# TripTracker for iPhone

This is the native SwiftUI client for the existing TripTracker server. It does
not run a second backend. Flight lookups, shared tracked flights, server
monitoring, and untracking use the existing HTTP TripTracker API at
69.138.9.74:8080/trip/api.

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

## Backend connection

Port 8080 currently serves plain HTTP. iOS App Transport Security requires
an arbitrary-load exception for this public IP address. Traffic to the
TripTracker API is unencrypted; a public HTTPS hostname and certificate would
allow this exception to be removed later. Other services, including weather
and radar, use HTTPS.

## Local build

Set DEVELOPER_DIR to /Applications/Xcode.app/Contents/Developer and run
xcodebuild with the TripTracker scheme and an iPhone simulator destination.
