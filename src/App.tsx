import { Activity, AlertTriangle, ArrowRight, BarChart3, Bell, CalendarDays, CheckCircle2, CloudSun, History, LoaderCircle, MapPin, Plane, Radar, RefreshCw, Search, ShieldCheck, Timer, Trash2 } from "lucide-react";
import L from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { airlineLogoFor, airlineMatches } from "./airlines";
import { boardingEstimate } from "./boarding";
import type { BoardingEstimate } from "./boarding";
import { fetchAirportDelays, fetchAirportRunways, fetchFlightStatistics, fetchTrackedFlights, lookupFlight, registerTrackedFlights, searchFlights, sendFlightNotification, untrackFlight } from "./flightProvider";
import { flightTiming, timingLabel } from "./flightTiming";
import type { TimeComparison } from "./flightTiming";
import { fetchWeather } from "./weather";
import type { AirportDelayEvent, AirportDelayReport, AirportDelayStatus, AirportRunway, FlightLeg, FlightLookupResult, FlightStatistics, RunwayCatalog, RunwayEnd, WeatherSnapshot } from "./types";
import "leaflet/dist/leaflet.css";

const storageKey = "triptracker:flights";
const refreshIntervalMs = 30000;
const landedDisplayMs = 10 * 60 * 1000;
const rainViewerApiUrl = "https://api.rainviewer.com/public/weather-maps.json";
const appVersion = import.meta.env.VITE_APP_VERSION;

type SoundEventType = "takeoff" | "landing" | "gate";
type AudioWindow = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };
type RainViewerFrame = { time: number; path: string };
type RainViewerResponse = {
  generated?: number;
  host?: string;
  radar?: {
    past?: RainViewerFrame[];
  };
};
type RunwayApproach = {
  airportCode: string;
  runwayIdent: string;
  headingDeg: number;
  threshold: L.LatLngTuple;
  finalFix: L.LatLngTuple;
  crossTrackNm?: number;
  distanceToThresholdNm?: number;
  headingDeltaDeg?: number;
};
type DelayOutlook = {
  label: "Low" | "Moderate" | "High" | "Complete" | "Unknown";
  tone: "low" | "moderate" | "high" | "complete" | "unknown";
  score: number | null;
  summary: string;
  factors: string[];
};

function notifyFlightEvent(eventType: "tracked" | "updated" | "concluded", flight: FlightLeg, changes: string[] = []): void {
  sendFlightNotification(eventType, flight, changes).catch((error) => {
    console.warn("TripTracker email notification failed", error);
  });
}

async function concludeFlightEvent(flight: FlightLeg, changes: string[]): Promise<boolean> {
  try {
    const result = await sendFlightNotification("concluded", flight, changes);
    return result.concluded === true && result.deferred !== true;
  } catch (error) {
    console.warn("TripTracker could not conclude flight tracking", error);
    return false;
  }
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function formatZonedTime(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(new Date(value));
}

function timeAgo(value: string): string {
  const minutes = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  return minutes === 1 ? "1 min ago" : `${minutes} min ago`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(`${value}T00:00:00`));
}

function isAmbiguousLookup(result: FlightLookupResult): result is Extract<FlightLookupResult, { ambiguous: true }> {
  return "ambiguous" in result && result.ambiguous === true;
}

function requireSingleFlight(result: FlightLookupResult): FlightLeg {
  if (isAmbiguousLookup(result)) {
    throw new Error(result.message);
  }
  return result;
}

function formatTimestamp(value: string | null): string {
  if (!value) return "Not refreshed yet";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatRadarTimestamp(value: number | null): string {
  if (!value) return "Unavailable";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value * 1000));
}

function durationText(ms: number): string {
  const absoluteMinutes = Math.max(0, Math.round(Math.abs(ms) / 60000));
  const hours = Math.floor(absoluteMinutes / 60);
  const minutes = absoluteMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
}

function statusLead(flight: FlightLeg): string {
  const now = Date.now();
  const departure = new Date(flight.departureTime).getTime();
  const arrival = new Date(flight.arrivalTime).getTime();
  if (flight.status === "Landed") return `Landed ${durationText(now - landedTimestamp(flight))} ago`;
  if (flight.status === "Arrived") return `Arrived ${durationText(now - arrival)} ago`;
  if (flight.status === "En Route") return `Arriving in ${durationText(arrival - now)}`;
  if (flight.status === "Boarding") return `Departs in ${durationText(departure - now)}`;
  if (flight.status === "Delayed") return `Updated departure ${formatTime(flight.departureTime)}`;
  if (flight.status === "Cancelled") return "Flight cancelled";
  return `Departs in ${durationText(departure - now)}`;
}

function FlightTimeDisplay({
  comparison,
  timeZone,
  forceDelayTone = false,
}: {
  comparison: TimeComparison;
  timeZone: string;
  forceDelayTone?: boolean;
}) {
  const isDelayed = comparison.isDelayed || forceDelayTone;
  const showComparison = isDelayed && comparison.scheduledTime && comparison.deltaMinutes !== null && comparison.deltaMinutes > 0;
  return (
    <>
      <div className={`flight-time-display ${isDelayed ? "delayed" : "on-time"}`}>
        {showComparison ? (
          <>
            <div className="time-change-row original">
              <span>Original</span>
              <del>{formatZonedTime(comparison.scheduledTime!, timeZone)}</del>
            </div>
            <div className="time-change-row updated">
              <span>Updated</span>
              <time dateTime={comparison.currentTime}>{formatZonedTime(comparison.currentTime, timeZone)}</time>
            </div>
            <b className="delay-amount">+{comparison.deltaMinutes} min</b>
          </>
        ) : (
          <time className="current-flight-time" dateTime={comparison.currentTime}>
            {formatZonedTime(comparison.currentTime, timeZone)}
          </time>
        )}
      </div>
      <span className="your-time">Your time: {formatZonedTime(comparison.currentTime, "America/New_York")}</span>
    </>
  );
}

