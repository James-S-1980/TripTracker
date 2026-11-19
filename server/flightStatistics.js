const completedOutcome = "Completed";
const delayedOutcome = "Delayed";
const severeDelayOutcome = "Severely delayed";
const cancelledOutcome = "Cancelled";

const aircraftTypeNames = {
  A318: "Airbus A318",
  A319: "Airbus A319",
  A320: "Airbus A320",
  A321: "Airbus A321",
  A20N: "Airbus A320neo",
  A21N: "Airbus A321neo",
  A332: "Airbus A330-200",
  A333: "Airbus A330-300",
  A338: "Airbus A330-800neo",
  A339: "Airbus A330-900neo",
  A343: "Airbus A340-300",
  A346: "Airbus A340-600",
  A359: "Airbus A350-900",
  A35K: "Airbus A350-1000",
  A388: "Airbus A380-800",
  BCS1: "Airbus A220-100",
  BCS3: "Airbus A220-300",
  B712: "Boeing 717-200",
  B733: "Boeing 737-300",
  B734: "Boeing 737-400",
  B735: "Boeing 737-500",
  B736: "Boeing 737-600",
  B737: "Boeing 737-700",
  B738: "Boeing 737-800",
  B739: "Boeing 737-900",
  B37M: "Boeing 737 MAX 7",
  B38M: "Boeing 737 MAX 8",
  B39M: "Boeing 737 MAX 9",
  B3XM: "Boeing 737 MAX 10",
  B744: "Boeing 747-400",
  B748: "Boeing 747-8",
  B752: "Boeing 757-200",
  B753: "Boeing 757-300",
  B762: "Boeing 767-200",
  B763: "Boeing 767-300",
  B764: "Boeing 767-400",
  B772: "Boeing 777-200",
  B773: "Boeing 777-300",
  B77L: "Boeing 777-200LR",
  B77W: "Boeing 777-300ER",
  B788: "Boeing 787-8",
  B789: "Boeing 787-9",
  B78X: "Boeing 787-10",
  CRJ2: "Bombardier CRJ-200",
  CRJ7: "Bombardier CRJ-700",
  CRJ9: "Bombardier CRJ-900",
  CRJX: "Bombardier CRJ-1000",
  DH8A: "De Havilland Dash 8-100",
  DH8B: "De Havilland Dash 8-200",
  DH8C: "De Havilland Dash 8-300",
  DH8D: "De Havilland Dash 8-400",
  E135: "Embraer ERJ-135",
  E145: "Embraer ERJ-145",
  E170: "Embraer 170",
  E175: "Embraer 175",
  E75L: "Embraer 175",
  E75S: "Embraer 175",
  E190: "Embraer 190",
  E195: "Embraer 195",
  E290: "Embraer E190-E2",
  E295: "Embraer E195-E2",
  MD11: "McDonnell Douglas MD-11",
  MD80: "McDonnell Douglas MD-80",
  MD82: "McDonnell Douglas MD-82",
  MD83: "McDonnell Douglas MD-83",
  MD88: "McDonnell Douglas MD-88",
  MD90: "McDonnell Douglas MD-90",
  AT43: "ATR 42-300",
  AT45: "ATR 42-500",
  AT46: "ATR 42-600",
  AT72: "ATR 72-200",
  AT75: "ATR 72-500",
  AT76: "ATR 72-600",
};

