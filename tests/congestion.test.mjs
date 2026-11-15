import assert from "node:assert/strict";
import { test } from "node:test";
import { congestionColor, congestionRegions } from "../src/congestion.ts";

function airport(airportCode, lat, lon, severity = "clear", options = {}) {
  return {
    airportCode,
    airportName: `${airportCode} Airport`,
    lat,
    lon,
    severity,
    status: severity === "clear" ? "No active FAA advisory" : "Delay",
    continuouslyMonitored: options.continuouslyMonitored ?? true,
    events: options.events ?? [],
    updatedAt: "2026-11-15T14:00:00.000Z",
    coverage: "test",
  };
}

test("clusters nearby metro airports and uses the worst regional severity", () => {
  const regions = congestionRegions([
    airport("JFK", 40.6413, -73.7781, "major", {
      events: [{ severity: "major", averageDelayMinutes: 42 }],
    }),
    airport("LGA", 40.7769, -73.8740),
    airport("EWR", 40.6895, -74.1745, "critical", {
      events: [{ severity: "critical" }],
    }),
    airport("ATL", 33.6407, -84.4277),
  ]);

  assert.equal(regions.length, 2);
  assert.deepEqual(regions[0].airports.map((item) => item.airportCode), ["EWR", "JFK", "LGA"]);
  assert.equal(regions[0].severity, "critical");
  assert.equal(regions[0].averageDelayMinutes, 42);
  assert.equal(regions[1].airports[0].airportCode, "ATL");
});

test("omits airports without continuous FAA coverage or an active event", () => {
  const regions = congestionRegions([
    airport("LHR", 51.4700, -0.4543, "unknown", { continuouslyMonitored: false }),
    airport("BOS", 42.3656, -71.0096),
  ]);
  assert.deepEqual(regions.map((region) => region.airports[0].airportCode), ["BOS"]);
});

test("uses a readable green-to-red severity palette", () => {
  assert.equal(congestionColor("clear"), "#34d399");
  assert.equal(congestionColor("minor"), "#facc15");
  assert.equal(congestionColor("critical"), "#ef4444");
});
