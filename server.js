import express from "express";
import fs from "node:fs";
import nodemailer from "nodemailer";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT ?? 8787;
const flightAwareBaseUrl = "https://aeroapi.flightaware.com/aeroapi";
const airplanesLiveBaseUrl = "https://api.airplanes.live/v2";
const smsRecipient = process.env.TRIPTRACKER_SMS_TO ?? "4438762640@tmomail.net";
const smsFrom = process.env.TRIPTRACKER_SMTP_USER ?? "James.schliesske@gmail.com";
const smsAppPassword = process.env.TRIPTRACKER_SMTP_APP_PASSWORD;
const milesToNauticalMiles = 0.868976;
const earthRadiusMiles = 3958.7613;
const adsbCacheMs = 30000;
const adsbMaxRadiusNm = 250;
const generatedAirports = JSON.parse(fs.readFileSync(path.join(__dirname, "src", "airportCatalog.generated.json"), "utf8"));
const adsbPointCache = new Map();

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
  AA: { name: "American Airlines", logoUrl: "https://www.gstatic.com/flights/airline_logos/70px/AA.png" },
  AS: { name: "Alaska Airlines", logoUrl: "https://www.gstatic.com/flights/airline_logos/70px/AS.png" },
  B6: { name: "JetBlue", logoUrl: "https://www.gstatic.com/flights/airline_logos/70px/B6.png" },
  DL: { name: "Delta Air Lines", logoUrl: "https://www.gstatic.com/flights/airline_logos/70px/DL.png" },
  F9: { name: "Frontier Airlines", logoUrl: "https://www.gstatic.com/flights/airline_logos/70px/F9.png" },
  NK: { name: "Spirit Airlines", logoUrl: "https://www.gstatic.com/flights/airline_logos/70px/NK.png" },
  UA: { name: "United Airlines", logoUrl: "https://www.gstatic.com/flights/airline_logos/70px/UA.png" },
  WN: { name: "Southwest Airlines", logoUrl: "https://www.gstatic.com/flights/airline_logos/70px/WN.png" },
};

const airportCatalog = Object.fromEntries(generatedAirports.map((airport) => [airport.code, airport]));
app.use(express.json({ limit: "64kb" }));

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

function usefulAirportValue(value) {
  const normalized = String(value ?? "").trim();
  return normalized && !/^(?:n\/?a|na|none|null|unknown|tbd|-|--|\?)$/i.test(normalized) ? normalized : "TBD";
}

function usefulOptionalValue(value) {
  const normalized = usefulAirportValue(value);
  return normalized === "TBD" ? undefined : normalized;
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
    boardingGate: usefulAirportValue(flight.gate_origin),
    arrivalGate: usefulAirportValue(flight.gate_destination),
    terminal: usefulAirportValue(flight.terminal_origin),
    arrivalTerminal: usefulAirportValue(flight.terminal_destination),
    status,
    progress: flight.progress_percent ?? (status === "Arrived" ? 100 : status === "En Route" ? 50 : 0),
    altitudeFt: flight.filed_altitude ? flight.filed_altitude * 100 : 0,
    groundSpeedMph: flight.filed_airspeed ? Math.round(flight.filed_airspeed * 1.15078) : 0,
    tailNumber: usefulOptionalValue(flight.registration),
    inboundFlightId: usefulOptionalValue(flight.inbound_fa_flight_id),
    lastUpdated: new Date().toISOString(),
    dataSource: "FlightAware AeroAPI",
    alerts,
  };
}

