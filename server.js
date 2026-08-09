import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT ?? 8787;
const flightAwareBaseUrl = "https://aeroapi.flightaware.com/aeroapi";
const generatedAirports = JSON.parse(fs.readFileSync(path.join(__dirname, "src", "airportCatalog.generated.json"), "utf8"));

const airlineIcaoByIata = {
  AA: "AAL",
  AS: "ASA",
  B6: "JBU",
  DL: "DAL",
  F9: "FFT",
  NK: "NKS",
  UA: "UAL",
  WN: "SWA",
};

const airlineIataByIcao = Object.fromEntries(
  Object.entries(airlineIcaoByIata).map(([iata, icao]) => [icao, iata]),
);

const airlineBrands = {
  AA: { name: "American Airlines", logoUrl: "https://logo.clearbit.com/aa.com" },
  AS: { name: "Alaska Airlines", logoUrl: "https://logo.clearbit.com/alaskaair.com" },
  B6: { name: "JetBlue", logoUrl: "https://logo.clearbit.com/jetblue.com" },
  DL: { name: "Delta Air Lines", logoUrl: "https://logo.clearbit.com/delta.com" },
  F9: { name: "Frontier Airlines", logoUrl: "https://logo.clearbit.com/flyfrontier.com" },
  NK: { name: "Spirit Airlines", logoUrl: "https://logo.clearbit.com/spirit.com" },
  UA: { name: "United Airlines", logoUrl: "https://logo.clearbit.com/united.com" },
  WN: { name: "Southwest Airlines", logoUrl: "https://logo.clearbit.com/southwest.com" },
};

const airportCatalog = Object.fromEntries(generatedAirports.map((airport) => [airport.code, airport]));

function addDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString();
}

function normalizeAirport(airport) {
  if (!airport) return null;
  const code = airport.code_iata ?? airport.code?.replace(/^K(?=[A-Z]{3}$)/, "") ?? "UNK";
  const knownAirport = airportCatalog[code];
  if (knownAirport) {
    return {
      ...knownAirport,
      name: airport.name ?? knownAirport.name,
      city: airport.city ?? knownAirport.city,
      timeZone: airport.timezone ?? knownAirport.timeZone,
    };
  }

  return {
    code,
    name: airport.name ?? "Unknown airport",
    city: airport.city ?? "Unknown",
    lat: 0,
    lon: 0,
    timeZone: airport.timezone ?? "America/New_York",
  };
}

function statusFromFlight(flight) {
  if (flight.cancelled) return "Cancelled";
  if (flight.actual_in || flight.actual_on) return "Arrived";
  if (flight.actual_off || flight.progress_percent > 0) return "En Route";
  if (flight.status?.toLowerCase().includes("delay")) return "Delayed";
  if (flight.actual_out) return "Boarding";
  return "Scheduled";
}

