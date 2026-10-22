import assert from "node:assert/strict";
import { test } from "node:test";
import { createNotificationState, evaluateFlightNotificationPolicy } from "../server/notificationPolicy.js";

const now = Date.parse("2026-10-22T16:00:00Z");

function flight(overrides = {}) {
  return {
    id: "UAL100-20261022",
    flightNumber: "UA 100",
    date: "2026-10-22",
    origin: { code: "IAD", timeZone: "America/New_York" },
    destination: { code: "LAX", timeZone: "America/Los_Angeles" },
    status: "Scheduled",
    progress: 0,
    departureTime: new Date(now + 30 * 60000).toISOString(),
    arrivalTime: new Date(now + 150 * 60000).toISOString(),
    terminal: "",
    boardingGate: "TBD",
    arrivalTerminal: "",
    arrivalGate: "TBD",
    ...overrides,
  };
}

function eventTypes(result) {
  return result.notifications.map((notification) => notification.eventType);
}

test("routine enrichment and small time adjustments do not send email", () => {
  const previous = flight();
  const state = createNotificationState(previous, now);
  const enriched = flight({
    tailNumber: "N12345",
    inboundFrom: { code: "BOS" },
    inboundFlightNumber: "UA 99",
    arrivalTime: new Date(now + 155 * 60000).toISOString(),
  });

  const result = evaluateFlightNotificationPolicy(previous, enriched, state, now);
  assert.deepEqual(result.notifications, []);
});

test("gate assignments, delays, and cumulative ten-minute time changes are critical", () => {
  const initial = flight();
  let state = createNotificationState(initial, now);

  const gateAssigned = flight({ terminal: "C", boardingGate: "C7" });
  let result = evaluateFlightNotificationPolicy(initial, gateAssigned, state, now);
  assert.deepEqual(eventTypes(result), ["critical"]);
  assert.equal(result.notifications[0].changes[0].kind, "departure-gate");
  state = result.state;

  const smallDelay = flight({
    terminal: "C",
    boardingGate: "C7",
    arrivalTime: new Date(now + 156 * 60000).toISOString(),
  });
  result = evaluateFlightNotificationPolicy(gateAssigned, smallDelay, state, now);
  assert.deepEqual(result.notifications, []);
  state = result.state;

  const cumulativeDelay = flight({
    terminal: "C",
    boardingGate: "C7",
    arrivalTime: new Date(now + 161 * 60000).toISOString(),
  });
  result = evaluateFlightNotificationPolicy(smallDelay, cumulativeDelay, state, now);
  assert.deepEqual(eventTypes(result), ["critical"]);
  assert.equal(result.notifications[0].changes[0].kind, "arrival-time");
  state = result.state;

  const delayed = { ...cumulativeDelay, status: "Delayed" };
  result = evaluateFlightNotificationPolicy(cumulativeDelay, delayed, state, now);
  assert.deepEqual(eventTypes(result), ["critical"]);
  assert.equal(result.notifications[0].changes[0].kind, "status");
});

test("each requested flight milestone is emitted once", () => {
  const scheduled = flight();
  let previous = scheduled;
  let state = createNotificationState(scheduled, now);

  const airborne = flight({
    status: "En Route",
    progress: 10,
    aircraftPosition: { altitudeFt: 8000, source: "Airplanes.live ADS-B" },
  });
  let result = evaluateFlightNotificationPolicy(previous, airborne, state, now);
  assert.deepEqual(eventTypes(result), ["takeoff"]);
  previous = airborne;
  state = result.state;

  const halfway = flight({
    status: "En Route",
    progress: 51,
    aircraftPosition: { altitudeFt: 35000, source: "Airplanes.live ADS-B" },
  });
  result = evaluateFlightNotificationPolicy(previous, halfway, state, now);
  assert.deepEqual(eventTypes(result), ["halfway"]);
  previous = halfway;
  state = result.state;

  const firstDrop = flight({
    status: "En Route",
    progress: 65,
    aircraftPosition: { altitudeFt: 34000, source: "Airplanes.live ADS-B" },
  });
  result = evaluateFlightNotificationPolicy(previous, firstDrop, state, now);
  assert.deepEqual(result.notifications, []);
  previous = firstDrop;
  state = result.state;

  const descent = flight({
    status: "En Route",
    progress: 70,
    aircraftPosition: { altitudeFt: 32000, source: "Airplanes.live ADS-B" },
  });
  result = evaluateFlightNotificationPolicy(previous, descent, state, now);
  assert.deepEqual(eventTypes(result), ["descent"]);
  previous = descent;
  state = result.state;

  const landingSoon = flight({
    status: "En Route",
    progress: 94,
    arrivalTime: new Date(now + 9 * 60000).toISOString(),
    aircraftPosition: { altitudeFt: 6000, source: "Airplanes.live ADS-B" },
  });
  result = evaluateFlightNotificationPolicy(previous, landingSoon, state, now);
  assert.deepEqual(eventTypes(result), ["ten_minutes"]);
  previous = landingSoon;
  state = result.state;

  const landed = flight({
    status: "Landed",
    progress: 100,
    arrivalTime: landingSoon.arrivalTime,
    aircraftPosition: { altitudeFt: 0, source: "Airplanes.live ADS-B" },
  });
  result = evaluateFlightNotificationPolicy(previous, landed, state, now);
  assert.deepEqual(eventTypes(result), ["landed"]);
  state = result.state;

  result = evaluateFlightNotificationPolicy(landed, landed, state, now + 30000);
  assert.deepEqual(result.notifications, []);
});

test("estimated schedule altitude cannot trigger descent", () => {
  const cruise = flight({
    status: "En Route",
    progress: 60,
    aircraftPosition: { altitudeFt: 35000, source: "Estimated from schedule" },
  });
  const state = createNotificationState(cruise, now);
  const estimatedLow = flight({
    status: "En Route",
    progress: 80,
    aircraftPosition: { altitudeFt: 10000, source: "Estimated from schedule" },
  });
  const result = evaluateFlightNotificationPolicy(cruise, estimatedLow, state, now);
  assert.equal(eventTypes(result).includes("descent"), false);
});
