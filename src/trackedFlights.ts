import type { FlightLeg } from "./types";

type FlightMerger = (previous: FlightLeg | undefined, next: FlightLeg) => FlightLeg;

export function flightIdentityKey(flight: FlightLeg): string {
  const designator = flight.flightNumber.trim().match(/^([A-Z0-9]{2,3})\s*(\d+[A-Z]?)$/i);
  const airlineCode = String(flight.airlineCode || designator?.[1] || "").toUpperCase();
  const flightNumber = String(designator?.[2] || flight.flightNumber.replace(/\D/g, ""))
    .toUpperCase()
    .replace(/^0+(?=\d)/, "");
  return [
    `${airlineCode}${flightNumber}`,
    flight.date,
    flight.origin.code.toUpperCase(),
    flight.destination.code.toUpperCase(),
  ].join("::");
}

export function dedupeFlightsByIdentity(flights: FlightLeg[], mergeFlights: FlightMerger): FlightLeg[] {
  const deduped = new Map<string, FlightLeg>();
  flights.forEach((flight) => {
    if (!hasFlightIdentity(flight)) return;
    const key = flightIdentityKey(flight);
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, flight);
      return;
    }
    const candidateIsNewer = flightTimestamp(flight) >= flightTimestamp(existing);
    deduped.set(key, candidateIsNewer
      ? mergeFlights(existing, flight)
      : mergeFlights(flight, existing));
  });
  return sortTrackedFlights([...deduped.values()]);
}

export function mergeFlightSources(
  localFlights: FlightLeg[],
  serverFlights: FlightLeg[],
  mergeFlights: FlightMerger,
): FlightLeg[] {
  const merged = new Map(dedupeFlightsByIdentity(localFlights, mergeFlights)
    .map((flight) => [flightIdentityKey(flight), flight]));
  dedupeFlightsByIdentity(serverFlights, mergeFlights).forEach((flight) => {
    const key = flightIdentityKey(flight);
    merged.set(key, mergeFlights(merged.get(key), flight));
  });
  return sortTrackedFlights([...merged.values()]);
}

export function sortTrackedFlights(flights: FlightLeg[]): FlightLeg[] {
  return [...flights].sort((left, right) => flightTimestamp(right) - flightTimestamp(left));
}

function hasFlightIdentity(flight: FlightLeg | undefined | null): flight is FlightLeg {
  return Boolean(flight?.flightNumber && flight.date && flight.origin?.code && flight.destination?.code);
}

function flightTimestamp(flight: FlightLeg): number {
  const timestamp = new Date(flight.lastUpdated ?? flight.departureTime).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}
