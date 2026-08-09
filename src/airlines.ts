export type Airline = {
  code: string;
  name: string;
  callsign: string;
  aliases: string[];
  logoUrl: string;
};

export const airlines: Airline[] = [
  { code: "AA", name: "American Airlines", callsign: "American", aliases: ["AAL"], logoUrl: "https://logo.clearbit.com/aa.com" },
  { code: "AS", name: "Alaska Airlines", callsign: "Alaska", aliases: ["ASA"], logoUrl: "https://logo.clearbit.com/alaskaair.com" },
  { code: "B6", name: "JetBlue", callsign: "JetBlue", aliases: ["JBU"], logoUrl: "https://logo.clearbit.com/jetblue.com" },
  { code: "DL", name: "Delta Air Lines", callsign: "Delta", aliases: ["DAL"], logoUrl: "https://logo.clearbit.com/delta.com" },
  { code: "F9", name: "Frontier Airlines", callsign: "Frontier", aliases: ["FFT"], logoUrl: "https://logo.clearbit.com/flyfrontier.com" },
  { code: "NK", name: "Spirit Airlines", callsign: "Spirit Wings", aliases: ["NKS"], logoUrl: "https://logo.clearbit.com/spirit.com" },
  { code: "UA", name: "United Airlines", callsign: "United", aliases: ["UAL"], logoUrl: "https://logo.clearbit.com/united.com" },
  { code: "WN", name: "Southwest Airlines", callsign: "Southwest", aliases: ["SWA", "SW"], logoUrl: "https://logo.clearbit.com/southwest.com" },
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