async function enrichFlightAwarePosition(mappedFlight, apiKey) {
  const [position, track, inboundFlight] = await Promise.all([
    fetchFlightAwarePosition(mappedFlight.id, apiKey).catch(() => null),
    fetchFlightAwareTrack(mappedFlight.id, apiKey).catch(() => []),
    mappedFlight.inboundFlightId ? fetchFlightAwareFlightById(mappedFlight.inboundFlightId, apiKey).catch(() => null) : Promise.resolve(null),
  ]);
  const inboundFrom = inboundFlight?.origin ? normalizeAirport(inboundFlight.origin) : undefined;
  const inboundFlightNumber = inboundFlight ? flightNumberFromFlightAware(inboundFlight) : undefined;
  const inboundStatus = inboundFlight ? statusFromFlight(inboundFlight) : undefined;

  return {
    ...mappedFlight,
    aircraftPosition: position ?? track.at(-1),
    track: track.length > 0 ? track : undefined,
    altitudeFt: position?.altitudeFt ?? track.at(-1)?.altitudeFt ?? mappedFlight.altitudeFt,
    groundSpeedMph: position?.groundSpeedMph ?? track.at(-1)?.groundSpeedMph ?? mappedFlight.groundSpeedMph,
    tailNumber: mappedFlight.tailNumber ?? position?.tailNumber ?? track.at(-1)?.tailNumber,
    inboundFrom,
    inboundFlightNumber,
    inboundStatus,
    inboundSource: inboundFrom ? "FlightAware AeroAPI" : undefined,
  };
}

async function enrichAdsbPosition(mappedFlight, requestedIdent) {
  if (!isTrackableInFlight(mappedFlight)) {
    return mappedFlight;
  }

  const identifiers = callsignCandidates(mappedFlight, requestedIdent);
  if (identifiers.length === 0) {
    return mappedFlight;
  }

  const searchPoints = routeSearchPoints(mappedFlight.origin, mappedFlight.destination);
  const aircraftLists = await Promise.all(
    searchPoints.map((point) => fetchAirplanesLivePoint(point.lat, point.lon, point.radiusNm).catch(() => [])),
  );
  const aircraft = dedupeAircraft(aircraftLists.flat());
  const match = bestAdsbMatch(aircraft, identifiers, mappedFlight);
  if (!match) {
    return mappedFlight;
  }

  const source = "Airplanes.live ADS-B";
  const dataSource = mappedFlight.dataSource.includes(source)
    ? mappedFlight.dataSource
    : `${mappedFlight.dataSource} + ${source}`;

  return {
    ...mappedFlight,
    aircraftPosition: match,
    altitudeFt: match.altitudeFt ?? mappedFlight.altitudeFt,
    groundSpeedMph: match.groundSpeedMph ?? mappedFlight.groundSpeedMph,
    tailNumber: mappedFlight.tailNumber ?? match.tailNumber,
    lastUpdated: new Date().toISOString(),
    dataSource,
  };
}

function flightNumberFromFlightAware(flight) {
  if (flight.operator_iata && flight.flight_number) {
    return `${flight.operator_iata} ${flight.flight_number}`;
  }
  return flight.ident_iata ?? flight.ident ?? undefined;
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

async function fetchFlightAwareFlightById(faFlightId, apiKey) {
  const response = await fetch(`${flightAwareBaseUrl}/flights/${encodeURIComponent(faFlightId)}`, {
    headers: { "x-apikey": apiKey },
  });
  if (!response.ok) return null;
  const payload = await response.json();
  return (payload.flights ?? [payload]).find(Boolean) ?? null;
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
    tailNumber: usefulOptionalValue(position.registration ?? position.tailnumber ?? position.tail_number),
  };
}

function isTrackableInFlight(flight) {
  return flight.status === "En Route" || flight.progress > 0 && flight.progress < 100;
}

function callsignCandidates(flight, requestedIdent) {
  const values = new Set();
  const compactFlight = compactIdent(flight.flightNumber);
  const [, , flightDigits = ""] = compactFlight.match(/^([A-Z0-9]{2,3})(\d+)$/) ?? [];
  for (const value of [requestedIdent, compactFlight]) {
    if (value) values.add(compactIdent(value));
  }
  const airlineCode = normalizeAirlineCode(String(flight.airlineCode ?? ""));
  const airlineIcao = airlineIcaoByIata[airlineCode] ?? airlineCode;
  if (airlineIcao && flightDigits) values.add(`${airlineIcao}${flightDigits}`);
  if (airlineCode && flightDigits) values.add(`${airlineCode}${flightDigits}`);
  return [...values].filter(Boolean);
}

