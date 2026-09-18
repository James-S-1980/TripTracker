import crypto from "node:crypto";
import fs from "node:fs";
import http2 from "node:http2";
import path from "node:path";

const tokenPattern = /^[0-9a-f]{64,}$/i;

export function createPushService({ dataDir, logger = console, env = process.env, connect = http2.connect }) {
  const devicesPath = path.join(dataDir, "apns-devices.json");
  const devices = new Map();
  const teamId = env.TRIPTRACKER_APNS_TEAM_ID;
  const keyId = env.TRIPTRACKER_APNS_KEY_ID;
  const keyPath = env.TRIPTRACKER_APNS_KEY_PATH;
  const topic = env.TRIPTRACKER_APNS_BUNDLE_ID ?? "com.jamesschliesske.triptracker";
  const registrationSecret = env.TRIPTRACKER_PUSH_REGISTRATION_SECRET;
  let signingKey;
  let cachedJWT;
  let cachedAt = 0;

  if (fs.existsSync(devicesPath)) {
    try {
      for (const item of JSON.parse(fs.readFileSync(devicesPath, "utf8"))) {
        if (tokenPattern.test(item.token) && ["sandbox", "production"].includes(item.environment)) {
          devices.set(item.token, item);
        }
      }
    } catch (error) { logger.warn("Could not load APNs devices", error); }
  }

  function save() {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(devicesPath, JSON.stringify([...devices.values()], null, 2), { mode: 0o600 });
  }

  function configured() { return Boolean(teamId && keyId && keyPath && registrationSecret); }

  function authorized(secret) {
    if (!registrationSecret || typeof secret !== "string") return false;
    const supplied = Buffer.from(secret);
    const expected = Buffer.from(registrationSecret);
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
  }

  function register({ token, environment }, secret) {
    if (!configured()) return { status: 503, error: "Push notifications are not configured." };
    if (!authorized(secret)) return { status: 401, error: "Invalid push registration secret." };
    if (typeof token !== "string" || !tokenPattern.test(token) || !["sandbox", "production"].includes(environment)) {
      return { status: 400, error: "Invalid device token or APNs environment." };
    }
    devices.set(token.toLowerCase(), { token: token.toLowerCase(), environment, registeredAt: new Date().toISOString() });
    save();
    return { status: 200, ok: true };
  }

  function jwt() {
    if (cachedJWT && Date.now() - cachedAt < 50 * 60 * 1000) return cachedJWT;
    signingKey ??= crypto.createPrivateKey(fs.readFileSync(keyPath));
    const encoded = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const input = `${encoded({ alg: "ES256", kid: keyId })}.${encoded({ iss: teamId, iat: Math.floor(Date.now() / 1000) })}`;
    const signature = crypto.sign("sha256", Buffer.from(input), { key: signingKey, dsaEncoding: "ieee-p1363" });
    cachedJWT = `${input}.${signature.toString("base64url")}`;
    cachedAt = Date.now();
    return cachedJWT;
  }

  function send(device, event) {
    return new Promise((resolve, reject) => {
      const host = device.environment === "sandbox" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
      const authorization = `bearer ${jwt()}`;
      const session = connect(host);
      session.setTimeout?.(10000, () => session.destroy(new Error("APNs request timed out")));
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        session.close();
        if (error) reject(error); else resolve(value);
      };
      session.on("error", (error) => finish(error));
      const request = session.request({
        ":method": "POST", ":path": `/3/device/${device.token}`,
        authorization, "apns-topic": topic,
        "apns-push-type": "alert", "apns-priority": "10", "content-type": "application/json",
      });
      let status;
      let response = "";
      request.setEncoding("utf8");
      request.on("response", (headers) => { status = headers[":status"]; });
      request.on("data", (chunk) => { response += chunk; });
      request.on("error", (error) => finish(error));
      request.on("end", () => finish(null, { status, response }));
      request.end(JSON.stringify({
        aps: { alert: { title: event.title, body: event.body }, sound: "default" },
        eventId: event.id, flightNumber: event.flightNumber,
      }));
    });
  }

  async function broadcast(event) {
    if (!configured() || devices.size === 0) return;
    for (const device of devices.values()) {
      try {
        const result = await send(device, event);
        if (result.status === 410 || (result.status === 400 && /BadDeviceToken|DeviceTokenNotForTopic|Unregistered/.test(result.response))) {
          devices.delete(device.token);
          save();
        } else if (result.status !== 200) {
          logger.warn(`APNs rejected push: HTTP ${result.status} ${result.response}`);
        }
      } catch (error) { logger.warn("APNs push failed", error); }
    }
  }

  return { configured, register, broadcast };
}
