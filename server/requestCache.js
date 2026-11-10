export class ExpiringRequestCache {
  constructor({ ttlMs, maxEntries = 200, now = () => Date.now() }) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.now = now;
    this.entries = new Map();
  }

  async getOrLoad(key, loader) {
    const now = this.now();
    const existing = this.entries.get(key);
    if (existing?.value !== undefined && existing.expiresAt > now) {
      return existing.value;
    }
    if (existing?.promise) return existing.promise;

    const promise = Promise.resolve().then(loader);
    this.entries.set(key, { promise, expiresAt: now + this.ttlMs });
    try {
      const value = await promise;
      this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
      this.prune();
      return value;
    } catch (error) {
      if (this.entries.get(key)?.promise === promise) this.entries.delete(key);
      throw error;
    }
  }

  prune() {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (!entry.promise && entry.expiresAt <= now) this.entries.delete(key);
    }
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) return;
      this.entries.delete(oldestKey);
    }
  }
}
