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

## Flight notifications

The bell in the header opens a native notification inbox. While the app is
open, it checks the existing server notification history every 30 seconds and
shows a local alert for newly emailed tracking, update, and conclusion events.
The first launch establishes a baseline so old events do not all alert at once.

Closed-app alerts use Apple Push Notifications (APNs). They need an Apple
Developer Program team, a registered bundle ID with Push Notifications enabled,
and an APNs Auth Key (.p8). A free Personal Team cannot deliver APNs pushes.
The app has development and production push entitlements for Debug and Release.
The simulator build can verify compilation; use a signed iPhone build to test
actual delivery.

1. In Apple Developer, enable Push Notifications on this app's bundle ID, create
   an APNs Auth Key, and record its Team ID and Key ID. Keep the .p8 file only
   on the server. Never add it to Git.
2. On the server, set `TRIPTRACKER_APNS_TEAM_ID`,
   `TRIPTRACKER_APNS_KEY_ID`, `TRIPTRACKER_APNS_KEY_PATH` (absolute path to the
   .p8 file), and `TRIPTRACKER_APNS_BUNDLE_ID` (the signed app bundle ID).
   Set `TRIPTRACKER_PUSH_REGISTRATION_SECRET` to a long random secret. The
   Windows startup script reads these from User environment variables.
3. Give the iOS build the same registration secret through the
   `TRIPTRACKER_PUSH_REGISTRATION_SECRET` build setting. For a local command
   line build, pass it to `xcodebuild` as a build setting. In Xcode, set that
   user-defined target build setting locally. The value is substituted into
   the app Info.plist; keep it out of committed project files.
4. Deploy the updated `server.js` and `pushNotifications.js` to the existing
   backend, sign and install the app, grant notification permission, and track
   a flight. APNs sends alerts for the same successfully emailed events.

The registration secret limits who can subscribe to personal flight alerts,
but the current port 8080 connection is plain HTTP, so it does not protect the
secret or device token in transit. Configure a trusted HTTPS endpoint before
using push registration across an untrusted network.
