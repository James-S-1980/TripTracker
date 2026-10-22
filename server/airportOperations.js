const severityRank = {
  clear: 0,
  info: 1,
  minor: 2,
  major: 3,
  critical: 4,
};

function cleanText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function limitedText(value, maxLength = 260) {
  const text = cleanText(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}...`;
}

function numericValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizedFacilities(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean);
  const text = cleanText(value);
  return text ? text.split(/[;,]/).map(cleanText).filter(Boolean) : [];
}

function eventBase(type, title, severity, source) {
  return {
    type,
    title,
    severity,
    reason: undefined,
    summary: "",
    averageDelayMinutes: undefined,
    trend: undefined,
    startTime: undefined,
    endTime: undefined,
    probabilityOfExtension: undefined,
    scope: [],
    advisoryUrl: undefined,
    sourceUpdatedAt: source?.updatedAt ?? source?.updateTime ?? source?.eventTime ?? source?.sourceTimeStamp,
  };
}

function airportEvents(source, airportCode, airportName) {
  const events = [];

  if (source?.airportClosure) {
    const closure = source.airportClosure;
    const event = eventBase("airport_closure", "Airport closure", "critical", closure);
    event.reason = cleanText(closure.reason ?? closure.impactingCondition);
    event.summary = event.reason
      ? `${airportName} is closed due to ${event.reason.toLowerCase()}.`
      : `${airportName} is currently closed.`;
    event.startTime = closure.startTime;
    event.endTime = closure.endTime ?? closure.reopenTime;
    event.advisoryUrl = closure.advisoryUrl;
    events.push(event);
  }

  if (source?.freeForm) {
    const restriction = source.freeForm;
    const text = limitedText(restriction.text || restriction.simpleText);
    const limitedScope = /\b(?:GA|GENERAL AVIATION|NON[ -]?SKED|PPR)\b/i.test(text);
    const event = eventBase(
      limitedScope ? "airport_restriction" : "airport_closure",
      limitedScope ? "Operating restriction" : "Airport closure",
      limitedScope ? "info" : "critical",
      restriction,
    );
    event.reason = text;
    event.summary = text
      ? `${limitedScope ? "Published restriction" : "Closure notice"}: ${text}`
      : `${airportName} has a published FAA operating restriction.`;
    event.startTime = restriction.startTime;
    event.endTime = restriction.endTime;
    events.push(event);
  }

  if (source?.groundStop) {
    const stop = source.groundStop;
    const event = eventBase("ground_stop", "Ground stop", "critical", stop);
    event.reason = cleanText(stop.impactingCondition ?? stop.reason);
    event.summary = `Departures to ${airportCode} are being held at their origin${event.reason ? ` due to ${event.reason.toLowerCase()}` : ""}.`;
    event.startTime = stop.startTime;
    event.endTime = stop.endTime;
    event.probabilityOfExtension = cleanText(stop.probabilityOfExtension);
    event.scope = normalizedFacilities(stop.includedFacilities);
    event.advisoryUrl = stop.advisoryUrl;
    events.push(event);
  }

  if (source?.groundDelay) {
    const delay = source.groundDelay;
    const event = eventBase("ground_delay", "Ground delay program", "major", delay);
    event.averageDelayMinutes = numericValue(delay.avgDelay ?? delay.averageDelay);
    event.reason = cleanText(delay.impactingCondition ?? delay.reason);
    event.summary = `Departures to ${airportCode} are receiving controlled departure times${event.averageDelayMinutes !== undefined ? ` with an average delay of ${event.averageDelayMinutes} minutes` : ""}${event.reason ? ` due to ${event.reason.toLowerCase()}` : ""}.`;
    event.startTime = delay.startTime;
    event.endTime = delay.endTime;
    event.scope = normalizedFacilities(delay.includedFacilities);
    event.advisoryUrl = delay.advisoryUrl;
    events.push(event);
  }

  for (const [property, type, title, direction] of [
    ["arrivalDelay", "arrival_delay", "Arrival delays", "Arrivals to"],
    ["departureDelay", "departure_delay", "Departure delays", "Departures from"],
  ]) {
    const delay = source?.[property];
    if (!delay) continue;
    const averageDelayMinutes = numericValue(delay.averageDelay ?? delay.avgDelay);
    const severity = averageDelayMinutes !== undefined && averageDelayMinutes >= 30 ? "major" : "minor";
    const event = eventBase(type, title, severity, delay);
    event.averageDelayMinutes = averageDelayMinutes;
    event.trend = cleanText(delay.trend).toLowerCase() || undefined;
    event.reason = cleanText(delay.reason ?? delay.impactingCondition);
    event.summary = `${direction} ${airportCode} are delayed${averageDelayMinutes !== undefined ? ` an average of ${averageDelayMinutes} minutes` : ""}${event.trend ? ` and delays are ${event.trend}` : ""}${event.reason ? ` due to ${event.reason.toLowerCase()}` : ""}.`;
    event.startTime = delay.updateTime;
    events.push(event);
  }

  if (source?.deicing) {
    const deicing = source.deicing;
    const event = eventBase("deicing", "Deicing in progress", "minor", deicing);
    event.summary = `Aircraft departing ${airportCode} are undergoing deicing.`;
    event.startTime = deicing.eventTime;
    events.push(event);
  }

  return events.sort((left, right) => severityRank[right.severity] - severityRank[left.severity]);
}

function mostRecentTimestamp(source, fallback) {
  const values = [
    source?.airportConfig?.sourceTimeStamp,
    source?.airportConfig?.updatedAt,
    ...airportEvents(source, source?.airportId ?? "", source?.airportLongName ?? source?.airportId ?? "")
      .map((event) => event.sourceUpdatedAt),
  ]
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);
  return values.length > 0 ? new Date(Math.max(...values)).toISOString() : fallback;
}

function airportSummary(code, activeEvent, pacingAirport, fetchedAt) {
  const airportName = cleanText(activeEvent?.airportLongName) || code;
  const events = airportEvents(activeEvent, code, airportName);
  const highestSeverity = events[0]?.severity ?? (pacingAirport ? "clear" : "unknown");
  const status = events[0]?.title ?? (pacingAirport ? "No active FAA advisory" : "Coverage limited");
  const airportConfig = activeEvent?.airportConfig;

  return {
    airportCode: code,
    airportName,
    status,
    severity: highestSeverity,
    continuouslyMonitored: Boolean(pacingAirport),
    events,
    runwayConfig: airportConfig ? {
      arrivals: cleanText(airportConfig.arrivalRunwayConfig) || undefined,
      departures: cleanText(airportConfig.departureRunwayConfig) || undefined,
      arrivalRate: numericValue(airportConfig.arrivalRate),
    } : undefined,
    updatedAt: mostRecentTimestamp(activeEvent, fetchedAt),
    coverage: pacingAirport
      ? events.length > 0
        ? "FAA pacing airport with an active event in the current feed."
        : "FAA pacing airport; no active event means no current FAA delay program is listed."
      : events.length > 0
        ? "The FAA published an active event for this airport, which is outside the continuously listed pacing-airport set."
        : "No current FAA event is listed. Coverage is selective for airports outside the FAA pacing-airport list.",
  };
}

export function summarizeAirportOperations({ requestedCodes, events, pacingAirports, fetchedAt = new Date().toISOString() }) {
  const eventByAirport = new Map(
    (Array.isArray(events) ? events : [])
      .filter((event) => event?.airportId)
      .map((event) => [cleanText(event.airportId).toUpperCase(), event]),
  );
  const pacingByAirport = new Map(
    (Array.isArray(pacingAirports) ? pacingAirports : [])
      .filter((airport) => airport?.airportId)
      .map((airport) => [cleanText(airport.airportId).toUpperCase(), airport]),
  );
  const codes = [...new Set((requestedCodes ?? []).map((code) => cleanText(code).toUpperCase()).filter(Boolean))];

  return {
    airports: codes.map((code) => airportSummary(code, eventByAirport.get(code), pacingByAirport.get(code), fetchedAt)),
    updatedAt: fetchedAt,
    source: "FAA National Airspace System Status",
    sourceUrl: "https://nasstatus.faa.gov/",
  };
}
