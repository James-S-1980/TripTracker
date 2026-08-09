import type { Airport } from "./types";
import { generatedAirports } from "./airportCatalog.generated";

export const airports: Airport[] = generatedAirports;

export function findAirport(code: string): Airport | undefined {
  return airports.find((airport) => airport.code === code.toUpperCase());
}
