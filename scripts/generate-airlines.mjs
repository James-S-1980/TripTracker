import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const sourceUrl = "https://raw.githubusercontent.com/jpatokal/openflights/master/data/airlines.dat";

const modernOverrides = [
  ["AC", "ACA", "Air Canada", "AIR CANADA", "Canada"],
  ["AM", "AMX", "Aeromexico", "AEROMEXICO", "Mexico"],
  ["AV", "AVA", "Avianca", "AVIANCA", "Colombia"],
  ["BA", "BAW", "British Airways", "SPEEDBIRD", "United Kingdom"],
  ["CX", "CPA", "Cathay Pacific", "CATHAY", "Hong Kong"],
  ["EK", "UAE", "Emirates", "EMIRATES", "United Arab Emirates"],
  ["EY", "ETD", "Etihad Airways", "ETIHAD", "United Arab Emirates"],
  ["FI", "ICE", "Icelandair", "ICEAIR", "Iceland"],
  ["IB", "IBE", "Iberia", "IBERIA", "Spain"],
  ["JL", "JAL", "Japan Airlines", "JAPANAIR", "Japan"],
  ["KE", "KAL", "Korean Air", "KOREANAIR", "South Korea"],
  ["KL", "KLM", "KLM Royal Dutch Airlines", "KLM", "Netherlands"],
  ["LH", "DLH", "Lufthansa", "LUFTHANSA", "Germany"],
  ["LX", "SWR", "Swiss International Air Lines", "SWISS", "Switzerland"],
  ["NH", "ANA", "All Nippon Airways", "ALL NIPPON", "Japan"],
  ["QF", "QFA", "Qantas", "QANTAS", "Australia"],
  ["QR", "QTR", "Qatar Airways", "QATARI", "Qatar"],
  ["SQ", "SIA", "Singapore Airlines", "SINGAPORE", "Singapore"],
  ["TK", "THY", "Turkish Airlines", "TURKISH", "Turkey"],
  ["VS", "VIR", "Virgin Atlantic", "VIRGIN", "United Kingdom"],
  ["WS", "WJA", "WestJet", "WESTJET", "Canada"],
];

const preferredNames = new Map([
  ["AC", "Air Canada"],
  ["AF", "Air France"],
  ["AZ", "ITA Airways"],
  ["BA", "British Airways"],
  ["CX", "Cathay Pacific"],
  ["EK", "Emirates"],
  ["EY", "Etihad Airways"],
  ["JL", "Japan Airlines"],
  ["KL", "KLM Royal Dutch Airlines"],
  ["LH", "Lufthansa"],
  ["LX", "Swiss International Air Lines"],
  ["NH", "All Nippon Airways"],
  ["QF", "Qantas"],
  ["QR", "Qatar Airways"],
  ["SK", "SAS Scandinavian Airlines"],
  ["SQ", "Singapore Airlines"],
  ["TK", "Turkish Airlines"],
  ["VS", "Virgin Atlantic"],
]);

function download(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download ${url}: ${response.statusCode}`));
        response.resume();
        return;
      }
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => resolve(body));
    }).on("error", reject);
  });
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === "\"") {
      if (quoted && line[index + 1] === "\"") {
        current += "\"";
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(cleanValue(current));
      current = "";
    } else {
      current += character;
    }
  }

  values.push(cleanValue(current));
  return values;
}

function cleanValue(value) {
  const trimmed = value.trim();
  return trimmed === "\\N" ? "" : trimmed;
}

function validIata(value) {
  return /^[A-Z0-9]{2}$/.test(value);
}

function validIcao(value) {
  return /^[A-Z0-9]{3}$/.test(value);
}

function logoUrl(code) {
  return `https://www.gstatic.com/flights/airline_logos/70px/${code}.png`;
}

function upsert(catalog, [iata, icao, name, callsign, country]) {
  const existing = catalog.get(iata);
  catalog.set(iata, {
    code: iata,
    icao,
    name: preferredNames.get(iata) ?? name,
    callsign,
    country,
    aliases: Array.from(new Set([existing?.icao, existing?.callsign, icao, callsign, ...(existing?.aliases ?? [])].filter(Boolean))),
    logoUrl: logoUrl(iata),
  });
}

const source = await download(sourceUrl);
const catalog = new Map();

for (const line of source.split(/\r?\n/)) {
  if (!line.trim()) continue;
  const [, name, alias, iata, icao, callsign, country, active] = parseCsvLine(line);
  if (active !== "Y" || !validIata(iata)) continue;
  if (icao && !validIcao(icao)) continue;
  const aliases = [alias, icao, callsign].filter(Boolean);
  catalog.set(iata, {
    code: iata,
    icao,
    name: preferredNames.get(iata) ?? name,
    callsign,
    country,
    aliases: Array.from(new Set(aliases)),
    logoUrl: logoUrl(iata),
  });
}

for (const override of modernOverrides) {
  upsert(catalog, override);
}

const airlines = Array.from(catalog.values())
  .sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code));

const jsonPath = path.join(root, "src", "airlineCatalog.generated.json");
const tsPath = path.join(root, "src", "airlineCatalog.generated.ts");
fs.writeFileSync(jsonPath, `${JSON.stringify(airlines, null, 2)}\n`);
fs.writeFileSync(tsPath, `import type { Airline } from "./airlines";\n\nexport const generatedAirlines = ${JSON.stringify(airlines, null, 2)} satisfies Airline[];\n`);

console.log(`Generated ${airlines.length} airlines.`);
