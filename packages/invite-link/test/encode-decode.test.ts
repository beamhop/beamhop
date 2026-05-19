import { describe, expect, it } from "bun:test";
import { CURRENT_VERSION, decode, encode, InviteEncodeError } from "../src/index.js";

describe("encode", () => {
  it("emits a fragment beginning with #", () => {
    const f = encode({ kind: "terminal", room: "abc", token: "tk" });
    expect(f.startsWith("#")).toBe(true);
  });

  it("includes version, kind, and room", () => {
    const f = encode({ kind: "agent", room: "room-1", token: "tk" });
    expect(f).toContain("v=1");
    expect(f).toContain("k=agent");
    expect(f).toContain("r=room-1");
  });

  it("omits password when not provided", () => {
    const f = encode({ kind: "terminal", room: "x", token: "tk" });
    expect(f).not.toContain("pw=");
  });

  it("includes password when provided (URL-encoded)", () => {
    const f = encode({
      kind: "terminal",
      room: "x",
      token: "tk",
      password: "hunter 2!",
    });
    expect(f).toContain("pw=hunter+2%21");
  });

  it("comma-joins relay urls", () => {
    const f = encode({
      kind: "terminal",
      room: "x",
      token: "tk",
      relayUrls: ["wss://a", "wss://b"],
    });
    expect(decodeURIComponent(f)).toContain("rl=wss://a,wss://b");
  });

  it("rejects unknown kinds", () => {
    expect(() =>
      encode({ kind: "weird" as never, room: "x", token: "tk" }),
    ).toThrow(InviteEncodeError);
  });

  it("rejects empty room", () => {
    expect(() => encode({ kind: "terminal", room: "", token: "tk" })).toThrow(
      InviteEncodeError,
    );
  });

  it("rejects missing token", () => {
    expect(() =>
      encode({ kind: "terminal", room: "x", token: "" }),
    ).toThrow(InviteEncodeError);
  });
});

describe("decode", () => {
  it("round-trips a basic invite", () => {
    const original = {
      kind: "terminal" as const,
      room: "ab12",
      token: "auth-tk",
      hostPeerId: "peer-xyz",
      password: "secret",
      relayUrls: ["wss://r.example.com"],
    };
    const f = encode(original);
    const result = decode(f);
    if (!result.ok) throw new Error(result.error);
    expect(result.invite.kind).toBe("terminal");
    expect(result.invite.room).toBe("ab12");
    expect(result.invite.token).toBe("auth-tk");
    expect(result.invite.hostPeerId).toBe("peer-xyz");
    expect(result.invite.password).toBe("secret");
    expect(result.invite.relayUrls).toEqual(["wss://r.example.com"]);
    expect(result.invite.version).toBe(CURRENT_VERSION);
  });

  it("omits hostPeerId when not provided", () => {
    const f = encode({ kind: "terminal", room: "x", token: "tk" });
    expect(f).not.toContain("hp=");
    const result = decode(f);
    if (!result.ok) throw new Error(result.error);
    expect(result.invite.hostPeerId).toBeUndefined();
  });

  it("accepts a full URL", () => {
    const f = encode({ kind: "agent", room: "r", token: "tk" });
    const result = decode(`https://app.example.com/join${f}`);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.invite.room).toBe("r");
  });

  it("accepts a URL object", () => {
    const f = encode({ kind: "agent", room: "r", token: "tk" });
    const url = new URL(`https://example.com/${f}`);
    const result = decode(url);
    expect(result.ok).toBe(true);
  });

  it("accepts a raw param string with no # prefix", () => {
    const result = decode("v=1&k=terminal&r=abc&t=tk");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.invite.room).toBe("abc");
  });

  it("fails on missing kind", () => {
    const result = decode("#v=1&r=abc&t=tk");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/unknown kind/);
  });

  it("fails on missing room", () => {
    const result = decode("#v=1&k=terminal&t=tk");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/room/);
  });

  it("fails on missing token", () => {
    const result = decode("#v=1&k=terminal&r=abc");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/token/);
  });

  it("fails on unsupported future version", () => {
    const result = decode("#v=99&k=terminal&r=x&t=tk");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/unsupported version/);
  });

  it("fails on no fragment", () => {
    const result = decode("https://example.com/no-fragment");
    expect(result.ok).toBe(false);
  });

  it("omits relayUrls when not present", () => {
    const result = decode("#v=1&k=terminal&r=x&t=tk");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.invite.relayUrls).toBeUndefined();
  });
});
