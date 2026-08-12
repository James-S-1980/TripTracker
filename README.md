# TripTracker

TripTracker is a React flight monitoring app for tracking upcoming and active trips. It accepts airline, flight number, and date, then presents gate, status, departure, arrival, enroute, route map, change alerts, and airport weather information.

Flight data is served through the local API proxy so provider keys and scraping logic stay off the browser. Weather uses the public Open-Meteo forecast API by airport coordinates.

## Run locally

```bash
npm install
npm run dev
```

`npm run dev` starts both the TripTracker API server and the Vite web app. The flight lookup UI depends on the API server being available.

## Live FlightAware data

FlightAware AeroAPI is supported through the local server proxy so the API key is not exposed to the browser.

```bash
$env:FLIGHTAWARE_AEROAPI_KEY="your-key"
npm run build
npm start
```

Open `http://127.0.0.1:8787`.

Lookup order:

1. FlightAware AeroAPI, when `FLIGHTAWARE_AEROAPI_KEY` is configured.
2. Public web fallback:
   - Google-style flight-card search result when its HTML exposes parseable data.
   - FlightStats public flight page, powered by Cirium, as the concrete parseable fallback for airline flight status pages.

TripTracker no longer falls back to demo data. If neither live source returns parseable flight information, the app shows a lookup error instead of inventing route, gate, or status values.

FlightAware-backed lookups can include live aircraft position and track data. TripTracker also enriches active in-flight results with Airplanes.live ADS-B data by sampling the route corridor and matching the aircraft callsign, which gives the moving map fresher latitude, longitude, heading, altitude, and speed when the flight is visible in ADS-B coverage.

Public web fallback pages usually expose altitude, speed, gates, and times but not exact latitude/longitude. When no FlightAware or ADS-B position is available, TripTracker labels the aircraft map marker as estimated from schedule.

## Text notifications

TripTracker can send email-to-text notifications when a flight is first tracked and when tracked flight status, gate, time, tail, or inbound details change. SMTP credentials are read only from server environment variables and should not be committed.

```bash
$env:TRIPTRACKER_SMTP_USER="James.schliesske@gmail.com"
$env:TRIPTRACKER_SMTP_APP_PASSWORD="your-gmail-app-password"
$env:TRIPTRACKER_SMS_TO="4438762640@tmomail.net"
npm run build
npm start
```

On the local hosted Windows server, use `.\start-triptracker-local.ps1` so the process reads the saved user-level environment variables before starting.

## Build

```bash
npm run build
```

## Airport catalog

The airport catalog is generated from current OurAirports data and includes airports with IATA codes plus derived IANA time zones.

```bash
npm run generate:airports
```

Generated files:

- `src/airportCatalog.generated.json`
- `src/airportCatalog.generated.ts`

## Airline catalog

The airline catalog is generated from OpenFlights airline data plus overrides for common current carriers. It supports matching by airline name, IATA code, ICAO code, callsign, aliases, and country. The server uses the same generated data to convert IATA codes such as `AC` to provider-friendly ICAO identifiers such as `ACA`.

```bash
npm run generate:airlines
```

Generated files:

- `src/airlineCatalog.generated.json`
- `src/airlineCatalog.generated.ts`
