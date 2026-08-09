# TripTracker

TripTracker is a React flight monitoring app for tracking upcoming and active trips. It accepts airline, flight number, and date, then presents gate, status, departure, arrival, enroute, route map, change alerts, and airport weather information.

The current flight data provider is a deterministic mock shaped behind `src/flightProvider.ts` so a live aviation data API can be added without changing the dashboard UI. Weather uses the public Open-Meteo forecast API by airport coordinates.

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

FlightAware-backed lookups can include live aircraft position and track data. Public web fallback pages usually expose altitude, speed, gates, and times but not exact latitude/longitude, so TripTracker labels those aircraft map markers as estimated from schedule.

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
