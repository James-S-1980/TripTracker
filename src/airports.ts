import type { Airport } from "./types";

export const airports: Airport[] = [
  { code: "ATL", name: "Hartsfield-Jackson Atlanta International", city: "Atlanta", lat: 33.6407, lon: -84.4277 },
  { code: "BOS", name: "Boston Logan International", city: "Boston", lat: 42.3656, lon: -71.0096 },
  { code: "CLT", name: "Charlotte Douglas International", city: "Charlotte", lat: 35.214, lon: -80.9431 },
  { code: "DCA", name: "Ronald Reagan Washington National", city: "Washington", lat: 38.8512, lon: -77.0402 },
  { code: "DEN", name: "Denver International", city: "Denver", lat: 39.8561, lon: -104.6737 },
  { code: "DFW", name: "Dallas Fort Worth International", city: "Dallas-Fort Worth", lat: 32.8998, lon: -97.0403 },
  { code: "EWR", name: "Newark Liberty International", city: "Newark", lat: 40.6895, lon: -74.1745 },
  { code: "IAD", name: "Washington Dulles International", city: "Washington", lat: 38.9531, lon: -77.4565 },
  { code: "JFK", name: "John F. Kennedy International", city: "New York", lat: 40.6413, lon: -73.7781 },
  { code: "LAS", name: "Harry Reid International", city: "Las Vegas", lat: 36.084, lon: -115.1537 },
  { code: "LAX", name: "Los Angeles International", city: "Los Angeles", lat: 33.9416, lon: -118.4085 },
  { code: "MIA", name: "Miami International", city: "Miami", lat: 25.7959, lon: -80.287 },
  { code: "ORD", name: "Chicago O'Hare International", city: "Chicago", lat: 41.9742, lon: -87.9073 },
  { code: "PHX", name: "Phoenix Sky Harbor International", city: "Phoenix", lat: 33.4352, lon: -112.0101 },
  { code: "SEA", name: "Seattle-Tacoma International", city: "Seattle", lat: 47.4502, lon: -122.3088 },
  { code: "SFO", name: "San Francisco International", city: "San Francisco", lat: 37.6213, lon: -122.379 },
];

export function findAirport(code: string): Airport | undefined {
  return airports.find((airport) => airport.code === code.toUpperCase());
}
