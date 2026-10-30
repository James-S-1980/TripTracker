export type FlightStatus = "Scheduled" | "Boarding" | "En Route" | "Delayed" | "Landed" | "Arrived" | "Cancelled";

export type Airport = {
  code: string;
  name: string;
  city: string;
  lat: number;
  lon: number;
  timeZone: string;
};

export type FlightLeg = {
  id: string;
  airline: string;
  airlineCode: string;
  airlineLogoUrl?: string;
  flightNumber: string;
  date: string;
  origin: Airport;
  destination: Airport;
  departureTime: string;
  arrivalTime: string;
  scheduledDepartureTime?: string;
  scheduledArrivalTime?: string;
  boardingTime?: string;
  boardingGate: string;
  arrivalGate: string;
  terminal: string;
  arrivalTerminal: string;
  status: FlightStatus;
  progress: number;
  altitudeFt: number;
  groundSpeedMph: number;
  tailNumber?: string;
  inboundFrom?: Airport;
  inboundFlightNumber?: string;
  inboundStatus?: FlightStatus;
  inboundSource?: string;
  aircraftPosition?: AircraftPosition;
  track?: AircraftPosition[];
  lastUpdated: string;
  dataSource: string;
  sourceUrl?: string;
  landedAt?: string;
  alerts: FlightAlert[];
};

export type FlightLookupResult = FlightLeg | {
  ambiguous: true;
  flights: FlightLeg[];
  message: string;
};

export type FlightSearchResult = {
  flights: FlightLeg[];
  message: string;
};

export type FlightHistoryRecord = {
  date: string;
  aircraft?: string;
  origin: string;
  destination: string;
  scheduledDepartureLocal?: string;
  actualDepartureLocal?: string;
  departureDelayMinutes?: number;
  outcome: "Completed" | "Delayed" | "Severely delayed" | "Cancelled";
};

export type FlightStatistics = {
  flightNumber: string;
  route: string;
  sampleSize: number;
  completedFlights: number;
  onTimeFlights: number;
  delayedFlights: number;
  severeDelayFlights: number;
  cancelledFlights: number;
  onTimeRate: number;
  delayRate: number;
  cancellationRate: number;
  issueRate: number;
  averageDepartureDelayMinutes: number | null;
  medianDepartureDelayMinutes: number | null;
  historicalRiskPercent: number | null;
  historicalAssessment: "Low" | "Moderate" | "High" | "Insufficient data";
  confidence: "Limited" | "Moderate" | "Strong";
  recentIssues: FlightHistoryRecord[];
  records: FlightHistoryRecord[];
  source: string;
  sourceUrl: string;
  updatedAt: string;
  coverage: string;
};

export type AirportDelayEventType =
  | "airport_closure"
  | "airport_restriction"
  | "ground_stop"
  | "ground_delay"
  | "arrival_delay"
  | "departure_delay"
  | "deicing";

export type AirportDelaySeverity = "clear" | "unknown" | "info" | "minor" | "major" | "critical";

export type AirportDelayEvent = {
  type: AirportDelayEventType;
  title: string;
  severity: Exclude<AirportDelaySeverity, "clear" | "unknown">;
  reason?: string;
  summary: string;
  averageDelayMinutes?: number;
  trend?: string;
  startTime?: string;
  endTime?: string;
  probabilityOfExtension?: string;
  scope: string[];
  advisoryUrl?: string;
  sourceUpdatedAt?: string;
};

export type AirportDelayStatus = {
  airportCode: string;
  airportName: string;
  city?: string;
  timeZone?: string;
  status: string;
  severity: AirportDelaySeverity;
  continuouslyMonitored: boolean;
  events: AirportDelayEvent[];
  runwayConfig?: {
    arrivals?: string;
    departures?: string;
    arrivalRate?: number;
  };
  updatedAt: string;
  coverage: string;
};

export type AirportDelayReport = {
  airports: AirportDelayStatus[];
  updatedAt: string;
  source: string;
  sourceUrl: string;
  stale: boolean;
};

export type AircraftPosition = {
  lat: number;
  lon: number;
  altitudeFt: number;
  groundSpeedMph?: number;
  headingDeg?: number;
  timestamp?: string;
  source: "FlightAware live position" | "FlightAware track" | "FlightAware public track" | "Airplanes.live ADS-B" | "ADSB.lol ADS-B" | "ADS-B" | "Estimated from schedule";
  callsign?: string;
  aircraftHex?: string;
  tailNumber?: string;
  seenPositionSeconds?: number;
  crossTrackMiles?: number;
};

export type RunwayEnd = {
  ident: string;
  lat: number;
  lon: number;
  headingDeg: number;
  displacedThresholdFt?: number;
};

export type AirportRunway = {
  id: string;
  airportCode: string;
  ident: string;
  lengthFt?: number;
  widthFt?: number;
  surface?: string;
  lighted: boolean;
  le?: RunwayEnd | null;
  he?: RunwayEnd | null;
};

export type RunwayCatalog = Record<string, AirportRunway[]>;

export type FlightAlert = {
  id: string;
  type: "gate" | "delay" | "status" | "weather";
  priority: "critical" | "high" | "normal";
  title: string;
  message: string;
  timestamp: string;
};

export type WeatherSnapshot = {
  airportCode: string;
  temperatureF: number;
  windMph: number;
  precipitationChance: number;
  condition: string;
};
