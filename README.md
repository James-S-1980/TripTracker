# TripTracker

TripTracker is a React flight monitoring app for tracking upcoming and active trips. It accepts airline, flight number, and date, then presents gate, status, departure, arrival, enroute, route map, change alerts, and airport weather information.

Flight data is served through the API in the TripTracker container so provider keys and scraping logic stay off the browser. Weather uses the public Open-Meteo forecast API by airport coordinates.

## Container hosting

Docker Compose builds and starts the app and API together on port 8772:

```powershell
docker compose up -d --build
```

Open `http://localhost:8772/trip/` or `http://<host>:8772/trip/`. The raw tracked flights API is at `/trip/api/tracked-flights`. Use `docker compose logs -f triptracker` to inspect the server and `docker compose down` to stop it.

The existing `data/` directory is mounted into the container at `/app/data`, preserving tracked flights and notification history across rebuilds. The optional, ignored `.env.local` file supplies server settings to the container. It is excluded from the image. For example:

```dotenv
FLIGHTAWARE_AEROAPI_KEY=your-key
TRIPTRACKER_SMTP_USER=your-email@gmail.com
TRIPTRACKER_SMTP_APP_PASSWORD=your-app-password
TRIPTRACKER_SMS_TO=your-email@gmail.com
```

After changing `.env.local`, recreate the container with `docker compose up -d --force-recreate`.

## Live FlightAware data

FlightAware AeroAPI is supported through the container API so the key is not exposed to the browser. Set `FLIGHTAWARE_AEROAPI_KEY` in `.env.local` before starting the container.

Lookup order:

1. FlightAware AeroAPI, when `FLIGHTAWARE_AEROAPI_KEY` is configured.
2. Public web fallback:
   - Google-style flight-card search result when its HTML exposes parseable data.
   - FlightStats public flight page, powered by Cirium, as the concrete parseable fallback for airline flight status pages.

TripTracker no longer falls back to demo data. If neither live source returns parseable flight information, the app shows a lookup error instead of inventing route, gate, or status values.

FlightAware-backed lookups can include live aircraft position and track data. TripTracker also enriches active in-flight results with Airplanes.live ADS-B data by sampling the route corridor and matching the aircraft callsign, which gives the moving map fresher latitude, longitude, heading, altitude, and speed when the flight is visible in ADS-B coverage.

Public web fallback pages usually expose altitude, speed, gates, and times but not exact latitude/longitude. When no FlightAware or ADS-B position is available, TripTracker labels the aircraft map marker as estimated from schedule.

## Email notifications

TripTracker sends email when a flight is first tracked and when tracked flight status, gate, time, tail, or inbound details change. Set `TRIPTRACKER_SMTP_USER`, `TRIPTRACKER_SMTP_APP_PASSWORD`, and `TRIPTRACKER_SMS_TO` in `.env.local`; despite its legacy name, `TRIPTRACKER_SMS_TO` is the email recipient. Do not commit `.env.local`.

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

The airline catalog is generated from OpenFlights airline data plus overrides for common current passenger and cargo carriers. It supports matching by airline name, IATA code, ICAO code, callsign, aliases, and country. The server uses the same generated data to convert IATA codes such as `AC` to provider-friendly ICAO identifiers such as `ACA`; cargo entries include carriers such as UPS Airlines (`5X`/`UPS`) and FedEx Express (`FX`/`FDX`).

```bash
npm run generate:airlines
```

Generated files:

- `src/airlineCatalog.generated.json`
- `src/airlineCatalog.generated.ts`
