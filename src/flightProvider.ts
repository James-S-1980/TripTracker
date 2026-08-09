import { resolveAirline } from "./airlines";
import type { FlightLeg } from "./types";

export async function lookupFlight(airlineInput: string, flightNumber: string, date: string): Promise<FlightLeg> {
  const airline = resolveAirline(airlineInput);
  const params = new URLSearchParams({ airline: airline.code, flightNumber, date });
  let response: Response;
  try {
    response = await fetch(`/api/flights/lookup?${params.toString()}`);
  } catch {
    throw new Error("Flight lookup API is unavailable. Start the TripTracker server and try again.");
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string; detail?: string } | null;
    throw new Error(payload?.detail ? `${payload.error} ${payload.detail}` : payload?.error ?? `Flight lookup failed with HTTP ${response.status}.`);
  }
  return await response.json() as FlightLeg;
}
