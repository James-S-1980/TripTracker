# TripTracker

TripTracker is a React flight monitoring app for tracking upcoming and active trips. It accepts airline, flight number, and date, then presents gate, status, departure, arrival, enroute, route map, change alerts, and airport weather information.

The current flight data provider is a deterministic mock shaped behind `src/flightProvider.ts` so a live aviation data API can be added without changing the dashboard UI. Weather uses the public Open-Meteo forecast API by airport coordinates.

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```
