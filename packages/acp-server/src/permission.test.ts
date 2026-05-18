import { describe, expect, test } from "bun:test";
import { PendingPermissions, resolvePermission } from "./permission.js";
import { createConsoleLogger } from "./logger.js";

const silentLogger = () => createConsoleLogger({ level: "error", sink: () => {} });

describe("resolvePermission", () => {
  test("defaults: forward=true, timeoutMs=60_000", () => {
    const r = resolvePermission(undefined);
    expect(r.forward).toBe(true);
    expect(r.timeoutMs).toBe(60_000);
    expect(r.policy).toBeUndefined();
  });

  test("explicit overrides win", () => {
    const policy = () => "allow" as const;
    const r = resolvePermission({ forward: false, timeoutMs: 100, policy });
    expect(r.forward).toBe(false);
    expect(r.timeoutMs).toBe(100);
    expect(r.policy).toBe(policy);
  });
});

describe("PendingPermissions", () => {
  test("open() returns an id and a promise that resolves with the decision", async () => {
    const pp = new PendingPermissions(silentLogger());
    const { id, promise } = pp.open(1000);
    expect(typeof id).toBe("string");
    setTimeout(() => pp.resolve(id, "allow_once"), 5);
    expect(await promise).toBe("allow_once");
  });

  test("resolves to reject_once on timeout without throwing", async () => {
    const pp = new PendingPermissions(silentLogger());
    const { promise } = pp.open(10);
    expect(await promise).toBe("reject_once");
  });

  test("resolve() on unknown id returns false and does not throw", () => {
    const pp = new PendingPermissions(silentLogger());
    expect(pp.resolve("nope", "allow_once")).toBe(false);
  });

  test("rejectAll() rejects every outstanding promise", async () => {
    const pp = new PendingPermissions(silentLogger());
    const a = pp.open(60_000);
    const b = pp.open(60_000);
    pp.rejectAll("shutdown");
    await expect(a.promise).rejects.toThrow(/shutdown/);
    await expect(b.promise).rejects.toThrow(/shutdown/);
  });
});
