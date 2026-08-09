import type { Airport, WeatherSnapshot } from "./types";

type OpenMeteoResponse = {
  current?: {
    temperature_2m?: number;
    wind_speed_10m?: number;
    precipitation?: number;
    weather_code?: number;
  };
};

const codeToCondition: Record<number, string> = {
  0: "Clear",
  1: "Mostly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  51: "Light drizzle",
  61: "Rain",
  71: "Snow",
  80: "Showers",
  95: "Thunderstorms",
};

export async function fetchWeather(airport: Airport): Promise<WeatherSnapshot> {
  const params = new URLSearchParams({
    latitude: String(airport.lat),
    longitude: String(airport.lon),
    current: "temperature_2m,wind_speed_10m,precipitation,weather_code",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Weather lookup failed for ${airport.code}`);
  }
  const data = (await response.json()) as OpenMeteoResponse;
  const current = data.current ?? {};

  return {
    airportCode: airport.code,
    temperatureF: Math.round(current.temperature_2m ?? 0),
    windMph: Math.round(current.wind_speed_10m ?? 0),
    precipitationChance: Math.round((current.precipitation ?? 0) * 10),
    condition: codeToCondition[current.weather_code ?? 0] ?? "Changing",
  };
}