function compactIdent(value) {
  return String(value ?? "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
}

function routeSearchPoints(origin, destination) {
  const distance = haversineMiles(origin.lat, origin.lon, destination.lat, destination.lon);
  if (!Number.isFinite(distance) || distance <= 0) return [];
  const segments = Math.max(1, Math.min(7, Math.ceil(distance / 420)));
  const radiusMiles = distance / segments / 2 + 80;
  const radiusNm = Math.min(adsbMaxRadiusNm, Math.max(120, Math.ceil(radiusMiles * milesToNauticalMiles)));
  return Array.from({ length: segments + 1 }, (_, index) => {
    const fraction = index / segments;
    const point = interpolateGreatCircle(origin, destination, fraction);
    return { lat: point.lat, lon: point.lon, radiusNm };
  });
}

async function fetchAirplanesLivePoint(lat, lon, radiusNm) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)},${Math.round(radiusNm)}`;
  const cached = adsbPointCache.get(key);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < adsbCacheMs) {
    return cached.aircraft;
  }

  const url = `${airplanesLiveBaseUrl}/point/${lat.toFixed(5)}/${lon.toFixed(5)}/${radiusNm.toFixed(2)}`;
  const response = await fetch(url, { headers: browserHeaders() });
  if (!response.ok) {
    throw new Error(`Airplanes.live returned ${response.status}.`);
  }
  const payload = await response.json();
  const aircraft = Array.isArray(payload.ac) ? payload.ac : [];
  adsbPointCache.set(key, { fetchedAt: now, aircraft });
  pruneAdsbCache(now);
  return aircraft;
}

function pruneAdsbCache(now) {
  for (const [key, value] of adsbPointCache.entries()) {
    if (now - value.fetchedAt > adsbCacheMs * 4) {
      adsbPointCache.delete(key);
    }
  }
}

function dedupeAircraft(aircraft) {
  const byKey = new Map();
  for (const item of aircraft) {
    const key = item.hex ?? item.r ?? cleanAdsbCallsign(item) ?? JSON.stringify([item.lat, item.lon]);
    const existing = byKey.get(key);
    if (!existing || Number(item.seen_pos ?? item.seen ?? 999) < Number(existing.seen_pos ?? existing.seen ?? 999)) {
      byKey.set(key, item);
    }
  }
  return [...byKey.values()];
}

function bestAdsbMatch(aircraft, identifiers, flight) {
  const identifierSet = new Set(identifiers.map(compactIdent));
  let best = null;
  for (const item of aircraft) {
    const callsign = cleanAdsbCallsign(item);
    if (!callsign || !identifierSet.has(callsign)) continue;
    const lat = Number(item.lat);
    const lon = Number(item.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const crossTrack = crossTrackMiles(flight.origin, flight.destination, { lat, lon });
    if (!Number.isFinite(crossTrack) || crossTrack > 250) continue;
    const seenPositionSeconds = Number(item.seen_pos ?? item.seen ?? 0);
    const altitude = item.alt_baro ?? item.alt_geom;
    const altitudeFt = normalizeAdsbAltitude(altitude);
    const groundSpeedMph = Number.isFinite(Number(item.gs)) ? Math.round(Number(item.gs) * 1.15078) : undefined;
    const score = crossTrack + Math.max(0, seenPositionSeconds) / 4;
    const candidate = {
      lat,
      lon,
      altitudeFt,
      groundSpeedMph,
      headingDeg: Number(item.track),
      timestamp: new Date(Date.now() - Math.max(0, seenPositionSeconds) * 1000).toISOString(),
      source: "Airplanes.live ADS-B",
      callsign,
      aircraftHex: item.hex ?? undefined,
      tailNumber: item.r ?? undefined,
      seenPositionSeconds: Number.isFinite(seenPositionSeconds) ? seenPositionSeconds : undefined,
      crossTrackMiles: Math.round(crossTrack),
      score,
    };
    if (!best || candidate.score < best.score) {
      best = candidate;
    }
  }
  if (!best) return null;
  const { score, ...position } = best;
  return position;
}

function cleanAdsbCallsign(aircraft) {
  return compactIdent(aircraft.flight ?? aircraft.call ?? "");
}

function normalizeAdsbAltitude(value) {
  if (value === "ground") return 0;
  const altitude = Number(value);
  return Number.isFinite(altitude) ? Math.round(altitude) : 0;
}

function haversineMiles(latA, lonA, latB, lonB) {
  const dLat = toRadians(latB - latA);
  const dLon = toRadians(lonB - lonA);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(latA)) * Math.cos(toRadians(latB)) * Math.sin(dLon / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function crossTrackMiles(origin, destination, point) {
  const startToPoint = haversineMiles(origin.lat, origin.lon, point.lat, point.lon) / earthRadiusMiles;
  const bearingStartToPoint = bearingRadians(origin.lat, origin.lon, point.lat, point.lon);
  const bearingStartToEnd = bearingRadians(origin.lat, origin.lon, destination.lat, destination.lon);
  return Math.abs(Math.asin(Math.sin(startToPoint) * Math.sin(bearingStartToPoint - bearingStartToEnd)) * earthRadiusMiles);
}

function bearingRadians(latA, lonA, latB, lonB) {
  const phi1 = toRadians(latA);
  const phi2 = toRadians(latB);
  const lambda = toRadians(lonB - lonA);
  return Math.atan2(
    Math.sin(lambda) * Math.cos(phi2),
    Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda),
  );
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
    const enrichedFlight = await enrichFlightAwarePublicMetadata(flightAwareFlight, ident).catch(() => flightAwareFlight);
    response.json(await enrichAdsbPosition(enrichedFlight, ident));
    return;
  }

  const webFlight = await lookupWebFlight(ident, airline, flightNumber, date).catch((error) => {
    errors.push(error instanceof Error ? error.message : "Web search lookup failed.");
    return null;
  });
  if (webFlight) {
    const enrichedFlight = await enrichFlightAwarePublicMetadata(webFlight, ident).catch(() => webFlight);
    response.json(await enrichAdsbPosition(enrichedFlight, ident));
    return;
  }

  response.status(404).json({
    error: `No live flight data found for ${ident} on ${date}.`,
    detail: errors.join(" "),
  });
});

app.post(["/api/notifications/flight-event", "/trip/api/notifications/flight-event"], async (request, response) => {
  try {
    const { eventType, flight, changes = [] } = request.body ?? {};
    if (!flight?.flightNumber || !flight?.origin?.code || !flight?.destination?.code) {
      response.status(400).json({ error: "Notification request did not include a valid flight." });
      return;
    }

    if (!smsAppPassword) {
      response.status(503).json({ error: "Text notifications are not configured on the server." });
      return;
    }

    const message = formatFlightTextMessage(eventType, flight, changes);
    await sendTextMessage(message);
    response.json({ ok: true });
  } catch (error) {
    response.status(500).json({
      error: "Text notification failed.",
      detail: error instanceof Error ? error.message : "Unknown notification error.",
    });
  }
});

function normalizeAirlineCode(code) {
  return airlineIataByIcao[code] ?? code;
}

let smsTransporter = null;

function textTransporter() {
  if (!smsTransporter) {
    smsTransporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: smsFrom,
        pass: smsAppPassword,
      },
    });
  }
  return smsTransporter;
}

async function sendTextMessage(message) {
  await textTransporter().sendMail({
    from: smsFrom,
    to: smsRecipient,
    subject: "",
    text: message,
  });
}

function formatFlightTextMessage(eventType, flight, changes) {
  const route = `${flight.origin.code}-${flight.destination.code}`;
  const header = eventType === "tracked"
    ? `TripTracker tracking ${flight.flightNumber} ${route}`
    : `TripTracker update ${flight.flightNumber} ${route}`;
  const status = `Status: ${flight.status}`;
  const departure = flightTimeLine("Dep", flight.origin, flight.departureTime);
  const arrival = flightTimeLine("Arr", flight.destination, flight.arrivalTime);
  const departureYourTime = easternTimeLine("Dep your time", flight.departureTime, flight.origin.timeZone);
  const arrivalYourTime = easternTimeLine("Arr your time", flight.arrivalTime, flight.destination.timeZone);
  const boardingGate = `Boarding: ${gateText(flight.terminal, flight.boardingGate)}`;
  const arrivalGate = `Arrival: ${gateText(flight.arrivalTerminal, flight.arrivalGate)}`;
  const tail = flight.tailNumber ? `Tail: ${flight.tailNumber}` : undefined;
  const inbound = flight.inboundFrom
    ? `Inbound: ${flight.inboundFrom.code}${flight.inboundFlightNumber ? ` via ${flight.inboundFlightNumber}` : ""}${flight.inboundStatus ? ` ${flight.inboundStatus}` : ""}`
    : undefined;
  const changeText = Array.isArray(changes) && changes.length > 0 ? `Changes: ${changes.join("; ")}` : undefined;

  return [header, status, changeText, departure, departureYourTime, arrival, arrivalYourTime, boardingGate, arrivalGate, tail, inbound]
    .filter(Boolean)
    .join("\n")
    .slice(0, 1500);
}

function flightTimeLine(label, airport, value) {
  const airportName = usefulOptionalValue(airport?.name);
  const city = usefulOptionalValue(airport?.city);
  const airportDetail = airportName ? `${airport.code} / ${airportName}` : airport?.code;
  const cityText = city ? `, ${city}` : "";
  return `${label}: ${formatSmsTime(value, airport?.timeZone)} ${airportDetail}${cityText}`;
}

function easternTimeLine(label, value, airportTimeZone) {
  if (!value || airportTimeZone === "America/New_York") return undefined;
  return `${label}: ${formatSmsTime(value, "America/New_York")}`;
}

function formatSmsTime(value, timeZone) {
  if (!value) return "pending";
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "pending";
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: timeZone ?? "America/New_York",
      timeZoneName: "short",
    }).format(date);
  } catch {
    return "pending";
  }
}

function gateText(terminal, gate) {
  const cleanTerminal = usefulOptionalValue(terminal);
  const cleanGate = usefulOptionalValue(gate);
  if (cleanTerminal && cleanGate) return `${cleanTerminal} / ${cleanGate}`;
  if (cleanGate) return cleanGate;
  if (cleanTerminal) return `Terminal ${cleanTerminal}`;
  return "Pending";
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
  const errors = [];
  const candidateDates = webLookupDates(date);

  for (const lookupDate of candidateDates) {
    const query = `${ident} ${airline} ${flightNumber} flight status ${lookupDate}`;
    const url = `https://www.google.com/search?${new URLSearchParams({ q: query, hl: "en" }).toString()}`;
    try {
      const searchResponse = await fetch(url, { headers: browserHeaders() });
      if (!searchResponse.ok) {
        throw new Error(`Google flight search returned ${searchResponse.status}.`);
      }
      const html = await searchResponse.text();
      return parseGoogleFlightCard(html, ident, airline, flightNumber, lookupDate, url);
    } catch (error) {
      errors.push(error instanceof Error ? `Google ${lookupDate}: ${error.message}` : `Google ${lookupDate}: flight card parse failed.`);
    }
  }

  for (const lookupDate of candidateDates) {
    try {
      const flightStatsUrl = flightStatsUrlFor(airline, flightNumber, lookupDate);
      const flightStatsResponse = await fetch(flightStatsUrl, { headers: browserHeaders() });
      if (!flightStatsResponse.ok) {
        throw new Error(`FlightStats returned ${flightStatsResponse.status}.`);
      }
      const html = await flightStatsResponse.text();
      return parseFlightStatsPage(html, ident, airline, flightNumber, lookupDate, flightStatsUrl);
    } catch (error) {
      errors.push(error instanceof Error ? `FlightStats ${lookupDate}: ${error.message}` : `FlightStats ${lookupDate}: parse failed.`);
    }
  }

  throw new Error(errors.join(" "));
}