function mapFlightAwareFlight(flight, requestedDate) {
  const origin = normalizeAirport(flight.origin);
  const destination = normalizeAirport(flight.destination);
  if (!origin || !destination) {
    throw new Error("FlightAware response did not include origin and destination airports.");
  }

  const departureTime = flight.actual_out ?? flight.estimated_out ?? flight.scheduled_out ?? flight.actual_off ?? flight.estimated_off ?? flight.scheduled_off;
  const arrivalTime = flight.actual_in ?? flight.estimated_in ?? flight.scheduled_in ?? flight.actual_on ?? flight.estimated_on ?? flight.scheduled_on;
  if (!departureTime || !arrivalTime) {
    throw new Error("FlightAware response did not include usable departure and arrival times.");
  }

  const status = statusFromFlight(flight);
  const alerts = [
    {
      id: `${flight.fa_flight_id}-status`,
      type: "status",
      priority: status === "Delayed" || status === "Cancelled" ? "critical" : status === "En Route" ? "high" : "normal",
      title: status,
      message: flight.status ?? `FlightAware reports ${status.toLowerCase()} status.`,
      timestamp: new Date().toISOString(),
    },
  ];

  if (flight.gate_origin || flight.gate_destination) {
    alerts.unshift({
      id: `${flight.fa_flight_id}-gate`,
      type: "gate",
      priority: "high",
      title: "Gate information available",
      message: `Departure ${flight.gate_origin ?? "TBD"} / arrival ${flight.gate_destination ?? "TBD"}.`,
      timestamp: new Date().toISOString(),
    });
  }

  const flightNumber = flight.operator_iata && flight.flight_number
    ? `${flight.operator_iata} ${flight.flight_number}`
    : flight.ident_iata ?? flight.ident ?? `${flight.operator_iata ?? ""} ${flight.flight_number ?? ""}`.trim();
  const airlineCode = flight.operator_iata ?? flightNumber.match(/^([A-Z0-9]{2})/)?.[1] ?? "";
  const brand = airlineBrands[airlineCode];

  return {
    id: flight.fa_flight_id,
    airline: flight.operator ?? brand?.name ?? flight.operator_iata ?? "FlightAware",
    airlineCode,
    airlineLogoUrl: brand?.logoUrl,
    flightNumber,
    date: requestedDate,
    origin,
    destination,
    departureTime,
    arrivalTime,
    boardingGate: flight.gate_origin ?? "TBD",
    arrivalGate: flight.gate_destination ?? "TBD",
    terminal: flight.terminal_origin ?? "TBD",
    arrivalTerminal: flight.terminal_destination ?? "TBD",
    status,
    progress: flight.progress_percent ?? (status === "Arrived" ? 100 : status === "En Route" ? 50 : 0),
    altitudeFt: flight.filed_altitude ? flight.filed_altitude * 100 : 0,
    groundSpeedMph: flight.filed_airspeed ? Math.round(flight.filed_airspeed * 1.15078) : 0,
    lastUpdated: new Date().toISOString(),
    dataSource: "FlightAware AeroAPI",
    alerts,
  };
}

async function enrichFlightAwarePosition(mappedFlight, apiKey) {
  const [position, track] = await Promise.all([
    fetchFlightAwarePosition(mappedFlight.id, apiKey).catch(() => null),
    fetchFlightAwareTrack(mappedFlight.id, apiKey).catch(() => []),
  ]);

  return {
    ...mappedFlight,
    aircraftPosition: position ?? track.at(-1),
    track: track.length > 0 ? track : undefined,
    altitudeFt: position?.altitudeFt ?? track.at(-1)?.altitudeFt ?? mappedFlight.altitudeFt,
    groundSpeedMph: position?.groundSpeedMph ?? track.at(-1)?.groundSpeedMph ?? mappedFlight.groundSpeedMph,
  };
}

async function fetchFlightAwarePosition(faFlightId, apiKey) {
  const response = await fetch(`${flightAwareBaseUrl}/flights/${encodeURIComponent(faFlightId)}/position`, {
    headers: { "x-apikey": apiKey },
  });
  if (!response.ok) return null;
  const payload = await response.json();
  const position = payload.last_position ?? payload.position ?? payload;
  return mapFlightAwarePosition(position, "FlightAware live position");
}

async function fetchFlightAwareTrack(faFlightId, apiKey) {
  const params = new URLSearchParams({ include_estimated_positions: "true" });
  const response = await fetch(`${flightAwareBaseUrl}/flights/${encodeURIComponent(faFlightId)}/track?${params.toString()}`, {
    headers: { "x-apikey": apiKey },
  });
  if (!response.ok) return [];
  const payload = await response.json();
  const positions = payload.positions ?? payload.track ?? [];
  return positions.map((position) => mapFlightAwarePosition(position, "FlightAware track")).filter(Boolean);
}

