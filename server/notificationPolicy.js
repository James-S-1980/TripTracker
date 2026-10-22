const materialTimeChangeMs = 10 * 60 * 1000;
const landingSoonMs = 10 * 60 * 1000;
const criticalStatuses = new Set(["delayed", "cancelled", "diverted"]);
const completedStatuses = new Set(["landed", "arrived"]);

export function createNotificationState(flight, now = Date.now()) {
  const altitude = actualAltitude(flight);
  const progress = flightProgress(flight);
  const airborne = isAirborne(flight);
  const completed = isCompleted(flight);
  const remainingMs = timeUntilArrival(flight, now);

  return {
    version: 1,
    takeoffSent: airborne,
    halfwaySent: progress >= 50,
    descentSent: completed || (airborne && progress >= 70 && altitude !== null && altitude <= 18000),
    tenMinutesSent: completed || (airborne && remainingMs !== null && remainingMs <= landingSoonMs),
    landedSent: completed,
    maxObservedAltitudeFt: altitude ?? 0,
    lastActualAltitudeFt: altitude,
    descentDropSamples: 0,
    notifiedStatus: normalizedStatus(flight?.status),
    notifiedDepartureGate: normalizedGate(flight?.terminal, flight?.boardingGate),
    notifiedArrivalGate: normalizedGate(flight?.arrivalTerminal, flight?.arrivalGate),
    notifiedDepartureTime: validTimestamp(flight?.departureTime),
    notifiedArrivalTime: validTimestamp(flight?.arrivalTime),
  };
}

export function evaluateFlightNotificationPolicy(previous, next, savedState, now = Date.now()) {
  const state = {
    ...createNotificationState(previous ?? next, now),
    ...(savedState ?? {}),
  };
  const criticalChanges = criticalFlightChanges(next, state);
  const notifications = [];
  const progress = flightProgress(next);
  const airborne = isAirborne(next);
  const completed = isCompleted(next);

  if (!state.takeoffSent && airborne) {
    notifications.push({ eventType: "takeoff", changes: [{ kind: "takeoff" }] });
    state.takeoffSent = true;
  }

  if (!state.halfwaySent && airborne && progress >= 50) {
    notifications.push({ eventType: "halfway", changes: [{ kind: "halfway", progress }] });
    state.halfwaySent = true;
  }

  updateAltitudeTrend(state, next);
  if (!state.descentSent && hasEnteredDescent(state, next, progress)) {
    notifications.push({
      eventType: "descent",
      changes: [{ kind: "descent", altitudeFt: state.lastActualAltitudeFt }],
    });
    state.descentSent = true;
  }

  const remainingMs = timeUntilArrival(next, now);
  if (
    !state.tenMinutesSent
    && airborne
    && remainingMs !== null
    && remainingMs > 0
    && remainingMs <= landingSoonMs
  ) {
    notifications.push({
      eventType: "ten_minutes",
      changes: [{ kind: "ten-minutes", remainingMinutes: Math.max(1, Math.ceil(remainingMs / 60000)) }],
    });
    state.tenMinutesSent = true;
  }

  if (!state.landedSent && completed) {
    notifications.push({ eventType: "landed", changes: [{ kind: "landed" }] });
    state.landedSent = true;
    state.takeoffSent = true;
    state.halfwaySent = true;
    state.descentSent = true;
    state.tenMinutesSent = true;
  }

  if (criticalChanges.length > 0) {
    if (notifications.length > 0) {
      notifications.at(-1).changes.push(...criticalChanges);
    } else {
      notifications.push({ eventType: "critical", changes: criticalChanges });
    }
  }

  return { state, notifications };
}

function criticalFlightChanges(flight, state) {
  const changes = [];
  const status = normalizedStatus(flight?.status);
  const previousStatus = normalizedStatus(state.notifiedStatus);
  const departureGate = normalizedGate(flight?.terminal, flight?.boardingGate);
  const arrivalGate = normalizedGate(flight?.arrivalTerminal, flight?.arrivalGate);
  const departureTime = validTimestamp(flight?.departureTime);
  const arrivalTime = validTimestamp(flight?.arrivalTime);

  if (status !== previousStatus && (criticalStatuses.has(status) || criticalStatuses.has(previousStatus))) {
    const routineMilestoneStatus = criticalStatuses.has(previousStatus) && (status === "en route" || completedStatuses.has(status));
    if (!routineMilestoneStatus) {
      changes.push({ kind: "status", previous: state.notifiedStatus || "Unknown", next: flight?.status || "Unknown" });
    }
  }
  state.notifiedStatus = flight?.status || state.notifiedStatus;

  if (departureGate && departureGate !== state.notifiedDepartureGate) {
    changes.push({ kind: "departure-gate", previous: state.notifiedDepartureGate, next: departureGate });
    state.notifiedDepartureGate = departureGate;
  }

  if (arrivalGate && arrivalGate !== state.notifiedArrivalGate) {
    changes.push({ kind: "arrival-gate", previous: state.notifiedArrivalGate, next: arrivalGate });
    state.notifiedArrivalGate = arrivalGate;
  }

  appendMaterialTimeChange(changes, state, "departure", departureTime);
  appendMaterialTimeChange(changes, state, "arrival", arrivalTime);
  return changes;
}