export function parseFlightAwareHistory(html, options) {
  const {
    origin,
    destination,
    originTimeZone,
    targetDate,
    originAliases = [],
    destinationAliases = [],
    limit = 14,
  } = options;
  const expectedOrigins = airportAliases(origin, originAliases);
  const expectedDestinations = airportAliases(destination, destinationAliases);
  const records = [];
  const rowPattern = /<tr\b[^>]*data-target=['"]([^'"]+\/history\/[^'"]+)['"][^>]*>([\s\S]*?)<\/tr>/gi;

  for (const match of html.matchAll(rowPattern)) {
    const path = decodeEntities(match[1]);
    const route = path.match(/\/history\/(\d{8})\/(\d{4})Z\/([A-Z0-9]{3,4})\/([A-Z0-9]{3,4})/i);
    if (!route) continue;

    const date = compactDateToIso(route[1]);
    if (!date || date >= targetDate) continue;

    const routeOrigin = route[3].toUpperCase();
    const routeDestination = route[4].toUpperCase();
    if (!expectedOrigins.has(routeOrigin) || !expectedDestinations.has(routeDestination)) continue;

    const cells = [...match[2].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
      .map((cell) => plainText(cell[1]));
    if (cells.length < 7) continue;

    const resultText = cells[6];
    const cancelled = /cancelled|canceled/i.test(resultText);
    const scheduled = /scheduled/i.test(resultText);
    if (scheduled) continue;

    if (cancelled) {
      records.push({
        date,
        aircraft: usefulText(cells[1]),
        origin,
        destination,
        outcome: cancelledOutcome,
      });
    } else {
      const actualDepartureMinutes = parseClockMinutes(cells[4]);
      const scheduledDepartureMinutes = scheduledLocalMinutes(route[1], route[2], originTimeZone);
      if (!Number.isFinite(actualDepartureMinutes) || !Number.isFinite(scheduledDepartureMinutes)) continue;
      const departureDelayMinutes = normalizedMinuteDifference(actualDepartureMinutes, scheduledDepartureMinutes);
      const outcome = departureDelayMinutes >= 60
        ? severeDelayOutcome
        : departureDelayMinutes >= 15
          ? delayedOutcome
          : completedOutcome;
      records.push({
        date,
        aircraft: usefulText(cells[1]),
        origin,
        destination,
        scheduledDepartureLocal: formatClock(scheduledDepartureMinutes),
        actualDepartureLocal: formatClock(actualDepartureMinutes),
        departureDelayMinutes,
        outcome,
      });
    }

    if (records.length >= limit) break;
  }

  return records;
}

export function summarizeFlightHistory(records, metadata) {
  const completed = records.filter((record) => record.outcome !== cancelledOutcome);
  const delayed = completed.filter((record) => Number(record.departureDelayMinutes) >= 15);
  const severe = completed.filter((record) => Number(record.departureDelayMinutes) >= 60);
  const cancelled = records.filter((record) => record.outcome === cancelledOutcome);
  const onTime = completed.filter((record) => Number(record.departureDelayMinutes) < 15);
  const delays = completed.map((record) => Number(record.departureDelayMinutes)).filter(Number.isFinite);
  const issueCount = delayed.length + cancelled.length;
  const sampleSize = records.length;
  const issueRate = sampleSize > 0 ? Math.round(issueCount / sampleSize * 100) : 0;
  const smoothedRisk = sampleSize > 0 ? Math.round((issueCount + 2) / (sampleSize + 8) * 100) : null;
  const aircraftEstimate = estimateAircraftType(records);

  return {
    flightNumber: metadata.flightNumber,
    route: `${metadata.origin}-${metadata.destination}`,
    sampleSize,
    completedFlights: completed.length,
    onTimeFlights: onTime.length,
    delayedFlights: delayed.length,
    severeDelayFlights: severe.length,
    cancelledFlights: cancelled.length,
    onTimeRate: sampleSize > 0 ? Math.round(onTime.length / sampleSize * 100) : 0,
    delayRate: sampleSize > 0 ? Math.round(delayed.length / sampleSize * 100) : 0,
    cancellationRate: sampleSize > 0 ? Math.round(cancelled.length / sampleSize * 100) : 0,
    issueRate,
    averageDepartureDelayMinutes: delays.length > 0 ? Math.round(delays.reduce((sum, value) => sum + value, 0) / delays.length) : null,
    medianDepartureDelayMinutes: median(delays),
    historicalRiskPercent: smoothedRisk,
    historicalAssessment: riskLabel(smoothedRisk),
    confidence: confidenceLabel(sampleSize),
    aircraftEstimate,
    recentIssues: records
      .filter((record) => record.outcome !== completedOutcome)
      .slice(0, 5),
    records,
    source: "FlightAware public activity log",
    sourceUrl: metadata.sourceUrl,
    updatedAt: new Date().toISOString(),
    coverage: "Departure punctuality, cancellations, and aircraft-type evidence for prior route-matched operations",
  };
}

export function estimateAircraftType(records) {
  const counts = new Map();
  for (const [index, record] of (Array.isArray(records) ? records : []).entries()) {
    if (record?.outcome === cancelledOutcome) continue;
    const aircraft = normalizedAircraftType(record?.aircraft);
    if (!aircraft) continue;
    const current = counts.get(aircraft.code) ?? { ...aircraft, matches: 0, newestIndex: index };
    current.matches += 1;
    counts.set(aircraft.code, current);
  }

  const sampleSize = [...counts.values()].reduce((sum, aircraft) => sum + aircraft.matches, 0);
  if (sampleSize === 0) return null;

  const ranked = [...counts.values()]
    .map((aircraft) => ({
      ...aircraft,
      sharePercent: Math.round(aircraft.matches / sampleSize * 100),
    }))
    .sort((left, right) => right.matches - left.matches || left.newestIndex - right.newestIndex || left.code.localeCompare(right.code));
  const leading = ranked[0];
  const runnerUp = ranked[1];
  const leadMargin = leading.sharePercent - (runnerUp?.sharePercent ?? 0);
  const confidence = sampleSize >= 6 && leading.sharePercent >= 70 && leadMargin >= 25
    ? "Strong"
    : sampleSize >= 3 && leading.sharePercent >= 50 && leadMargin >= 15
      ? "Moderate"
      : "Limited";

  return {
    code: leading.code,
    name: leading.name,
    matches: leading.matches,
    sampleSize,
    sharePercent: leading.sharePercent,
    confidence,
    alternatives: ranked.slice(1, 3).map(({ newestIndex: _newestIndex, ...aircraft }) => aircraft),
  };
}

function airportAliases(iataCode, aliases) {
  const normalized = new Set([iataCode, ...aliases].map((value) => String(value ?? "").trim().toUpperCase()).filter(Boolean));
  if (/^[A-Z]{3}$/.test(iataCode)) normalized.add(`K${iataCode}`);
  return normalized;
}

function compactDateToIso(value) {
  if (!/^\d{8}$/.test(value)) return null;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function scheduledLocalMinutes(dateValue, timeValue, timeZone) {
  const year = Number(dateValue.slice(0, 4));
  const month = Number(dateValue.slice(4, 6));
  const day = Number(dateValue.slice(6, 8));
  const hour = Number(timeValue.slice(0, 2));
  const minute = Number(timeValue.slice(2, 4));
  const timestamp = Date.UTC(year, month - 1, day, hour, minute);
  if (!Number.isFinite(timestamp)) return NaN;

  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(timestamp));
    const part = (type) => Number(parts.find((item) => item.type === type)?.value);
    return part("hour") * 60 + part("minute");
  } catch {
    return NaN;
  }
}

