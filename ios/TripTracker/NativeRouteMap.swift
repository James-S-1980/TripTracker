import SwiftUI
import MapKit

struct NativeRouteMap: UIViewRepresentable {
    let flight: FlightLeg
    let radarTileURL: String?
    let runways: [AirportRunway]

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView()
        map.delegate = context.coordinator
        map.overrideUserInterfaceStyle = .dark
        map.mapType = .mutedStandard
        map.pointOfInterestFilter = .excludingAll
        map.showsCompass = false
        map.isRotateEnabled = false
        return map
    }

    func updateUIView(_ map: MKMapView, context: Context) {
        let key = [
            flight.id, flight.lastUpdated, radarTileURL ?? "",
            runways.map(\.id).sorted().joined(separator: ",")
        ].joined(separator: "|")
        guard context.coordinator.lastContentKey != key else { return }
        let flightChanged = context.coordinator.lastFlightID != flight.id
        context.coordinator.lastContentKey = key
        context.coordinator.lastFlightID = flight.id

        map.removeOverlays(map.overlays)
        map.removeAnnotations(map.annotations)
        if let radarTileURL {
            let radar = MKTileOverlay(urlTemplate: radarTileURL)
            radar.canReplaceMapContent = false
            map.addOverlay(radar, level: .aboveRoads)
        }

        for runway in runways {
            guard let left = runway.le?.coordinate, let right = runway.he?.coordinate,
                  CLLocationCoordinate2DIsValid(left), CLLocationCoordinate2DIsValid(right) else { continue }
            var ends = [left, right]
            let line = MKPolyline(coordinates: &ends, count: ends.count)
            line.title = "runway"
            map.addOverlay(line, level: .aboveLabels)
        }

        let track = flight.track?.map(\.coordinate).filter(CLLocationCoordinate2DIsValid) ?? []
        var route = track.count > 1 ? track : [flight.origin.coordinate, flight.destination.coordinate]
        if route.count > 1 {
            let line = MKPolyline(coordinates: &route, count: route.count)
            line.title = "route"
            map.addOverlay(line, level: .aboveLabels)
        }

        let origin = MKPointAnnotation()
        origin.title = flight.origin.code
        origin.coordinate = flight.origin.coordinate
        let destination = MKPointAnnotation()
        destination.title = flight.destination.code
        destination.coordinate = flight.destination.coordinate
        map.addAnnotations([origin, destination])
        if let aircraft = flight.aircraftPosition, CLLocationCoordinate2DIsValid(aircraft.coordinate) {
            let marker = AircraftAnnotation(
                coordinate: aircraft.coordinate,
                title: flight.flightNumber,
                heading: aircraft.headingDeg ?? 0
            )
            map.addAnnotation(marker)
        }

        if flightChanged {
            var rect = MKMapRect.null
            for coordinate in [flight.origin.coordinate, flight.destination.coordinate] {
                guard CLLocationCoordinate2DIsValid(coordinate) else { continue }
                let point = MKMapPoint(coordinate)
                rect = rect.union(MKMapRect(x: point.x, y: point.y, width: 1, height: 1))
            }
            if !rect.isNull {
                map.setVisibleMapRect(rect, edgePadding: UIEdgeInsets(top: 50, left: 48, bottom: 50, right: 48), animated: false)
            }
        }
    }

    final class Coordinator: NSObject, MKMapViewDelegate {
        var lastContentKey: String?
        var lastFlightID: String?

        func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
            if let radar = overlay as? MKTileOverlay {
                let renderer = MKTileOverlayRenderer(tileOverlay: radar)
                renderer.alpha = 0.5
                return renderer
            }
            if let line = overlay as? MKPolyline {
                let renderer = MKPolylineRenderer(polyline: line)
                renderer.strokeColor = line.title == "runway"
                    ? UIColor(red: 247/255, green: 201/255, blue: 72/255, alpha: 0.9)
                    : UIColor(red: 79/255, green: 209/255, blue: 197/255, alpha: 1)
                renderer.lineWidth = line.title == "runway" ? 2 : 3
                return renderer
            }
            return MKOverlayRenderer(overlay: overlay)
        }

        func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
            if let aircraft = annotation as? AircraftAnnotation {
                let view = MKAnnotationView(annotation: aircraft, reuseIdentifier: "aircraft")
                view.image = UIImage(systemName: "airplane.circle.fill")?
                    .withTintColor(UIColor(red: 79/255, green: 209/255, blue: 197/255, alpha: 1), renderingMode: .alwaysOriginal)
                view.transform = CGAffineTransform(rotationAngle: aircraft.heading * .pi / 180)
                view.canShowCallout = true
                return view
            }
            let view = MKMarkerAnnotationView(annotation: annotation, reuseIdentifier: "airport")
            view.markerTintColor = UIColor(red: 19/255, green: 120/255, blue: 111/255, alpha: 1)
            view.glyphText = annotation.title ?? nil
            view.canShowCallout = true
            return view
        }
    }
}

private final class AircraftAnnotation: NSObject, MKAnnotation {
    let coordinate: CLLocationCoordinate2D
    let title: String?
    let heading: Double

    init(coordinate: CLLocationCoordinate2D, title: String, heading: Double) {
        self.coordinate = coordinate
        self.title = title
        self.heading = heading
    }
}
