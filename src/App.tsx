import { AlertTriangle, Bell, CalendarDays, CloudSun, MapPin, Plane, Radar, RefreshCw, Search, Timer, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { airlineMatches } from "./airlines";
import { lookupFlight } from "./flightProvider";
import { fetchWeather } from "./weather";
import type { FlightLeg, WeatherSnapshot } from "./types";

const storageKey = "triptracker:flights";

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

function splitFlightDesignator(value: string): [string, string] {
  const spaced = value.trim().match(/^([A-Z0-9]{2,3})\s+(\d+)$/i);
  if (spaced) return [spaced[1], spaced[2]];
  const compact = value.trim().match(/^([A-Z0-9]{2,3})(\d+)$/i);
  if (compact) return [compact[1], compact[2]];
  return value.split(" ", 2) as [string, string];
}

export function App() {
  const [airline, setAirline] = useState("");
  const [flightNumber, setFlightNumber] = useState("401");
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
      message: `${activeFlight.origin.code} to ${activeFlight.destination.code} is being watched for departure, gate, and arrival changes.`,
      timestamp: activeFlight.lastUpdated,
    };
    return [...activeFlight.alerts, routeItem]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [activeFlight]);

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(flights));
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
    const flight = await lookupFlight(airline.trim(), flightNumber.trim(), date);
    setFlights((current) => [flight, ...current.filter((item) => item.id !== flight.id)]);
    setActiveId(flight.id);
    setIsLoading(false);
  }

  async function refreshActiveFlight() {
    if (!activeFlight) return;
    const [code, number] = splitFlightDesignator(activeFlight.flightNumber);
    setIsLoading(true);
    const flight = await lookupFlight(code, number, activeFlight.date);
    setFlights((current) => current.map((item) => item.id === flight.id ? flight : item));
    setActiveId(flight.id);
    setIsLoading(false);
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
        <div>
          <p className="eyebrow">TripTracker</p>
          <h1>Flight command center</h1>
        </div>
        <div className="freshness">
          <Radar size={18} />
          <span>Prioritizing gate and status changes</span>
        </div>
      </section>

      <section className="tracker-grid">
        <aside className="sidebar">
          <form className="lookup-panel" onSubmit={addFlight}>
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
                  placeholder="401"
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
                  <strong>{flight.flightNumber}</strong>
                  <span>{flight.origin.code} to {flight.destination.code}</span>
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
              <div className="flight-header">
                <div>
                  <p>{activeFlight.airline}</p>
                  <h2>{activeFlight.flightNumber}</h2>
                </div>
                <button className="icon-button" onClick={refreshActiveFlight} disabled={isLoading} aria-label="Refresh flight">
                  <RefreshCw size={18} />
                </button>
              </div>

              <section className="flight-brief">
                <div>
                  <small>Status</small>
                  <strong>{activeFlight.status}</strong>
                </div>
                <div>
                  <small>Route</small>
                  <strong>{activeFlight.origin.code} to {activeFlight.destination.code}</strong>
                  <span>{activeFlight.origin.city} to {activeFlight.destination.city}</span>
                </div>
                <div>
                  <small>Boarding gate</small>
                  <strong>T{activeFlight.terminal} / {activeFlight.boardingGate}</strong>
                </div>
                <div>
                  <small>Arrival gate</small>
                  <strong>T{activeFlight.arrivalTerminal} / {activeFlight.arrivalGate}</strong>
                </div>
                <div className="provider-note">
                  <small>Data source</small>
                  <strong>{activeFlight.dataSource ?? "Simulated demo provider"}</strong>
                </div>
              </section>

              <div className="summary-strip">
                <Metric icon={<Plane />} label="Status" value={activeFlight.status} tone={activeFlight.status === "Delayed" ? "danger" : "good"} />
                <Metric icon={<MapPin />} label="Boarding" value={`T${activeFlight.terminal} ${activeFlight.boardingGate}`} tone="warn" />
                <TimeMetric
                  icon={<Timer />}
                  label={`Depart ${activeFlight.origin.code}`}
                  value={formatZonedTime(activeFlight.departureTime, activeFlight.origin.timeZone ?? "America/New_York")}
                  subValue={`Your time: ${formatZonedTime(activeFlight.departureTime, "America/New_York")}`}
                />
                <TimeMetric
                  icon={<CalendarDays />}
                  label={`Arrive ${activeFlight.destination.code}`}
                  value={formatZonedTime(activeFlight.arrivalTime, activeFlight.destination.timeZone ?? "America/New_York")}
                  subValue={`${formatDate(activeFlight.date)} / Your time: ${formatZonedTime(activeFlight.arrivalTime, "America/New_York")}`}
                />
              </div>

              <FlightMap flight={activeFlight} />

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

function Metric({ icon, label, value, tone = "neutral" }: { icon: React.ReactNode; label: string; value: string; tone?: "neutral" | "good" | "warn" | "danger" }) {
  return (
    <div className={`metric ${tone}`}>
      <span>{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function TimeMetric({ icon, label, value, subValue }: { icon: React.ReactNode; label: string; value: string; subValue: string }) {
  return (
    <div className="metric time-metric">
      <span>{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <em>{subValue}</em>
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
    </article>
  );
}

function FlightMap({ flight }: { flight: FlightLeg }) {
  const padding = 95;
  const minLon = Math.min(flight.origin.lon, flight.destination.lon) - 8;
  const maxLon = Math.max(flight.origin.lon, flight.destination.lon) + 8;
  const minLat = Math.min(flight.origin.lat, flight.destination.lat) - 5;
  const maxLat = Math.max(flight.origin.lat, flight.destination.lat) + 5;
  const project = (lon: number, lat: number) => ({
    x: padding + ((lon - minLon) / (maxLon - minLon)) * (900 - padding * 2),
    y: 285 - ((lat - minLat) / (maxLat - minLat)) * 240,
  });
  const origin = project(flight.origin.lon, flight.origin.lat);
  const destination = project(flight.destination.lon, flight.destination.lat);
  const controlX = (origin.x + destination.x) / 2;
  const controlY = Math.min(origin.y, destination.y) - 90;
  const progress = flight.progress / 100;
  const planeX = (1 - progress) ** 2 * origin.x + 2 * (1 - progress) * progress * controlX + progress ** 2 * destination.x;
  const planeY = (1 - progress) ** 2 * origin.y + 2 * (1 - progress) * progress * controlY + progress ** 2 * destination.y;

  return (
    <section className="map-panel" aria-label="Flight route map">
      <svg viewBox="0 0 900 330" role="img">
        <defs>
          <linearGradient id="routeGradient" x1="0%" x2="100%">
            <stop offset="0%" stopColor="#0f766e" />
            <stop offset="100%" stopColor="#d97706" />
          </linearGradient>
        </defs>
        <rect width="900" height="330" rx="8" />
        <g className="basemap">
          <path d="M45 96 C130 25 280 30 360 88 C420 132 500 91 570 113 C675 145 740 108 850 151 L852 322 L44 322 Z" />
          <path d="M192 45 C248 56 276 82 256 119 C235 156 174 155 136 126 C102 99 120 52 192 45 Z" />
          <path d="M545 36 C616 38 670 61 692 109 C715 158 670 207 598 205 C525 203 472 166 479 105 C484 59 504 36 545 36 Z" />
          <path d="M298 190 C352 162 427 170 452 215 C476 258 423 300 345 292 C279 286 246 225 298 190 Z" />
          <path d="M622 218 C678 196 759 206 802 255 C827 284 798 310 718 309 C648 308 595 275 622 218 Z" />
        </g>
        <g className="map-lines">
          <path d="M120 70 H790 M120 135 H790 M120 200 H790 M120 265 H790" />
          <path d="M165 42 V288 M300 42 V288 M435 42 V288 M570 42 V288 M705 42 V288" />
        </g>
        <path className="route-shadow" d={`M${origin.x} ${origin.y} Q${controlX} ${controlY} ${destination.x} ${destination.y}`} />
        <path className="route" d={`M${origin.x} ${origin.y} Q${controlX} ${controlY} ${destination.x} ${destination.y}`} />
        <circle className="airport-dot" cx={origin.x} cy={origin.y} r="9" />
        <circle className="airport-dot destination" cx={destination.x} cy={destination.y} r="9" />
        <g className="plane-marker" transform={`translate(${planeX} ${planeY}) rotate(12)`}>
          <path d="M0 -13 L34 0 L0 13 L7 1 L-18 1 L-18 -1 L7 -1 Z" />
        </g>
        <text x={Math.max(28, origin.x - 42)} y={Math.min(306, origin.y + 42)}>{flight.origin.code}</text>
        <text x={Math.min(805, destination.x - 42)} y={Math.min(306, destination.y + 42)}>{flight.destination.code}</text>
        <text className="city" x={Math.max(28, origin.x - 42)} y={Math.min(326, origin.y + 62)}>{flight.origin.city}</text>
        <text className="city" x={Math.min(805, destination.x - 42)} y={Math.min(326, destination.y + 62)}>{flight.destination.city}</text>
      </svg>
    </section>
  );
}
