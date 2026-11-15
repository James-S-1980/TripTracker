import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAirTravelHealth, parseFlightAwareDailyTotals, summarizeMiserySnapshot } from "../server/airTravelHealth.js";

function snapshot(time, { onTime, delayed, cancelled }) {
  return {
    time,
    data: [
      { airport: "KATL", ontime: Math.round(onTime * 0.55), delayed: Math.round(delayed * 0.55), cancelled: Math.round(cancelled * 0.55) },
      { airport: "KORD", ontime: onTime - Math.round(onTime * 0.55), delayed: delayed - Math.round(delayed * 0.55), cancelled: cancelled - Math.round(cancelled * 0.55) },
    ],
  };
}

test("parses current U.S. delay and cancellation totals", () => {
  const html = `
    <h3>Total delays within, into, or out of the United States today:&nbsp;&nbsp;7,889</h3>
    <h3>Total cancellations within, into, or out of the United States today:&nbsp;&nbsp;1,956</h3>
  `;
  assert.deepEqual(parseFlightAwareDailyTotals(html), { delayed: 7889, cancelled: 1956 });
});

test("sums airport operations without double-counting destination detail", () => {
  const summary = summarizeMiserySnapshot({
    time: 1794780000,
    data: [
      { airport: "KATL", ontime: 70, delayed: 25, cancelled: 5, destinations: [{ airport: "KJFK", delayed: 25 }] },
      { airport: "KORD", ontime: 72, delayed: 26, cancelled: 2 },
    ],
  });
  assert.equal(summary.total, 200);
  assert.equal(summary.delayed, 51);
  assert.equal(summary.cancelled, 7);
});

test("assigns a normal B grade near the BTS benchmark", () => {
  const now = 1794780000;
  const health = buildAirTravelHealth({
    realtime: snapshot(now, { onTime: 720, delayed: 261, cancelled: 19 }),
    historical: [snapshot(now - 3600, { onTime: 720, delayed: 261, cancelled: 19 })],
    dailyTotals: { delayed: 4800, cancelled: 340 },
  });
  assert.equal(health.grade, "B");
  assert.equal(health.label, "Normal");
  assert.equal(health.snapshot.normalDelayed, 262);
  assert.equal(health.trend.direction, "steady");
});

test("assigns an F and flags a rapidly worsening disruption", () => {
  const now = 1794780000;
  const health = buildAirTravelHealth({
    realtime: snapshot(now, { onTime: 520, delayed: 400, cancelled: 80 }),
    historical: [snapshot(now - 3600, { onTime: 670, delayed: 300, cancelled: 30 })],
    dailyTotals: { delayed: 7889, cancelled: 1956 },
    faaAirports: [
      { severity: "critical", events: [{ type: "ground_stop" }] },
      { severity: "major", events: [{ type: "ground_delay" }] },
    ],
  });
  assert.equal(health.grade, "F");
  assert.equal(health.trend.direction, "worsening_fast");
  assert.equal(health.today.cancelled, 1956);
  assert.equal(health.faa.activeAdvisories, 2);
  assert.match(health.summary, /above the BTS benchmark/i);
});
