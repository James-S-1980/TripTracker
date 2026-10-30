import type { FlightLeg } from "./types";

export type BoardingPolicy = {
  airline: string;
  codes: string[];
  leadMinutes: number;
  basis: "boarding-start" | "gate-ready";
  detail: string;
  sourceUrl: string;
};

export type BoardingEstimate = {
  time: string | null;
  kind: "exact" | "policy" | "unavailable";
  policy?: BoardingPolicy;
};

const boardingPolicies: BoardingPolicy[] = [
  {
    airline: "American Airlines",
    codes: ["AA", "AAL"],
    leadMinutes: 50,
    basis: "boarding-start",
    detail: "Most flights board 30-50 minutes before departure; this uses the earliest published start.",
    sourceUrl: "https://www.aa.com/web/i18n/travel-info/boarding-process.html",
  },
  {
    airline: "United Airlines",
    codes: ["UA", "UAL"],
    leadMinutes: 50,
    basis: "boarding-start",
    detail: "Most flights board 40-50 minutes before departure; this uses the earliest published start.",
    sourceUrl: "https://www.united.com/en/us/fly/travel/airport/boarding-process.html",
  },
  {
    airline: "Southwest Airlines",
    codes: ["WN", "SWA"],
    leadMinutes: 30,
    basis: "boarding-start",
    detail: "Southwest may begin boarding as early as 30 minutes before departure.",
    sourceUrl: "https://www.southwest.com/air/check-in/index.html?validate=true",
  },
  {
    airline: "Delta Air Lines",
    codes: ["DL", "DAL"],
    leadMinutes: 45,
    basis: "gate-ready",
    detail: "Delta recommends being gate-ready 45 minutes before international departures; TripTracker uses that conservative reminder when route type is unavailable.",
    sourceUrl: "https://www.delta.com/us/en/check-in-security/check-in-time-requirements/international-check-in",
  },
  {
    airline: "Frontier Airlines",
    codes: ["F9", "FFT"],
    leadMinutes: 45,
    basis: "boarding-start",
    detail: "Frontier publishes that boarding begins 45 minutes before departure.",
    sourceUrl: "https://faq.flyfrontier.com/help/airport-information-what-times-do-i-need-to-keep-in-mind-to-ensure-i-make-my-flight",
  },
  {
    airline: "Alaska Airlines",
    codes: ["AS", "ASA"],
    leadMinutes: 50,
    basis: "gate-ready",
    detail: "Alaska asks passengers to be at the gate and ready to board 50 minutes before departure.",
    sourceUrl: "https://www.alaskaair.com/content/travel-info/flight-experience/our-boarding-process",
  },
  {
    airline: "Air Canada",
    codes: ["AC", "ACA"],
    leadMinutes: 45,
    basis: "gate-ready",
    detail: "Air Canada publishes a 30-minute gate deadline for Canada/U.S. trips and 45 minutes for international trips; this uses the more conservative 45-minute reminder.",
    sourceUrl: "https://www.aircanada.com/us/en/aco/home/plan/check-in-information/check-in-and-boarding-times.html",
  },
  {
    airline: "British Airways",
    codes: ["BA", "BAW"],
    leadMinutes: 50,
    basis: "gate-ready",
    detail: "British Airways asks passengers to be at the gate and ready to board at least 50 minutes before departure.",
    sourceUrl: "https://www.britishairways.com/content/information/checking-in-and-boarding/boarding",
  },
  {
    airline: "Allegiant Air",
    codes: ["G4", "AAY"],
    leadMinutes: 60,
    basis: "gate-ready",
    detail: "Allegiant asks passengers to be through security and at the departure gate one hour before departure.",
    sourceUrl: "https://www.allegiantair.com/seating-checking-boarding",
  },
];

export function boardingPolicyFor(code: string): BoardingPolicy | undefined {
  const normalized = code.trim().toUpperCase();
  return boardingPolicies.find((policy) => policy.codes.includes(normalized));
}

export function boardingEstimate(flight: FlightLeg): BoardingEstimate {
  const exactTime = validIsoTime(flight.boardingTime);
  if (exactTime) return { time: exactTime, kind: "exact" };

  const policy = boardingPolicyFor(flight.airlineCode || flight.flightNumber.split(/\s+/)[0]);
  const departure = new Date(flight.departureTime).getTime();
  if (!policy || !Number.isFinite(departure)) return { time: null, kind: "unavailable" };

  return {
    time: new Date(departure - policy.leadMinutes * 60000).toISOString(),
    kind: "policy",
    policy,
  };
}

function validIsoTime(value?: string): string | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}
