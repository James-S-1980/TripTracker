import XCTest
@testable import TripTracker

final class FlightDataTests: XCTestCase {
    func testAeroFlightMappingHandlesNullStatusFieldsAndUsesBundledAirports() throws {
        let flight: [String: Any] = [
            "fa_flight_id": "AAL123-20260919",
            "origin": ["code_iata": "JFK"],
            "destination": ["code_iata": "LHR"],
            "scheduled_out": "2026-09-19T12:00:00Z",
            "scheduled_in": "2026-09-19T19:00:00Z",
            "actual_in": NSNull(),
            "actual_on": NSNull(),
            "actual_off": NSNull(),
            "status": "Scheduled",
            "gate_origin": "A12",
            "gate_destination": NSNull()
        ]
        let result = try APIClient.mapFlight(flight, date: "2026-09-19", airlineCode: "AA", number: "123")
        XCTAssertEqual(result.status, "Scheduled")
        XCTAssertEqual(result.origin.code, "JFK")
        XCTAssertNotEqual(result.origin.lat, 0)
        XCTAssertEqual(result.destination.code, "LHR")
        XCTAssertEqual(result.boardingGate, "A12")
        XCTAssertEqual(result.arrivalGate, "TBD")
        XCTAssertEqual(APIClient.status(flight), "Scheduled")
    }

    func testBundledRunwayCatalogProvidesAirportOverlays() {
        XCTAssertFalse(FlightCatalogs.runways["JFK", default: []].isEmpty)
    }
}
