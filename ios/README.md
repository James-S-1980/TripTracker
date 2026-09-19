# TripTracker for iPhone

This native SwiftUI app runs without the TripTracker server at 69.138.9.74.
Flight lookup and tracking are handled on the iPhone. Tracked flights are
stored locally and do not sync to the web app or another phone. The runway and
airport catalogs are bundled with the app. Weather and radar still need an
internet connection and come directly from Open-Meteo and RainViewer.

## Flight data setup

Live flight status, gates, aircraft position, and inbound details come directly
from FlightAware AeroAPI over HTTPS. In the app, tap the gear icon, enter your
personal AeroAPI key, and tap Save key. The key is stored in iPhone Keychain and
is not included in the source code or app bundle. Get a key through
[FlightAware AeroAPI](https://www.flightaware.com/commercial/aeroapi/).
FlightAware may bill for API use. Active flights refresh every 30 seconds while
the app is open. Concluded and old flights stop automatic refresh. Pull down on
the dashboard to refresh active flights manually.

The app keeps existing locally cached flights across this update. Flights that
existed only on the old server do not transfer automatically. The old server
may continue its separate tracking and emails until you remove those flights
through the web app.

## Open and install

1. Open `TripTracker.xcodeproj` in Xcode.
2. Select the TripTracker target and choose your Apple development team under
   Signing & Capabilities. If needed, change the bundle identifier to one
   registered to your team.
3. Connect and trust your iPhone, select it as the run destination, and press
   Run. The app targets iOS 17 or later.

`project.yml` is the XcodeGen source for regenerating the checked-in Xcode
project. XcodeGen is not required to open or build it.

This app refreshes while open. iOS does not guarantee background refresh
intervals, so closed-app status checks and email delivery are outside this
on-device version.
