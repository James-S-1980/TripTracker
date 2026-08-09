export type Airline = {
  code: string;
  name: string;
  callsign: string;
};

export const airlines: Airline[] = [
  { code: "AA", name: "American Airlines", callsign: "American" },
  { code: "AS", name: "Alaska Airlines", callsign: "Alaska" },
  { code: "B6", name: "JetBlue", callsign: "JetBlue" },
  { code: "DL", name: "Delta Air Lines", callsign: "Delta" },
  { code: "F9", name: "Frontier Airlines", callsign: "Frontier" },
  { code: "NK", name: "Spirit Airlines", callsign: "Spirit Wings" },
  { code: "UA", name: "United Airlines", callsign: "United" },
  { code: "WN", name: "Southwest Airlines", callsign: "Southwest" },
];

export function resolveAirline(input: string): Airline {
  const normalized = input.trim().toLowerCase();
  return airlines.find((airline) => (
    airline.code.toLowerCase() === normalized ||
    airline.name.toLowerCase() === normalized ||
    airline.name.toLowerCase().includes(normalized)
  )) ?? {
    code: input.trim().toUpperCase().slice(0, 3),
    name: input.trim().toUpperCase(),
    callsign: input.trim().toUpperCase(),
  };
}

export function airlineMatches(input: string): Airline[] {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return airlines;
  return airlines.filter((airline) => (
    airline.code.toLowerCase().startsWith(normalized) ||
    airline.name.toLowerCase().includes(normalized) ||
    airline.callsign.toLowerCase().includes(normalized)
  ));
}