function boardingCountdownText(ms: number): string {
  const totalMinutes = Math.max(0, Math.ceil(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
}

function BoardingCountdown({
  estimate,
  flight,
  now,
}: {
  estimate: BoardingEstimate;
  flight: FlightLeg;
  now: number;
}) {
  if (!["Scheduled", "Delayed", "Boarding"].includes(flight.status)) return null;

  const boardingAt = estimate.time ? new Date(estimate.time).getTime() : Number.NaN;
  const remaining = boardingAt - now;
  const hasTime = Number.isFinite(boardingAt);
  const isBoarding = flight.status === "Boarding";
  const timeReached = hasTime && remaining <= 0;
  const isGateReminder = estimate.policy?.basis === "gate-ready";
  let headline = "Boarding time unavailable";
  if (isBoarding) {
    headline = "Boarding now";
  } else if (timeReached) {
    headline = isGateReminder
      ? "Gate-ready time reached"
      : estimate.kind === "policy" ? "Boarding expected now" : "Boarding time reached";
  } else if (hasTime) {
    headline = `${isGateReminder ? "Be at gate" : "Boarding starts"} in ${boardingCountdownText(remaining)}`;
  }

  let tone = "upcoming";
  if (isBoarding || timeReached) tone = "active";
  else if (!hasTime) tone = "unavailable";
  else if (remaining <= 60 * 60000) tone = "soon";
  const sourceLabel = estimate.kind === "exact"
    ? "Published boarding time"
    : estimate.policy
      ? isGateReminder ? "Airline gate policy" : "Airline policy estimate"
      : "Check airline app";

  return (
    <section className={`boarding-strip ${tone}`}>
      <span className="boarding-strip-icon"><Timer size={20} /></span>
      <div className="boarding-strip-time">
        <small>Boarding countdown</small>
        <strong>{headline}</strong>
        {estimate.time && (
          <time dateTime={estimate.time}>{formatZonedTime(estimate.time, flight.origin.timeZone ?? "America/New_York")}</time>
        )}
      </div>
      <div className="boarding-strip-source">
        <span>{sourceLabel}</span>
        {estimate.policy ? (
          <>
            <a href={estimate.policy.sourceUrl} target="_blank" rel="noreferrer">{estimate.policy.airline} policy</a>
            <small>{estimate.policy.detail}</small>
          </>
        ) : estimate.kind === "exact" ? (
          <small>Provided by {flight.dataSource}.</small>
        ) : (
          <small>No exact time or published boarding-start rule is available for this carrier.</small>
        )}
      </div>
    </section>
  );
}

function usefulAirportValue(value: string | undefined): string {
  const normalized = String(value ?? "").trim();
  return normalized && !/^(?:n\/?a|na|none|null|unknown|tbd|-|--|\?)$/i.test(normalized) ? normalized : "";
}

function gateDisplay(terminal: string, gate: string): string {
  const cleanTerminal = usefulAirportValue(terminal);
  const cleanGate = usefulAirportValue(gate);
  if (cleanTerminal && cleanGate) return `${cleanTerminal} / ${cleanGate}`;
  if (cleanGate) return cleanGate;
  if (cleanTerminal) return `Terminal ${cleanTerminal}`;
  return "Pending";
}

function inboundStatusLabel(status: FlightLeg["inboundStatus"] | undefined): string {
  if (!status) return "";
  if (status === "En Route") return "departed";
  if (status === "Landed" || status === "Arrived") return "arrived";
  if (status === "Cancelled") return "cancelled";
  return "on ground";
}

function altitudeLabel(flight: FlightLeg): string {
  if (flight.altitudeFt) return `${flight.altitudeFt.toLocaleString()} ft`;
  return flight.status === "En Route" ? "Altitude pending" : "Ground";
}

function aircraftPhotoUrl(tailNumber: string): string {
  return `https://www.planespotters.net/photos/reg/${encodeURIComponent(tailNumber)}`;
}

function describeFlightChanges(previous: FlightLeg, next: FlightLeg): string[] {
  const changes: string[] = [];
  const previousDepartureGate = gateDisplay(previous.terminal, previous.boardingGate);
  const nextDepartureGate = gateDisplay(next.terminal, next.boardingGate);
  const previousArrivalGate = gateDisplay(previous.arrivalTerminal, previous.arrivalGate);
  const nextArrivalGate = gateDisplay(next.arrivalTerminal, next.arrivalGate);
  const previousTail = previous.tailNumber ?? previous.aircraftPosition?.tailNumber ?? "";
  const nextTail = next.tailNumber ?? next.aircraftPosition?.tailNumber ?? "";
  const previousInbound = inboundSummary(previous);
  const nextInbound = inboundSummary(next);

  if (previous.status !== next.status) changes.push(`Status ${previous.status} -> ${next.status}`);
  if (previousDepartureGate !== nextDepartureGate && nextDepartureGate !== "Pending") changes.push(`Departure gate ${previousDepartureGate} -> ${nextDepartureGate}`);
  if (previousArrivalGate !== nextArrivalGate && nextArrivalGate !== "Pending") changes.push(`Arrival gate ${previousArrivalGate} -> ${nextArrivalGate}`);
  if (previous.departureTime !== next.departureTime) changes.push(`Departure ${formatZonedTime(next.departureTime, next.origin.timeZone ?? "America/New_York")}`);
  if (previous.arrivalTime !== next.arrivalTime) changes.push(`Arrival ${formatZonedTime(next.arrivalTime, next.destination.timeZone ?? "America/New_York")}`);
  if (previousTail !== nextTail && nextTail) changes.push(`Tail ${nextTail}`);
  if (previousInbound !== nextInbound && nextInbound) changes.push(`Inbound ${nextInbound}`);
  return changes;
}

function inboundSummary(flight: FlightLeg): string {
  if (!flight.inboundFrom) return "";
  return `${flight.inboundFrom.code}${flight.inboundFlightNumber ? ` via ${flight.inboundFlightNumber}` : ""}${flight.inboundStatus ? ` ${flight.inboundStatus}` : ""}`;
}

function mergeKnownFlightEnrichment(previous: FlightLeg | undefined, next: FlightLeg): FlightLeg {
  if (!previous) return next;
  const previousTail = previous.tailNumber ?? previous.aircraftPosition?.tailNumber;
  const nextTail = next.tailNumber ?? next.aircraftPosition?.tailNumber;
  const merged: FlightLeg = { ...next };

  merged.scheduledDepartureTime = next.scheduledDepartureTime ?? previous.scheduledDepartureTime;
  merged.scheduledArrivalTime = next.scheduledArrivalTime ?? previous.scheduledArrivalTime;
  merged.boardingTime = next.boardingTime ?? previous.boardingTime;

  if (!nextTail && previousTail) {
    merged.tailNumber = previousTail;
    if (merged.aircraftPosition) {
      merged.aircraftPosition = {
        ...merged.aircraftPosition,
        tailNumber: previousTail,
      };
    }
  }

  if (!merged.inboundFrom && previous.inboundFrom) {
    merged.inboundFrom = previous.inboundFrom;
    merged.inboundFlightNumber = previous.inboundFlightNumber;
    merged.inboundStatus = previous.inboundStatus;
    merged.inboundSource = previous.inboundSource;
  } else if (merged.inboundFrom && previous.inboundFrom && inboundSummary(merged) === inboundSummary(previous)) {
    merged.inboundFlightNumber = merged.inboundFlightNumber ?? previous.inboundFlightNumber;
    merged.inboundStatus = merged.inboundStatus ?? previous.inboundStatus;
    merged.inboundSource = merged.inboundSource ?? previous.inboundSource;
  }

  return merged;
}

function TripTrackerLogo() {
  return (
    <svg aria-hidden="true" className="triptracker-logo" viewBox="0 0 64 64">
      <defs>
        <linearGradient id="triptrackerLogoGradient" x1="11" y1="12" x2="52" y2="54" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8ff7ed" />
          <stop offset="0.55" stopColor="#4fd1c5" />
          <stop offset="1" stopColor="#7dd3fc" />
        </linearGradient>
      </defs>
      <circle className="logo-orbit" cx="32" cy="32" r="24" />
      <path className="logo-route glow" d="M15 41c8-14 19-22 34-24" />
      <path className="logo-route" d="M15 41c8-14 19-22 34-24" />
      <g className="logo-aircraft" transform="translate(38 25) rotate(-28)">
        <path d="M0-11v22" />
        <path d="M0-1 10 5" />
        <path d="M0-1-10 5" />
        <path d="M0 7 4 10" />
        <path d="M0 7-4 10" />
      </g>
      <circle className="logo-dot origin" cx="15" cy="41" r="3.2" />
      <circle className="logo-dot destination" cx="49" cy="17" r="4" />
    </svg>
  );
}

function soundEventsForFlightChange(previous: FlightLeg, next: FlightLeg): SoundEventType[] {
  const events: SoundEventType[] = [];
  if (previous.status !== "En Route" && next.status === "En Route") {
    events.push("takeoff");
  }
  if (previous.status !== "Landed" && previous.status !== "Arrived" && (next.status === "Landed" || next.status === "Arrived")) {
    events.push("landing");
  }

  const previousDepartureGate = gateDisplay(previous.terminal, previous.boardingGate);
  const nextDepartureGate = gateDisplay(next.terminal, next.boardingGate);
  const previousArrivalGate = gateDisplay(previous.arrivalTerminal, previous.arrivalGate);
  const nextArrivalGate = gateDisplay(next.arrivalTerminal, next.arrivalGate);
  const departureChanged = previousDepartureGate !== nextDepartureGate && nextDepartureGate !== "Pending";
  const arrivalChanged = previousArrivalGate !== nextArrivalGate && nextArrivalGate !== "Pending";
  if (departureChanged || arrivalChanged) {
    events.push("gate");
  }
  return events;
}

function splitFlightDesignator(value: string): [string, string] {
  const spaced = value.trim().match(/^([A-Z0-9]{2,3})\s+(\d+)$/i);
  if (spaced) return [spaced[1], spaced[2]];
  const compact = value.trim().match(/^([A-Z0-9]{2,3})(\d+)$/i);
  if (compact) return [compact[1], compact[2]];
  return value.split(" ", 2) as [string, string];
}

function landedTimestamp(flight: FlightLeg): number {
  const landedAt = new Date(flight.landedAt ?? flight.arrivalTime).getTime();
  return Number.isFinite(landedAt) ? landedAt : Date.now();
}

function shouldRemoveLandedFlight(flight: FlightLeg, now = Date.now()): boolean {
  return flight.status === "Landed" && now - landedTimestamp(flight) >= landedDisplayMs;
}

function landedDisplayFlight(flight: FlightLeg, previous?: FlightLeg): FlightLeg {
  if (flight.status !== "Arrived") return flight;
  return {
    ...flight,
    status: "Landed",
    landedAt: previous?.landedAt ?? new Date().toISOString(),
    alerts: replaceFlightStatusAlert(flight, "Landed"),
  };
}

function replaceFlightStatusAlert(flight: FlightLeg, status: FlightLeg["status"]): FlightLeg["alerts"] {
  const statusAlert = {
    id: `${flight.id}-landed`,
    type: "status" as const,
    priority: "high" as const,
    title: status,
    message: `${flight.flightNumber} has landed at ${flight.destination.code}. It will remain visible for 10 minutes.`,
    timestamp: new Date().toISOString(),
  };
  return [statusAlert, ...flight.alerts.filter((alert) => alert.type !== "status")];
}

function mergeTrackedFlightLists(localFlights: FlightLeg[], serverFlights: FlightLeg[]): FlightLeg[] {
  const merged = new Map<string, FlightLeg>();
  localFlights.forEach((flight) => {
    if (!shouldRemoveLandedFlight(flight)) merged.set(flight.id, flight);
  });
  serverFlights.forEach((flight) => {
    if (!shouldRemoveLandedFlight(flight)) {
      merged.set(flight.id, mergeKnownFlightEnrichment(merged.get(flight.id), flight));
    }
  });
  return [...merged.values()].sort((a, b) => (
    new Date(b.lastUpdated ?? b.departureTime).getTime() - new Date(a.lastUpdated ?? a.departureTime).getTime()
  ));
}

function flightIdentityKey(flight: FlightLeg): string {
  return [
    flight.flightNumber.replace(/\s+/g, "").toUpperCase(),
    flight.date,
    flight.origin.code,
    flight.destination.code,
  ].join("::");
}

function serverTrackedFlightKey(flight: FlightLeg): string {
  const match = flight.flightNumber.trim().match(/^([A-Z0-9]{2,3})\s*(\d+[A-Z]?)$/i);
  const designator = match
    ? `${match[1].toUpperCase()}-${match[2].replace(/\D/g, "")}`
    : flight.flightNumber;
  return `${designator}-${flight.date}-${flight.origin.code}-${flight.destination.code}`;
}

function nextActiveId(currentActiveId: string | null, currentFlights: FlightLeg[], nextFlights: FlightLeg[], concludedIds = new Set<string>()): string | null {
  if (nextFlights.length === 0) return null;
  if (!currentActiveId || concludedIds.has(currentActiveId)) return nextFlights[0].id;
  if (nextFlights.some((flight) => flight.id === currentActiveId)) return currentActiveId;

  const currentActiveFlight = currentFlights.find((flight) => flight.id === currentActiveId);
  if (!currentActiveFlight) return nextFlights[0].id;

  const currentFlightKey = flightIdentityKey(currentActiveFlight);
  return nextFlights.find((flight) => flightIdentityKey(flight) === currentFlightKey)?.id ?? nextFlights[0].id;
}

function delayOutlook(
  flight: FlightLeg,
  statistics: FlightStatistics,
  originWeather?: WeatherSnapshot,
  destinationWeather?: WeatherSnapshot,
  airportDelays?: AirportDelayReport | null,
): DelayOutlook {
  if (flight.status === "Landed" || flight.status === "Arrived") {
    return {
      label: "Complete",
      tone: "complete",
      score: 0,
      summary: "This flight has completed. The history below remains available for context.",
      factors: [],
    };
  }

  let score = statistics.historicalRiskPercent ?? 25;
  const factors: string[] = [];
  let hasCurrentSignal = false;

  if (flight.status === "Cancelled") {
    score = 100;
    factors.push("This flight is currently cancelled");
    hasCurrentSignal = true;
  } else if (flight.status === "Delayed") {
    score = Math.max(score, 90);
    factors.push("The live status already reports a delay");
    hasCurrentSignal = true;
  }

  if (flight.inboundStatus === "Cancelled") {
    score += 30;
    factors.push("The assigned inbound flight is cancelled");
    hasCurrentSignal = true;
  } else if (flight.inboundStatus === "Delayed") {
    score += 18;
    factors.push("The inbound aircraft is delayed");
    hasCurrentSignal = true;
  } else if ((flight.inboundStatus === "Scheduled" || flight.inboundStatus === "Boarding") &&
    new Date(flight.departureTime).getTime() - Date.now() < 90 * 60 * 1000 &&
    new Date(flight.departureTime).getTime() > Date.now()) {
    score += 10;
    factors.push("The inbound aircraft has not departed with less than 90 minutes to scheduled departure");
    hasCurrentSignal = true;
  }

  [
    { label: "Origin", weather: originWeather },
    { label: "Destination", weather: destinationWeather },
  ].forEach(({ label, weather }) => {
    if (!weather || weather.condition === "Unavailable") return;
    if (/thunder|snow|fog|freezing/i.test(weather.condition)) {
      score += 12;
      factors.push(`${label} weather reports ${weather.condition.toLowerCase()}`);
      hasCurrentSignal = true;
    } else if (/rain|shower/i.test(weather.condition)) {
      score += 5;
      factors.push(`${label} weather reports ${weather.condition.toLowerCase()}`);
      hasCurrentSignal = true;
    }
    if (weather.windMph >= 25) {
      score += 8;
      factors.push(`${label} winds are ${weather.windMph} mph`);
      hasCurrentSignal = true;
    }
  });

  [
    { code: flight.origin.code, label: "Origin", role: "origin" as const },
    { code: flight.destination.code, label: "Destination", role: "destination" as const },
  ].forEach(({ code, label, role }) => {
    const airport = airportDelays?.airports.find((item) => item.airportCode === code);
    if (!airport) return;
    const relevantEvents = airport.events.filter((event) => (
      event.type === "airport_closure" ||
      (role === "destination" && ["ground_stop", "ground_delay", "arrival_delay"].includes(event.type)) ||
      (role === "origin" && ["departure_delay", "deicing"].includes(event.type))
    ));
    const event = relevantEvents[0];
    if (!event) return;

    const eventScore = {
      airport_closure: 45,
      ground_stop: 35,
      ground_delay: Math.min(30, Math.max(15, Math.round((event.averageDelayMinutes ?? 30) / 2))),
      arrival_delay: Math.min(24, Math.max(8, Math.round((event.averageDelayMinutes ?? 15) / 2))),
      departure_delay: Math.min(24, Math.max(8, Math.round((event.averageDelayMinutes ?? 15) / 2))),
      deicing: 8,
      airport_restriction: 0,
    }[event.type];
    score += eventScore;
    factors.push(`${label} airport: ${event.title.toLowerCase()}${event.averageDelayMinutes ? ` (${event.averageDelayMinutes}m avg)` : ""}`);
    hasCurrentSignal = true;
  });

  score = Math.max(0, Math.min(100, Math.round(score)));
  if (statistics.sampleSize === 0 && !hasCurrentSignal) {
    return {
      label: "Unknown",
      tone: "unknown",
      score: null,
      summary: "Not enough route-matched history or live warning signals are available for a useful assessment.",
      factors: [],
    };
  }

  const label = score < 25 ? "Low" : score < 45 ? "Moderate" : "High";
  const summary = statistics.sampleSize > 0
    ? `${statistics.delayedFlights + statistics.cancelledFlights} of ${statistics.sampleSize} recent route-matched flights had a 15+ minute departure delay or cancellation.`
    : "This assessment is based on current operational signals because route history is limited.";
  return { label, tone: label.toLowerCase() as DelayOutlook["tone"], score, summary, factors };
}

function delayVarianceLabel(value: number | null): string {
  if (value === null) return "Pending";
  if (value < 0) return `${Math.abs(value)}m early`;
  if (value === 0) return "On schedule";
  return `${value}m late`;
}

function historyDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(`${value}T00:00:00`));
}

