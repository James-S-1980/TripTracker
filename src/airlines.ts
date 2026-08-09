export type Airline = {
  code: string;
  name: string;
  callsign: string;
  aliases: string[];
  logoUrl: string;
};

export const airlines: Airline[] = [
  { code: "AA", name: "American Airlines", callsign: "American", aliases: ["AAL"], logoUrl: "https://images.kiwi.com/airlines/64/AA.png" },
  { code: "AS", name: "Alaska Airlines", callsign: "Alaska", aliases: ["ASA"], logoUrl: "https://images.kiwi.com/airlines/64/AS.png" },
  { code: "B6", name: "JetBlue", callsign: "JetBlue", aliases: ["JBU"], logoUrl: "https://images.kiwi.com/airlines/64/B6.png" },
  { code: "DL", name: "Delta Air Lines", callsign: "Delta", aliases: ["DAL"], logoUrl: "https://images.kiwi.com/airlines/64/DL.png" },
  { code: "F9", name: "Frontier Airlines", callsign: "Frontier", aliases: ["FFT"], logoUrl: "https://images.kiwi.com/airlines/64/F9.png" },
  { code: "NK", name: "Spirit Airlines", callsign: "Spirit Wings", aliases: ["NKS"], logoUrl: "https://images.kiwi.com/airlines/64/NK.png" },
  { code: "UA", name: "United Airlines", callsign: "United", aliases: ["UAL"], logoUrl: "https://images.kiwi.com/airlines/64/UA.png" },
  { code: "WN", name: "Southwest Airlines", callsign: "Southwest", aliases: ["SWA", "SW"], logoUrl: "https://images.kiwi.com/airlines/64/WN.png" },
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
    logoUrl: "",
  };
}

export function airlineLogoFor(code: string): string {
  return airlines.find((airline) => (
    airline.code === code.toUpperCase() ||
    airline.aliases.includes(code.toUpperCase())
  ))?.logoUrl ?? "";
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