async function enrichFlightAwarePublicMetadata(mappedFlight, ident) {
  if (mappedFlight.inboundFrom && mappedFlight.tailNumber) {
    return mappedFlight;
  }

  const publicFlight = await fetchFlightAwarePublicFlight(`https://www.flightaware.com/live/flight/${encodeURIComponent(ident)}`);
  if (!publicFlight || !publicFlightMatches(publicFlight, mappedFlight, ident)) {
    return mappedFlight;
  }

  const tailNumber = mappedFlight.tailNumber ?? usefulOptionalValue(publicFlight.aircraft?.tail);
  const inboundLink = publicFlight.inboundFlight?.linkUrl;
  if (!inboundLink || mappedFlight.inboundFrom) {
    return {
      ...mappedFlight,
      tailNumber,
    };
  }

  const inboundFlight = await fetchFlightAwarePublicFlight(new URL(inboundLink, "https://www.flightaware.com").toString()).catch(() => null);
  const inboundDestinationCode = publicAirportCode(inboundFlight?.destination);
  if (!inboundFlight || inboundDestinationCode !== mappedFlight.origin.code) {
    return {
      ...mappedFlight,
      tailNumber,
    };
  }

  const inboundFrom = airportFromPublicFlightAware(inboundFlight.origin);
  if (!inboundFrom) {
    return {
      ...mappedFlight,
      tailNumber,
    };
  }
  const inboundFlightNumber = flightNumberFromPublicIdent(inboundFlight.displayIdent ?? inboundFlight.ident);
  const inboundTailNumber = tailNumber ??
    usefulOptionalValue(inboundFlight.aircraft?.tail) ??
    await findAdsbTailForInboundFlight(inboundFrom, mappedFlight.origin, inboundFlightNumber, inboundFlight.displayIdent ?? inboundFlight.ident).catch(() => undefined);

  return {
    ...mappedFlight,
    tailNumber: inboundTailNumber,
    inboundFrom,
    inboundFlightNumber,
    inboundStatus: inboundStatusFromPublicFlight(inboundFlight),
    inboundSource: "FlightAware public page",
  };
}

