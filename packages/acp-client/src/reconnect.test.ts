import { describe, expect, test } from "bun:test";
import { makeReconnect } from "./reconnect.js";

describe("makeReconnect", () => {
  test("returns null immediately when disabled", () => {
    const p = makeReconnect({ enabled: false });
    expect(p.enabled).toBe(false);
    expect(p.next()).toBeNull();
  });

  test("returns null after maxAttempts exhausted", () => {
    const p = makeReconnect({ maxAttempts: 3, initialDelayMs: 100, jitter: 0 });
    expect(p.next()).not.toBeNull();
    expect(p.next()).not.toBeNull();
    expect(p.next()).not.toBeNull();
    expect(p.next()).toBeNull();
  });

  test("backoff doubles up to maxDelayMs", () => {
    const p = makeReconnect({
      initialDelayMs: 100,
      maxDelayMs: 400,
      maxAttempts: 10,
      jitter: 0,
    });
    expect(p.next()).toBe(100);
    expect(p.next()).toBe(200);
    expect(p.next()).toBe(400);
    expect(p.next()).toBe(400);
  });

  test("jitter perturbs the delay symmetrically around the base", () => {
    const p = makeReconnect({
      initialDelayMs: 1000,
      maxDelayMs: 10_000,
      maxAttempts: 100,
      jitter: 0.5,
    });
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 50; i++) {
      const r = makeReconnect({ initialDelayMs: 1000, maxDelayMs: 10_000, jitter: 0.5 }).next()!;
      min = Math.min(min, r);
      max = Math.max(max, r);
    }
    expect(min).toBeGreaterThanOrEqual(500);
    expect(max).toBeLessThanOrEqual(1500);
    // Sanity: with 50 samples and ±50% jitter, range should be non-trivial.
    expect(max - min).toBeGreaterThan(50);
    // unused but exercises the closure
    expect(p.next()).toBeGreaterThan(0);
  });

  test("never returns negative delays even with extreme negative jitter", () => {
    // With initialDelayMs=10 and jitter=0.99, the formula could compute a
    // negative number; the implementation clamps to 0.
    for (let i = 0; i < 100; i++) {
      const r = makeReconnect({ initialDelayMs: 10, jitter: 0.99 }).next();
      expect(r).not.toBeNull();
      expect(r!).toBeGreaterThanOrEqual(0);
    }
  });

  test("reset() lets the policy be reused", () => {
    const p = makeReconnect({ maxAttempts: 2, initialDelayMs: 10, jitter: 0 });
    expect(p.next()).not.toBeNull();
    expect(p.next()).not.toBeNull();
    expect(p.next()).toBeNull();
    p.reset();
    expect(p.next()).not.toBeNull();
  });
});
