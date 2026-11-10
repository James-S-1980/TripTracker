import assert from "node:assert/strict";
import { test } from "node:test";
import { ExpiringRequestCache } from "../server/requestCache.js";

test("coalesces concurrent requests and reuses a fresh result", async () => {
  let loads = 0;
  const cache = new ExpiringRequestCache({ ttlMs: 1000 });
  const loader = async () => {
    loads += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { value: loads };
  };

  const results = await Promise.all(Array.from({ length: 20 }, () => cache.getOrLoad("UA-123", loader)));
  assert.equal(loads, 1);
  assert.equal(results.every((result) => result.value === 1), true);
  assert.deepEqual(await cache.getOrLoad("UA-123", loader), { value: 1 });
  assert.equal(loads, 1);
});

test("expires entries and retries rejected loaders", async () => {
  let now = 0;
  let loads = 0;
  const cache = new ExpiringRequestCache({ ttlMs: 100, now: () => now });

  await assert.rejects(cache.getOrLoad("failed", async () => {
    throw new Error("temporary failure");
  }));
  assert.equal(await cache.getOrLoad("failed", async () => "recovered"), "recovered");

  const loader = async () => ++loads;
  assert.equal(await cache.getOrLoad("expiring", loader), 1);
  now = 99;
  assert.equal(await cache.getOrLoad("expiring", loader), 1);
  now = 101;
  assert.equal(await cache.getOrLoad("expiring", loader), 2);
});
