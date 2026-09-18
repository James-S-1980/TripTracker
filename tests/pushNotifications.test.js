import assert from "node:assert/strict";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createPushService } from "../pushNotifications.js";

const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "triptracker-push-"));
const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const keyPath = path.join(temporaryDir, "AuthKey.p8");
fs.writeFileSync(keyPath, privateKey.export({ format: "pem", type: "pkcs8" }));

function service(connect) {
  return createPushService({
    dataDir: temporaryDir, connect,
    env: {
      TRIPTRACKER_APNS_TEAM_ID: "TESTTEAM",
      TRIPTRACKER_APNS_KEY_ID: "TESTKEY",
      TRIPTRACKER_APNS_KEY_PATH: keyPath,
      TRIPTRACKER_APNS_BUNDLE_ID: "com.example.triptracker",
      TRIPTRACKER_PUSH_REGISTRATION_SECRET: "a-long-pairing-secret",
    },
  });
}

test("registration requires the secret and a valid token", () => {
  const push = service(() => { throw Error("should not connect"); });
  const device = { token: "a".repeat(64), environment: "sandbox" };
  assert.equal(push.register(device, "wrong").status, 401);
  assert.equal(push.register({ token: "bad", environment: "sandbox" }, "a-long-pairing-secret").status, 400);
  assert.equal(push.register(device, "a-long-pairing-secret").status, 200);
});

test("APNs request carries a signed ES256 token and flight alert", async () => {
  const requests = [];
  const connect = (host) => {
    const session = new EventEmitter();
    session.close = () => {};
    session.request = (headers) => {
      const request = new EventEmitter();
      request.setEncoding = () => {};
      request.end = (body) => {
        requests.push({ host, headers, body: JSON.parse(body) });
        queueMicrotask(() => {
          request.emit("response", { ":status": 200 });
          request.emit("end");
        });
      };
      return request;
    };
    return session;
  };
  const push = service(connect);
  const token = "b".repeat(64);
  assert.equal(push.register({ token, environment: "sandbox" }, "a-long-pairing-secret").status, 200);
  await push.broadcast({ id: "event-1", title: "Flight updated", body: "Gate changed", flightNumber: "AA123" });
  const request = requests.at(-1);
  assert.equal(request.host, "https://api.sandbox.push.apple.com");
  assert.equal(request.headers[":path"], `/3/device/${token}`);
  assert.equal(request.headers["apns-topic"], "com.example.triptracker");
  assert.equal(request.body.aps.alert.body, "Gate changed");
  assert.equal(request.body.eventId, "event-1");
  const jwt = request.headers.authorization.slice("bearer ".length);
  const [header, payload, signature] = jwt.split(".");
  assert.equal(JSON.parse(Buffer.from(header, "base64url")).alg, "ES256");
  assert.equal(JSON.parse(Buffer.from(payload, "base64url")).iss, "TESTTEAM");
  assert.ok(crypto.verify("sha256", Buffer.from(`${header}.${payload}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url")));
});
