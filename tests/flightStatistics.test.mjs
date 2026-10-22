import assert from "node:assert/strict";
import { test } from "node:test";
import { parseFlightAwareHistory, summarizeFlightHistory } from "../server/flightStatistics.js";

const row = ({ date, scheduledUtc, origin = "KPHL", destination = "KDFW", departure, result, aircraft = "A321" }) => `
  <tr class="rowClickTarget" data-target='/live/flight/AAL1751/history/${date}/${scheduledUtc}Z/${origin}/${destination}'>
    <td><a>${date.slice(6)}-${date.slice(4, 6)}-${date.slice(0, 4)}</a></td>
    <td>${aircraft}</td>
    <td>Philadelphia Intl (${origin})</td>
    <td>Dallas-Fort Worth Intl (${destination})</td>
    <td>${departure}</td>
    <td>07:15&nbsp;<span class="tz">CDT</span></td>
    <td>${result}</td>
  </tr>`;

test("parses route-matched history and classifies operational issues", () => {
  const html = [
    row({ date: "20261022", scheduledUtc: "0910", departure: "05:12&nbsp;<span>EDT</span>", result: "2:47" }),
    row({ date: "20261021", scheduledUtc: "0910", departure: "05:26&nbsp;<span>EDT</span>", result: "2:50" }),
    row({ date: "20261020", scheduledUtc: "0910", departure: "06:15&nbsp;<span>EDT</span>", result: "3:01" }),
    row({ date: "20261019", scheduledUtc: "0910", departure: "05:10&nbsp;<span>EDT</span>", result: "Cancelled" }),
    row({ date: "20261018", scheduledUtc: "0910", origin: "KORD", destination: "KLAX", departure: "05:45 CDT", result: "3:20" }),
    row({ date: "20261024", scheduledUtc: "0910", departure: "05:10 EDT", result: "Scheduled" }),
  ].join("\n");

  const records = parseFlightAwareHistory(html, {
    origin: "PHL",
    destination: "DFW",
    originTimeZone: "America/New_York",
    targetDate: "2026-10-24",
  });

  assert.equal(records.length, 4);
  assert.deepEqual(records.map((record) => record.outcome), [
    "Completed",
    "Delayed",
    "Severely delayed",
    "Cancelled",
  ]);
  assert.deepEqual(records.map((record) => record.departureDelayMinutes), [2, 16, 65, undefined]);

  const summary = summarizeFlightHistory(records, {
    flightNumber: "AA 1751",
    origin: "PHL",
    destination: "DFW",
    sourceUrl: "https://www.flightaware.com/live/flight/AAL1751/history",
  });

  assert.equal(summary.sampleSize, 4);
  assert.equal(summary.onTimeFlights, 1);
  assert.equal(summary.delayedFlights, 2);
  assert.equal(summary.severeDelayFlights, 1);
  assert.equal(summary.cancelledFlights, 1);
  assert.equal(summary.issueRate, 75);
  assert.equal(summary.averageDepartureDelayMinutes, 28);
  assert.equal(summary.medianDepartureDelayMinutes, 16);
  assert.equal(summary.recentIssues.length, 3);
});

test("supports explicit international ICAO aliases", () => {
  const html = row({
    date: "20261020",
    scheduledUtc: "1645",
    origin: "EGLL",
    destination: "KJFK",
    departure: "18:03 BST",
    result: "7:12",
    aircraft: "B77W",
  });
  const records = parseFlightAwareHistory(html, {
    origin: "LHR",
    destination: "JFK",
    originTimeZone: "Europe/London",
    targetDate: "2026-10-21",
    originAliases: ["EGLL"],
    destinationAliases: ["KJFK"],
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].departureDelayMinutes, 18);
  assert.equal(records[0].outcome, "Delayed");
});
