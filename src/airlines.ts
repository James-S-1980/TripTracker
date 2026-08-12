import { generatedAirlines } from "./airlineCatalog.generated";

export type Airline = {
  code: string;
  icao: string;
  name: string;
  callsign: string;
  country: string;
  aliases: string[];
  logoUrl: string;
};

export const airlines: Airline[] = generatedAirlines;

export function resolveAirline(input: string): Airline {
  const normalized = input.trim().toLowerCase();
  return airlines.find((airline) => (
    airline.code.toLowerCase() === normalized ||
    airline.icao.toLowerCase() === normalized ||
    airline.name.toLowerCase() === normalized ||
    airline.aliases.some((alias) => alias.toLowerCase() === normalized) ||
    airline.name.toLowerCase().includes(normalized)
  )) ?? {
    code: input.trim().toUpperCase().slice(0, 3),
    icao: input.trim().toUpperCase().slice(0, 3),
    name: input.trim().toUpperCase(),
    callsign: input.trim().toUpperCase(),
    country: "",
    aliases: [],
    logoUrl: "",
  };
}

export function airlineLogoFor(code: string): string {
  return airlines.find((airline) => (
    airline.code === code.toUpperCase() ||
    airline.icao === code.toUpperCase() ||
    airline.aliases.includes(code.toUpperCase())
  ))?.logoUrl ?? "";
}

export function airlineMatches(input: string): Airline[] {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return airlines;
  return airlines
    .map((airline) => ({ airline, score: airlineMatchScore(airline, normalized) }))
    .filter((match) => match.score !== Number.POSITIVE_INFINITY)
    .sort((a, b) => a.score - b.score || a.airline.name.localeCompare(b.airline.name))
    .map((match) => match.airline);
}

function airlineMatchScore(airline: Airline, normalized: string): number {
  const code = airline.code.toLowerCase();
  const icao = airline.icao.toLowerCase();
  const name = airline.name.toLowerCase();
  const callsign = airline.callsign.toLowerCase();
  const country = airline.country.toLowerCase();
  const aliases = airline.aliases.map((alias) => alias.toLowerCase());

  if (code === normalized || icao === normalized || name === normalized || aliases.includes(normalized)) return 0;
  if (code.startsWith(normalized)) return 1;
  if (icao.startsWith(normalized)) return 2;
  if (name.startsWith(normalized)) return 3;
  if (callsign.startsWith(normalized)) return 4;
  if (aliases.some((alias) => alias.startsWith(normalized))) return 5;
  if (name.includes(normalized)) return 6;
  if (callsign.includes(normalized)) return 7;
  if (country.includes(normalized)) return 8;
  return Number.POSITIVE_INFINITY;
}
