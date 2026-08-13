import { resolveAirline } from "./airlines";
import type { FlightLeg } from "./types";

function apiBase(): string {
  return window.location.pathname.startsWith("/trip") ? "/trip/api" : "/api";
}

export async function lookupFlight(airlineInput: string, flightNumber: string, date: string, options: { track?: boolean } = {}): Promise<FlightLeg> {
  const airline = resolveAirline(airlineInput);
  const params = new URLSearchParams({ airline: airline.code, flightNumber, date });
  if (options.track) params.set("track", "true");
  let response: Response;
  try {
    response = await fetch(`${apiBase()}/flights/lookup?${params.toString()}`);
  } catch {
    throw new Error("Flight lookup API is unavailable. Start the TripTracker server and try again.");
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string; detail?: string } | null;
    throw new Error(payload?.detail ? `${payload.error} ${payload.detail}` : payload?.error ?? `Flight lookup failed with HTTP ${response.status}.`);
  }
  return await response.json() as FlightLeg;
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
    body: JSON.stringify({ flights }),
  }).catch(() => undefined);
}

export async function untrackFlight(flight: FlightLeg): Promise<void> {
  await fetch(`${apiBase()}/notifications/untrack`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ flight }),
  }).catch(() => undefined);
}
