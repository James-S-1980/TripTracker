# TripTracker

TripTracker is a React flight monitoring app for tracking upcoming and active trips. It accepts airline, flight number, and date, then presents gate, status, departure, arrival, enroute, route map, change alerts, and airport weather information.

The native iPhone client is in [ios/README.md](ios/README.md). It uses the hosted TripTracker API on port 8087.

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

### Lifecycle and health management

Compose manages two containers for this project:

- `triptracker` is the application container. It runs `node server.js`, publishes port `8772`, and retains runtime data in `./data`.
- `triptracker-recovery` watches only the application container's Docker health status and restarts it when Docker declares it unhealthy.

Both services use `restart: unless-stopped`. Docker therefore restarts an unexpectedly exited service and restores it when Docker Desktop starts again. For recovery after a Windows reboot, enable **Start Docker Desktop when you sign in to your computer** in Docker Desktop settings.

The application health check requests `http://127.0.0.1:8772/healthz` inside the application container every 30 seconds. The endpoint returns success only when the server can answer HTTP, the built web entry point is readable, and the persistent data directory is readable and writable. Docker allows 20 seconds for startup and marks the container unhealthy after three consecutive failures. The same endpoint is available from the host at `http://localhost:8772/healthz`.

Docker restart policies act when a container exits; they do not act on an `unhealthy` status. The small `triptracker-recovery` service fills that gap. It checks health every 15 seconds and uses `docker restart triptracker` after Docker reports `unhealthy`. It permits at most three such restarts in 15 minutes and waits 90 seconds after each attempt. Once that limit is reached, it leaves the container unhealthy and emits a diagnostic message once per minute instead of creating a tight restart loop.

The recovery service mounts `/var/run/docker.sock` because restarting another container requires access to the Docker Engine API. Access to this socket is effectively administrative access to Docker and the host resources Docker controls. The helper is therefore limited to this Compose project, has no network, uses a read-only filesystem, and targets the fixed `triptracker` container name.

### Operations and troubleshooting

Run these commands from the project directory:

```powershell
# Build and start (or update) the project
docker compose up -d --build

# Stop both services without removing their containers
docker compose stop

# Start previously stopped services
docker compose start

# Stop and remove this project's containers and network; persistent data remains
docker compose down

# Restart both services
docker compose restart

# Running state, health, and published ports
docker compose ps

# Current health state
docker inspect triptracker --format '{{.State.Health.Status}}'

# Recent health-check attempts, including the most recent failure output
docker inspect triptracker --format '{{json .State.Health.Log}}'

# Docker restart-policy restart count
docker inspect triptracker --format '{{.RestartCount}}'

# Application and recovery logs
docker compose logs --tail=100 triptracker
docker compose logs --tail=100 recovery
docker compose logs -f
```

The recovery logs contain `is unhealthy; restarting it` and `restart command completed` when the helper intervenes. Application logs remain available through Docker after a restart.

### Recovery tests

Test normal crash recovery with the supplied Compose override. It replaces only the test container's command with one that exits after five seconds. The recovery helper deliberately ignores exited containers, so this path is handled by Docker's restart policy:

```powershell
docker compose -f compose.yaml -f docker/compose.crash-test.yaml up -d --force-recreate triptracker
Start-Sleep -Seconds 15
docker inspect triptracker --format 'status={{.State.Status}} health={{.State.Health.Status}} restarts={{.RestartCount}} started={{.State.StartedAt}}'
docker compose logs --tail=30 triptracker

# Restore the normal application command and wait for healthy status
docker compose up -d --force-recreate triptracker
```

Test unhealthy recovery by creating the health-test sentinel inside the running container. The application remains accessible, but `/healthz` reports the intentional failure. After three failed checks, Docker marks the container unhealthy and the recovery service restarts it. Server startup removes the sentinel, allowing the restarted instance to become healthy. Allow about two minutes for the full transition:

```powershell
docker exec triptracker touch /tmp/triptracker-health-failure-test
Invoke-RestMethod http://localhost:8772/healthz
docker inspect triptracker --format '{{.State.Health.Status}}'
docker compose logs -f recovery
```

In another terminal, watch the state move from `healthy` through `unhealthy` and back to `healthy`:

```powershell
while ($true) {
  docker inspect triptracker --format '{{.State.Status}} {{.State.Health.Status}} {{.State.StartedAt}}'
  Start-Sleep -Seconds 10
}
```

Press `Ctrl+C` after recovery. No temporary application setting needs restoration: server startup removes the test sentinel. Confirm the final state with `docker compose ps` and `Invoke-RestMethod http://localhost:8772/healthz`.

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

## Map data

The route map uses OpenStreetMap's standard raster tiles, which do not require an API key. The weather radar remains a separate RainViewer overlay. OpenStreetMap attribution is displayed on the map, and the app requests tiles only as users navigate the interactive map.

## Email notifications

TripTracker sends email when a flight is first tracked and when tracked flight status, gate, time, tail, or inbound details change. Set `TRIPTRACKER_SMTP_USER`, `TRIPTRACKER_SMTP_APP_PASSWORD`, and `TRIPTRACKER_SMS_TO` in `.env.local`; despite its legacy name, `TRIPTRACKER_SMS_TO` is the email recipient. Do not commit `.env.local`.

## Build

```bash
npm run build
```

The production container uses an Alpine Node runtime and installs only server dependencies. Its startup entrypoint repairs ownership on the host-mounted `./data` directory before dropping privileges to the non-root `node` user. Compose limits the application to 192 MiB of memory and the health-recovery sidecar to 64 MiB.

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