function mapFlightAwarePosition(position, source) {
  const lat = Number(position.latitude ?? position.lat);
  const lon = Number(position.longitude ?? position.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const altitude = Number(position.altitude ?? position.altitude_ft ?? 0);
  const groundSpeed = Number(position.groundspeed ?? position.groundspeed_mph ?? position.speed ?? 0);

  return {
    lat,
    lon,
    altitudeFt: altitude > 1000 ? Math.round(altitude) : Math.round(altitude * 100),
    groundSpeedMph: Number.isFinite(groundSpeed) ? Math.round(groundSpeed * (source.includes("FlightAware") ? 1.15078 : 1)) : undefined,
    headingDeg: Number(position.heading ?? position.course ?? position.heading_deg),
    timestamp: position.timestamp ?? position.time,
    source,
  };
}

function chooseFlight(flights, requestedDate) {
  const target = requestedDate.slice(0, 10);
  return flights.find((flight) => (
    (flight.scheduled_out ?? flight.scheduled_off ?? "").startsWith(target)
  )) ?? flights[0];
}

app.get(["/api/flights/lookup", "/trip/api/flights/lookup"], async (request, response) => {
  const requestedAirline = String(request.query.airline ?? "").toUpperCase();
  const airline = normalizeAirlineCode(requestedAirline);
  const flightNumber = String(request.query.flightNumber ?? "").replace(/\D/g, "");
  const date = String(request.query.date ?? new Date().toISOString().slice(0, 10));
  const ident = `${airlineIcaoByIata[airline] ?? airline}${flightNumber}`;
  const errors = [];

  const flightAwareFlight = await lookupFlightAware(ident, date).catch((error) => {
    errors.push(error instanceof Error ? error.message : "FlightAware lookup failed.");
    return null;
  });
  if (flightAwareFlight) {
    response.json(flightAwareFlight);
    return;
  }

  const webFlight = await lookupWebFlight(ident, airline, flightNumber, date).catch((error) => {
    errors.push(error instanceof Error ? error.message : "Web search lookup failed.");
    return null;
  });
  if (webFlight) {
    response.json(webFlight);
    return;
  }

  response.status(404).json({
    error: `No live flight data found for ${ident} on ${date}.`,
    detail: errors.join(" "),
  });
});

function normalizeAirlineCode(code) {
  return airlineIataByIcao[code] ?? code;
}

async function lookupFlightAware(ident, date) {
  const apiKey = process.env.FLIGHTAWARE_AEROAPI_KEY;
  if (!apiKey) {
    throw new Error("FlightAware API key is not configured.");
  }

  const params = new URLSearchParams({
    ident_type: "designator",
    start: addDays(date, -1),
    end: addDays(date, 2),
    max_pages: "1",
  });
  const flightAwareResponse = await fetch(`${flightAwareBaseUrl}/flights/${encodeURIComponent(ident)}?${params.toString()}`, {
    headers: { "x-apikey": apiKey },
  });

  if (!flightAwareResponse.ok) {
    throw new Error(`FlightAware returned ${flightAwareResponse.status}.`);
  }

  const payload = await flightAwareResponse.json();
  const flight = chooseFlight(payload.flights ?? [], date);
  return flight ? enrichFlightAwarePosition(mapFlightAwareFlight(flight, date), apiKey) : null;
}

async function lookupWebFlight(ident, airline, flightNumber, date) {
  const query = `${ident} ${airline} ${flightNumber} flight status ${date}`;
  const url = `https://www.google.com/search?${new URLSearchParams({ q: query, hl: "en" }).toString()}`;
  const errors = [];

  try {
    const searchResponse = await fetch(url, { headers: browserHeaders() });
    if (!searchResponse.ok) {
      throw new Error(`Google flight search returned ${searchResponse.status}.`);
    }
    const html = await searchResponse.text();
    return parseGoogleFlightCard(html, ident, airline, flightNumber, date, url);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Google flight card parse failed.");
  }

  try {
    const flightStatsUrl = flightStatsUrlFor(airline, flightNumber, date);
    const flightStatsResponse = await fetch(flightStatsUrl, { headers: browserHeaders() });
    if (!flightStatsResponse.ok) {
      throw new Error(`FlightStats returned ${flightStatsResponse.status}.`);
    }
    const html = await flightStatsResponse.text();
    return parseFlightStatsPage(html, ident, airline, flightNumber, date, flightStatsUrl);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "FlightStats parse failed.");
  }

  throw new Error(errors.join(" "));
}

function browserHeaders() {
  return {
    "accept-language": "en-US,en;q=0.9",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
  };
}

function flightStatsUrlFor(airline, flightNumber, date) {
  const [year, month, day] = date.split("-");
  return `https://www.flightstats.com/v2/flight-tracker/${airline}/${flightNumber}?${new URLSearchParams({
    year,
    month: String(Number(month)),
    date: String(Number(day)),
  }).toString()}`;
}