function parseClockMinutes(value) {
  const match = String(value ?? "").match(/\b(\d{1,2}):(\d{2})\s*(AM|PM)?\b/i);
  if (!match) return NaN;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3]?.toUpperCase();
  if (meridiem === "AM" && hour === 12) hour = 0;
  if (meridiem === "PM" && hour !== 12) hour += 12;
  return hour * 60 + minute;
}

function normalizedMinuteDifference(actual, scheduled) {
  let difference = actual - scheduled;
  if (difference < -720) difference += 1440;
  if (difference > 720) difference -= 1440;
  return difference;
}

function formatClock(minutes) {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  return `${Math.floor(normalized / 60).toString().padStart(2, "0")}:${(normalized % 60).toString().padStart(2, "0")}`;
}

function plainText(value) {
  return decodeEntities(String(value ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function usefulText(value) {
  const normalized = String(value ?? "").trim();
  return normalized && !/^[-?]$/.test(normalized) ? normalized : undefined;
}

function normalizedAircraftType(value) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (!normalized || /^(?:UNKNOWN|UNAVAILABLE|PENDING|N\/A|NONE)$/.test(normalized)) return null;
  const tokens = normalized.match(/[A-Z0-9]{3,4}/g) ?? [];
  const code = tokens.find((token) => aircraftTypeNames[token])
    ?? tokens.find((token) => /[A-Z]/.test(token) && /\d/.test(token));
  if (!code) return null;
  return {
    code,
    name: aircraftTypeNames[code] ?? code,
  };
}

function decodeEntities(value) {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : Math.round(sorted[middle]);
}

function riskLabel(percent) {
  if (percent === null) return "Insufficient data";
  if (percent < 25) return "Low";
  if (percent < 45) return "Moderate";
  return "High";
}

function confidenceLabel(sampleSize) {
  if (sampleSize < 5) return "Limited";
  if (sampleSize < 10) return "Moderate";
  return "Strong";
}
