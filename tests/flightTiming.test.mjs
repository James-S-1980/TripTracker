import assert from "node:assert/strict";
import { test } from "node:test";
import { flightTiming, timingLabel } from "../src/flightTiming.ts";

function flight(overrides = {}) {
  return {
    status: "Scheduled",
    departureTime: "2026-10-30T14:00:00.000Z",
    arrivalTime: "2026-10-30T17:00:00.000Z",
    scheduledDepartureTime: "2026-10-30T14:00:00.000Z",
    scheduledArrivalTime: "2026-10-30T17:00:00.000Z",
    ...overrides,
  };
}

test("on-time flights remain green through small schedule adjustments", () => {
  const timing = flightTiming(flight({
    departureTime: "2026-10-30T14:04:00.000Z",
    arrivalTime: "2026-10-30T17:03:00.000Z",
  }));
  assert.equal(timing.state, "on-time");
  assert.equal(timing.departure.isDelayed, false);
  assert.equal(timing.arrival.isDelayed, false);
  assert.equal(timingLabel(timing), "On time");
});

test("a material departure or arrival delay turns the flight red", () => {
  const timing = flightTiming(flight({
    departureTime: "2026-10-30T14:42:00.000Z",
    arrivalTime: "2026-10-30T17:31:00.000Z",
  }));
  assert.equal(timing.state, "delayed");
  assert.equal(timing.departure.deltaMinutes, 42);
  assert.equal(timing.arrival.deltaMinutes, 31);
  assert.equal(timing.delayMinutes, 42);
  assert.equal(timingLabel(timing), "42 min delay");
});

test("provider-reported delays remain delayed when schedule baselines are unavailable", () => {
  const timing = flightTiming(flight({
    status: "Delayed",
    scheduledDepartureTime: undefined,
    scheduledArrivalTime: undefined,
  }));
  assert.equal(timing.state, "delayed");
  assert.equal(timing.delayMinutes, null);
  assert.equal(timingLabel(timing), "Delay reported");
});

test("cancelled flights take precedence over timing calculations", () => {
  const timing = flightTiming(flight({ status: "Cancelled", arrivalTime: "2026-10-30T18:00:00.000Z" }));
  assert.equal(timing.state, "cancelled");
  assert.equal(timingLabel(timing), "Cancelled");
});
