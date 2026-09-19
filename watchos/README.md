# TripTracker for Apple Watch

This native watchOS app displays the flights tracked by the existing TripTracker
server at `http://69.138.9.74:8087/trip/api/tracked-flights`. It shows flight
number, route, status, departure and arrival gates, completion percentage,
last flight update time, and departure and arrival times in each airport's local
time zone. The list refreshes every 30 seconds while the watch app is open, and
a Refresh button is available. The last successful list is cached on the watch
for times when the server is unreachable.

Track or remove flights using the iPhone or web app. The watch app reads the
shared server list; it does not edit it. watchOS suspends background apps, so
30-second refresh is available only while the watch app is active.

Open `TripTrackerWatch.xcodeproj` in Xcode, select the TripTrackerWatch scheme,
then choose a paired Apple Watch or watchOS simulator and Run. The project
requires watchOS 10 or later. `project.yml` is the XcodeGen source for the
checked-in project.

The server uses plain HTTP on port 8087. The watch target includes an App
Transport Security exception for this endpoint. A trusted HTTPS hostname is
recommended for future hosting.
