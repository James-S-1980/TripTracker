import { resolveAirline } from "./airlines";
import type { FlightLeg } from "./types";

export async function lookupFlight(airlineInput: string, flightNumber: string, date: string): Promise<FlightLeg> {
  const airline = resolveAirline(airlineInput);
  const params = new URLSearchParams({ airline: airline.code, flightNumber, date });
  const response = await fetch(`/api/flights/lookup?${params.toString()}`);
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string; detail?: string } | null;
    throw new Error(payload?.detail ? `${payload.error} ${payload.detail}` : payload?.error ?? "Flight lookup failed.");
  }
  return await response.json() as FlightLeg;
}
