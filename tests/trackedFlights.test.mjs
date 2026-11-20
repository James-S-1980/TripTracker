import assert from "node:assert/strict";
import { test } from "node:test";
import { flightIdentityKey, mergeFlightSources } from "../src/trackedFlights.ts";

function flight(overrides = {}) {
  return {
    id: "flightstats-AAL1316-2026-11-20",
    airline: "American Airlines",
    airlineCode: "AA",
    flightNumber: "AA 1316",
    date: "2026-11-20",
    origin: { code: "DFW" },
    destination: { code: "PHL" },
    departureTime: "2026-11-20T16:50:00.000Z",
    lastUpdated: "2026-11-20T09:00:00.000Z",
    alerts: [],
    ...overrides,
  };
}

function mergeEnrichment(previous, next) {
  return {
    ...next,
    tailNumber: next.tailNumber ?? previous?.tailNumber,
  };
}

test("merges one flight when its provider-specific id changes", () => {
  const local = flight({ tailNumber: "N123AA" });
  const server = flight({
    id: "flightaware-public-AAL1316-2026-11-20",
    lastUpdated: "2026-11-20T10:00:00.000Z",
    boardingGate: "A12",
  });

  const merged = mergeFlightSources([local], [server], mergeEnrichment);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, server.id);
  assert.equal(merged[0].boardingGate, "A12");
  assert.equal(merged[0].tailNumber, "N123AA");
});

test("keeps genuinely different dated routes separate", () => {
  const flights = mergeFlightSources(
    [flight()],
    [flight({ id: "second-leg", origin: { code: "PHL" }, destination: { code: "ORD" } })],
    mergeEnrichment,
  );

  assert.equal(flights.length, 2);
  assert.notEqual(flightIdentityKey(flights[0]), flightIdentityKey(flights[1]));
});

test("normalizes formatting differences in the canonical identity", () => {
  const standard = flight();
  const padded = flight({ flightNumber: "AA 01316" });

  assert.equal(flightIdentityKey(standard), flightIdentityKey(padded));
});