function parseGoogleFlightCard(html, ident, airline, flightNumber, date, sourceUrl) {
  const text = decodeHtml(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const route = findRoute(text);
  if (!route) {
    throw new Error("Web search did not expose a parseable flight-card route.");
  }

  const origin = airportForRouteCode(route.origin, text);
  const destination = airportForRouteCode(route.destination, text);

  const status = findStatus(text);
  const times = findFlightTimes(text, date, origin.timeZone, destination.timeZone);
  const gates = [...text.matchAll(/Terminal\s+([A-Z0-9/]+)\s+Gate\s+([A-Z0-9/]+)/gi)];
  const updated = text.match(/Updated\s+([^.;]+?)(?:\s+·|\s+-|\s+Cirium|\s*$)/i)?.[1]?.trim();

  return {
    id: `web-${ident}-${date}`,
    airline: airlineNameFromCode(airline),
    airlineCode: airline,
    airlineLogoUrl: airlineLogoFor(airline),
    flightNumber: `${airline} ${flightNumber}`,
    date,
    origin,
    destination,
    departureTime: times.departureTime,
    arrivalTime: times.arrivalTime,
    boardingGate: gates[0]?.[2] ?? "TBD",
    arrivalGate: gates[1]?.[2] ?? "TBD",
    terminal: gates[0]?.[1] ?? "TBD",
    arrivalTerminal: gates[1]?.[1] ?? "TBD",
    status,
    progress: status === "Arrived" ? 100 : status === "En Route" ? 70 : 0,
    altitudeFt: 0,
    groundSpeedMph: 0,
    aircraftPosition: estimatedPosition(origin, destination, status, times.departureTime, times.arrivalTime),
    lastUpdated: new Date().toISOString(),
    dataSource: `Web search flight card${updated ? `, updated ${updated}` : ""}`,
    sourceUrl,
    alerts: [
      {
        id: `web-${ident}-${date}-status`,
        type: "status",
        priority: status === "Delayed" || status === "Cancelled" ? "critical" : "high",
        title: status,
        message: `Parsed ${route.origin} to ${route.destination} from public web-search flight results.`,
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

function parseFlightStatsPage(html, ident, airline, flightNumber, date, sourceUrl) {
  const text = plainText(html);
  const route = findFlightStatsRoute(text, airline, flightNumber) ?? findRoute(text);
  if (!route) {
    throw new Error("FlightStats page did not expose a parseable route.");
  }

  const origin = airportForRouteCode(route.origin, text);
  const destination = airportForRouteCode(route.destination, text);

  const status = findStatus(text);
  const departureTimeText =
    text.match(/Flight Departure Times.*?Actual\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?)/i)?.[1] ??
    text.match(/Flight Departure Times.*?Estimated\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?)/i)?.[1] ??
    text.match(/Flight Departure Times.*?Scheduled\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?)/i)?.[1];
  const arrivalTimeText =
    text.match(/Flight Arrival Times.*?Actual\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?)/i)?.[1] ??
    text.match(/Flight Arrival Times.*?Estimated\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?)/i)?.[1] ??
    text.match(/Flight Arrival Times.*?Scheduled\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?)/i)?.[1];
  const gates = [...text.matchAll(/Terminal\s+([A-Z0-9/]+)\s+Gate\s+([A-Z0-9/]+)/gi)];
  const flightTime = text.match(/Flight Time Total\s+([^ ]+\s+[^ ]+)/i)?.[1];

  if (!departureTimeText || !arrivalTimeText) {
    throw new Error("FlightStats page did not expose usable departure and arrival times.");
  }

  const departureTime = wallTimeToUtcIso(date, departureTimeText, origin.timeZone);
  const arrivalTime = wallTimeToUtcIso(date, arrivalTimeText, destination.timeZone);
  const altitudeText = text.match(/ALTITUDE\s+(\d+)\s*ft/i)?.[1];
  const speedText = text.match(/Speed\s+(\d+)\s+kts/i)?.[1];
  const altitudeFt = Number(altitudeText ?? 0);
  const speedMph = Math.round(Number(speedText ?? 0) * 1.15078);

  return {
    id: `flightstats-${ident}-${date}`,
    airline: airlineNameFromCode(airline),
    airlineCode: airline,
    airlineLogoUrl: airlineLogoFor(airline),
    flightNumber: `${airline} ${flightNumber}`,
    date,
    origin,
    destination,
    departureTime,
    arrivalTime,
    boardingGate: gates[0]?.[2] ?? "TBD",
    arrivalGate: gates[1]?.[2] ?? "TBD",
    terminal: gates[0]?.[1] ?? "TBD",
    arrivalTerminal: gates[1]?.[1] ?? "TBD",
    status,
    progress: progressFromTimes(status, departureTime, arrivalTime),
    altitudeFt,
    groundSpeedMph: speedMph,
    aircraftPosition: estimatedPosition(origin, destination, status, departureTime, arrivalTime, altitudeFt, speedMph),
    lastUpdated: new Date().toISOString(),
    dataSource: "FlightStats public page, powered by Cirium",
    sourceUrl,
    alerts: [
      {
        id: `flightstats-${ident}-${date}-status`,
        type: "status",
        priority: status === "Delayed" || status === "Cancelled" ? "critical" : "high",
        title: status,
        message: `Parsed ${route.origin} to ${route.destination}${flightTime ? `, flight time ${flightTime}` : ""}.`,
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

function estimatedPosition(origin, destination, status, departureTime, arrivalTime, altitudeFt = 0, groundSpeedMph = 0) {
  if (status !== "En Route") return undefined;
  const progress = progressFromTimes(status, departureTime, arrivalTime) / 100;
  const point = interpolateGreatCircle(origin, destination, progress);
  return {
    lat: point.lat,
    lon: point.lon,
    altitudeFt,
    groundSpeedMph,
    timestamp: new Date().toISOString(),
    source: "Estimated from schedule",
  };
}

function interpolateGreatCircle(origin, destination, fraction) {
  const lat1 = toRadians(origin.lat);
  const lon1 = toRadians(origin.lon);
  const lat2 = toRadians(destination.lat);
  const lon2 = toRadians(destination.lon);
  const delta = 2 * Math.asin(Math.sqrt(
    Math.sin((lat2 - lat1) / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2,
  ));

  if (delta === 0) return { lat: origin.lat, lon: origin.lon };
  const a = Math.sin((1 - fraction) * delta) / Math.sin(delta);
  const b = Math.sin(fraction * delta) / Math.sin(delta);
  const x = a * Math.cos(lat1) * Math.cos(lon1) + b * Math.cos(lat2) * Math.cos(lon2);
  const y = a * Math.cos(lat1) * Math.sin(lon1) + b * Math.cos(lat2) * Math.sin(lon2);
  const z = a * Math.sin(lat1) + b * Math.sin(lat2);
  return { lat: toDegrees(Math.atan2(z, Math.sqrt(x ** 2 + y ** 2))), lon: toDegrees(Math.atan2(y, x)) };
}

function toRadians(value) {
  return value * Math.PI / 180;
}

function toDegrees(value) {
  return value * 180 / Math.PI;
}

function progressFromTimes(status, departureTime, arrivalTime) {
  if (status === "Arrived") return 100;
  if (status !== "En Route") return 0;
  const start = new Date(departureTime).getTime();
  const end = new Date(arrivalTime).getTime();
  const now = Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 70;
  return Math.max(5, Math.min(98, Math.round(((now - start) / (end - start)) * 100)));
}

function plainText(html) {
  return decodeHtml(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function findRoute(text) {
  const explicit = text.match(/\b([A-Z]{3})\s*(?:to|→|-)\s*([A-Z]{3})\b/);
  if (explicit) return { origin: explicit[1], destination: explicit[2] };

  const airportBlocks = [...text.matchAll(/\b([A-Z]{3})\s+[^,]+,\s+[A-Z]{2,},\s+(?:US|MX|CA)\s+[^.]*?\bAirport\b/gi)]
    .map((match) => match[1].toUpperCase());
  const uniqueAirportBlocks = [...new Set(airportBlocks)];
  if (uniqueAirportBlocks.length >= 2) {
    return { origin: uniqueAirportBlocks[0], destination: uniqueAirportBlocks[1] };
  }

  const codes = [...text.matchAll(/\b([A-Z]{3})\b/g)]
    .map((match) => match[1])
    .filter((code) => airportCatalog[code]);
  const uniqueCodes = [...new Set(codes)];
  return uniqueCodes.length >= 2 ? { origin: uniqueCodes[0], destination: uniqueCodes[1] } : null;
}

function findFlightStatsRoute(text, airline, flightNumber) {
  const marker = `Flight Status ${airline} ${flightNumber}`;
  const markerIndex = text.indexOf(marker);
  if (markerIndex === -1) return null;

  const slice = text.slice(markerIndex, markerIndex + 320);
  const airlineIcao = airlineIcaoByIata[airline];
  const codes = [...slice.matchAll(/\b([A-Z]{3})\b/g)]
    .map((match) => match[1])
    .filter((code) => code !== airline && code !== airlineIcao && code !== "N/A");
  return codes.length >= 2 ? { origin: codes[0], destination: codes[1] } : null;
}

function airportForRouteCode(code, text) {
  const known = airportCatalog[code];
  if (known) return known;

  const airportPattern = new RegExp(`${code}\\s+([^,]+),\\s*([A-Z]{2,}),\\s*(US|MX|CA)\\s+([^]*? Airport)`, "i");
  const match = text.match(airportPattern);
  return {
    code,
    name: match?.[4]?.trim() ?? `${code} Airport`,
    city: match?.[1]?.trim() ?? code,
    lat: 0,
    lon: 0,
    timeZone: "America/New_York",
  };
}

function findStatus(text) {
  if (/\b(cancelled|canceled)\b/i.test(text)) return "Cancelled";
  if (/\b(landed|arrived)\b/i.test(text)) return "Arrived";
  if (/\ben route|in air|departed\b/i.test(text)) return "En Route";
  if (/\bdelayed\b/i.test(text)) return "Delayed";
  if (/\bboarding\b/i.test(text)) return "Boarding";
  return "Scheduled";
}

function findFlightTimes(text, date, originTimeZone, destinationTimeZone) {
  const departed = text.match(/\b(?:Departed|Departure)\s+(\d{1,2}:\d{2}\s*[AP]M)\b/i)?.[1];
  const landed = text.match(/\b(?:Landed|Arrived|Arrival)\s+(\d{1,2}:\d{2}\s*[AP]M)\b/i)?.[1];
  const genericTimes = [...text.matchAll(/\b(\d{1,2}:\d{2}\s*[AP]M)\b/gi)].map((match) => match[1]);

  return {
    departureTime: wallTimeToUtcIso(date, departed ?? genericTimes[0] ?? "12:00 PM", originTimeZone),
    arrivalTime: wallTimeToUtcIso(date, landed ?? genericTimes[1] ?? genericTimes[0] ?? "12:00 PM", destinationTimeZone),
  };
}

function wallTimeToUtcIso(date, time, timeZone) {
  const [, hourText, minuteText, suffix] = time.match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i) ?? [];
  let hour = Number(hourText ?? 12);
  const minute = Number(minuteText ?? 0);
  if (suffix?.toUpperCase() === "PM" && hour !== 12) hour += 12;
  if (suffix?.toUpperCase() === "AM" && hour === 12) hour = 0;

  const candidate = new Date(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    hour: "2-digit",
  });
  const offsetName = formatter.formatToParts(candidate).find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const offset = offsetName.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!offset) return candidate.toISOString();
  const offsetMinutes = (Number(offset[2]) * 60 + Number(offset[3] ?? 0)) * (offset[1] === "+" ? 1 : -1);
  return new Date(candidate.getTime() - offsetMinutes * 60000).toISOString();
}

function airlineNameFromCode(code) {
  return airlineBrands[code]?.name ?? code;
}

function airlineLogoFor(code) {
  return airlineBrands[code]?.logoUrl ?? "";
}

app.use(express.static(path.join(__dirname, "dist")));
app.use("/trip", express.static(path.join(__dirname, "dist")));
app.use((request, response) => {
  if (request.path.startsWith("/trip")) {
    response.sendFile(path.join(__dirname, "dist", "index.html"));
    return;
  }
  response.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.listen(port, () => {
  console.log(`TripTracker server listening on http://127.0.0.1:${port}`);
});
