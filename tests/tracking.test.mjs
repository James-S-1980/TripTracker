import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const projectDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function availablePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  server.close();
  await once(server, "close");
  return port;
}

async function startServer(port, dataDir) {
  const env = { ...process.env, PORT: String(port), TRIPTRACKER_DATA_DIR: dataDir };
  delete env.TRIPTRACKER_SMTP_APP_PASSWORD;
  const child = spawn(process.execPath, ["server.js"], { cwd: projectDir, env, stdio: "ignore" });
  const baseUrl = `http://127.0.0.1:${port}/trip/api`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) throw new Error("TripTracker server stopped during test startup.");
    try {
      const response = await fetch(`${baseUrl}/tracked-flights`);
      if (response.ok) return { child, baseUrl };
    } catch {
      // The server has not started listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill();
  throw new Error("TripTracker server did not start in time.");
}

async function post(baseUrl, endpoint, body) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200);
  return response.json();
}

async function trackedFlights(baseUrl) {
  return (await trackedSnapshot(baseUrl)).flights;
}

async function trackedSnapshot(baseUrl) {
  const response = await fetch(`${baseUrl}/tracked-flights`);
  assert.equal(response.status, 200);
  return await response.json();
}

function flight(origin, destination) {
  return {
    id: `UA9999-${origin}-${destination}`,
    flightNumber: "UA 9999",
    date: "2026-09-19",
    origin: { code: origin },
    destination: { code: destination },
    status: "Scheduled",
    departureTime: "2026-09-19T14:00:00Z",
    arrivalTime: "2026-09-19T17:00:00Z",
    lastUpdated: "2026-09-19T13:00:00Z",
  };
}

test("deleted leg stays untracked across stale registrations and a restart", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "triptracker-test-"));
  const port = await availablePort();
  const first = flight("ORD", "LAX");
  const second = flight("DEN", "SFO");
  let server = await startServer(port, dataDir);
  t.after(async () => {
    server.child.kill();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const healthResponse = await fetch(`http://127.0.0.1:${port}/healthz`);
  assert.equal(healthResponse.status, 200);
  assert.equal((await healthResponse.json()).status, "healthy");

  await post(server.baseUrl, "/notifications/register-tracked", { flights: [first, second] });
  assert.equal((await trackedFlights(server.baseUrl)).length, 2);

  await post(server.baseUrl, "/notifications/untrack", { flight: first });
  assert.deepEqual((await trackedFlights(server.baseUrl)).map((item) => item.origin.code), ["DEN"]);

  await post(server.baseUrl, "/notifications/register-tracked", { flights: [first, second] });
  assert.deepEqual((await trackedFlights(server.baseUrl)).map((item) => item.origin.code), ["DEN"]);

  const update = await post(server.baseUrl, "/notifications/flight-event", {
    eventType: "updated",
    flight: first,
    changes: ["Gate changed"],
  });
  assert.equal(update.suppressed, true);

  server.child.kill();
  await once(server.child, "exit");
  server = await startServer(port, dataDir);
  await post(server.baseUrl, "/notifications/register-tracked", { flights: [first] });
  assert.deepEqual((await trackedFlights(server.baseUrl)).map((item) => item.origin.code), ["DEN"]);

  const staleSecond = { ...second, flightNumber: "UAL 9999", date: "2026-09-20" };
  const removal = await post(server.baseUrl, "/notifications/untrack", { flight: staleSecond });
  assert.equal(removal.removed, true);
  assert.equal(removal.removedCount, 1);
  assert.deepEqual(await trackedFlights(server.baseUrl), []);

  await post(server.baseUrl, "/notifications/register-tracked", { flights: [second] });
  assert.deepEqual(await trackedFlights(server.baseUrl), []);
});

test("expired landed leg is completed once and cannot be restored by stale browser state", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "triptracker-completed-test-"));
  const port = await availablePort();
  const completed = {
    ...flight("ORD", "BWI"),
    status: "Landed",
    landedAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
    arrivalTime: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
  };
  const expectedKey = "UA-9999-2026-09-19-ORD-BWI";
  let server = await startServer(port, dataDir);
  t.after(async () => {
    server.child.kill();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  await post(server.baseUrl, "/notifications/register-tracked", { flights: [completed] });
  const concluded = await trackedSnapshot(server.baseUrl);
  assert.deepEqual(concluded.flights, []);
  assert.equal(concluded.serverTrackedFlights, 0);
  assert.equal(concluded.untrackedFlightKeys.includes(expectedKey), true);

  await post(server.baseUrl, "/notifications/register-tracked", { flights: [completed] });
  assert.deepEqual(await trackedFlights(server.baseUrl), []);

  server.child.kill();
  await once(server.child, "exit");
  server = await startServer(port, dataDir);
  await post(server.baseUrl, "/notifications/register-tracked", { flights: [completed] });
  const restored = await trackedSnapshot(server.baseUrl);
  assert.deepEqual(restored.flights, []);
  assert.equal(restored.untrackedFlightKeys.includes(expectedKey), true);
});
