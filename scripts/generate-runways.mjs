import fs from "node:fs/promises";
import path from "node:path";

const airportsUrl = "https://davidmegginson.github.io/ourairports-data/airports.csv";
const runwaysUrl = "https://davidmegginson.github.io/ourairports-data/runways.csv";
const jsonOutputPath = path.resolve("src/runwayCatalog.generated.json");
const tsOutputPath = path.resolve("src/runwayCatalog.generated.ts");

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
}

function parseCsv(csv) {
  const [headerLine, ...lines] = csv.trim().split(/\r?\n/);
  const headers = parseCsvLine(headerLine);
  return lines.map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function numberOrUndefined(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function validCoordinate(lat, lon) {
  return lat !== undefined
    && lon !== undefined
    && lat >= -90
    && lat <= 90
    && lon >= -180
    && lon <= 180
    && !(lat === 0 && lon === 0);
}

function runwayEnd(row, prefix) {
  const lat = numberOrUndefined(row[`${prefix}_latitude_deg`]);
  const lon = numberOrUndefined(row[`${prefix}_longitude_deg`]);
  const headingDeg = numberOrUndefined(row[`${prefix}_heading_degT`]);
  const ident = row[`${prefix}_ident`]?.trim();
  if (!ident || !validCoordinate(lat, lon) || headingDeg === undefined) return null;
  return {
    ident,
    lat,
    lon,
    headingDeg,
    displacedThresholdFt: numberOrUndefined(row[`${prefix}_displaced_threshold_ft`]),
  };
}

const [airportResponse, runwayResponse] = await Promise.all([
  fetch(airportsUrl),
  fetch(runwaysUrl),
]);

if (!airportResponse.ok) {
  throw new Error(`Failed to download OurAirports airports: ${airportResponse.status}`);
}
if (!runwayResponse.ok) {
  throw new Error(`Failed to download OurAirports runways: ${runwayResponse.status}`);
}

const airportRows = parseCsv(await airportResponse.text());
const iataByAirportId = new Map(
  airportRows
    .filter((row) => /^[A-Z0-9]{3}$/.test(row.iata_code) && row.type !== "closed")
    .map((row) => [row.id, row.iata_code]),
);

const runwayRows = parseCsv(await runwayResponse.text());
const runwaysByAirport = new Map();

for (const row of runwayRows) {
  if (row.closed === "1") continue;
  const airportCode = iataByAirportId.get(row.airport_ref);
  if (!airportCode) continue;

  const le = runwayEnd(row, "le");
  const he = runwayEnd(row, "he");
  if (!le && !he) continue;

  const runway = {
    id: String(row.id),
    airportCode,
    ident: [le?.ident, he?.ident].filter(Boolean).join("/"),
    lengthFt: numberOrUndefined(row.length_ft),
    widthFt: numberOrUndefined(row.width_ft),
    surface: row.surface || undefined,
    lighted: row.lighted === "1",
    le,
    he,
  };

  const existing = runwaysByAirport.get(airportCode) ?? [];
  existing.push(runway);
  runwaysByAirport.set(airportCode, existing);
}

const catalog = Object.fromEntries(
  [...runwaysByAirport.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([airportCode, runways]) => [
      airportCode,
      runways.sort((left, right) => (right.lengthFt ?? 0) - (left.lengthFt ?? 0) || left.ident.localeCompare(right.ident)),
    ]),
);

const generated = `import catalog from "./runwayCatalog.generated.json";
import type { RunwayCatalog } from "./types";

// Generated from OurAirports runway data. Run \`npm run generate:runways\` to refresh.
export const generatedRunways: RunwayCatalog = catalog as RunwayCatalog;
`;

await fs.writeFile(jsonOutputPath, `${JSON.stringify(catalog, null, 2)}\n`);
await fs.writeFile(tsOutputPath, generated);
console.log(`Wrote runway data for ${runwaysByAirport.size} airports to ${jsonOutputPath}`);
