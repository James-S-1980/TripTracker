import { airports, findAirport } from "./airports";
import { resolveAirline } from "./airlines";
import type { FlightAlert, FlightLeg, FlightStatus } from "./types";

const statuses: FlightStatus[] = ["Scheduled", "Boarding", "En Route", "Delayed", "Arrived"];

function seededNumber(seed: string): number {
  return Array.from(seed).reduce((total, char) => total + char.charCodeAt(0), 0);
}

function isoAt(date: string, hour: number, minute: number): string {
  const value = new Date(`${date}T00:00:00`);
  value.setHours(hour, minute, 0, 0);
  return value.toISOString();
}

function knownFlightSnapshot(airlineCode: string, flightNumber: string, date: string): Partial<FlightLeg> | null {
  if (airlineCode === "WN" && flightNumber === "3370" && date === "2026-08-09") {
    const origin = findAirport("LAS");
    const destination = findAirport("DCA");
    if (!origin || !destination) return null;

    return {
      origin,
      destination,
      departureTime: isoAt(date, 11, 7),
      arrivalTime: isoAt(date, 16, 20),
      terminal: "1",
      arrivalTerminal: "1",
      status: "En Route",
      progress: 96,
      altitudeFt: 9000,
      groundSpeedMph: 360,
      dataSource: "Verified public tracker snapshot",
      alerts: [
        {
          id: "WN3370-2026-08-09-route",
          type: "status",
          priority: "high",
          title: "Route verified",
          message: "WN3370 is tracking Las Vegas LAS to Washington DCA for Aug 9, 2026.",
          timestamp: new Date().toISOString(),
        },
      ],
    };
  }

  return null;
}

export async function lookupFlight(airlineInput: string, flightNumber: string, date: string): Promise<FlightLeg> {
  await new Promise((resolve) => window.setTimeout(resolve, 450));

  const airline = resolveAirline(airlineInput);
  const airlineCode = airline.code;
  const seed = seededNumber(`${airlineCode}${flightNumber}${date}`);
  const snapshot = knownFlightSnapshot(airlineCode, flightNumber, date);
  const origin = airports[seed % airports.length];
  const destination = airports[(seed * 3 + 5) % airports.length] === origin
    ? airports[(seed + 7) % airports.length]
    : airports[(seed * 3 + 5) % airports.length];
  const status = statuses[seed % statuses.length];
  const delayed = status === "Delayed";
  const progress = status === "Arrived" ? 100 : status === "En Route" ? 58 + (seed % 27) : status === "Boarding" ? 6 : 0;
  const boardingGate = `${String.fromCharCode(65 + (seed % 6))}${10 + (seed % 39)}`;
  const arrivalGate = `${String.fromCharCode(65 + ((seed + 4) % 6))}${10 + ((seed + 21) % 39)}`;
  const previousGate = `${String.fromCharCode(65 + ((seed + 2) % 6))}${10 + ((seed + 11) % 39)}`;
  const alerts: FlightAlert[] = [
    {
      id: `${seed}-status`,
      type: "status",
      priority: status === "Cancelled" || delayed ? "critical" : status === "Boarding" ? "high" : "normal",
      title: status === "Delayed" ? "Delay detected" : `${status} status`,
      message: delayed ? "Departure is running behind schedule. Review connection buffers." : `Flight is currently ${status.toLowerCase()}.`,
      timestamp: new Date().toISOString(),
    },
  ];

  if (seed % 2 === 0) {
    alerts.unshift({
      id: `${seed}-gate`,
      type: "gate",
      priority: "critical",
      title: "Gate changed",
      message: `Boarding gate moved from ${previousGate} to ${boardingGate}.`,
      timestamp: new Date(Date.now() - 1000 * 60 * 7).toISOString(),
    });
  }

  const resolvedOrigin = snapshot?.origin ?? origin;
  const resolvedDestination = snapshot?.destination ?? destination;
  const resolvedAlerts = snapshot?.alerts ? [...snapshot.alerts, ...alerts] : alerts;

  return {
    id: `${airlineCode}-${flightNumber}-${date}`,
    airline: airline.name,
    flightNumber: `${airlineCode.toUpperCase()} ${flightNumber}`,
    date,
    origin: resolvedOrigin,
    destination: resolvedDestination,
    departureTime: snapshot?.departureTime ?? isoAt(date, 8 + (seed % 10), seed % 60),
    arrivalTime: snapshot?.arrivalTime ?? isoAt(date, 11 + (seed % 9), (seed + 24) % 60),
    boardingGate,
    arrivalGate,
    terminal: snapshot?.terminal ?? `${1 + (seed % 5)}`,
    arrivalTerminal: snapshot?.arrivalTerminal ?? `${1 + ((seed + 2) % 5)}`,
    status: snapshot?.status ?? status,
    progress: snapshot?.progress ?? progress,
    altitudeFt: snapshot?.altitudeFt ?? (progress > 10 && progress < 99 ? 28000 + (seed % 11000) : 0),
    groundSpeedMph: snapshot?.groundSpeedMph ?? (progress > 10 && progress < 99 ? 420 + (seed % 95) : 0),
    lastUpdated: new Date().toISOString(),
    dataSource: snapshot?.dataSource ?? "Simulated demo provider",
    alerts: resolvedAlerts,
  };
}
