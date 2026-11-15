const baseline = {
  delayedRate: 0.2624,
  cancelledRate: 0.0186,
  label: "BTS August 2026 national operating-carrier benchmark",
  source: "U.S. Bureau of Transportation Statistics",
  sourceUrl: "https://transtats.bts.gov/OT_Delay/ot_delaycause1.asp",
};

const gradeRank = { A: 0, B: 1, C: 2, D: 3, F: 4 };
const gradeLabels = {
  A: "Excellent",
  B: "Normal",
  C: "Strained",
  D: "Poor",
  F: "Severe disruption",
};

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundedRate(value) {
  return Math.round(value * 10000) / 10000;
}

function roundedPercent(value) {
  return Math.round(value * 1000) / 10;
}

export function summarizeMiserySnapshot(snapshot) {
  const totals = (Array.isArray(snapshot?.data) ? snapshot.data : []).reduce((summary, airport) => ({
    onTime: summary.onTime + numberValue(airport?.ontime),
    delayed: summary.delayed + numberValue(airport?.delayed),
    cancelled: summary.cancelled + numberValue(airport?.cancelled),
  }), { onTime: 0, delayed: 0, cancelled: 0 });
  const total = totals.onTime + totals.delayed + totals.cancelled;
  if (total <= 0) throw new Error("FlightAware live operations did not include usable flight totals.");

  return {
    ...totals,
    total,
    onTimeRate: roundedRate(totals.onTime / total),
    delayedRate: roundedRate(totals.delayed / total),
    cancelledRate: roundedRate(totals.cancelled / total),
    disruptionRate: roundedRate((totals.delayed + totals.cancelled) / total),
    timestamp: Number.isFinite(Number(snapshot?.time))
      ? new Date(Number(snapshot.time) * 1000).toISOString()
      : new Date().toISOString(),
  };
}