function inboundStatusFromPublicFlight(flight) {
  if (!flight) return undefined;
  if (flight.cancelled) return "Cancelled";

  const nowSeconds = Date.now() / 1000;
  const actualLanding = Number(flight.landingTimes?.actual);
  const actualTakeoff = Number(flight.takeoffTimes?.actual);
  const estimatedTakeoff = Number(flight.takeoffTimes?.estimated ?? flight.takeoffTimes?.scheduled);
  const estimatedLanding = Number(flight.landingTimes?.estimated ?? flight.landingTimes?.scheduled);
  const statusText = String(flight.flightStatus ?? "").toLowerCase();

  if (Number.isFinite(actualLanding) && actualLanding > 0) return "Arrived";
  if (Number.isFinite(actualTakeoff) && actualTakeoff > 0) return "En Route";
  if (/\b(arrived|landed)\b/.test(statusText)) return "Arrived";
  if (/\b(en route|departed|airborne|in air)\b/.test(statusText)) return "En Route";
  if (/\bdelayed\b/.test(statusText)) return "Delayed";
  if (/\bboarding\b/.test(statusText)) return "Boarding";
  if (Number.isFinite(estimatedTakeoff) && estimatedTakeoff <= nowSeconds && (!Number.isFinite(estimatedLanding) || estimatedLanding > nowSeconds)) return "En Route";
  return "Scheduled";
}

