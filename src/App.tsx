import { AlertTriangle, Bell, CalendarDays, CloudSun, MapPin, Plane, Radar, RefreshCw, Search, Timer } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { lookupFlight } from "./flightProvider";
import { fetchWeather } from "./weather";
import type { FlightLeg, WeatherSnapshot } from "./types";

const storageKey = "triptracker:flights";

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function timeAgo(value: string): string {
  const minutes = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  return minutes === 1 ? "1 min ago" : `${minutes} min ago`;
}

export function App() {
  const [airline, setAirline] = useState("DL");
  const [flightNumber, setFlightNumber] = useState("401");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [flights, setFlights] = useState<FlightLeg[]>(() => {
    const saved = window.localStorage.getItem(storageKey);
    return saved ? JSON.parse(saved) as FlightLeg[] : [];
  });
  const [activeId, setActiveId] = useState<string | null>(flights[0]?.id ?? null);
  const [isLoading, setIsLoading] = useState(false);
  const [weather, setWeather] = useState<Record<string, WeatherSnapshot>>({});

  const activeFlight = flights.find((flight) => flight.id === activeId) ?? flights[0];
  const allAlerts = useMemo(
    () => flights.flatMap((flight) => flight.alerts.map((alert) => ({ ...alert, flight: flight.flightNumber })))
      .sort((a, b) => priorityWeight(b.priority) - priorityWeight(a.priority)),
    [flights],
  );

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
    const [code, number] = activeFlight.flightNumber.split(" ");
    setIsLoading(true);
    const flight = await lookupFlight(code, number, activeFlight.date);
    setFlights((current) => current.map((item) => item.id === flight.id ? flight : item));
    setActiveId(flight.id);
    setIsLoading(false);
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
              <input value={airline} onChange={(event) => setAirline(event.target.value.toUpperCase())} maxLength={3} />
            </label>
            <label>
              Flight number
              <input value={flightNumber} onChange={(event) => setFlightNumber(event.target.value)} inputMode="numeric" />
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
            <h2>Change Feed</h2>
          </div>
          <div className="alert-list">
            {allAlerts.length === 0 ? (
              <p className="empty">Track a flight to start monitoring operational changes.</p>
            ) : allAlerts.map((alert) => (
              <article className={`alert ${alert.priority}`} key={alert.id}>
                <span>{alert.priority}</span>
                <strong>{alert.title}</strong>
                <p>{alert.flight}: {alert.message}</p>
                <small>{timeAgo(alert.timestamp)}</small>
              </article>
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

              <div className="summary-strip">
                <Metric icon={<Plane />} label="Status" value={activeFlight.status} tone={activeFlight.status === "Delayed" ? "danger" : "good"} />
                <Metric icon={<MapPin />} label="Gate" value={`${activeFlight.terminal}/${activeFlight.gate}`} tone="warn" />
                <Metric icon={<Timer />} label="Depart" value={formatTime(activeFlight.departureTime)} />
                <Metric icon={<CalendarDays />} label="Arrive" value={formatTime(activeFlight.arrivalTime)} />
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

function priorityWeight(priority: string): number {
  return priority === "critical" ? 3 : priority === "high" ? 2 : 1;
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
  const planeX = 110 + (680 * flight.progress / 100);
  const arcY = 182 - Math.sin(Math.PI * flight.progress / 100) * 96;

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
        <path className="grid-line" d="M90 245 C260 110 610 110 810 245" />
        <path className="route" d="M110 245 C290 40 590 40 790 245" />
        <circle className="airport-dot" cx="110" cy="245" r="9" />
        <circle className="airport-dot destination" cx="790" cy="245" r="9" />
        <g className="plane-marker" transform={`translate(${planeX} ${arcY}) rotate(12)`}>
          <path d="M0 -13 L34 0 L0 13 L7 1 L-18 1 L-18 -1 L7 -1 Z" />
        </g>
        <text x="70" y="286">{flight.origin.code}</text>
        <text x="735" y="286">{flight.destination.code}</text>
        <text className="city" x="70" y="306">{flight.origin.city}</text>
        <text className="city" x="735" y="306">{flight.destination.city}</text>
      </svg>
    </section>
  );
}