export function parseFlightAwareDailyTotals(html) {
  const text = String(html ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#160;/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const delayed = text.match(/Total delays within, into, or out of the United States today:\s*([\d,]+)/i)?.[1];
  const cancelled = text.match(/Total cancellations within, into, or out of the United States today:\s*([\d,]+)/i)?.[1];
  if (!delayed || !cancelled) throw new Error("FlightAware daily totals were not present in the public page.");
  return {
    delayed: Number(delayed.replace(/,/g, "")),
    cancelled: Number(cancelled.replace(/,/g, "")),
  };
}

export function buildAirTravelHealth({
  realtime,
  historical = [],
  dailyTotals,
  faaAirports = [],
  fetchedAt = new Date().toISOString(),
}) {
  const current = summarizeMiserySnapshot(realtime);
  const history = (Array.isArray(historical) ? historical : [])
    .map((snapshot) => {
      try {
        return summarizeMiserySnapshot(snapshot);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const currentTime = new Date(current.timestamp).getTime();
  const oneHourPrior = closestPriorSnapshot(history, currentTime, 60);
  const threeHourPrior = closestPriorSnapshot(history, currentTime, 180);
  const oneHourChange = oneHourPrior ? current.disruptionRate - oneHourPrior.disruptionRate : null;
  const threeHourChange = threeHourPrior ? current.disruptionRate - threeHourPrior.disruptionRate : null;
  const oneHourCancellationChange = oneHourPrior ? current.cancelledRate - oneHourPrior.cancelledRate : null;
  const trend = trendAssessment(oneHourChange, threeHourChange, oneHourCancellationChange);

  const delayedRatio = current.delayedRate / baseline.delayedRate;
  const cancelledRatio = current.cancelledRate / baseline.cancelledRate;
  const pressure = delayedRatio * 0.65 + cancelledRatio * 0.35;
  const faa = faaSummary(faaAirports);
  let grade = gradeForPressure(pressure);
  if (faa.criticalAdvisories >= 3 || faa.groundStops >= 2) grade = worseGrade(grade, "D");
  else if (faa.majorAdvisories + faa.criticalAdvisories >= 6) grade = worseGrade(grade, "C");

  const normalDelayed = Math.round(current.total * baseline.delayedRate);
  const normalCancelled = Math.round(current.total * baseline.cancelledRate);
  const disruptionRatio = current.disruptionRate / (baseline.delayedRate + baseline.cancelledRate);
  const disruptionDifferencePercent = Math.round((disruptionRatio - 1) * 100);
  const factors = [
    `${current.delayed.toLocaleString("en-US")} delayed versus about ${normalDelayed.toLocaleString("en-US")} at the BTS benchmark`,
    `${current.cancelled.toLocaleString("en-US")} cancelled versus about ${normalCancelled.toLocaleString("en-US")} at the BTS benchmark`,
  ];
  if (trend.direction !== "steady" && trend.direction !== "unknown") factors.push(trend.detail);
  if (faa.activeAdvisories > 0) factors.push(`${faa.activeAdvisories} active FAA airport ${faa.activeAdvisories === 1 ? "advisory" : "advisories"}`);

  return {
    grade,
    label: gradeLabels[grade],
    summary: disruptionDifferencePercent > 0
      ? `The current disruption rate is ${disruptionDifferencePercent}% above the BTS benchmark; cancellations are running at ${cancelledRatio.toFixed(1)}x normal.`
      : `The current disruption rate is ${Math.abs(disruptionDifferencePercent)}% below the BTS benchmark.`,
    factors,
    snapshot: {
      ...current,
      normalDelayed,
      normalCancelled,
      delayedDifferencePercent: Math.round((delayedRatio - 1) * 100),
      cancelledDifferencePercent: Math.round((cancelledRatio - 1) * 100),
    },
    today: {
      delayed: numberValue(dailyTotals?.delayed),
      cancelled: numberValue(dailyTotals?.cancelled),
    },
    trend,
    faa,
    baseline: {
      ...baseline,
      delayedPercent: roundedPercent(baseline.delayedRate),
      cancelledPercent: roundedPercent(baseline.cancelledRate),
    },
    source: "FlightAware MiseryMap and live cancellation statistics",
    sourceUrl: "https://www.flightaware.com/miserymap/",
    updatedAt: current.timestamp,
    fetchedAt,
  };
}

function closestPriorSnapshot(history, currentTime, targetMinutes) {
  const target = currentTime - targetMinutes * 60000;
  const tolerance = 35 * 60000;
  const candidates = history.filter((snapshot) => {
    const timestamp = new Date(snapshot.timestamp).getTime();
    return timestamp < currentTime - 20 * 60000 && Math.abs(timestamp - target) <= tolerance;
  });
  return candidates.sort((left, right) => (
    Math.abs(new Date(left.timestamp).getTime() - target) - Math.abs(new Date(right.timestamp).getTime() - target)
  ))[0] ?? null;
}

function trendAssessment(oneHourChange, threeHourChange, cancellationChange) {
  const oneHour = oneHourChange === null ? null : roundedPercent(oneHourChange);
  const threeHour = threeHourChange === null ? null : roundedPercent(threeHourChange);
  const cancellation = cancellationChange === null ? null : roundedPercent(cancellationChange);
  const primary = oneHour ?? (threeHour === null ? null : threeHour / 3);

  if (primary === null) {
    return { direction: "unknown", label: "Trend building", changePoints: null, windowMinutes: null, detail: "More live observations are needed to establish momentum." };
  }
  if (primary >= 4 || (cancellation ?? 0) >= 1.5) {
    return { direction: "worsening_fast", label: "Worsening rapidly", changePoints: primary, windowMinutes: 60, detail: `Disruptions rose ${primary.toFixed(1)} percentage points in about one hour.` };
  }
  if (primary >= 1.5) {
    return { direction: "worsening", label: "Worsening", changePoints: primary, windowMinutes: 60, detail: `Disruptions rose ${primary.toFixed(1)} percentage points in about one hour.` };
  }
  if (primary <= -4 || (cancellation ?? 0) <= -1.5) {
    return { direction: "improving_fast", label: "Improving rapidly", changePoints: primary, windowMinutes: 60, detail: `Disruptions fell ${Math.abs(primary).toFixed(1)} percentage points in about one hour.` };
  }
  if (primary <= -1.5) {
    return { direction: "improving", label: "Improving", changePoints: primary, windowMinutes: 60, detail: `Disruptions fell ${Math.abs(primary).toFixed(1)} percentage points in about one hour.` };
  }
  return { direction: "steady", label: "Holding steady", changePoints: primary, windowMinutes: 60, detail: "The disruption rate has been broadly stable over the past hour." };
}

function faaSummary(airports) {
  const active = (Array.isArray(airports) ? airports : []).filter((airport) => Array.isArray(airport?.events) && airport.events.length > 0);
  return {
    activeAdvisories: active.length,
    majorAdvisories: active.filter((airport) => airport.severity === "major").length,
    criticalAdvisories: active.filter((airport) => airport.severity === "critical").length,
    groundStops: active.flatMap((airport) => airport.events).filter((event) => event.type === "ground_stop").length,
  };
}

function gradeForPressure(pressure) {
  if (pressure <= 0.8) return "A";
  if (pressure <= 1.05) return "B";
  if (pressure <= 1.25) return "C";
  if (pressure <= 1.5) return "D";
  return "F";
}

function worseGrade(current, minimum) {
  return gradeRank[current] >= gradeRank[minimum] ? current : minimum;
}
