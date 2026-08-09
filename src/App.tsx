import { AlertTriangle, Bell, CalendarDays, CloudSun, MapPin, Plane, Radar, RefreshCw, Search, Timer, Trash2 } from "lucide-react";
import L from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { airlineLogoFor, airlineMatches } from "./airlines";
import { lookupFlight } from "./flightProvider";
import { fetchWeather } from "./weather";
import type { FlightLeg, WeatherSnapshot } from "./types";
import "leaflet/dist/leaflet.css";

const storageKey = "triptracker:flights";
const refreshIntervalMs = 30000;

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function formatZonedTime(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(new Date(value));
}

function timeAgo(value: string): string {
  const minutes = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  return minutes === 1 ? "1 min ago" : `${minutes} min ago`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(`${value}T00:00:00`));
}

function formatTimestamp(value: string | null): string {
  if (!value) return "Not refreshed yet";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function durationText(ms: number): string {
  const absoluteMinutes = Math.max(0, Math.round(Math.abs(ms) / 60000));
  const hours = Math.floor(absoluteMinutes / 60);
  const minutes = absoluteMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
}

function statusLead(flight: FlightLeg): string {
  const now = Date.now();
  const departure = new Date(flight.departureTime).getTime();
  const arrival = new Date(flight.arrivalTime).getTime();
  if (flight.status === "Arrived") return `Arrived ${durationText(now - arrival)} ago`;
  if (flight.status === "En Route") return `Arriving in ${durationText(arrival - now)}`;
  if (flight.status === "Boarding") return `Departs in ${durationText(departure - now)}`;
  if (flight.status === "Delayed") return `Delayed departure ${formatTime(flight.departureTime)}`;
  if (flight.status === "Cancelled") return "Flight cancelled";
  return `Departs in ${durationText(departure - now)}`;
}

function usefulAirportValue(value: string | undefined): string {
  const normalized = String(value ?? "").trim();
  return normalized && !/^(?:n\/?a|na|none|null|unknown|tbd|-|--|\?)$/i.test(normalized) ? normalized : "";
}

function gateDisplay(terminal: string, gate: string): string {
  const cleanTerminal = usefulAirportValue(terminal);
  const cleanGate = usefulAirportValue(gate);
  if (cleanTerminal && cleanGate) return `${cleanTerminal} / ${cleanGate}`;
  if (cleanGate) return cleanGate;
  if (cleanTerminal) return `Terminal ${cleanTerminal}`;
  return "Pending";
}

function splitFlightDesignator(value: string): [string, string] {
  const spaced = value.trim().match(/^([A-Z0-9]{2,3})\s+(\d+)$/i);
  if (spaced) return [spaced[1], spaced[2]];
  const compact = value.trim().match(/^([A-Z0-9]{2,3})(\d+)$/i);
  if (compact) return [compact[1], compact[2]];
  return value.split(" ", 2) as [string, string];
}

export function App() {
  const [airline, setAirline] = useState("");
  const [flightNumber, setFlightNumber] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [flights, setFlights] = useState<FlightLeg[]>(() => {
    const saved = window.localStorage.getItem(storageKey);
    return saved ? JSON.parse(saved) as FlightLeg[] : [];
  });
  const [activeId, setActiveId] = useState<string | null>(flights[0]?.id ?? null);
  const [isLoading, setIsLoading] = useState(false);
  const [weather, setWeather] = useState<Record<string, WeatherSnapshot>>({});
  const [airlineFocused, setAirlineFocused] = useState(false);
  const [flightFocused, setFlightFocused] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);

  const activeFlight = flights.find((flight) => flight.id === activeId) ?? flights[0];
  const airlineSuggestions = airlineMatches(airline).slice(0, 6);
  const flightSuggestions = useMemo(() => {
    const recent = flights.map((flight) => flight.flightNumber.split(" ")[1]);
    return Array.from(new Set([...recent, "401", "982", "1175", "2027", "3301"]))
      .filter((value) => value.startsWith(flightNumber))
      .slice(0, 5);
  }, [flightNumber, flights]);
  const timeline = useMemo(() => {
    if (!activeFlight) return [];
    const routeItem = {
      id: `${activeFlight.id}-route`,
      priority: "normal" as const,
      title: "Route monitored",
      message: `${activeFlight.origin.code} to ${activeFlight.destination.code} is being watched for departure, gate, and arrival changes. Source: ${activeFlight.dataSource}.`,
      timestamp: activeFlight.lastUpdated,
    };
    return [...activeFlight.alerts, routeItem]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [activeFlight]);

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(flights));
  }, [flights]);

  useEffect(() => {
    if (flights.length === 0) return;
    const intervalId = window.setInterval(() => {
      void refreshTrackedFlights(true);
    }, refreshIntervalMs);
    return () => window.clearInterval(intervalId);
  }, [flights]);

  useEffect(() => {
    if (!activeFlight) return;
    [activeFlight.origin, activeFlight.destination].forEach((airport) => {
      if (weather[airport.code]) return;
      fetchWeather(airport)
        .then((snapshot) => setWeather((current) => ({ ...current, [airport.code]: snapshot })))
        .catch(() => {
          setWeather((current) => ({
            ...current,
            [airport.code]: {
              airportCode: airport.code,
              temperatureF: 0,
              windMph: 0,
              precipitationChance: 0,
              condition: "Unavailable",
            },
          }));
        });
    });
  }, [activeFlight, weather]);

  async function addFlight(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setLookupError(null);
    try {
      const flight = await lookupFlight(airline.trim(), flightNumber.trim(), date);
      setFlights((current) => [flight, ...current.filter((item) => item.id !== flight.id)]);
      setActiveId(flight.id);
      setLastRefreshAt(new Date().toISOString());
    } catch (error) {
      setLookupError(error instanceof Error ? error.message : "No live flight data found.");
    } finally {
      setIsLoading(false);
    }
  }

  async function refreshActiveFlight() {
    if (!activeFlight) return;
    setIsLoading(true);
    setLookupError(null);
    try {
      await refreshTrackedFlights(false, activeFlight.id);
    } catch (error) {
      setLookupError(error instanceof Error ? error.message : "No live flight data found.");
    } finally {
      setIsLoading(false);
    }
  }

  async function refreshTrackedFlights(silent: boolean, focusedFlightId?: string) {
    const flightsToRefresh = focusedFlightId
      ? flights.filter((flight) => flight.id === focusedFlightId)
      : flights;
    if (flightsToRefresh.length === 0) return;

    const refreshed = await Promise.allSettled(flightsToRefresh.map((flight) => {
      const [code, number] = splitFlightDesignator(flight.flightNumber);
      return lookupFlight(code, number, flight.date);
    }));
    const refreshMap = new Map<string, FlightLeg>();
    const failures: string[] = [];

    refreshed.forEach((result, index) => {
      const original = flightsToRefresh[index];
      if (result.status === "fulfilled") {
        refreshMap.set(original.id, result.value);
      } else {
        failures.push(original.flightNumber);
      }
    });

    if (refreshMap.size > 0) {
      setFlights((current) => current.map((flight) => refreshMap.get(flight.id) ?? flight));
      if (activeFlight && refreshMap.has(activeFlight.id)) {
        setActiveId(refreshMap.get(activeFlight.id)!.id);
      }
      setLastRefreshAt(new Date().toISOString());
    }

    if (failures.length > 0 && !silent) {
      throw new Error(`Refresh failed for ${failures.join(", ")}.`);
    }
  }

  function deleteFlight(flightId: string) {
    setFlights((current) => {
      const next = current.filter((flight) => flight.id !== flightId);
      if (flightId === activeFlight?.id) {
        setActiveId(next[0]?.id ?? null);
      }
      return next;
    });
  }

  return (
    <main className="app-shell">
      <section className="topbar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            <Plane size={26} />
          </div>
          <div>
            <p className="eyebrow">Live flight intelligence</p>
            <h1>TripTracker</h1>
          </div>
        </div>
        <div className="freshness">
          <Radar size={18} />
          <span>
            Auto-refresh every 30 seconds
            <small>Last refresh: {formatTimestamp(lastRefreshAt)}</small>
          </span>
        </div>
      </section>

      <section className={`tracker-grid ${activeFlight ? "has-active-flight" : ""}`}>
        <aside className="sidebar">
          <form className="lookup-panel" onSubmit={addFlight}>
            <div className="panel-title">
              <Search size={18} />
              <h2>Track a Flight</h2>
            </div>
            <label>
              Airline
              <div className="smart-field">
                <input
                  value={airline}
                  onBlur={() => window.setTimeout(() => setAirlineFocused(false), 120)}
                  onChange={(event) => setAirline(event.target.value)}
                  onFocus={() => setAirlineFocused(true)}
                  placeholder="Enter Airline"
                />
                {airlineFocused && airlineSuggestions.length > 0 && (
                  <div className="suggestions">
                    {airlineSuggestions.map((match) => (
                      <button type="button" key={match.code} onClick={() => setAirline(match.name)}>
                        <AirlineLogo code={match.code} logoUrl={match.logoUrl} size="small" />
                        <strong>{match.code}</strong>
                        <span>{match.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </label>
            <label>
              Flight number
              <div className="smart-field">
                <input
                  value={flightNumber}
                  onBlur={() => window.setTimeout(() => setFlightFocused(false), 120)}
                  onChange={(event) => setFlightNumber(event.target.value.replace(/\D/g, ""))}
                  onFocus={() => setFlightFocused(true)}
                  inputMode="numeric"
                  placeholder="Enter flight number"
                />
                {flightFocused && flightSuggestions.length > 0 && (
                  <div className="suggestions compact">
                    {flightSuggestions.map((match) => (
                      <button type="button" key={match} onClick={() => setFlightNumber(match)}>
                        <strong>{match}</strong>
                        <span>Suggested flight</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </label>
            <label>
              Date
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </label>
            <button type="submit" disabled={isLoading}>
              <Search size={17} />
              {isLoading ? "Checking" : "Track flight"}
            </button>
            {lookupError && <p className="lookup-error">{lookupError}</p>}
          </form>

          <div className="section-heading">
            <Bell size={18} />
            <h2>Flight Timeline</h2>
          </div>
          <div className="timeline">
            {!activeFlight ? (
              <p className="empty">Track a flight to start a focused operational timeline.</p>
            ) : timeline.map((item, index) => (
              <article className={`timeline-item ${item.priority}`} key={item.id}>
                <div className="timeline-marker">{index + 1}</div>
                <div>
                  <div className="timeline-meta">
                    <span>{item.priority}</span>
                    <small>{timeAgo(item.timestamp)}</small>
                  </div>
                  <strong>{item.title}</strong>
                  <p>{item.message}</p>
                </div>
              </article>
            ))}
          </div>

          <div className="section-heading monitored-heading">
            <Plane size={18} />
            <h2>Tracked Flights</h2>
          </div>
          <div className="tracked-list">
            {flights.map((flight) => (
              <div className={`tracked-flight ${flight.id === activeFlight?.id ? "active" : ""}`} key={flight.id}>
                <button onClick={() => setActiveId(flight.id)} type="button">
                  <AirlineLogo code={flight.airlineCode ?? splitFlightDesignator(flight.flightNumber)[0]} logoUrl={flight.airlineLogoUrl} size="small" />
                  <span className="tracked-copy">
                    <strong>{flight.flightNumber}</strong>
                    <span>{flight.origin.code} to {flight.destination.code}</span>
                    <em>Source: {flight.dataSource}</em>
                  </span>
                </button>
                <button
                  aria-label={`Delete ${flight.flightNumber}`}
                  className="delete-flight"
                  onClick={(event) => {
                    event.stopPropagation();
                    deleteFlight(flight.id);
                  }}
                  type="button"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </aside>

        <section className="dashboard">
          {activeFlight ? (
            <>
              <section className="live-flight-panel">
                <FlightMap flight={activeFlight} />
                <article className="flight-card">
                  <div className="flight-card-top">
                    <div className="airline-title">
                      <AirlineLogo
                        code={activeFlight.airlineCode ?? splitFlightDesignator(activeFlight.flightNumber)[0]}
                        logoUrl={activeFlight.airlineLogoUrl}
                      />
                      <div>
                        <p>{activeFlight.airline}</p>
                        <h2>{activeFlight.flightNumber}</h2>
                        <span>{formatDate(activeFlight.date)} / {activeFlight.origin.code} to {activeFlight.destination.code}</span>
                      </div>
                    </div>
                    <button className="icon-button" onClick={refreshActiveFlight} disabled={isLoading} aria-label="Refresh flight">
                      <RefreshCw size={18} />
                    </button>
                  </div>

                  <div className={`status-banner ${activeFlight.status.toLowerCase().replace(/\s+/g, "-")}`}>
                    <strong>{statusLead(activeFlight)}</strong>
                    <span>{activeFlight.status}</span>
                  </div>

                  <div className="route-times">
                    <div className="airport-stop">
                      <small>{activeFlight.origin.code} / {activeFlight.origin.name}</small>
                      <strong>{formatZonedTime(activeFlight.departureTime, activeFlight.origin.timeZone ?? "America/New_York")}</strong>
                      <span>Your time: {formatZonedTime(activeFlight.departureTime, "America/New_York")}</span>
                      <em>{activeFlight.origin.city}</em>
                    </div>

                    <div className="route-progress">
                      <span>{activeFlight.progress}%</span>
                      <div><i style={{ width: `${activeFlight.progress}%` }} /></div>
                    </div>

                    <div className="airport-stop">
                      <small>{activeFlight.destination.code} / {activeFlight.destination.name}</small>
                      <strong>{formatZonedTime(activeFlight.arrivalTime, activeFlight.destination.timeZone ?? "America/New_York")}</strong>
                      <span>Your time: {formatZonedTime(activeFlight.arrivalTime, "America/New_York")}</span>
                      <em>{activeFlight.destination.city}</em>
                    </div>
                  </div>

                  <div className="gate-row">
                    <div>
                      <small>Boarding</small>
                      <strong>{gateDisplay(activeFlight.terminal, activeFlight.boardingGate)}</strong>
                    </div>
                    <div>
                      <small>Arrival</small>
                      <strong>{gateDisplay(activeFlight.arrivalTerminal, activeFlight.arrivalGate)}</strong>
                    </div>
                  </div>

                  <div className="compact-facts">
                    <span><Timer size={15} /> {activeFlight.groundSpeedMph ? `${activeFlight.groundSpeedMph} mph` : "Speed pending"}</span>
                    <span><Plane size={15} /> {activeFlight.altitudeFt ? `${activeFlight.altitudeFt.toLocaleString()} ft` : "Ground"}</span>
                    <span><MapPin size={15} /> Updated {timeAgo(activeFlight.lastUpdated)}</span>
                  </div>

                  <p className="source-line">
                    Source: {activeFlight.dataSource}
                    {activeFlight.sourceUrl && <a href={activeFlight.sourceUrl} target="_blank" rel="noreferrer"> Open source</a>}
                  </p>
                </article>
              </section>

              <div className="detail-grid">
                <WeatherCard title="Origin weather" code={activeFlight.origin.code} weather={weather[activeFlight.origin.code]} />
                <WeatherCard title="Destination weather" code={activeFlight.destination.code} weather={weather[activeFlight.destination.code]} />
                <div className="ops-panel">
                  <div className="section-heading">
                    <AlertTriangle size={18} />
                    <h2>En Route</h2>
                  </div>
                  <dl>
                    <div><dt>Progress</dt><dd>{activeFlight.progress}%</dd></div>
                    <div><dt>Altitude</dt><dd>{activeFlight.altitudeFt ? `${activeFlight.altitudeFt.toLocaleString()} ft` : "Ground"}</dd></div>
                    <div><dt>Speed</dt><dd>{activeFlight.groundSpeedMph ? `${activeFlight.groundSpeedMph} mph` : "Pending"}</dd></div>
                    <div><dt>Updated</dt><dd>{timeAgo(activeFlight.lastUpdated)}</dd></div>
                  </dl>
                </div>
              </div>
            </>
          ) : (
            <div className="empty-state">
              <Plane size={42} />
              <h2>Add a flight to monitor</h2>
              <p>Enter airline, flight number, and date to create a tracked trip with gate, weather, route, and status monitoring.</p>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

function AirlineLogo({ code, logoUrl, size = "default" }: { code: string; logoUrl?: string; size?: "default" | "small" }) {
  const [failedUrls, setFailedUrls] = useState<string[]>([]);
  const fallbackLogo = airlineLogoFor(code);
  const logoCandidates = [logoUrl, fallbackLogo]
    .filter((value): value is string => Boolean(value))
    .filter((value, index, list) => list.indexOf(value) === index)
    .filter((value) => !failedUrls.includes(value));
  const resolvedLogo = logoCandidates[0];

  return (
    <span className={`airline-logo ${size}`}>
      {resolvedLogo ? (
        <img alt={`${code} logo`} src={resolvedLogo} onError={() => setFailedUrls((current) => [...current, resolvedLogo])} />
      ) : (
        <strong>{code.slice(0, 2).toUpperCase()}</strong>
      )}
    </span>
  );
}

function Metric({ icon, label, value, source, tone = "neutral" }: { icon: React.ReactNode; label: string; value: string; source?: string; tone?: "neutral" | "good" | "warn" | "danger" }) {
  return (
    <div className={`metric ${tone}`}>
      <span>{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        {source && <em>{source}</em>}
      </div>
    </div>
  );
}

function TimeMetric({ icon, label, value, subValue, source }: { icon: React.ReactNode; label: string; value: string; subValue: string; source: string }) {
  return (
    <div className="metric time-metric">
      <span>{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <em>{subValue}</em>
        <em>{source}</em>
      </div>
    </div>
  );
}

function WeatherCard({ title, code, weather }: { title: string; code: string; weather?: WeatherSnapshot }) {
  return (
    <article className="weather-card">
      <div className="section-heading">
        <CloudSun size={18} />
        <h2>{title}</h2>
      </div>
      <strong>{code}</strong>
      {weather ? (
        <dl>
          <div><dt>Temp</dt><dd>{weather.condition === "Unavailable" ? "Unavailable" : `${weather.temperatureF} F`}</dd></div>
          <div><dt>Wind</dt><dd>{weather.condition === "Unavailable" ? "Unavailable" : `${weather.windMph} mph`}</dd></div>
          <div><dt>Precip</dt><dd>{weather.condition === "Unavailable" ? "Unavailable" : `${weather.precipitationChance}%`}</dd></div>
          <div><dt>Sky</dt><dd>{weather.condition}</dd></div>
        </dl>
      ) : <p className="empty">Loading weather...</p>}
      <p className="source-line">Source: Open-Meteo</p>
    </article>
  );
}

function FlightMap({ flight }: { flight: FlightLeg }) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const leafletMapRef = useRef<L.Map | null>(null);
  const routePoints = useMemo(() => {
    if (flight.track && flight.track.length > 1) {
      return flight.track.map((point) => [point.lat, point.lon] as L.LatLngTuple);
    }
    return greatCirclePoints(
      [flight.origin.lat, flight.origin.lon],
      [flight.destination.lat, flight.destination.lon],
      72,
    );
  }, [flight]);

  useEffect(() => {
    if (!mapRef.current) return;
    if (!leafletMapRef.current) {
      leafletMapRef.current = L.map(mapRef.current, {
        attributionControl: true,
        scrollWheelZoom: false,
      });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 10,
      }).addTo(leafletMapRef.current);
    }

    const map = leafletMapRef.current;
    map.eachLayer((layer) => {
      if (!(layer instanceof L.TileLayer)) {
        layer.remove();
      }
    });

    const originPoint: L.LatLngTuple = [flight.origin.lat, flight.origin.lon];
    const destinationPoint: L.LatLngTuple = [flight.destination.lat, flight.destination.lon];
    const aircraft = flight.aircraftPosition;
    const aircraftPoint: L.LatLngTuple | undefined = aircraft ? [aircraft.lat, aircraft.lon] : undefined;

    L.polyline(routePoints, { color: "#0f766e", opacity: 0.82, weight: 4 }).addTo(map);
    L.circleMarker(originPoint, { color: "#0f766e", fillColor: "#0f766e", fillOpacity: 1, radius: 7 })
      .bindPopup(`${flight.origin.code} ${flight.origin.city}`)
      .addTo(map);
    L.circleMarker(destinationPoint, { color: "#d97706", fillColor: "#d97706", fillOpacity: 1, radius: 7 })
      .bindPopup(`${flight.destination.code} ${flight.destination.city}`)
      .addTo(map);

    if (aircraftPoint) {
      const live = aircraft?.source !== "Estimated from schedule";
      const heading = Number.isFinite(aircraft?.headingDeg) ? ` style="transform: rotate(${aircraft?.headingDeg}deg)"` : "";
      L.marker(aircraftPoint, {
        icon: L.divIcon({
          className: "aircraft-map-marker",
          html: `<span class="${live ? "live" : "estimated"}"${heading}>&#9992;</span>`,
          iconAnchor: [16, 16],
          iconSize: [32, 32],
        }),
      })
        .bindPopup([
          flight.flightNumber,
          aircraft?.callsign ? `Callsign ${aircraft.callsign}` : undefined,
          aircraft?.source,
          `${aircraft?.altitudeFt.toLocaleString()} ft`,
        ].filter(Boolean).join("<br>"))
        .addTo(map);
    }

    const bounds = L.latLngBounds([originPoint, destinationPoint, ...(aircraftPoint ? [aircraftPoint] : [])]);
    map.fitBounds(bounds.pad(0.24), { animate: false });
    window.setTimeout(() => map.invalidateSize(), 0);
  }, [flight, routePoints]);

  return (
    <section className="map-panel" aria-label="Flight route map">
      <div className="map-toolbar">
        <div>
          <small>Route map</small>
          <strong>{flight.origin.code} to {flight.destination.code}</strong>
        </div>
        <span className="source-chip">{flight.dataSource}</span>
      </div>
      <div className="route-map" ref={mapRef} />
      <div className="map-telemetry">
        <strong>{flight.aircraftPosition?.source ?? "No aircraft position available"}</strong>
        {flight.aircraftPosition?.callsign && <span>Callsign: {flight.aircraftPosition.callsign}</span>}
        <span>Altitude: {flight.altitudeFt ? `${flight.altitudeFt.toLocaleString()} ft` : "Unavailable"}</span>
        {typeof flight.aircraftPosition?.crossTrackMiles === "number" && <span>Route offset: {flight.aircraftPosition.crossTrackMiles} mi</span>}
        {flight.aircraftPosition?.timestamp && <span>Position time: {timeAgo(flight.aircraftPosition.timestamp)}</span>}
      </div>
      <p className="source-line">Route, status, and progress source: {flight.dataSource}</p>
    </section>
  );
}

function greatCirclePoints(start: [number, number], end: [number, number], segments: number): L.LatLngTuple[] {
  return Array.from({ length: segments + 1 }, (_, index) => {
    const fraction = index / segments;
    const point = interpolateGreatCircle(start[0], start[1], end[0], end[1], fraction);
    return [point.lat, point.lon];
  });
}

function interpolateGreatCircle(latA: number, lonA: number, latB: number, lonB: number, fraction: number) {
  const lat1 = toRadians(latA);
  const lon1 = toRadians(lonA);
  const lat2 = toRadians(latB);
  const lon2 = toRadians(lonB);
  const delta = 2 * Math.asin(Math.sqrt(
    Math.sin((lat2 - lat1) / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2,
  ));
  if (delta === 0) return { lat: latA, lon: lonA };
  const a = Math.sin((1 - fraction) * delta) / Math.sin(delta);
  const b = Math.sin(fraction * delta) / Math.sin(delta);
  const x = a * Math.cos(lat1) * Math.cos(lon1) + b * Math.cos(lat2) * Math.cos(lon2);
  const y = a * Math.cos(lat1) * Math.sin(lon1) + b * Math.cos(lat2) * Math.sin(lon2);
  const z = a * Math.sin(lat1) + b * Math.sin(lat2);
  return { lat: toDegrees(Math.atan2(z, Math.sqrt(x ** 2 + y ** 2))), lon: toDegrees(Math.atan2(y, x)) };
}

function toRadians(value: number) {
  return value * Math.PI / 180;
}

function toDegrees(value: number) {
  return value * 180 / Math.PI;
}
