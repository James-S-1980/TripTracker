import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT ?? 8787;
const flightAwareBaseUrl = "https://aeroapi.flightaware.com/aeroapi";

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

const airportCatalog = {
  ATL: { code: "ATL", name: "Hartsfield-Jackson Atlanta International", city: "Atlanta", lat: 33.6407, lon: -84.4277, timeZone: "America/New_York" },
  BOS: { code: "BOS", name: "Boston Logan International", city: "Boston", lat: 42.3656, lon: -71.0096, timeZone: "America/New_York" },
  CLT: { code: "CLT", name: "Charlotte Douglas International", city: "Charlotte", lat: 35.214, lon: -80.9431, timeZone: "America/New_York" },
  DCA: { code: "DCA", name: "Ronald Reagan Washington National", city: "Washington", lat: 38.8512, lon: -77.0402, timeZone: "America/New_York" },
  DEN: { code: "DEN", name: "Denver International", city: "Denver", lat: 39.8561, lon: -104.6737, timeZone: "America/Denver" },
  DFW: { code: "DFW", name: "Dallas Fort Worth International", city: "Dallas-Fort Worth", lat: 32.8998, lon: -97.0403, timeZone: "America/Chicago" },
  EWR: { code: "EWR", name: "Newark Liberty International", city: "Newark", lat: 40.6895, lon: -74.1745, timeZone: "America/New_York" },
  IAD: { code: "IAD", name: "Washington Dulles International", city: "Washington", lat: 38.9531, lon: -77.4565, timeZone: "America/New_York" },
  JFK: { code: "JFK", name: "John F. Kennedy International", city: "New York", lat: 40.6413, lon: -73.7781, timeZone: "America/New_York" },
  LAS: { code: "LAS", name: "Harry Reid International", city: "Las Vegas", lat: 36.084, lon: -115.1537, timeZone: "America/Los_Angeles" },
  LAX: { code: "LAX", name: "Los Angeles International", city: "Los Angeles", lat: 33.9416, lon: -118.4085, timeZone: "America/Los_Angeles" },
  MIA: { code: "MIA", name: "Miami International", city: "Miami", lat: 25.7959, lon: -80.287, timeZone: "America/New_York" },
  ORD: { code: "ORD", name: "Chicago O'Hare International", city: "Chicago", lat: 41.9742, lon: -87.9073, timeZone: "America/Chicago" },
  PHX: { code: "PHX", name: "Phoenix Sky Harbor International", city: "Phoenix", lat: 33.4352, lon: -112.0101, timeZone: "America/Phoenix" },
  SEA: { code: "SEA", name: "Seattle-Tacoma International", city: "Seattle", lat: 47.4502, lon: -122.3088, timeZone: "America/Los_Angeles" },
  SFO: { code: "SFO", name: "San Francisco International", city: "San Francisco", lat: 37.6213, lon: -122.379, timeZone: "America/Los_Angeles" },
};

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

  return {
    id: flight.fa_flight_id,
    airline: flight.operator ?? flight.operator_iata ?? "FlightAware",
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

function chooseFlight(flights, requestedDate) {
  const target = requestedDate.slice(0, 10);
  return flights.find((flight) => (
    (flight.scheduled_out ?? flight.scheduled_off ?? "").startsWith(target)
  )) ?? flights[0];
}

app.get("/api/flights/lookup", async (request, response) => {
  const apiKey = process.env.FLIGHTAWARE_AEROAPI_KEY;
  if (!apiKey) {
    response.status(503).json({ error: "FLIGHTAWARE_AEROAPI_KEY is not configured." });
    return;
  }

  const airline = String(request.query.airline ?? "").toUpperCase();
  const flightNumber = String(request.query.flightNumber ?? "").replace(/\D/g, "");
  const date = String(request.query.date ?? new Date().toISOString().slice(0, 10));
  const ident = `${airlineIcaoByIata[airline] ?? airline}${flightNumber}`;
  const params = new URLSearchParams({
    ident_type: "designator",
    start: addDays(date, -1),
    end: addDays(date, 2),
    max_pages: "1",
  });

  try {
    const flightAwareResponse = await fetch(`${flightAwareBaseUrl}/flights/${encodeURIComponent(ident)}?${params.toString()}`, {
      headers: { "x-apikey": apiKey },
    });

    if (!flightAwareResponse.ok) {
      const detail = await flightAwareResponse.text();
      response.status(flightAwareResponse.status).json({ error: "FlightAware lookup failed.", detail });
      return;
    }

    const payload = await flightAwareResponse.json();
    const flight = chooseFlight(payload.flights ?? [], date);
    if (!flight) {
      response.status(404).json({ error: `No FlightAware match found for ${ident} on ${date}.` });
      return;
    }

    response.json(mapFlightAwareFlight(flight, date));
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : "FlightAware request failed." });
  }
});

app.use(express.static(path.join(__dirname, "dist")));
app.use((_request, response) => {
  response.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.listen(port, () => {
  console.log(`TripTracker server listening on http://127.0.0.1:${port}`);
});
