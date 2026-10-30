import assert from "node:assert/strict";
import { test } from "node:test";
import { boardingEstimate, boardingPolicyFor } from "../src/boarding.ts";

function flight(overrides = {}) {
  return {
    airlineCode: "AA",
    flightNumber: "AA 100",
    departureTime: "2026-10-30T14:00:00.000Z",
    ...overrides,
  };
}

test("an exact boarding timestamp takes precedence over airline policy", () => {
  const estimate = boardingEstimate(flight({ boardingTime: "2026-10-30T12:45:00.000Z" }));
  assert.equal(estimate.kind, "exact");
  assert.equal(estimate.time, "2026-10-30T12:45:00.000Z");
  assert.equal(estimate.policy, undefined);
});

test("American uses the earliest point in its published boarding range", () => {
  const estimate = boardingEstimate(flight());
  assert.equal(estimate.kind, "policy");
  assert.equal(estimate.time, "2026-10-30T13:10:00.000Z");
  assert.equal(estimate.policy?.leadMinutes, 50);
  assert.equal(estimate.policy?.basis, "boarding-start");
});

test("Southwest uses its published 30-minute earliest boarding time", () => {
  const estimate = boardingEstimate(flight({ airlineCode: "WN", flightNumber: "WN 100" }));
  assert.equal(estimate.time, "2026-10-30T13:30:00.000Z");
  assert.equal(estimate.policy?.airline, "Southwest Airlines");
});

test("gate-ready policies are distinguished from boarding-start estimates", () => {
  const policy = boardingPolicyFor("AC");
  assert.equal(policy?.basis, "gate-ready");
  assert.equal(policy?.leadMinutes, 45);
});

test("unknown carriers do not receive a fabricated boarding time", () => {
  const estimate = boardingEstimate(flight({ airlineCode: "ZZ", flightNumber: "ZZ 100" }));
  assert.equal(estimate.kind, "unavailable");
  assert.equal(estimate.time, null);
});
