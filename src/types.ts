export type FlightStatus = "Scheduled" | "Boarding" | "En Route" | "Delayed" | "Arrived" | "Cancelled";

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
  boardingGate: string;
  arrivalGate: string;
  terminal: string;
  arrivalTerminal: string;
  status: FlightStatus;
  progress: number;
  altitudeFt: number;
  groundSpeedMph: number;
  lastUpdated: string;
  dataSource: string;
  sourceUrl?: string;
  alerts: FlightAlert[];
};

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
