const completedOutcome = "Completed";
const delayedOutcome = "Delayed";
const severeDelayOutcome = "Severely delayed";
const cancelledOutcome = "Cancelled";

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
    recentIssues: records
      .filter((record) => record.outcome !== completedOutcome)
      .slice(0, 5),
    records,
    source: "FlightAware public activity log",
    sourceUrl: metadata.sourceUrl,
    updatedAt: new Date().toISOString(),
    coverage: "Departure punctuality and cancellations for prior route-matched operations",
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
