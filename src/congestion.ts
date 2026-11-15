import type { AirportDelaySeverity, AirportDelayStatus } from "./types";

export type CongestionRegion = {
  airports: AirportDelayStatus[];
  lat: number;
  lon: number;
  severity: AirportDelaySeverity;
  averageDelayMinutes?: number;
};

const severityRank: Record<AirportDelaySeverity, number> = {
  unknown: -1,
  clear: 0,
  info: 1,
  minor: 2,
  major: 3,
  critical: 4,
};

const clusterDistanceMiles = 55;

export function congestionRegions(airports: AirportDelayStatus[]): CongestionRegion[] {
  const eligible = airports.filter((airport) => (
    Number.isFinite(airport.lat) &&
    Number.isFinite(airport.lon) &&
    (airport.continuouslyMonitored || airport.events.length > 0)
  ));
  const unvisited = new Set(eligible);
  const regions: CongestionRegion[] = [];

  while (unvisited.size > 0) {
    const seed = unvisited.values().next().value as AirportDelayStatus;
    unvisited.delete(seed);
    const cluster = [seed];
    const queue = [seed];

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const candidate of [...unvisited]) {
        if (distanceMiles(current, candidate) <= clusterDistanceMiles) {
          unvisited.delete(candidate);
          cluster.push(candidate);
          queue.push(candidate);
        }
      }
    }

    const airportsBySeverity = [...cluster].sort((left, right) => (
      severityRank[right.severity] - severityRank[left.severity]
    ));
    const delayMinutes = cluster
      .flatMap((airport) => airport.events)
      .map((event) => event.averageDelayMinutes)
      .filter((value): value is number => Number.isFinite(value));

    regions.push({
      airports: airportsBySeverity,
      lat: cluster.reduce((sum, airport) => sum + airport.lat!, 0) / cluster.length,
      lon: cluster.reduce((sum, airport) => sum + airport.lon!, 0) / cluster.length,
      severity: airportsBySeverity[0]?.severity ?? "unknown",
      averageDelayMinutes: delayMinutes.length > 0 ? Math.max(...delayMinutes) : undefined,
    });
  }

  return regions.sort((left, right) => severityRank[right.severity] - severityRank[left.severity]);
}

export function congestionColor(severity: AirportDelaySeverity): string {
  if (severity === "critical") return "#ef4444";
  if (severity === "major") return "#f97316";
  if (severity === "minor") return "#facc15";
  if (severity === "info") return "#a3e635";
  if (severity === "clear") return "#34d399";
  return "#64748b";
}

function distanceMiles(left: AirportDelayStatus, right: AirportDelayStatus): number {
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const lat1 = toRadians(left.lat!);
  const lat2 = toRadians(right.lat!);
  const deltaLat = lat2 - lat1;
  const deltaLon = toRadians(right.lon! - left.lon!);
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
