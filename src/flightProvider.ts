import { resolveAirline } from "./airlines";
import type { AirportDelayReport, FlightLeg, FlightLookupResult, FlightSearchResult, FlightStatistics, RunwayCatalog } from "./types";

function apiBase(): string {
  return window.location.pathname.startsWith("/trip") ? "/trip/api" : "/api";
}

export async function lookupFlight(airlineInput: string, flightNumber: string, date: string, options: { track?: boolean; monitor?: boolean; flightId?: string } = {}): Promise<FlightLookupResult> {
  const airline = resolveAirline(airlineInput);
  const params = new URLSearchParams({ airline: airline.code, flightNumber, date });
  if (options.track) params.set("track", "true");
  if (options.monitor) params.set("monitor", "true");
  if (options.flightId) params.set("flightId", options.flightId);
  let response: Response;
  try {
    response = await fetch(`${apiBase()}/flights/lookup?${params.toString()}`);
  } catch {
    throw new Error("Flight lookup API is unavailable. Check the TripTracker service and try again.");
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string; detail?: string } | null;
    if (payload && "ambiguous" in payload) return payload as FlightLookupResult;
    throw new Error(payload?.detail ? `${payload.error} ${payload.detail}` : payload?.error ?? `Flight lookup failed with HTTP ${response.status}.`);
  }
  return await response.json() as FlightLookupResult;
}

export async function searchFlights(airlineInput: string, flightNumber: string, date: string, signal?: AbortSignal): Promise<FlightSearchResult> {
  const airline = resolveAirline(airlineInput);
  const params = new URLSearchParams({ airline: airline.code, flightNumber, date });
  let response: Response;
  try {
    response = await fetch(`${apiBase()}/flights/search?${params.toString()}`, { signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new Error("Live flight search is temporarily unavailable.");
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error ?? `Live flight search failed with HTTP ${response.status}.`);
  }
  return await response.json() as FlightSearchResult;
}

export async function fetchFlightStatistics(flight: FlightLeg, signal?: AbortSignal): Promise<FlightStatistics> {
  const [airline, flightNumber] = splitFlightDesignator(flight.flightNumber);
  const params = new URLSearchParams({
    airline: flight.airlineCode || airline,
    flightNumber,
    origin: flight.origin.code,
    destination: flight.destination.code,
    date: flight.date,
    originTimeZone: flight.origin.timeZone || "Etc/UTC",
  });
  const response = await fetch(`${apiBase()}/flights/statistics?${params.toString()}`, { signal });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string; detail?: string } | null;
    throw new Error(payload?.detail ? `${payload.error} ${payload.detail}` : payload?.error ?? "Flight statistics are unavailable.");
  }
  return await response.json() as FlightStatistics;
}

export async function fetchAirportDelays(airportCodes: string[], signal?: AbortSignal): Promise<AirportDelayReport> {
  const airports = [...new Set(airportCodes.map((code) => code.trim().toUpperCase()).filter(Boolean))];
  const response = await fetch(`${apiBase()}/airport-delays?${new URLSearchParams({ airports: airports.join(",") })}`, { signal });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string; detail?: string } | null;
    throw new Error(payload?.detail ? `${payload.error} ${payload.detail}` : payload?.error ?? "Airport delay status is unavailable.");
  }
  return await response.json() as AirportDelayReport;
}

export async function sendFlightNotification(eventType: "tracked" | "updated" | "concluded", flight: FlightLeg, changes: string[] = []): Promise<void> {
  const response = await fetch(`${apiBase()}/notifications/flight-event`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ eventType, flight, changes }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string; detail?: string } | null;
    throw new Error(payload?.detail ? `${payload.error} ${payload.detail}` : payload?.error ?? `Text notification failed with HTTP ${response.status}.`);
  }
}

export async function registerTrackedFlights(flights: FlightLeg[]): Promise<void> {
  if (flights.length === 0) return;
  await fetch(`${apiBase()}/notifications/register-tracked`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ flights: flights.map(compactFlightForRegistration) }),
  }).catch(() => undefined);
}

export async function fetchTrackedFlights(): Promise<FlightLeg[]> {
  const response = await fetch(`${apiBase()}/tracked-flights`);
  if (!response.ok) return [];
  const payload = await response.json().catch(() => null) as { flights?: FlightLeg[] } | null;
  return Array.isArray(payload?.flights) ? payload.flights : [];
}

export async function untrackFlight(flight: FlightLeg): Promise<void> {
  const response = await fetch(`${apiBase()}/notifications/untrack`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ flight }),
  });
  if (!response.ok) throw new Error("Could not stop tracking this flight. Please try again.");
}

export async function fetchAirportRunways(airportCodes: string[]): Promise<RunwayCatalog> {
  const codes = [...new Set(airportCodes.map((code) => code.trim().toUpperCase()).filter(Boolean))];
  if (codes.length === 0) return {};
  const response = await fetch(`${apiBase()}/runways?${new URLSearchParams({ airports: codes.join(",") })}`);
  if (!response.ok) return {};
  return await response.json() as RunwayCatalog;
}

function compactFlightForRegistration(flight: FlightLeg): Partial<FlightLeg> {
  return {
    ...flight,
    track: undefined,
    alerts: flight.alerts?.slice(0, 4) ?? [],
  };
}

function splitFlightDesignator(value: string): [string, string] {
  const match = value.trim().match(/^([A-Z0-9]{2,3})\s*(\d+)$/i);
  return match ? [match[1].toUpperCase(), match[2]] : ["", value.replace(/\D/g, "")];
}