async function findAdsbTailForInboundFlight(origin, destination, inboundFlightNumber, publicIdent) {
  if (!origin || !destination || !inboundFlightNumber) return undefined;
  const [airlineCode = ""] = inboundFlightNumber.split(" ");
  const identifiers = callsignCandidates({
    airlineCode,
    flightNumber: inboundFlightNumber,
    origin,
    destination,
  }, publicIdent);
  if (identifiers.length === 0) return undefined;

  const searchPoints = routeSearchPoints(origin, destination);
  const aircraftLists = await Promise.all(
    searchPoints.map((point) => fetchAirplanesLivePoint(point.lat, point.lon, point.radiusNm).catch(() => [])),
  );
  const aircraft = dedupeAircraft(aircraftLists.flat());
  const match = bestAdsbMatch(aircraft, identifiers, { origin, destination });
  return usefulOptionalValue(match?.tailNumber);
}

async function fetchFlightAwarePublicFlight(url) {
  const response = await fetch(url, { headers: browserHeaders() });
  if (!response.ok) return null;
  const html = await response.text();
  const bootstrap = parseFlightAwareBootstrap(html);
  const flights = Object.values(bootstrap?.flights ?? {});
  return flights.find(Boolean) ?? null;
}

function parseFlightAwareBootstrap(html) {
  const match = html.match(/var trackpollBootstrap = (\{[\s\S]*?\});\s*<\/script>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function publicFlightMatches(publicFlight, mappedFlight, ident) {
  const publicIdent = compactIdent(publicFlight.displayIdent ?? publicFlight.ident ?? "");
  const requestedIdent = compactIdent(ident);
  const publicOrigin = publicAirportCode(publicFlight.origin);
  const publicDestination = publicAirportCode(publicFlight.destination);
  return publicIdent === requestedIdent &&
    publicOrigin === mappedFlight.origin.code &&
    publicDestination === mappedFlight.destination.code;
}

function publicAirportCode(airport) {
  return String(airport?.iata ?? airport?.altIdent ?? airport?.icao ?? "")
    .replace(/^K(?=[A-Z]{3}$)/, "")
    .toUpperCase();
}

function airportFromPublicFlightAware(airport) {
  const code = publicAirportCode(airport);
  if (!code) return null;
  const known = airportCatalog[code];
  if (known) return known;

  const coordinates = Array.isArray(airport?.coord) ? airport.coord : [];
  const lon = Number(coordinates[0]);
  const lat = Number(coordinates[1]);
  return {
    code,
    name: airport?.friendlyName ?? `${code} Airport`,
    city: String(airport?.friendlyLocation ?? code).split(",")[0],
    lat: Number.isFinite(lat) ? lat : 0,
    lon: Number.isFinite(lon) ? lon : 0,
    timeZone: String(airport?.TZ ?? "America/New_York").replace(/^:/, ""),
  };
}

function flightNumberFromPublicIdent(ident) {
  const normalized = String(ident ?? "").toUpperCase();
  const match = normalized.match(/^([A-Z]{3})(\d+[A-Z]?)$/);
  if (match) {
    return `${airlineIataByIcao[match[1]] ?? match[1]} ${match[2]}`;
  }
  const shortMatch = normalized.match(/^([A-Z0-9]{2})(\d+[A-Z]?)$/);
  return shortMatch ? `${shortMatch[1]} ${shortMatch[2]}` : usefulOptionalValue(normalized);
}

function webLookupDates(date) {
  const previousDate = addDays(date, -1).slice(0, 10);
  return previousDate === date ? [date] : [date, previousDate];
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
    boardingGate: usefulAirportValue(gates[0]?.[2]),
    arrivalGate: usefulAirportValue(gates[1]?.[2]),
    terminal: usefulAirportValue(gates[0]?.[1]),
    arrivalTerminal: usefulAirportValue(gates[1]?.[1]),
    status,
    progress: progressFromTimes(status, times.departureTime, times.arrivalTime),
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

  const times = normalizeFlightTimeRange(
    wallTimeToUtcIso(date, departureTimeText, origin.timeZone),
    wallTimeToUtcIso(date, arrivalTimeText, destination.timeZone),
  );
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
    departureTime: times.departureTime,
    arrivalTime: times.arrivalTime,
    boardingGate: usefulAirportValue(gates[0]?.[2]),
    arrivalGate: usefulAirportValue(gates[1]?.[2]),
    terminal: usefulAirportValue(gates[0]?.[1]),
    arrivalTerminal: usefulAirportValue(gates[1]?.[1]),
    status,
    progress: progressFromTimes(status, times.departureTime, times.arrivalTime),
    altitudeFt,
    groundSpeedMph: speedMph,
    aircraftPosition: estimatedPosition(origin, destination, status, times.departureTime, times.arrivalTime, altitudeFt, speedMph),
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
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
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

  return normalizeFlightTimeRange(
    wallTimeToUtcIso(date, departed ?? genericTimes[0] ?? "12:00 PM", originTimeZone),
    wallTimeToUtcIso(date, landed ?? genericTimes[1] ?? genericTimes[0] ?? "12:00 PM", destinationTimeZone),
  );
}

function normalizeFlightTimeRange(departureTime, arrivalTime) {
  const departure = new Date(departureTime);
  const arrival = new Date(arrivalTime);
  if (Number.isFinite(departure.getTime()) && Number.isFinite(arrival.getTime()) && arrival <= departure) {
    arrival.setUTCDate(arrival.getUTCDate() + 1);
  }
  return {
    departureTime: departure.toISOString(),
    arrivalTime: arrival.toISOString(),
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
  console.log(`Text notifications ${smsAppPassword ? "configured" : "not configured"}`);
});
