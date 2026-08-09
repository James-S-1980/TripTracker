import fs from "node:fs/promises";
import path from "node:path";
import tzlookup from "tz-lookup";

const sourceUrl = "https://davidmegginson.github.io/ourairports-data/airports.csv";
const jsonOutputPath = path.resolve("src/airportCatalog.generated.json");
const tsOutputPath = path.resolve("src/airportCatalog.generated.ts");

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

function airportTypeRank(type) {
  return type === "large_airport" ? 0 : type === "medium_airport" ? 1 : type === "small_airport" ? 2 : 3;
}

const response = await fetch(sourceUrl);
if (!response.ok) {
  throw new Error(`Failed to download OurAirports data: ${response.status}`);
}

const rows = parseCsv(await response.text());
const airports = rows
  .filter((row) => /^[A-Z0-9]{3}$/.test(row.iata_code))
  .filter((row) => row.type !== "closed")
  .sort((left, right) => (
    left.iata_code.localeCompare(right.iata_code) ||
    airportTypeRank(left.type) - airportTypeRank(right.type)
  ));

const deduped = new Map();
for (const row of airports) {
  if (deduped.has(row.iata_code)) continue;
  const lat = Number(row.latitude_deg);
  const lon = Number(row.longitude_deg);
  deduped.set(row.iata_code, {
    code: row.iata_code,
    name: row.name,
    city: row.municipality || row.iata_code,
    lat,
    lon,
    timeZone: Number.isFinite(lat) && Number.isFinite(lon) ? tzlookup(lat, lon) : "Etc/UTC",
  });
}

const airportList = [...deduped.values()];
const generated = `import catalog from "./airportCatalog.generated.json";
import type { Airport } from "./types";

// Generated from OurAirports data. Run \`npm run generate:airports\` to refresh.
export const generatedAirports: Airport[] = catalog as Airport[];
`;

await fs.writeFile(jsonOutputPath, `${JSON.stringify(airportList, null, 2)}\n`);
await fs.writeFile(tsOutputPath, generated);
console.log(`Wrote ${deduped.size} airports to ${jsonOutputPath}`);
