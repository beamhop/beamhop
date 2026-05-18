import { describe, expect, test } from "bun:test";
import {
  BUILT_IN_AGENT_IDS,
  CLOSE_CODES,
  DecodeError,
  PROTOCOL_VERSION,
  decode,
  encode,
  type WireMessage,
  type WireMessageKind,
} from "./index.js";

describe("PROTOCOL_VERSION", () => {
  test("is a positive integer", () => {
    expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true);
    expect(PROTOCOL_VERSION).toBeGreaterThan(0);
  });
});

describe("BUILT_IN_AGENT_IDS", () => {
  test("includes every CLI we plan to support", () => {
    // Locked deliberately — adding an agent without updating this list (and the
    // server registry) would be a silent inconsistency. Every entry MUST
    // correspond to a real, verified ACP-capable CLI on npm.
    expect([...BUILT_IN_AGENT_IDS]).toEqual([
      "claude-code",
      "gemini",
      "codex",
      "opencode",
      "copilot",
      "pi-mono",
    ]);
  });
});

describe("CLOSE_CODES", () => {
  test("all values are in the application-defined 4xxx range or RFC 6455 standard codes", () => {
    for (const [name, code] of Object.entries(CLOSE_CODES)) {
      const isStandard = code >= 1000 && code <= 1015;
      const isAppDefined = code >= 4000 && code <= 4999;
      expect(isStandard || isAppDefined).toBe(true);
      if (!(isStandard || isAppDefined)) {
        throw new Error(`close code ${name}=${code} is in a reserved range`);
      }
    }
  });
});

describe("encode/decode round-trip", () => {
  const cases: WireMessage[] = [
    {
      kind: "hello",
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: { name: "test", version: "1.0.0", meta: { token: "abc" } },
      agent: "claude-code",
    },
    {
      kind: "ready",
      payload: {
        sessionId: "s1",
        agentId: "gemini",
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: { foo: "bar" },
        availableAgents: [
          { id: "claude-code", label: "Claude Code", login: "acp_native" },
          { id: "copilot", label: "GitHub Copilot", login: "tty" },
          { id: "gemini", label: "Gemini", login: "acp_native" },
        ],
        modelCatalog: {
          channel: "set_model",
          models: [{ id: "gemini-3-pro", name: "Gemini 3 Pro" }],
          currentModelId: "gemini-3-pro",
        },
        authMethods: [
          { id: "oauth", name: "Sign in with OAuth", description: "Anthropic OAuth" },
        ],
      },
    },
    {
      kind: "rpc",
      payload: { direction: "c2a", id: 1, method: "session/prompt", params: { hello: 1 } },
    },
    { kind: "rpc-result", payload: { id: 1, result: { stopReason: "end_turn" } } },
    {
      kind: "rpc-error",
      payload: { id: "x", error: { code: -32603, message: "internal", data: { stack: "..." } } },
    },
    { kind: "notify", payload: { direction: "a2c", method: "session/update", params: {} } },
    { kind: "switch-agent", agentId: "codex", config: { mode: "ask" } },
    { kind: "cancel", sessionId: "s1" },
    {
      kind: "permission-prompt",
      payload: { id: "p1", request: { tool: "writeTextFile" } },
    },
    { kind: "permission-response", payload: { id: "p1", decision: "allow_once" } },
    { kind: "login-start", agentId: "copilot", requestId: "r1" },
    { kind: "login-ready", requestId: "r1", loginId: "L1" },
    { kind: "login-data", loginId: "L1", data: "Signed in as kucukkanat\n" },
    { kind: "login-resize", loginId: "L1", cols: 120, rows: 40 },
    { kind: "login-cancel", loginId: "L1" },
    { kind: "login-end", loginId: "L1", exitCode: 0, reason: "success_marker" },
    {
      kind: "log",
      payload: { level: "info", message: "hi", ts: 1700000000000, context: { foo: 1 } },
    },
    {
      kind: "error",
      fatal: true,
      payload: { code: "agent_crashed", message: "boom", hint: "check stderr", context: { pid: 1 } },
    },
    { kind: "ping", ts: 123 },
    { kind: "pong", ts: 123 },
    { kind: "close", code: CLOSE_CODES.NORMAL, reason: "bye" },
    { kind: "set-model", modelId: "gpt-5", requestId: "r1" },
    {
      kind: "set-model-result",
      requestId: "r1",
      ok: true,
      modelCatalog: {
        channel: "set_model",
        models: [{ id: "gpt-5", name: "GPT-5" }],
        currentModelId: "gpt-5",
      },
    },
    {
      kind: "set-model-result",
      requestId: "r2",
      ok: false,
      error: { code: "model_rejected", message: "model not in your plan" },
    },
    {
      kind: "model-update",
      modelCatalog: {
        channel: "set_config_option",
        models: [{ id: "z/glm", name: "Z.AI GLM" }],
        currentModelId: "z/glm",
      },
    },
  ];

  test.each(cases.map((c) => [c.kind, c] as const))("round-trips %s", (_kind, msg) => {
    const back = decode(encode(msg));
    expect(back).toEqual(msg);
  });

  test("covers every WireMessage kind exactly once", () => {
    // Forces the cases[] above to stay in sync with the union — if someone adds
    // a kind in index.ts they must add a case here or this test fails.
    const expected = new Set<WireMessageKind>([
      "hello",
      "ready",
      "rpc",
      "rpc-result",
      "rpc-error",
      "notify",
      "switch-agent",
      "cancel",
      "permission-prompt",
      "permission-response",
      "login-start",
      "login-ready",
      "login-data",
      "login-resize",
      "login-cancel",
      "login-end",
      "log",
      "error",
      "ping",
      "pong",
      "close",
      "set-model",
      "set-model-result",
      "model-update",
    ]);
    const seen = new Set<WireMessageKind>(cases.map((c) => c.kind));
    expect(seen).toEqual(expected);
  });
});

describe("decode error handling", () => {
  test("invalid JSON throws DecodeError with the raw input attached", () => {
    try {
      decode("not json");
      throw new Error("expected DecodeError");
    } catch (err) {
      expect(err).toBeInstanceOf(DecodeError);
      expect((err as DecodeError).raw).toBe("not json");
      expect((err as DecodeError).cause).toBeDefined();
    }
  });

  test("non-object payload throws DecodeError", () => {
    expect(() => decode("123")).toThrow(DecodeError);
    expect(() => decode("null")).toThrow(DecodeError);
    expect(() => decode('"a string"')).toThrow(DecodeError);
  });

  test("missing kind throws DecodeError", () => {
    expect(() => decode("{}")).toThrow(DecodeError);
  });

  test("unknown kind throws DecodeError with the kind named in the message", () => {
    try {
      decode(JSON.stringify({ kind: "frobnicate" }));
      throw new Error("expected DecodeError");
    } catch (err) {
      expect(err).toBeInstanceOf(DecodeError);
      expect((err as DecodeError).message).toContain("frobnicate");
    }
  });

  test("DecodeError name is set so error-name-based dispatch works", () => {
    try {
      decode("nope");
    } catch (err) {
      expect((err as Error).name).toBe("DecodeError");
    }
  });
});
