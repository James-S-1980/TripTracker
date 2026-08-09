export type Airline = {
  code: string;
  name: string;
  callsign: string;
  aliases: string[];
};

export const airlines: Airline[] = [
  { code: "AA", name: "American Airlines", callsign: "American", aliases: ["AAL"] },
  { code: "AS", name: "Alaska Airlines", callsign: "Alaska", aliases: ["ASA"] },
  { code: "B6", name: "JetBlue", callsign: "JetBlue", aliases: ["JBU"] },
  { code: "DL", name: "Delta Air Lines", callsign: "Delta", aliases: ["DAL"] },
  { code: "F9", name: "Frontier Airlines", callsign: "Frontier", aliases: ["FFT"] },
  { code: "NK", name: "Spirit Airlines", callsign: "Spirit Wings", aliases: ["NKS"] },
  { code: "UA", name: "United Airlines", callsign: "United", aliases: ["UAL"] },
  { code: "WN", name: "Southwest Airlines", callsign: "Southwest", aliases: ["SWA", "SW"] },
];

export function resolveAirline(input: string): Airline {
  const normalized = input.trim().toLowerCase();
  return airlines.find((airline) => (
    airline.code.toLowerCase() === normalized ||
    airline.name.toLowerCase() === normalized ||
    airline.aliases.some((alias) => alias.toLowerCase() === normalized) ||
    airline.name.toLowerCase().includes(normalized)
  )) ?? {
    code: input.trim().toUpperCase().slice(0, 3),
    name: input.trim().toUpperCase(),
    callsign: input.trim().toUpperCase(),
    aliases: [],
  };
}

export function airlineMatches(input: string): Airline[] {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return airlines;
  return airlines.filter((airline) => (
    airline.code.toLowerCase().startsWith(normalized) ||
    airline.name.toLowerCase().includes(normalized) ||
    airline.callsign.toLowerCase().includes(normalized) ||
    airline.aliases.some((alias) => alias.toLowerCase().startsWith(normalized))
  ));
}
