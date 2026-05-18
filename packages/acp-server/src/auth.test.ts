import { describe, expect, test } from "bun:test";
import { generateToken, resolveAuth, safeEqual } from "./auth.js";

describe("generateToken", () => {
  test("returns a base64url string", () => {
    const t = generateToken();
    expect(t.length).toBeGreaterThan(0);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test("each call yields a fresh token", () => {
    expect(generateToken()).not.toBe(generateToken());
  });
});

describe("safeEqual", () => {
  test("true for matching strings", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
  });
  test("false for mismatched lengths (no throw)", () => {
    expect(safeEqual("a", "ab")).toBe(false);
  });
  test("false for same-length mismatches", () => {
    expect(safeEqual("aaa", "aab")).toBe(false);
  });
});

describe("resolveAuth", () => {
  test("mode=none is a no-op verifier", () => {
    const r = resolveAuth(undefined);
    expect(r.config.mode).toBe("none");
    expect(r.verifyToken).toBeNull();
    expect(r.verifyUpgrade).toBeNull();
    expect(r.generatedToken).toBeUndefined();
  });

  test("mode=token with no token generates one and verifies it", async () => {
    const r = resolveAuth({ mode: "token" });
    expect(r.generatedToken).toBeTruthy();
    expect(await r.verifyToken!(r.generatedToken!)).toBe(true);
    expect(await r.verifyToken!("wrong")).toBe(false);
  });

  test("mode=token with an explicit token does NOT generate one", async () => {
    const r = resolveAuth({ mode: "token", token: "supersecret" });
    expect(r.generatedToken).toBeUndefined();
    expect(await r.verifyToken!("supersecret")).toBe(true);
    expect(await r.verifyToken!("notit")).toBe(false);
  });

  test("mode=token with custom verify wins over token generation", async () => {
    let calls = 0;
    const r = resolveAuth({
      mode: "token",
      verify: (t) => {
        calls += 1;
        return t === "yes";
      },
    });
    expect(r.generatedToken).toBeUndefined();
    expect(await r.verifyToken!("yes")).toBe(true);
    expect(calls).toBe(1);
  });

  test("mode=upgrade exposes verifyUpgrade and no token", () => {
    const verifyUpgrade = async () => ({ user: "alice" });
    const r = resolveAuth({ mode: "upgrade", verify: verifyUpgrade });
    expect(r.verifyUpgrade).toBe(verifyUpgrade);
    expect(r.verifyToken).toBeNull();
  });

  test("mode=both wires both verifiers and generates a token when only verifyUpgrade was provided", async () => {
    const r = resolveAuth({
      mode: "both",
      verifyUpgrade: () => null,
    });
    expect(r.generatedToken).toBeTruthy();
    expect(await r.verifyToken!(r.generatedToken!)).toBe(true);
    expect(r.verifyUpgrade).toBeDefined();
  });
});