function appendMaterialTimeChange(changes, state, field, nextTime) {
  const stateKey = field === "departure" ? "notifiedDepartureTime" : "notifiedArrivalTime";
  const previousTime = validTimestamp(state[stateKey]);
  if (nextTime === null) return;
  if (previousTime === null) {
    state[stateKey] = nextTime;
    return;
  }

  const deltaMs = nextTime - previousTime;
  if (Math.abs(deltaMs) < materialTimeChangeMs) return;
  changes.push({
    kind: `${field}-time`,
    previous: new Date(previousTime).toISOString(),
    next: new Date(nextTime).toISOString(),
    deltaMinutes: Math.round(deltaMs / 60000),
  });
  state[stateKey] = nextTime;
}

function updateAltitudeTrend(state, flight) {
  const altitude = actualAltitude(flight);
  if (altitude === null) return;

  const previousAltitude = finiteNumber(state.lastActualAltitudeFt);
  state.maxObservedAltitudeFt = Math.max(finiteNumber(state.maxObservedAltitudeFt) ?? 0, altitude);
  if (previousAltitude !== null) {
    if (altitude <= previousAltitude - 300) {
      state.descentDropSamples = (finiteNumber(state.descentDropSamples) ?? 0) + 1;
    } else if (altitude >= previousAltitude + 500) {
      state.descentDropSamples = 0;
    }
  }
  state.lastActualAltitudeFt = altitude;
}

function hasEnteredDescent(state, flight, progress) {
  if (!isAirborne(flight) || progress < 50) return false;
  const altitude = finiteNumber(state.lastActualAltitudeFt);
  const maximum = finiteNumber(state.maxObservedAltitudeFt);
  const dropSamples = finiteNumber(state.descentDropSamples) ?? 0;
  if (altitude === null || maximum === null || maximum < 6000 || dropSamples < 2) return false;
  const requiredDrop = maximum >= 18000 ? 1500 : Math.max(1000, Math.round(maximum * 0.15));
  return maximum - altitude >= requiredDrop;
}

function actualAltitude(flight) {
  const position = flight?.aircraftPosition;
  if (!position || /estimated/i.test(String(position.source ?? ""))) return null;
  const altitude = finiteNumber(position.altitudeFt ?? flight?.altitudeFt);
  return altitude !== null && altitude >= 0 ? altitude : null;
}

function isAirborne(flight) {
  const status = normalizedStatus(flight?.status);
  if (status === "en route") return true;
  const altitude = actualAltitude(flight);
  return altitude !== null && altitude >= 500 && !completedStatuses.has(status);
}

function isCompleted(flight) {
  return completedStatuses.has(normalizedStatus(flight?.status));
}

function flightProgress(flight) {
  const progress = finiteNumber(flight?.progress) ?? 0;
  return Math.max(0, Math.min(100, progress));
}

function timeUntilArrival(flight, now) {
  const arrival = validTimestamp(flight?.arrivalTime);
  return arrival === null ? null : arrival - now;
}

function normalizedGate(terminal, gate) {
  const cleanTerminal = usefulValue(terminal);
  const cleanGate = usefulValue(gate);
  if (cleanTerminal && cleanGate) return `${cleanTerminal} / ${cleanGate}`;
  if (cleanGate) return cleanGate;
  if (cleanTerminal) return `Terminal ${cleanTerminal}`;
  return "";
}

function usefulValue(value) {
  const normalized = String(value ?? "").trim();
  return normalized && !/^(?:pending|tbd|n\/?a|na|none|null|unknown|-|--|\?)$/i.test(normalized) ? normalized : "";
}

function normalizedStatus(value) {
  return String(value ?? "").trim().toLowerCase();
}

function validTimestamp(value) {
  const timestamp = new Date(value ?? "").getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
