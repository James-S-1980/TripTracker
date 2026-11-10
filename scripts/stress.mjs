import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const projectDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const trackedFlightCount = Number(process.env.STRESS_TRACKED_FLIGHTS ?? 250);
const untrackedFlightCount = Number(process.env.STRESS_UNTRACKED_FLIGHTS ?? 2000);

async function availablePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  server.close();
  await once(server, "close");
  return port;
}

function percentile(sorted, value) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)];
}

function flight(index) {
  const number = String(1000 + index);
  return {
    id: `stress-UA-${number}-IAD-ORD`,
    flightNumber: `UA ${number}`,
    airlineCode: "UA",
    airlineName: "United Airlines",
    date: "2099-01-01",
    origin: { code: "IAD", city: "Dulles", timeZone: "America/New_York" },
    destination: { code: "ORD", city: "Chicago", timeZone: "America/Chicago" },
    status: "Scheduled",
    departureTime: "2099-01-01T15:00:00.000Z",
    arrivalTime: "2099-01-01T17:00:00.000Z",
    lastUpdated: "2099-01-01T12:00:00.000Z",
    alerts: [],
    dataSource: "Stress fixture",
  };
}

async function seedData(dataDir) {
  const records = Array.from({ length: trackedFlightCount }, (_, index) => {
    const item = flight(index);
    return {
      flight: item,
      airline: "UA",
      flightNumber: String(1000 + index),
      date: item.date,
      lastCheckedAt: item.lastUpdated,
    };
  });
  const untracked = Array.from(
    { length: untrackedFlightCount },
    (_, index) => `UA-${5000 + index}-2099-01-01-IAD-ORD`,
  );
  await fs.writeFile(path.join(dataDir, "server-tracked-flights.json"), JSON.stringify(records));
  await fs.writeFile(path.join(dataDir, "untracked-flights.json"), JSON.stringify(untracked));
  await fs.writeFile(path.join(dataDir, "notification-events.json"), "[]");
  return records.map((record) => record.flight);
}

async function waitForServer(child, baseUrl) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error("Stress-test server exited during startup.");
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Stress-test server did not become ready.");
}

async function benchmark({ name, requests, concurrency, request }) {
  const latencies = [];
  let nextRequest = 0;
  let errors = 0;
  let bytes = 0;
  const startedAt = performance.now();

  async function worker() {
    while (true) {
      const index = nextRequest;
      nextRequest += 1;
      if (index >= requests) return;
      const requestStartedAt = performance.now();
      try {
        const response = await request(index);
        const body = await response.arrayBuffer();
        bytes += body.byteLength;
        if (!response.ok) errors += 1;
      } catch {
        errors += 1;
      } finally {
        latencies.push(performance.now() - requestStartedAt);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const durationMs = performance.now() - startedAt;
  latencies.sort((left, right) => left - right);
  return {
    name,
    requests,
    concurrency,
    errors,
    requestsPerSecond: Number((requests / (durationMs / 1000)).toFixed(1)),
    durationMs: Number(durationMs.toFixed(1)),
    meanMs: Number((latencies.reduce((sum, value) => sum + value, 0) / latencies.length).toFixed(2)),
    p50Ms: Number(percentile(latencies, 0.5).toFixed(2)),
    p95Ms: Number(percentile(latencies, 0.95).toFixed(2)),
    p99Ms: Number(percentile(latencies, 0.99).toFixed(2)),
    responseMiB: Number((bytes / 1024 / 1024).toFixed(2)),
  };
}

function printResults(results) {
  console.table(results.map((result) => ({
    scenario: result.name,
    requests: result.requests,
    concurrency: result.concurrency,
    errors: result.errors,
    "req/s": result.requestsPerSecond,
    "mean ms": result.meanMs,
    "p95 ms": result.p95Ms,
    "p99 ms": result.p99Ms,
    "response MiB": result.responseMiB,
  })));
  console.log(`STRESS_RESULTS=${JSON.stringify(results)}`);
}

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "triptracker-stress-"));
const port = await availablePort();
const flights = await seedData(dataDir);
const env = { ...process.env, PORT: String(port), TRIPTRACKER_DATA_DIR: dataDir };
delete env.TRIPTRACKER_SMTP_APP_PASSWORD;
const child = spawn(process.execPath, ["server.js"], { cwd: projectDir, env, stdio: ["ignore", "pipe", "pipe"] });
const baseUrl = `http://127.0.0.1:${port}`;

try {
  await waitForServer(child, baseUrl);
  const registrationBody = JSON.stringify({ flights: flights.slice(0, 25) });
  const jsonHeaders = { "content-type": "application/json" };
  const results = [];
  results.push(await benchmark({
    name: "health endpoint",
    requests: 1500,
    concurrency: 50,
    request: () => fetch(`${baseUrl}/healthz`),
  }));
  results.push(await benchmark({
    name: "runway catalog",
    requests: 1000,
    concurrency: 40,
    request: () => fetch(`${baseUrl}/trip/api/runways?airports=IAD,ORD,BWI,DCA`),
  }));
  results.push(await benchmark({
    name: "tracked snapshot",
    requests: 500,
    concurrency: 30,
    request: () => fetch(`${baseUrl}/trip/api/tracked-flights`),
  }));
  const relevantKeys = flights.slice(0, 25).map((flight) => (
    `${flight.airlineCode}-${flight.flightNumber.replace(/\D/g, "")}-${flight.date}-${flight.origin.code}-${flight.destination.code}`
  ));
  results.push(await benchmark({
    name: "filtered snapshot",
    requests: 500,
    concurrency: 30,
    request: () => fetch(`${baseUrl}/trip/api/tracked-flights?${new URLSearchParams({ keys: relevantKeys.join(",") })}`),
  }));
  results.push(await benchmark({
    name: "idempotent registration",
    requests: 300,
    concurrency: 20,
    request: () => fetch(`${baseUrl}/trip/api/notifications/register-tracked`, {
      method: "POST",
      headers: jsonHeaders,
      body: registrationBody,
    }),
  }));
  printResults(results);
} finally {
  child.kill();
  await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 2000))]);
  await fs.rm(dataDir, { recursive: true, force: true });
}
