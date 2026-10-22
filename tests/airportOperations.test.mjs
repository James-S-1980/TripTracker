import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeAirportOperations } from "../server/airportOperations.js";

const fetchedAt = "2026-10-22T14:30:00.000Z";

test("normalizes FAA delay programs for requested airports", () => {
  const report = summarizeAirportOperations({
    requestedCodes: ["DFW", "BWI", "LHR"],
    fetchedAt,
    pacingAirports: [{ airportId: "DFW" }, { airportId: "BWI" }],
    events: [
      {
        airportId: "DFW",
        airportLongName: "Dallas-Fort Worth International",
        groundDelay: {
          airportId: "DFW",
          avgDelay: "47",
          impactingCondition: "WEATHER / THUNDERSTORMS",
          startTime: "2026-10-22T13:00:00Z",
          endTime: "2026-10-22T18:00:00Z",
          includedFacilities: ["ZFW", "ZHU"],
          updatedAt: "2026-10-22T14:20:00Z",
        },
        airportConfig: {
          arrivalRunwayConfig: "17C/18R",
          departureRunwayConfig: "17R/18L",
          arrivalRate: 52,
          sourceTimeStamp: "2026-10-22T14:25:00Z",
        },
      },
      {
        airportId: "BWI",
        arrivalDelay: {
          airportId: "BWI",
          averageDelay: 22,
          trend: "increasing",
          reason: "VOLUME",
          updateTime: "2026-10-22T14:18:00Z",
        },
      },
    ],
  });

  assert.equal(report.airports.length, 3);
  assert.equal(report.airports[0].status, "Ground delay program");
  assert.equal(report.airports[0].severity, "major");
  assert.equal(report.airports[0].events[0].averageDelayMinutes, 47);
  assert.deepEqual(report.airports[0].events[0].scope, ["ZFW", "ZHU"]);
  assert.equal(report.airports[0].runwayConfig.arrivalRate, 52);
  assert.equal(report.airports[1].status, "Arrival delays");
  assert.equal(report.airports[1].events[0].trend, "increasing");
  assert.equal(report.airports[2].status, "Coverage limited");
  assert.equal(report.airports[2].severity, "unknown");
  assert.equal(report.airports[2].continuouslyMonitored, false);
});

test("prioritizes ground stops and distinguishes limited operating restrictions", () => {
  const report = summarizeAirportOperations({
    requestedCodes: ["JFK", "AUS"],
    fetchedAt,
    pacingAirports: [{ airportId: "JFK" }, { airportId: "AUS" }],
    events: [
      {
        airportId: "JFK",
        groundStop: {
          airportId: "JFK",
          impactingCondition: "LOW CEILINGS",
          probabilityOfExtension: "HIGH",
          startTime: "2026-10-22T14:00:00Z",
          endTime: "2026-10-22T15:30:00Z",
        },
        arrivalDelay: {
          airportId: "JFK",
          averageDelay: 18,
          trend: "decreasing",
          reason: "WEATHER",
          updateTime: "2026-10-22T14:10:00Z",
        },
      },
      {
        airportId: "AUS",
        freeForm: {
          airportId: "AUS",
          text: "TO GA ACFT EXC PPR",
          startTime: "2026-10-22T05:00:00Z",
          endTime: "2026-10-26T21:00:00Z",
        },
      },
    ],
  });

  assert.equal(report.airports[0].status, "Ground stop");
  assert.equal(report.airports[0].events.length, 2);
  assert.equal(report.airports[0].events[0].type, "ground_stop");
  assert.equal(report.airports[0].events[0].probabilityOfExtension, "HIGH");
  assert.equal(report.airports[1].status, "Operating restriction");
  assert.equal(report.airports[1].severity, "info");
  assert.match(report.airports[1].coverage, /active event in the current feed/i);
});