export function App() {
  const [airline, setAirline] = useState("");
  const [flightNumber, setFlightNumber] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [flights, setFlights] = useState<FlightLeg[]>(() => {
    const saved = window.localStorage.getItem(storageKey);
    return saved ? JSON.parse(saved) as FlightLeg[] : [];
  });
  const [activeId, setActiveId] = useState<string | null>(flights[0]?.id ?? null);
  const [isLoading, setIsLoading] = useState(false);
  const [weather, setWeather] = useState<Record<string, WeatherSnapshot>>({});
  const [airlineFocused, setAirlineFocused] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [flightChoices, setFlightChoices] = useState<FlightLeg[]>([]);
  const [liveMatches, setLiveMatches] = useState<FlightLeg[]>([]);
  const [liveSearchMessage, setLiveSearchMessage] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);
  const [statistics, setStatistics] = useState<FlightStatistics | null>(null);
  const [statisticsError, setStatisticsError] = useState<string | null>(null);
  const [isLoadingStatistics, setIsLoadingStatistics] = useState(false);
  const [airportDelays, setAirportDelays] = useState<AirportDelayReport | null>(null);
  const [airportDelaysError, setAirportDelaysError] = useState<string | null>(null);
  const [isLoadingAirportDelays, setIsLoadingAirportDelays] = useState(false);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const audioContextRef = useRef<AudioContext | null>(null);
  const lastSoundAtRef = useRef<Record<string, number>>({});
  const deletedFlightKeysRef = useRef<Set<string>>(new Set());
  const serverUntrackedFlightKeysRef = useRef<Set<string>>(new Set());

  const activeFlight = activeId ? flights.find((flight) => flight.id === activeId) : flights[0];
  const activeTiming = activeFlight ? flightTiming(activeFlight) : null;
  const activeBoarding = activeFlight ? boardingEstimate(activeFlight) : null;
  const activeDelayHasNoTimeChange = activeTiming?.state === "delayed"
    && !activeTiming.departure.isDelayed
    && !activeTiming.arrival.isDelayed;
  const activeStatisticsKey = activeFlight ? flightIdentityKey(activeFlight) : "";
  const activeAirportDelayKey = activeFlight ? `${activeFlight.origin.code}:${activeFlight.destination.code}` : "";
  const activeTailNumber = activeFlight?.tailNumber ?? activeFlight?.aircraftPosition?.tailNumber;
  const activeInboundStatus = inboundStatusLabel(activeFlight?.inboundStatus);
  const activeInboundText = activeFlight?.inboundFrom
    ? `${activeFlight.inboundFrom.code} ${activeFlight.inboundFrom.city}${activeFlight.inboundFlightNumber ? ` via ${activeFlight.inboundFlightNumber}` : ""}${activeInboundStatus ? `, ${activeInboundStatus}` : ""}`
    : "";
  const airlineSuggestions = airlineMatches(airline).slice(0, 6);
  const hasLiveSearchInput = airline.trim().length >= 2 && flightNumber.length >= 2 && Boolean(date);
  const timeline = useMemo(() => {
    if (!activeFlight) return [];
    const routeItem = {
      id: `${activeFlight.id}-route`,
      priority: "normal" as const,
      title: "Route monitored",
      message: `${activeFlight.origin.code} to ${activeFlight.destination.code} is being watched for departure, gate, and arrival changes. Source: ${activeFlight.dataSource}.`,
      timestamp: activeFlight.lastUpdated,
    };
    return [...activeFlight.alerts, routeItem]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [activeFlight]);

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(flights));
    const trackableFlights = flights.filter((flight) => !serverUntrackedFlightKeysRef.current.has(serverTrackedFlightKey(flight)));
    void registerTrackedFlights(trackableFlights);
  }, [flights]);

  useEffect(() => {
    const intervalId = window.setInterval(() => setClockNow(Date.now()), 15 * 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!hasLiveSearchInput) {
      setLiveMatches([]);
      setLiveSearchMessage(null);
      setIsSearching(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setIsSearching(true);
      setLiveSearchMessage(null);
      searchFlights(airline.trim(), flightNumber, date, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return;
          setLiveMatches(result.flights);
          setLiveSearchMessage(result.message);
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          setLiveMatches([]);
          setLiveSearchMessage(error instanceof Error ? error.message : "Live flight search is temporarily unavailable.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsSearching(false);
        });
    }, 650);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [airline, date, flightNumber, hasLiveSearchInput]);

  useEffect(() => {
    let cancelled = false;
    fetchTrackedFlights()
      .then((snapshot) => {
        if (cancelled) return;
        snapshot.untrackedFlightKeys.forEach((key) => serverUntrackedFlightKeysRef.current.add(key));
        setFlights((current) => {
          const nextFlights = mergeTrackedFlightLists(current, snapshot.flights)
            .filter((flight) => (
              !deletedFlightKeysRef.current.has(flightIdentityKey(flight))
              && !serverUntrackedFlightKeysRef.current.has(serverTrackedFlightKey(flight))
            ));
          setActiveId((currentActiveId) => nextActiveId(currentActiveId, current, nextFlights));
          return nextFlights;
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (flights.length === 0) return;
    const intervalId = window.setInterval(() => {
      void refreshTrackedFlights(true);
    }, refreshIntervalMs);
    return () => window.clearInterval(intervalId);
  }, [flights]);

  useEffect(() => {
    if (!activeFlight) return;
    [activeFlight.origin, activeFlight.destination].forEach((airport) => {
      if (weather[airport.code]) return;
      fetchWeather(airport)
        .then((snapshot) => setWeather((current) => ({ ...current, [airport.code]: snapshot })))
        .catch(() => {
          setWeather((current) => ({
            ...current,
            [airport.code]: {
              airportCode: airport.code,
              temperatureF: 0,
              windMph: 0,
              precipitationChance: 0,
              condition: "Unavailable",
            },
          }));
        });
    });
  }, [activeFlight, weather]);

  useEffect(() => {
    const flight = activeFlight;
    if (!flight) {
      setStatistics(null);
      setStatisticsError(null);
      setIsLoadingStatistics(false);
      return;
    }

    const controller = new AbortController();
    setStatistics(null);
    setStatisticsError(null);
    setIsLoadingStatistics(true);
    fetchFlightStatistics(flight, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setStatistics(result);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setStatisticsError(error instanceof Error ? error.message : "Historical statistics are unavailable.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoadingStatistics(false);
      });

    return () => controller.abort();
  }, [activeStatisticsKey]);

  useEffect(() => {
    const flight = activeFlight;
    if (!flight) {
      setAirportDelays(null);
      setAirportDelaysError(null);
      setIsLoadingAirportDelays(false);
      return;
    }

    const controller = new AbortController();
    let requestInProgress = false;
    setAirportDelays(null);
    setAirportDelaysError(null);
    setIsLoadingAirportDelays(true);

    const loadAirportDelays = async (initialLoad = false) => {
      if (requestInProgress) return;
      requestInProgress = true;
      try {
        const report = await fetchAirportDelays([flight.origin.code, flight.destination.code], controller.signal);
        if (!controller.signal.aborted) {
          setAirportDelays(report);
          setAirportDelaysError(null);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setAirportDelaysError(error instanceof Error ? error.message : "Airport delay status is unavailable.");
        }
      } finally {
        requestInProgress = false;
        if (initialLoad && !controller.signal.aborted) setIsLoadingAirportDelays(false);
      }
    };

    void loadAirportDelays(true);
    const intervalId = window.setInterval(() => void loadAirportDelays(), 60 * 1000);
    return () => {
      controller.abort();
      window.clearInterval(intervalId);
    };
  }, [activeAirportDelayKey]);

  async function addFlight(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void primeAudio();
    setIsLoading(true);
    setLookupError(null);
    setFlightChoices([]);
    setLiveMatches([]);
    setLiveSearchMessage(null);
    try {
      const result = await lookupFlight(airline.trim(), flightNumber.trim(), date, { track: true });
      if (isAmbiguousLookup(result)) {
        setFlightChoices(result.flights);
        setLookupError(result.message);
        return;
      }
      const flight = landedDisplayFlight(result);
      deletedFlightKeysRef.current.delete(flightIdentityKey(flight));
      serverUntrackedFlightKeysRef.current.delete(serverTrackedFlightKey(flight));
      setFlights((current) => [flight, ...current.filter((item) => item.id !== flight.id)]);
      setActiveId(flight.id);
      setLastRefreshAt(new Date().toISOString());
    } catch (error) {
      setLookupError(error instanceof Error ? error.message : "No live flight data found.");
    } finally {
      setIsLoading(false);
    }
  }

  async function trackSelectedFlight(choice: FlightLeg) {
    void primeAudio();
    setIsLoading(true);
    setLookupError(null);
    try {
      const flight = landedDisplayFlight(requireSingleFlight(await lookupFlight(
        choice.airlineCode,
        choice.flightNumber.split(" ")[1] ?? flightNumber.trim(),
        choice.date,
        { track: true, flightId: choice.id },
      )));
      deletedFlightKeysRef.current.delete(flightIdentityKey(flight));
      serverUntrackedFlightKeysRef.current.delete(serverTrackedFlightKey(flight));
      setFlights((current) => [flight, ...current.filter((item) => item.id !== flight.id)]);
      setActiveId(flight.id);
      setLiveMatches([]);
      setLiveSearchMessage(null);
      setFlightChoices([]);
      setLastRefreshAt(new Date().toISOString());
    } catch (error) {
      setLookupError(error instanceof Error ? error.message : "No live flight data found.");
    } finally {
      setIsLoading(false);
    }
  }

  async function refreshActiveFlight() {
    if (!activeFlight) return;
    void primeAudio();
    setIsLoading(true);
    setLookupError(null);
    try {
      await refreshTrackedFlights(false, activeFlight.id);
    } catch (error) {
      setLookupError(error instanceof Error ? error.message : "No live flight data found.");
    } finally {
      setIsLoading(false);
    }
  }

  async function refreshTrackedFlights(silent: boolean, focusedFlightId?: string) {
    const flightsToRefresh = focusedFlightId
      ? flights.filter((flight) => flight.id === focusedFlightId)
      : flights;
    if (flightsToRefresh.length === 0) return;

    const serverSnapshot = await fetchTrackedFlights().catch(() => null);
    serverSnapshot?.untrackedFlightKeys.forEach((key) => serverUntrackedFlightKeysRef.current.add(key));
    const remotelyRemovedIds = new Set(
      flights
        .filter((flight) => serverUntrackedFlightKeysRef.current.has(serverTrackedFlightKey(flight)))
        .map((flight) => flight.id),
    );
    const expiredLandedFlights = flightsToRefresh.filter((flight) => (
      !remotelyRemovedIds.has(flight.id) && shouldRemoveLandedFlight(flight)
    ));
    const expiredLandedIds = new Set(expiredLandedFlights.map((flight) => flight.id));
    const lookupFlights = flightsToRefresh.filter((flight) => (
      !expiredLandedIds.has(flight.id) && !remotelyRemovedIds.has(flight.id)
    ));
    const refreshed = await Promise.allSettled(lookupFlights.map((flight) => {
      const [code, number] = splitFlightDesignator(flight.flightNumber);
      return lookupFlight(code, number, flight.date, { monitor: true, flightId: flight.id }).then(requireSingleFlight);
    }));
    const refreshMap = new Map<string, FlightLeg>();
    const concludedIds = new Set<string>(remotelyRemovedIds);
    const conclusionCandidates = new Map<string, { flight: FlightLeg; changes: string[] }>();
    const failures: string[] = [];

    expiredLandedFlights.forEach((flight) => {
      conclusionCandidates.set(flight.id, {
        flight,
        changes: ["Flight landed 10 minutes ago; tracking concluded"],
      });
    });

    refreshed.forEach((result, index) => {
      const original = lookupFlights[index];
      if (result.status === "fulfilled") {
        const nextFlight = mergeKnownFlightEnrichment(original, landedDisplayFlight(result.value, original));
        const changes = describeFlightChanges(original, nextFlight);
        refreshMap.set(original.id, nextFlight);
        soundEventsForFlightChange(original, nextFlight).forEach((eventType) => {
          playFlightSound(eventType, original.id);
        });
        if (shouldRemoveLandedFlight(nextFlight)) {
          conclusionCandidates.set(original.id, {
            flight: nextFlight,
            changes: changes.length > 0 ? changes : ["Flight landed 10 minutes ago; tracking concluded"],
          });
        } else if (changes.length > 0) {
          notifyFlightEvent("updated", nextFlight, changes);
        }
      } else {
        failures.push(original.flightNumber);
      }
    });

    const conclusionResults = await Promise.all([...conclusionCandidates.entries()].map(async ([flightId, candidate]) => ({
      flightId,
      flight: candidate.flight,
      concluded: await concludeFlightEvent(candidate.flight, candidate.changes),
    })));
    conclusionResults.forEach((result) => {
      if (!result.concluded) return;
      concludedIds.add(result.flightId);
      serverUntrackedFlightKeysRef.current.add(serverTrackedFlightKey(result.flight));
    });

    if (refreshMap.size > 0 || concludedIds.size > 0) {
      setFlights((current) => {
        const nextFlights = current
          .map((flight) => refreshMap.get(flight.id) ?? flight)
          .filter((flight) => (
            !concludedIds.has(flight.id)
            && !deletedFlightKeysRef.current.has(flightIdentityKey(flight))
            && !serverUntrackedFlightKeysRef.current.has(serverTrackedFlightKey(flight))
          ));
        setActiveId((currentActiveId) => nextActiveId(currentActiveId, current, nextFlights, concludedIds));
        return nextFlights;
      });
      setLastRefreshAt(new Date().toISOString());
    }

    if (failures.length > 0 && !silent) {
      throw new Error(`Refresh failed for ${failures.join(", ")}.`);
    }
  }

  async function deleteFlight(flightId: string) {
    const removedFlight = flights.find((flight) => flight.id === flightId);
    if (!removedFlight) return;
    try {
      await untrackFlight(removedFlight);
    } catch (error) {
      setLookupError(error instanceof Error ? error.message : "Could not stop tracking this flight.");
      return;
    }
    deletedFlightKeysRef.current.add(flightIdentityKey(removedFlight));
    serverUntrackedFlightKeysRef.current.add(serverTrackedFlightKey(removedFlight));
    setFlights((current) => {
      const next = current.filter((flight) => flight.id !== flightId);
      setActiveId((currentActiveId) => nextActiveId(currentActiveId, current, next, new Set([flightId])));
      return next;
    });
  }

  async function primeAudio(): Promise<AudioContext | null> {
    if (audioContextRef.current) {
      if (audioContextRef.current.state === "suspended") {
        await audioContextRef.current.resume().catch(() => undefined);
      }
      return audioContextRef.current;
    }

    const AudioContextConstructor = window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
    if (!AudioContextConstructor) return null;
    const context = new AudioContextConstructor();
    audioContextRef.current = context;
    if (context.state === "suspended") {
      await context.resume().catch(() => undefined);
    }
    return context;
  }

  function playFlightSound(eventType: SoundEventType, flightId: string) {
    const key = `${flightId}:${eventType}`;
    const now = Date.now();
    if (now - (lastSoundAtRef.current[key] ?? 0) < 20000) return;
    lastSoundAtRef.current[key] = now;

    void primeAudio().then((context) => {
      if (!context) return;
      const start = context.currentTime + 0.02;
      const patterns: Record<SoundEventType, number[]> = {
        takeoff: [523, 659, 784],
        landing: [784, 659, 523],
        gate: [880, 880],
      };

      patterns[eventType].forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const toneStart = start + index * 0.16;
        oscillator.type = eventType === "gate" ? "square" : "sine";
        oscillator.frequency.setValueAtTime(frequency, toneStart);
        gain.gain.setValueAtTime(0.0001, toneStart);
        gain.gain.exponentialRampToValueAtTime(0.08, toneStart + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, toneStart + 0.14);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(toneStart);
        oscillator.stop(toneStart + 0.16);
      });
    });
  }

  return (
    <main className="app-shell" onPointerDown={() => void primeAudio()}>
      <section className="topbar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            <TripTrackerLogo />
          </div>
          <div>
            <p className="eyebrow">Live flight intelligence</p>
            <h1>TripTracker</h1>
            <span className="app-version">TripTracker v{appVersion}</span>
          </div>
        </div>
        <div className="brand-route-art" aria-hidden="true">
          <span className="brand-route-stop origin" />
          <span className="brand-route-line" />
          <Plane className="brand-route-plane" size={22} />
          <span className="brand-route-stop destination" />
        </div>
        <div className="freshness">
          <Radar className="freshness-radar" size={18} />
          <span>
            Auto-refresh every 30 seconds
            <small>Last refresh: {formatTimestamp(lastRefreshAt)}</small>
          </span>
        </div>
      </section>

      {flights.length > 0 && (
        <section className="top-flight-switcher" aria-label="Tracked flights">
          <div className="section-heading">
            <Plane size={18} />
            <h2>Tracked Flights</h2>
          </div>
          <div className="tracked-list">
            {flights.map((flight) => {
              const timing = flightTiming(flight);
              return (
                <div className={`tracked-flight timing-${timing.state} status-${flight.status.toLowerCase().replace(/\s+/g, "-")} ${flight.id === activeFlight?.id ? "active" : ""}`} key={flight.id}>
                  <button onClick={() => setActiveId(flight.id)} type="button">
                    <AirlineLogo code={flight.airlineCode ?? splitFlightDesignator(flight.flightNumber)[0]} logoUrl={flight.airlineLogoUrl} size="small" />
                    <span className="tracked-copy">
                      <strong>{flight.flightNumber}</strong>
                      <span className="tracked-route">{flight.origin.code}<ArrowRight size={13} />{flight.destination.code}</span>
                      <em>{timingLabel(timing)} · {flight.status}</em>
                    </span>
                  </button>
                  <button
                    aria-label={`Delete ${flight.flightNumber}`}
                    className="delete-flight"
                    onClick={(event) => {
                      event.stopPropagation();
                      void deleteFlight(flight.id);
                    }}
                    type="button"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className={`tracker-grid ${activeFlight ? "has-active-flight" : ""}`}>
        <aside className="sidebar">
          <form className="lookup-panel" onSubmit={addFlight}>
            <div className="panel-title">
              <Search size={18} />
              <h2>Track a Flight</h2>
            </div>
            <label>
              Airline
              <div className="smart-field">
                <input
                  value={airline}
                  onBlur={() => window.setTimeout(() => setAirlineFocused(false), 120)}
                  onChange={(event) => {
                    setAirline(event.target.value);
                    setFlightChoices([]);
                  }}
                  onFocus={() => setAirlineFocused(true)}
                  placeholder="Enter Airline"
                />
                {airlineFocused && airlineSuggestions.length > 0 && (
                  <div className="suggestions">
                    {airlineSuggestions.map((match) => (
                      <button type="button" key={match.code} onClick={() => {
                        setAirline(match.name);
                        setAirlineFocused(false);
                      }}>
                        <AirlineLogo code={match.code} logoUrl={match.logoUrl} size="small" />
                        <strong>{match.code}</strong>
                        <span>{match.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </label>
            <label>
              Flight number
              <div className="smart-field">
                <input
                  value={flightNumber}
                  onChange={(event) => {
                    setFlightNumber(event.target.value.replace(/\D/g, ""));
                    setFlightChoices([]);
                  }}
                  inputMode="numeric"
                  placeholder="Enter flight number"
                />
              </div>
            </label>
            <label>
              Date
              <input type="date" value={date} onChange={(event) => {
                setDate(event.target.value);
                setFlightChoices([]);
              }} />
            </label>
            <button type="submit" disabled={isLoading}>
              <Search size={17} />
              {isLoading ? "Checking" : "Track flight"}
            </button>
            {lookupError && <p className="lookup-error">{lookupError}</p>}
            {hasLiveSearchInput && flightChoices.length === 0 && (
              <div className="live-search-results" aria-live="polite">
                <div className={`live-search-feedback ${liveMatches.length > 0 ? "found" : ""}`}>
                  {isSearching ? <LoaderCircle className="spin" size={17} /> : liveMatches.length > 0 ? <CheckCircle2 size={17} /> : <Search size={17} />}
                  <span>{isSearching ? "Searching live flight schedules..." : liveSearchMessage ?? "Waiting for flight details..."}</span>
                </div>
                {!isSearching && liveMatches.map((match) => (
                  <div className="live-search-result" key={match.id}>
                    <AirlineLogo code={match.airlineCode} logoUrl={match.airlineLogoUrl} size="small" />
                    <div className="live-search-flight">
                      <div>
                        <strong>{match.flightNumber}</strong>
                        <span>{match.status}</span>
                      </div>
                      <div className="live-search-route">
                        <span>
                          <strong>{match.origin.code}</strong>
                          <small>{formatZonedTime(match.departureTime, match.origin.timeZone)}</small>
                        </span>
                        <ArrowRight size={16} />
                        <span>
                          <strong>{match.destination.code}</strong>
                          <small>{formatZonedTime(match.arrivalTime, match.destination.timeZone)}</small>
                        </span>
                      </div>
                    </div>
                    <button
                      aria-label={`Track ${match.flightNumber} from ${match.origin.code} to ${match.destination.code}`}
                      className="track-search-result"
                      disabled={isLoading}
                      onClick={() => void trackSelectedFlight(match)}
                      type="button"
                    >
                      <Search size={15} />
                      Track
                    </button>
                  </div>
                ))}
              </div>
            )}
            {flightChoices.length > 0 && (
              <div className="flight-choices">
                {flightChoices.map((choice) => (
                  <button
                    className="flight-choice"
                    disabled={isLoading}
                    key={choice.id}
                    onClick={() => void trackSelectedFlight(choice)}
                    type="button"
                  >
                    <span>
                      <strong>{choice.origin.code} to {choice.destination.code}</strong>
                      <em>{choice.origin.city} to {choice.destination.city}</em>
                    </span>
                    <span>
                      <strong>{formatZonedTime(choice.departureTime, choice.origin.timeZone)}</strong>
                      <em>{choice.status}</em>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </form>

          <div className="section-heading">
            <Bell size={18} />
            <h2>Flight Timeline</h2>
          </div>
          <div className="timeline">
            {!activeFlight ? (
              <p className="empty">Track a flight to start a focused operational timeline.</p>
            ) : timeline.map((item, index) => (
              <article className={`timeline-item ${item.priority}`} key={item.id}>
                <div className="timeline-marker">{index + 1}</div>
                <div>
                  <div className="timeline-meta">
                    <span>{item.priority}</span>
                    <small>{timeAgo(item.timestamp)}</small>
                  </div>
                  <strong>{item.title}</strong>
                  <p>{item.message}</p>
                </div>
              </article>
            ))}
          </div>

        </aside>

        <section className="dashboard">
          {activeFlight ? (
            <>
              <section className="live-flight-panel">
                <FlightMap flight={activeFlight} />
                <article className="flight-card">
                  <div className="flight-card-top">
                    <div className="airline-title">
                      <AirlineLogo
                        code={activeFlight.airlineCode ?? splitFlightDesignator(activeFlight.flightNumber)[0]}
                        logoUrl={activeFlight.airlineLogoUrl}
                      />
                      <div>
                        <p>{activeFlight.airline}</p>
                        <h2>{activeFlight.flightNumber}</h2>
                        <span>{formatDate(activeFlight.date)} / {activeFlight.origin.code} to {activeFlight.destination.code}</span>
                      </div>
                    </div>
                    <button className="icon-button" onClick={refreshActiveFlight} disabled={isLoading} aria-label="Refresh flight">
                      <RefreshCw size={18} />
                    </button>
                  </div>

                  <div className={`status-banner timing-${activeTiming?.state ?? "on-time"} ${activeFlight.status.toLowerCase().replace(/\s+/g, "-")}`}>
                    <div className="status-banner-copy">
                      <strong>{activeTiming ? timingLabel(activeTiming) : activeFlight.status}</strong>
                      <small>{statusLead(activeFlight)}</small>
                    </div>
                    <span>{activeFlight.status}</span>
                  </div>

                  {activeBoarding && (
                    <BoardingCountdown estimate={activeBoarding} flight={activeFlight} now={clockNow} />
                  )}

                  <div className="route-times">
                    <div className="airport-stop">
                      <small>{activeFlight.origin.code} / {activeFlight.origin.name}</small>
                      <FlightTimeDisplay
                        comparison={activeTiming!.departure}
                        forceDelayTone={activeDelayHasNoTimeChange}
                        timeZone={activeFlight.origin.timeZone ?? "America/New_York"}
                      />
                      <em>{activeFlight.origin.city}</em>
                    </div>

                    <div className="route-progress">
                      <span>{activeFlight.progress}%</span>
                      <div className="route-progress-track">
                        <i style={{ width: `${activeFlight.progress}%` }} />
                        <Plane
                          aria-hidden="true"
                          className="route-progress-plane"
                          size={18}
                          style={{ left: `${Math.max(2, Math.min(98, activeFlight.progress))}%` }}
                        />
                      </div>
                    </div>

                    <div className="airport-stop">
                      <small>{activeFlight.destination.code} / {activeFlight.destination.name}</small>
                      <FlightTimeDisplay
                        comparison={activeTiming!.arrival}
                        forceDelayTone={activeDelayHasNoTimeChange}
                        timeZone={activeFlight.destination.timeZone ?? "America/New_York"}
                      />
                      <em>{activeFlight.destination.city}</em>
                    </div>
                  </div>

                  <div className="gate-row">
                    <div>
                      <small>Boarding</small>
                      <strong>{gateDisplay(activeFlight.terminal, activeFlight.boardingGate)}</strong>
                    </div>
                    <div>
                      <small>Arrival</small>
                      <strong>{gateDisplay(activeFlight.arrivalTerminal, activeFlight.arrivalGate)}</strong>
                    </div>
                  </div>

                  <div className="compact-facts">
                    <span><Timer size={15} /> {activeFlight.groundSpeedMph ? `${activeFlight.groundSpeedMph} mph` : "Speed pending"}</span>
                    <span><Plane size={15} /> {altitudeLabel(activeFlight)}</span>
                    <span>
                      <Plane size={15} /> Tail{" "}
                      {activeTailNumber ? (
                        <a href={aircraftPhotoUrl(activeTailNumber)} target="_blank" rel="noreferrer" title={`View photos of ${activeTailNumber}`}>
                          {activeTailNumber}
                        </a>
                      ) : "pending"}
                    </span>
                    <span className="inbound-fact"><MapPin size={15} /> Inbound {activeInboundText || "pending"}</span>
                    <span><MapPin size={15} /> Updated {timeAgo(activeFlight.lastUpdated)}</span>
                  </div>

                  <p className="source-line">
                    Source: {activeFlight.dataSource}
                    {activeFlight.inboundSource && ` Inbound source: ${activeFlight.inboundSource}.`}
                    {activeFlight.sourceUrl && <a href={activeFlight.sourceUrl} target="_blank" rel="noreferrer"> Open source</a>}
                  </p>
                </article>
              </section>

              <FlightStatisticsPanel
                airportDelays={airportDelays}
                error={statisticsError}
                flight={activeFlight}
                isLoading={isLoadingStatistics}
                originWeather={weather[activeFlight.origin.code]}
                destinationWeather={weather[activeFlight.destination.code]}
                statistics={statistics}
              />

              <AirportDelayPanel
                error={airportDelaysError}
                flight={activeFlight}
                isLoading={isLoadingAirportDelays}
                report={airportDelays}
              />

              <div className="detail-grid">
                <WeatherCard title="Origin weather" code={activeFlight.origin.code} weather={weather[activeFlight.origin.code]} />
                <WeatherCard title="Destination weather" code={activeFlight.destination.code} weather={weather[activeFlight.destination.code]} />
                <div className="ops-panel">
                  <div className="section-heading">
                    <AlertTriangle size={18} />
                    <h2>En Route</h2>
                  </div>
                  <dl>
                    <div><dt>Progress</dt><dd>{activeFlight.progress}%</dd></div>
                    <div><dt>Altitude</dt><dd>{altitudeLabel(activeFlight)}</dd></div>
                    <div><dt>Speed</dt><dd>{activeFlight.groundSpeedMph ? `${activeFlight.groundSpeedMph} mph` : "Pending"}</dd></div>
                    <div><dt>Updated</dt><dd>{timeAgo(activeFlight.lastUpdated)}</dd></div>
                  </dl>
                </div>
              </div>
            </>
          ) : (
            <div className="empty-state">
              <Plane size={42} />
              <h2>Add a flight to monitor</h2>
              <p>Enter airline, flight number, and date to create a tracked trip with gate, weather, route, and status monitoring.</p>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

function AirlineLogo({ code, logoUrl, size = "default" }: { code: string; logoUrl?: string; size?: "default" | "small" }) {
  const [failedUrls, setFailedUrls] = useState<string[]>([]);
  const normalizedCode = code.toUpperCase();
  const fallbackLogo = airlineLogoFor(normalizedCode);
  const logoCandidates = [logoUrl, fallbackLogo]
    .filter((value): value is string => Boolean(value))
    .filter((value, index, list) => list.indexOf(value) === index)
    .filter((value) => !failedUrls.includes(value));
  const resolvedLogo = logoCandidates[0];

  return (
    <span className={`airline-logo ${size}`}>
      {resolvedLogo ? (
        <img alt={`${code} logo`} src={resolvedLogo} onError={() => setFailedUrls((current) => [...current, resolvedLogo])} />
      ) : (
        <strong>{normalizedCode.slice(0, 2)}</strong>
      )}
    </span>
  );
}

function airportEventTimestamp(value: string | undefined, timeZone: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timeZone || "America/New_York",
    timeZoneName: "short",
  }).format(date);
}

function AirportDelayPanel({
  flight,
  report,
  isLoading,
  error,
}: {
  flight: FlightLeg;
  report: AirportDelayReport | null;
  isLoading: boolean;
  error: string | null;
}) {
  return (
    <section className="airport-delay-panel">
      <div className="airport-delay-heading">
        <div className="section-heading">
          <Radar size={19} />
          <h2>Airport Delay Status</h2>
        </div>
        <span><Activity size={14} /> Current FAA operations</span>
      </div>

      {isLoading && (
        <div className="statistics-state" aria-live="polite">
          <LoaderCircle className="spin" size={21} />
          <div>
            <strong>Checking airport operations</strong>
            <span>Looking for active FAA programs at {flight.origin.code} and {flight.destination.code}</span>
          </div>
        </div>
      )}

      {!isLoading && error && !report && (
        <div className="statistics-state error" role="status">
          <AlertTriangle size={21} />
          <div>
            <strong>Airport status unavailable</strong>
            <span>{error}</span>
          </div>
        </div>
      )}

      {report && (
        <>
          <div className="airport-delay-grid">
            {report.airports.map((airport) => (
              <AirportDelayCard
                airport={airport}
                key={airport.airportCode}
                role={airport.airportCode === flight.origin.code ? "Origin" : "Destination"}
              />
            ))}
          </div>
          <p className="airport-delay-source">
            {report.stale && <strong>Showing the last successful FAA update. </strong>}
            Checked {formatTimestamp(report.updatedAt)}. Source: {" "}
            <a href={report.sourceUrl} rel="noreferrer" target="_blank">{report.source}</a>.
            {error && ` Latest refresh failed: ${error}`}
          </p>
        </>
      )}
    </section>
  );
}

function AirportDelayCard({ airport, role }: { airport: AirportDelayStatus; role: "Origin" | "Destination" }) {
  return (
    <article className={`airport-delay-card severity-${airport.severity}`}>
      <header>
        <div>
          <span>{role}</span>
          <strong>{airport.airportCode}</strong>
        </div>
        <span className="airport-delay-status">{airport.status}</span>
      </header>
      <h3>{airport.airportName}</h3>

      {airport.events.length === 0 ? (
        <div className={`airport-clear-state ${airport.continuouslyMonitored ? "confirmed" : "limited"}`}>
          {airport.continuouslyMonitored ? <CheckCircle2 size={22} /> : <Activity size={22} />}
          <div>
            <strong>{airport.continuouslyMonitored ? "No active FAA delay advisory" : "No current FAA event listed"}</strong>
            <span>{airport.continuouslyMonitored
              ? "No ground stop, ground-delay program, or airport-specific delay is listed in the current feed."
              : "This airport is outside the FAA pacing-airport list, so the absence of an event is not an operational all-clear."}</span>
          </div>
        </div>
      ) : (
        <ul className="airport-event-list">
          {airport.events.map((event, index) => (
            <AirportEventRow airport={airport} event={event} key={`${event.type}-${index}`} />
          ))}
        </ul>
      )}

      {airport.runwayConfig && (
        <div className="airport-runway-facts">
          {airport.runwayConfig.arrivals && <span>Arrivals <strong>{airport.runwayConfig.arrivals}</strong></span>}
          {airport.runwayConfig.departures && <span>Departures <strong>{airport.runwayConfig.departures}</strong></span>}
          {airport.runwayConfig.arrivalRate !== undefined && <span>Arrival rate <strong>{airport.runwayConfig.arrivalRate}/hr</strong></span>}
        </div>
      )}

      <p className="airport-coverage-note">
        {airport.continuouslyMonitored ? "FAA pacing airport" : "Selective FAA coverage"} · {airport.coverage}
      </p>
    </article>
  );
}

function AirportEventRow({ airport, event }: { airport: AirportDelayStatus; event: AirportDelayEvent }) {
  const endTime = airportEventTimestamp(event.endTime, airport.timeZone);
  const details = [
    event.averageDelayMinutes !== undefined ? `Average ${event.averageDelayMinutes} min` : "",
    event.trend || "",
    endTime ? `Expected through ${endTime}` : "",
    event.probabilityOfExtension ? `${event.probabilityOfExtension.toLowerCase()} extension probability` : "",
  ].filter(Boolean).join(" · ");
  return (
    <li className={`severity-${event.severity}`}>
      <AlertTriangle size={17} />
      <div>
        <strong>{event.title}</strong>
        <p>{event.summary}</p>
        {details && <span>{details}</span>}
      </div>
    </li>
  );
}

function FlightStatisticsPanel({
  flight,
  statistics,
  airportDelays,
  originWeather,
  destinationWeather,
  isLoading,
  error,
}: {
  flight: FlightLeg;
  statistics: FlightStatistics | null;
  airportDelays: AirportDelayReport | null;
  originWeather?: WeatherSnapshot;
  destinationWeather?: WeatherSnapshot;
  isLoading: boolean;
  error: string | null;
}) {
  return (
    <section className={`reliability-panel ${statistics ? `risk-${delayOutlook(flight, statistics, originWeather, destinationWeather, airportDelays).tone}` : "risk-unknown"}`}>
      <div className="reliability-heading">
        <div className="section-heading">
          <BarChart3 size={19} />
          <h2>Flight Reliability</h2>
        </div>
        <span><History size={14} /> Recent route history</span>
      </div>

      {isLoading && (
        <div className="statistics-state" aria-live="polite">
          <LoaderCircle className="spin" size={21} />
          <div>
            <strong>Analyzing recent operations</strong>
            <span>Matching {flight.flightNumber} history for {flight.origin.code} to {flight.destination.code}</span>
          </div>
        </div>
      )}

      {!isLoading && error && (
        <div className="statistics-state error" role="status">
          <AlertTriangle size={21} />
          <div>
            <strong>Reliability history unavailable</strong>
            <span>{error}</span>
          </div>
        </div>
      )}

      {!isLoading && statistics && (() => {
        const outlook = delayOutlook(flight, statistics, originWeather, destinationWeather, airportDelays);
        return (
          <>
            <div className="risk-overview">
              <div className="risk-verdict">
                <small>Overall delay outlook</small>
                <strong>{outlook.label}</strong>
                <span>{statistics.confidence} historical confidence</span>
              </div>
              <div className="risk-evidence">
                <div
                  aria-label={`${outlook.label} delay risk`}
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={outlook.score ?? undefined}
                  className="risk-scale"
                  role="meter"
                >
                  <i style={{ width: `${outlook.score ?? 0}%` }} />
                </div>
                <p>{outlook.summary}</p>
                {outlook.factors.length > 0 && (
                  <div className="risk-factors" aria-label="Current risk factors">
                    {outlook.factors.slice(0, 4).map((factor) => <span key={factor}>{factor}</span>)}
                  </div>
                )}
              </div>
            </div>

            <div className="history-metrics">
              <div>
                <ShieldCheck size={18} />
                <strong>{statistics.sampleSize > 0 ? `${statistics.onTimeRate}%` : "--"}</strong>
                <span>On time</span>
              </div>
              <div>
                <Timer size={18} />
                <strong>{statistics.sampleSize > 0 ? `${statistics.delayRate}%` : "--"}</strong>
                <span>Departed 15m+ late</span>
              </div>
              <div>
                <AlertTriangle size={18} />
                <strong>{statistics.cancelledFlights}</strong>
                <span>Cancellations</span>
              </div>
              <div>
                <Activity size={18} />
                <strong>{delayVarianceLabel(statistics.averageDepartureDelayMinutes)}</strong>
                <span>Average departure</span>
              </div>
            </div>

            <div className="history-issues">
              <div>
                <strong>Recent issues</strong>
                <span>{statistics.sampleSize} prior {statistics.route} operations analyzed</span>
              </div>
              {statistics.recentIssues.length > 0 ? (
                <ul>
                  {statistics.recentIssues.map((record) => (
                    <li className={`history-${record.outcome.toLowerCase().replace(/\s+/g, "-")}`} key={`${record.date}-${record.outcome}`}>
                      <time dateTime={record.date}>{historyDate(record.date)}</time>
                      <strong>{record.outcome}</strong>
                      <span>{record.outcome === "Cancelled" ? "Flight did not operate" : delayVarianceLabel(record.departureDelayMinutes ?? null)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No 15+ minute departure delays or cancellations appear in the available sample.</p>
              )}
            </div>

            <p className="statistics-source">
              {statistics.coverage}. This is an estimate, not a guarantee. Source: {" "}
              <a href={statistics.sourceUrl} rel="noreferrer" target="_blank">{statistics.source}</a>.
            </p>
          </>
        );
      })()}
    </section>
  );
}

function Metric({ icon, label, value, source, tone = "neutral" }: { icon: React.ReactNode; label: string; value: string; source?: string; tone?: "neutral" | "good" | "warn" | "danger" }) {
  return (
    <div className={`metric ${tone}`}>
      <span>{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        {source && <em>{source}</em>}
      </div>
    </div>
  );
}

function TimeMetric({ icon, label, value, subValue, source }: { icon: React.ReactNode; label: string; value: string; subValue: string; source: string }) {
  return (
    <div className="metric time-metric">
      <span>{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <em>{subValue}</em>
        <em>{source}</em>
      </div>
    </div>
  );
}

function WeatherCard({ title, code, weather }: { title: string; code: string; weather?: WeatherSnapshot }) {
  const tone = title.toLowerCase().startsWith("origin") ? "origin" : "destination";
  return (
    <article className={`weather-card ${tone}`}>
      <div className="section-heading">
        <CloudSun size={18} />
        <h2>{title}</h2>
      </div>
      <strong>{code}</strong>
      {weather ? (
        <dl>
          <div><dt>Temp</dt><dd>{weather.condition === "Unavailable" ? "Unavailable" : `${weather.temperatureF} F`}</dd></div>
          <div><dt>Wind</dt><dd>{weather.condition === "Unavailable" ? "Unavailable" : `${weather.windMph} mph`}</dd></div>
          <div><dt>Precip</dt><dd>{weather.condition === "Unavailable" ? "Unavailable" : `${weather.precipitationChance}%`}</dd></div>
          <div><dt>Sky</dt><dd>{weather.condition}</dd></div>
        </dl>
      ) : <p className="empty">Loading weather...</p>}
      <p className="source-line">Source: Open-Meteo</p>
    </article>
  );
}

function FlightMap({ flight }: { flight: FlightLeg }) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const leafletMapRef = useRef<L.Map | null>(null);
  const radarLayerRef = useRef<L.TileLayer | null>(null);
  const lastAutoFitKeyRef = useRef<string | null>(null);
  const [radarEnabled, setRadarEnabled] = useState(true);
  const [radarFrame, setRadarFrame] = useState<{ generated: number | null; tileUrl: string } | null>(null);
  const [radarError, setRadarError] = useState<string | null>(null);
  const [runwayCatalog, setRunwayCatalog] = useState<RunwayCatalog>({});
  const routePoints = useMemo(() => {
    if (flight.track && flight.track.length > 1) {
      return flight.track.map((point) => [point.lat, point.lon] as L.LatLngTuple);
    }
    return greatCirclePoints(
      [flight.origin.lat, flight.origin.lon],
      [flight.destination.lat, flight.destination.lon],
      72,
    );
  }, [flight]);
  const autoFitKey = `${flight.flightNumber}-${flight.date}-${flight.origin.code}-${flight.destination.code}`;
  const runwayApproaches = useMemo(() => [
    ...runwayApproachesForAirport(flight.origin.code, runwayCatalog[flight.origin.code] ?? [], 10),
    ...runwayApproachesForAirport(flight.destination.code, runwayCatalog[flight.destination.code] ?? [], 22),
  ], [flight.origin.code, flight.destination.code, runwayCatalog]);
  const likelyArrivalRunway = useMemo(
    () => likelyRunwayAlignment(flight, runwayApproaches.filter((approach) => approach.airportCode === flight.destination.code)),
    [flight, runwayApproaches],
  );

  useEffect(() => {
    let cancelled = false;
    fetchAirportRunways([flight.origin.code, flight.destination.code])
      .then((catalog) => {
        if (!cancelled) setRunwayCatalog(catalog);
      })
      .catch(() => {
        if (!cancelled) setRunwayCatalog({});
      });
    return () => {
      cancelled = true;
    };
  }, [flight.origin.code, flight.destination.code]);

  useEffect(() => {
    let cancelled = false;

    async function loadRadarFrame() {
      try {
        const response = await fetch(rainViewerApiUrl);
        if (!response.ok) {
          throw new Error(`RainViewer returned ${response.status}.`);
        }
        const payload = await response.json() as RainViewerResponse;
        const latestFrame = payload.radar?.past?.at(-1);
        if (!payload.host || !latestFrame?.path) {
          throw new Error("RainViewer did not include a current radar frame.");
        }
        if (!cancelled) {
          setRadarFrame({
            generated: payload.generated ?? latestFrame.time ?? null,
            tileUrl: `${payload.host}${latestFrame.path}/512/{z}/{x}/{y}/2/1_1.png`,
          });
          setRadarError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setRadarError(error instanceof Error ? error.message : "Radar unavailable.");
        }
      }
    }

    void loadRadarFrame();
    const intervalId = window.setInterval(() => {
      void loadRadarFrame();
    }, 5 * 60 * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;
    if (!leafletMapRef.current) {
      leafletMapRef.current = L.map(mapRef.current, {
        attributionControl: true,
        scrollWheelZoom: false,
      });
      leafletMapRef.current.createPane("radarPane");
      const radarPane = leafletMapRef.current.getPane("radarPane");
      if (radarPane) {
        radarPane.style.zIndex = "350";
        radarPane.style.pointerEvents = "none";
      }
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
        className: "triptracker-base-map",
        maxZoom: 10,
      }).addTo(leafletMapRef.current);
    }

    const map = leafletMapRef.current;
    map.eachLayer((layer) => {
      if (!(layer instanceof L.TileLayer)) {
        layer.remove();
      }
    });

    const originPoint: L.LatLngTuple = [flight.origin.lat, flight.origin.lon];
    const destinationPoint: L.LatLngTuple = [flight.destination.lat, flight.destination.lon];
    const aircraft = flight.aircraftPosition;
    const aircraftPoint: L.LatLngTuple | undefined = aircraft ? [aircraft.lat, aircraft.lon] : undefined;

    L.polyline(routePoints, { color: "#07111d", opacity: 0.88, weight: 8 }).addTo(map);
    L.polyline(routePoints, { color: "#4ed9ff", opacity: 0.92, weight: 4 }).addTo(map);
    drawRunwayOverlay(map, flight.origin.code, runwayCatalog[flight.origin.code] ?? [], runwayApproaches, false);
    drawRunwayOverlay(map, flight.destination.code, runwayCatalog[flight.destination.code] ?? [], runwayApproaches, true);
    L.circleMarker(originPoint, { color: "#d8f8ff", fillColor: "#38c7f4", fillOpacity: 1, radius: 7, weight: 2 })
      .bindPopup(`${flight.origin.code} ${flight.origin.city}`)
      .addTo(map);
    L.circleMarker(destinationPoint, { color: "#fff0dc", fillColor: "#ff9f43", fillOpacity: 1, radius: 7, weight: 2 })
      .bindPopup(`${flight.destination.code} ${flight.destination.city}`)
      .addTo(map);

    if (aircraftPoint) {
      const live = aircraft?.source !== "Estimated from schedule";
      const heading = Number.isFinite(aircraft?.headingDeg) ? ` style="transform: rotate(${aircraft?.headingDeg}deg)"` : "";
      L.marker(aircraftPoint, {
        icon: L.divIcon({
          className: "aircraft-map-marker",
          html: `
            <span class="${live ? "live" : "estimated"}">
              <svg class="aircraft-symbol" viewBox="0 0 32 32" aria-hidden="true"${heading}>
                <path d="M16 2.5c.9 0 1.5.7 1.5 1.6v7.5l11 5.8v2.7l-11-2.9v6.2l4.1 3v2.2L16 27l-5.6 1.6v-2.2l4.1-3v-6.2l-11 2.9v-2.7l11-5.8V4.1c0-.9.6-1.6 1.5-1.6Z" />
              </svg>
            </span>
          `,
          iconAnchor: [19, 19],
          iconSize: [38, 38],
        }),
      })
        .bindPopup([
          flight.flightNumber,
          aircraft?.callsign ? `Callsign ${aircraft.callsign}` : undefined,
          aircraft?.source,
          `${aircraft?.altitudeFt.toLocaleString()} ft`,
        ].filter(Boolean).join("<br>"))
        .addTo(map);
    }

    if (lastAutoFitKeyRef.current !== autoFitKey) {
      const bounds = L.latLngBounds([originPoint, destinationPoint, ...(aircraftPoint ? [aircraftPoint] : [])]);
      map.fitBounds(bounds.pad(0.24), { animate: false });
      lastAutoFitKeyRef.current = autoFitKey;
    }
    window.setTimeout(() => map.invalidateSize(), 0);
  }, [autoFitKey, flight, routePoints, runwayApproaches, runwayCatalog]);

  useEffect(() => {
    const map = leafletMapRef.current;
    if (!map) return;

    if (radarLayerRef.current) {
      radarLayerRef.current.removeFrom(map);
      radarLayerRef.current = null;
    }

    if (!radarEnabled || !radarFrame) return;

    radarLayerRef.current = L.tileLayer(radarFrame.tileUrl, {
      attribution: "Radar: RainViewer",
      className: "weather-radar-layer",
      maxNativeZoom: 7,
      maxZoom: 10,
      opacity: 0.56,
      pane: "radarPane",
      zIndex: 320,
    }).addTo(map);
  }, [radarEnabled, radarFrame]);

  return (
    <section className="map-panel" aria-label="Flight route map">
      <div className="map-toolbar">
        <div>
          <small>Route map</small>
          <strong>{flight.origin.code} to {flight.destination.code}</strong>
        </div>
        <div className="map-actions">
          <button
            aria-pressed={radarEnabled}
            className={`radar-toggle ${radarEnabled ? "active" : ""}`}
            onClick={() => setRadarEnabled((enabled) => !enabled)}
            title="Toggle weather radar overlay"
            type="button"
          >
            <Radar size={16} />
            <span>Radar</span>
          </button>
          <span className="source-chip">{flight.dataSource}</span>
        </div>
      </div>
      <div className="route-map" ref={mapRef} />
      <div className="map-telemetry">
        <strong>{flight.aircraftPosition?.source ?? "No aircraft position available"}</strong>
        {flight.aircraftPosition?.callsign && <span>Callsign: {flight.aircraftPosition.callsign}</span>}
        <span>Altitude: {flight.altitudeFt ? `${flight.altitudeFt.toLocaleString()} ft` : "Unavailable"}</span>
        <span>{likelyArrivalRunway ? `Likely arrival: RWY ${likelyArrivalRunway.runwayIdent} (${likelyArrivalRunway.crossTrackNm?.toFixed(1)} NM off)` : "Arrival runway alignment pending"}</span>
        {flight.aircraftPosition?.timestamp && <span>Position time: {timeAgo(flight.aircraftPosition.timestamp)}</span>}
        <span>Radar: {radarError ? "Unavailable" : radarEnabled ? `On, ${formatRadarTimestamp(radarFrame?.generated ?? null)}` : "Off"}</span>
      </div>
      <p className="source-line">Route, status, and progress source: {flight.dataSource}. Weather radar source: RainViewer. Runway overlay source: OurAirports.</p>
    </section>
  );
}

function greatCirclePoints(start: [number, number], end: [number, number], segments: number): L.LatLngTuple[] {
  return Array.from({ length: segments + 1 }, (_, index) => {
    const fraction = index / segments;
    const point = interpolateGreatCircle(start[0], start[1], end[0], end[1], fraction);
    return [point.lat, point.lon];
  });
}

function runwayApproachesForAirport(airportCode: string, runways: AirportRunway[], extensionNm: number): RunwayApproach[] {
  return runways
    .flatMap((runway) => [
      runway.le ? approachFromRunwayEnd(airportCode, runway.le, extensionNm) : null,
      runway.he ? approachFromRunwayEnd(airportCode, runway.he, extensionNm) : null,
    ])
    .filter((approach): approach is RunwayApproach => Boolean(approach));
}

function approachFromRunwayEnd(airportCode: string, runwayEnd: RunwayEnd, extensionNm: number): RunwayApproach {
  const finalFix = pointFromBearing(runwayEnd.lat, runwayEnd.lon, runwayEnd.headingDeg + 180, extensionNm);
  return {
    airportCode,
    runwayIdent: runwayEnd.ident,
    headingDeg: normalizeDegrees(runwayEnd.headingDeg),
    threshold: [runwayEnd.lat, runwayEnd.lon],
    finalFix: [finalFix.lat, finalFix.lon],
  };
}

function drawRunwayOverlay(
  map: L.Map,
  airportCode: string,
  runways: AirportRunway[],
  approaches: RunwayApproach[],
  primary: boolean,
) {
  const runwayColor = primary ? "#f8fafc" : "#a7f3d0";
  const approachColor = primary ? "#67e8f9" : "#5eead4";

  runways.slice(0, 12).forEach((runway) => {
    if (runway.le && runway.he) {
      L.polyline([[runway.le.lat, runway.le.lon], [runway.he.lat, runway.he.lon]], {
        color: runwayColor,
        opacity: primary ? 0.7 : 0.42,
        weight: primary ? 3 : 2,
      })
        .bindTooltip(`${airportCode} runway ${runway.ident}${runway.lengthFt ? `, ${runway.lengthFt.toLocaleString()} ft` : ""}`)
        .addTo(map);
    }
  });

  approaches
    .filter((approach) => approach.airportCode === airportCode)
    .slice(0, 24)
    .forEach((approach) => {
      L.polyline([approach.finalFix, approach.threshold], {
        color: approachColor,
        dashArray: "7 9",
        lineCap: "round",
        opacity: primary ? 0.62 : 0.34,
        weight: primary ? 2.5 : 1.8,
      })
        .bindTooltip(`${airportCode} RWY ${approach.runwayIdent} final, ${Math.round(approach.headingDeg)} deg`)
        .addTo(map);
    });
}

function likelyRunwayAlignment(flight: FlightLeg, approaches: RunwayApproach[]): RunwayApproach | null {
  const aircraft = flight.aircraftPosition;
  if (!aircraft || aircraft.source === "Estimated from schedule" || !Number.isFinite(aircraft.headingDeg)) return null;

  const scored = approaches.map((approach) => {
    const threshold = { lat: approach.threshold[0], lon: approach.threshold[1] };
    const finalFix = { lat: approach.finalFix[0], lon: approach.finalFix[1] };
    const crossTrackNm = distanceToSegmentNm({ lat: aircraft.lat, lon: aircraft.lon }, finalFix, threshold);
    const distanceToThresholdNm = distanceNm(aircraft.lat, aircraft.lon, threshold.lat, threshold.lon);
    const headingDeltaDeg = headingDelta(aircraft.headingDeg ?? 0, approach.headingDeg);
    return {
      ...approach,
      crossTrackNm,
      distanceToThresholdNm,
      headingDeltaDeg,
      score: crossTrackNm * 4 + headingDeltaDeg * 0.35 + distanceToThresholdNm * 0.08,
    };
  }).sort((left, right) => left.score - right.score);

  const best = scored[0];
  if (!best || best.crossTrackNm > 4 || best.headingDeltaDeg > 45 || best.distanceToThresholdNm > 35) return null;
  return best;
}

function pointFromBearing(lat: number, lon: number, bearingDeg: number, distanceNauticalMiles: number) {
  const angularDistance = distanceNauticalMiles / 3440.065;
  const bearing = toRadians(normalizeDegrees(bearingDeg));
  const lat1 = toRadians(lat);
  const lon1 = toRadians(lon);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
    Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
    Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
  );
  return { lat: toDegrees(lat2), lon: normalizeLongitude(toDegrees(lon2)) };
}

function distanceToSegmentNm(point: { lat: number; lon: number }, start: { lat: number; lon: number }, end: { lat: number; lon: number }) {
  const meanLat = toRadians((start.lat + end.lat + point.lat) / 3);
  const project = (coordinate: { lat: number; lon: number }) => ({
    x: coordinate.lon * 60 * Math.cos(meanLat),
    y: coordinate.lat * 60,
  });
  const p = project(point);
  const a = project(start);
  const b = project(end);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  const closest = { x: a.x + t * dx, y: a.y + t * dy };
  return Math.hypot(p.x - closest.x, p.y - closest.y);
}

function distanceNm(latA: number, lonA: number, latB: number, lonB: number) {
  const earthRadiusNm = 3440.065;
  const lat1 = toRadians(latA);
  const lat2 = toRadians(latB);
  const deltaLat = toRadians(latB - latA);
  const deltaLon = toRadians(lonB - lonA);
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return earthRadiusNm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function interpolateGreatCircle(latA: number, lonA: number, latB: number, lonB: number, fraction: number) {
  const lat1 = toRadians(latA);
  const lon1 = toRadians(lonA);
  const lat2 = toRadians(latB);
  const lon2 = toRadians(lonB);
  const delta = 2 * Math.asin(Math.sqrt(
    Math.sin((lat2 - lat1) / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2,
  ));
  if (delta === 0) return { lat: latA, lon: lonA };
  const a = Math.sin((1 - fraction) * delta) / Math.sin(delta);
  const b = Math.sin(fraction * delta) / Math.sin(delta);
  const x = a * Math.cos(lat1) * Math.cos(lon1) + b * Math.cos(lat2) * Math.cos(lon2);
  const y = a * Math.cos(lat1) * Math.sin(lon1) + b * Math.cos(lat2) * Math.sin(lon2);
  const z = a * Math.sin(lat1) + b * Math.sin(lat2);
  return { lat: toDegrees(Math.atan2(z, Math.sqrt(x ** 2 + y ** 2))), lon: toDegrees(Math.atan2(y, x)) };
}

function toRadians(value: number) {
  return value * Math.PI / 180;
}

function toDegrees(value: number) {
  return value * 180 / Math.PI;
}

function normalizeDegrees(value: number) {
  return ((value % 360) + 360) % 360;
}

function normalizeLongitude(value: number) {
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

function headingDelta(left: number, right: number) {
  const delta = Math.abs(normalizeDegrees(left) - normalizeDegrees(right));
  return Math.min(delta, 360 - delta);
}
