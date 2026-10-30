import type { FlightLeg } from "./types";

export type TimeComparison = {
  currentTime: string;
  scheduledTime?: string;
  deltaMinutes: number | null;
  isDelayed: boolean;
};

export type FlightTiming = {
  state: "on-time" | "delayed" | "cancelled";
  delayMinutes: number | null;
  departure: TimeComparison;
  arrival: TimeComparison;
};

export const visibleDelayThresholdMinutes = 5;

export function compareFlightTime(currentTime: string, scheduledTime?: string): TimeComparison {
  const current = new Date(currentTime).getTime();
  const scheduled = scheduledTime ? new Date(scheduledTime).getTime() : Number.NaN;
  const deltaMinutes = Number.isFinite(current) && Number.isFinite(scheduled)
    ? Math.round((current - scheduled) / 60000)
    : null;
  return {
    currentTime,
    scheduledTime: Number.isFinite(scheduled) ? scheduledTime : undefined,
    deltaMinutes,
    isDelayed: deltaMinutes !== null && deltaMinutes >= visibleDelayThresholdMinutes,
  };
}

export function flightTiming(flight: FlightLeg): FlightTiming {
  const departure = compareFlightTime(flight.departureTime, flight.scheduledDepartureTime);
  const arrival = compareFlightTime(flight.arrivalTime, flight.scheduledArrivalTime);
  const positiveDelays = [departure.deltaMinutes, arrival.deltaMinutes]
    .filter((value): value is number => value !== null && value > 0);
  const delayMinutes = positiveDelays.length > 0 ? Math.max(...positiveDelays) : null;
  const state = flight.status === "Cancelled"
    ? "cancelled"
    : flight.status === "Delayed" || departure.isDelayed || arrival.isDelayed
      ? "delayed"
      : "on-time";
  return { state, delayMinutes, departure, arrival };
}

export function timingLabel(timing: FlightTiming): string {
  if (timing.state === "cancelled") return "Cancelled";
  if (timing.state === "delayed") {
    return timing.delayMinutes ? `${timing.delayMinutes} min delay` : "Delay reported";
  }
  return "On time";
}
