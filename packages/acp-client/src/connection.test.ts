import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  CLOSE_CODES,
  PROTOCOL_VERSION,
  decode,
  encode,
  type WireMessage,
} from "@beamhop/acp-protocol";
import { MissingHandlerError, connectAcp, type AcpSession } from "./connection.js";
import { MockWebSocket } from "./fake-ws.js";

// Default handlers — minimal, just satisfies the `onPermissionRequest` contract.
const baseHandlers = () => ({
  onPermissionRequest: async () => "allow_once" as const,
});

const baseOpts = () => ({
  url: "ws://test/acp",
  auth: { mode: "token" as const, token: "tok" },
  agent: "claude-code" as const,
  clientInfo: { name: "test", version: "0.0.0" },
  handlers: baseHandlers(),
  // Disable reconnect by default so tests don't see retry side-effects.
  reconnect: { enabled: false },
  WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
});

async function openSession(): Promise<{ session: AcpSession; ws: MockWebSocket }> {
  const promise = connectAcp(baseOpts());
  // The constructor runs synchronously inside connectAcp -> Session.openSocket.
  const ws = MockWebSocket.last!;
  expect(ws).not.toBeNull();
  // Drive the open handshake and the ready frame the server would send.
  ws.fakeOpen();
  ws.fakeServerFrame(
    encode({
      kind: "ready",
      payload: {
        sessionId: "s1",
        agentId: "claude-code",
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: { foo: true },
        availableAgents: [
          { id: "claude-code", label: "Claude Code" },
          { id: "gemini", label: "Gemini" },
        ],
        modelCatalog: null,
      },
    }),
  );
  const session = await promise;
  return { session, ws };
}

beforeEach(() => MockWebSocket.reset());
afterEach(() => MockWebSocket.reset());

describe("connectAcp DX guarantees", () => {
  test("throws synchronously when onPermissionRequest is missing", async () => {
    const opts = baseOpts();
    // Force-cast to drop the required handler — simulates a JS consumer mistake.
    (opts as unknown as { handlers: Record<string, unknown> }).handlers = {};
    await expect(connectAcp(opts)).rejects.toBeInstanceOf(MissingHandlerError);
  });

  test("throws when no WebSocket implementation is available", async () => {
    const opts = baseOpts();
    opts.WebSocketImpl = undefined as unknown as typeof WebSocket;
    // Stash and clear the global so the fallback path activates.
    const orig = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
    delete (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
    try {
      await expect(connectAcp(opts)).rejects.toThrow(/WebSocket/i);
    } finally {
      if (orig) (globalThis as { WebSocket?: typeof WebSocket }).WebSocket = orig;
    }
  });
});

describe("handshake", () => {
  test("sends a hello frame on open with token in clientInfo.meta", async () => {
    const { ws } = await openSession();
    expect(ws.sent.length).toBeGreaterThanOrEqual(1);
    const first = decode(ws.sent[0]!) as Extract<WireMessage, { kind: "hello" }>;
    expect(first.kind).toBe("hello");
    expect(first.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(first.agent).toBe("claude-code");
    expect(first.clientInfo.meta?.token).toBe("tok");
  });

  test("resolves connectAcp only after the ready frame arrives", async () => {
    const promise = connectAcp(baseOpts());
    const ws = MockWebSocket.last!;
    ws.fakeOpen();
    let settled = false;
    promise.then(() => (settled = true));
    await new Promise((r) => setTimeout(r, 5));
    expect(settled).toBe(false);
    ws.fakeServerFrame(
      encode({
        kind: "ready",
        payload: {
          sessionId: "s2",
          agentId: "claude-code",
          protocolVersion: PROTOCOL_VERSION,
          availableAgents: [],
          modelCatalog: null,
        },
      }),
    );
    const session = await promise;
    expect(session.sessionId).toBe("s2");
  });
});

describe("prompt() async iterable", () => {
  test("streams updates and resolves with the final result", async () => {
    const { session, ws } = await openSession();
    const stream = session.prompt("hi");

    // Find the prompt id the client sent.
    const rpcFrame = ws.sent.find((s) => {
      const m = decode(s);
      return m.kind === "rpc" && m.payload.method === "session/prompt";
    })!;
    const rpcId = (decode(rpcFrame) as Extract<WireMessage, { kind: "rpc" }>).payload.id;

    // Server pushes two notifications + a result.
    ws.fakeServerFrame(
      encode({
        kind: "notify",
        payload: { direction: "a2c", method: "session/update", params: { chunk: 1 } },
      }),
    );
    ws.fakeServerFrame(
      encode({
        kind: "notify",
        payload: { direction: "a2c", method: "session/update", params: { chunk: 2 } },
      }),
    );
    ws.fakeServerFrame(
      encode({
        kind: "rpc-result",
        payload: { id: rpcId, result: { stopReason: "end_turn" } },
      }),
    );

    const updates: unknown[] = [];
    for await (const u of stream) updates.push(u);
    expect(updates).toEqual([{ chunk: 1 }, { chunk: 2 }]);
    expect(await stream.result).toEqual({ stopReason: "end_turn" });
  });

  test("rejects a second concurrent prompt with session_already_active", async () => {
    const { session, ws } = await openSession();
    const first = session.prompt("first");
    // Consume errors so they don't surface as unhandled rejections in the test harness.
    first.result.catch(() => {});
    const second = session.prompt("second");
    await expect(second.result).rejects.toMatchObject({ code: "session_already_active" });

    // Drain first so the test exits clean.
    const rpcFrame = ws.sent.find((s) => decode(s).kind === "rpc")!;
    const rpcId = (decode(rpcFrame) as Extract<WireMessage, { kind: "rpc" }>).payload.id;
    ws.fakeServerFrame(
      encode({ kind: "rpc-result", payload: { id: rpcId, result: { stopReason: "end_turn" } } }),
    );
    await first.result;
  });

  test("sends a cancel frame when the prompt AbortSignal fires", async () => {
    const { session, ws } = await openSession();
    const ctrl = new AbortController();
    const stream = session.prompt("test", { signal: ctrl.signal });
    stream.result.catch(() => {});
    ctrl.abort();
    // Allow the abort listener microtask to run.
    await new Promise((r) => setTimeout(r, 0));
    const sentCancel = ws.sent.some((s) => decode(s).kind === "cancel");
    expect(sentCancel).toBe(true);
  });
});

describe("server-initiated RPC (a2c)", () => {
  test("routes fs/read_text_file to handlers.readTextFile and replies", async () => {
    const handlers = {
      onPermissionRequest: async () => "allow_once" as const,
      readTextFile: async ({ path }: { path: string }) => ({ content: `contents:${path}` }),
    };
    const promise = connectAcp({ ...baseOpts(), handlers });
    const ws = MockWebSocket.last!;
    ws.fakeOpen();
    ws.fakeServerFrame(
      encode({
        kind: "ready",
        payload: { sessionId: "s", agentId: "claude-code", protocolVersion: PROTOCOL_VERSION, availableAgents: [], modelCatalog: null },
      }),
    );
    await promise;

    ws.fakeServerFrame(
      encode({
        kind: "rpc",
        payload: { direction: "a2c", id: "r1", method: "fs/read_text_file", params: { path: "/a" } },
      }),
    );

    // Wait for the reply to be sent.
    await new Promise((r) => setTimeout(r, 5));
    const reply = ws.sent.find((s) => {
      const m = decode(s);
      return (m.kind === "rpc-result" || m.kind === "rpc-error") && m.payload.id === "r1";
    })!;
    const parsed = decode(reply) as Extract<WireMessage, { kind: "rpc-result" }>;
    expect(parsed.kind).toBe("rpc-result");
    expect(parsed.payload.result).toEqual({ content: "contents:/a" });
  });

  test("replies with rpc-error and emits a non-fatal error when a handler is missing", async () => {
    const { ws, session } = await openSession();
    const errors: unknown[] = [];
    session.on("error", (e) => errors.push(e));

    ws.fakeServerFrame(
      encode({
        kind: "rpc",
        payload: {
          direction: "a2c",
          id: "r2",
          method: "fs/write_text_file",
          params: { path: "/x", content: "y" },
        },
      }),
    );
    await new Promise((r) => setTimeout(r, 5));

    const reply = ws.sent.find((s) => {
      const m = decode(s);
      return m.kind === "rpc-error" && m.payload.id === "r2";
    });
    expect(reply).toBeDefined();
    expect(errors).toHaveLength(1);
    expect((errors[0] as { code: string }).code).toBe("not_implemented");
  });
});

describe("permission prompt", () => {
  test("calls onPermissionRequest and replies with the decision", async () => {
    let received: unknown = null;
    const handlers = {
      onPermissionRequest: async (p: unknown) => {
        received = p;
        return "allow_always" as const;
      },
    };
    const promise = connectAcp({ ...baseOpts(), handlers });
    const ws = MockWebSocket.last!;
    ws.fakeOpen();
    ws.fakeServerFrame(
      encode({
        kind: "ready",
        payload: { sessionId: "s", agentId: "claude-code", protocolVersion: PROTOCOL_VERSION, availableAgents: [], modelCatalog: null },
      }),
    );
    await promise;

    ws.fakeServerFrame(
      encode({
        kind: "permission-prompt",
        payload: { id: "perm1", request: { tool: "writeTextFile" } },
      }),
    );
    await new Promise((r) => setTimeout(r, 5));

    expect(received).toEqual({ id: "perm1", request: { tool: "writeTextFile" } });
    const resp = ws.sent.find((s) => decode(s).kind === "permission-response");
    expect(resp).toBeDefined();
    expect(decode(resp!)).toEqual({
      kind: "permission-response",
      payload: { id: "perm1", decision: "allow_always" },
    });
  });

  test("auto-rejects when the handler throws", async () => {
    const handlers = {
      onPermissionRequest: async () => {
        throw new Error("ui crashed");
      },
    };
    const promise = connectAcp({ ...baseOpts(), handlers });
    const ws = MockWebSocket.last!;
    ws.fakeOpen();
    ws.fakeServerFrame(
      encode({
        kind: "ready",
        payload: { sessionId: "s", agentId: "claude-code", protocolVersion: PROTOCOL_VERSION, availableAgents: [], modelCatalog: null },
      }),
    );
    const session = await promise;
    const errors: unknown[] = [];
    session.on("error", (e) => errors.push(e));

    ws.fakeServerFrame(
      encode({ kind: "permission-prompt", payload: { id: "perm2", request: {} } }),
    );
    await new Promise((r) => setTimeout(r, 5));

    const resp = ws.sent.find((s) => decode(s).kind === "permission-response");
    expect(resp).toBeDefined();
    const parsed = decode(resp!) as Extract<WireMessage, { kind: "permission-response" }>;
    expect(parsed.payload.decision).toBe("reject_once");
    expect(errors).toHaveLength(1);
  });
});

describe("ping/pong + log + error frames", () => {
  test("replies to ping with pong carrying the same ts", async () => {
    const { ws } = await openSession();
    ws.fakeServerFrame(encode({ kind: "ping", ts: 42 }));
    await new Promise((r) => setTimeout(r, 0));
    const pong = ws.sent.find((s) => decode(s).kind === "pong");
    expect(pong).toBeDefined();
    expect(decode(pong!)).toEqual({ kind: "pong", ts: 42 });
  });

  test("emits log events for server log frames", async () => {
    const { session, ws } = await openSession();
    const logs: unknown[] = [];
    session.on("log", (e) => logs.push(e));
    ws.fakeServerFrame(
      encode({ kind: "log", payload: { level: "info", message: "hi", ts: 1, context: {} } }),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(logs).toHaveLength(1);
  });

  test("routes fatal vs non-fatal error frames to the right events", async () => {
    const { session, ws } = await openSession();
    const errors: unknown[] = [];
    const fatals: unknown[] = [];
    session.on("error", (e) => errors.push(e));
    session.on("fatal", (e) => fatals.push(e));
    ws.fakeServerFrame(
      encode({
        kind: "error",
        fatal: false,
        payload: { code: "protocol_error", message: "minor" },
      }),
    );
    ws.fakeServerFrame(
      encode({
        kind: "error",
        fatal: true,
        payload: { code: "agent_crashed", message: "boom" },
      }),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(errors).toHaveLength(1);
    expect(fatals).toHaveLength(1);
  });
});

describe("decode failures", () => {
  test("malformed inbound frame surfaces a non-fatal protocol_error", async () => {
    const { session, ws } = await openSession();
    const errors: { code: string }[] = [];
    session.on("error", (e) => errors.push(e as { code: string }));
    ws.fakeServerFrame("not json at all");
    await new Promise((r) => setTimeout(r, 0));
    expect(errors).toHaveLength(1);
    expect(errors[0]!.code).toBe("protocol_error");
  });
});

describe("close behavior", () => {
  test("auth/version close codes are treated as fatal (no reconnect)", async () => {
    // Enable reconnect, then close with 4401 — there must be no second WS created.
    const opts = { ...baseOpts(), reconnect: { enabled: true, maxAttempts: 5, initialDelayMs: 1, jitter: 0 } };
    const promise = connectAcp(opts);
    const ws = MockWebSocket.last!;
    ws.fakeOpen();
    ws.fakeServerFrame(
      encode({
        kind: "ready",
        payload: { sessionId: "s", agentId: "claude-code", protocolVersion: PROTOCOL_VERSION, availableAgents: [], modelCatalog: null },
      }),
    );
    await promise;
    const before = MockWebSocket.instances.length;
    ws.fakeServerClose(CLOSE_CODES.AUTH_FAILED, "auth_failed");
    await new Promise((r) => setTimeout(r, 20));
    expect(MockWebSocket.instances.length).toBe(before);
  });

  test("non-fatal close triggers a reconnect attempt", async () => {
    const opts = {
      ...baseOpts(),
      reconnect: { enabled: true, maxAttempts: 1, initialDelayMs: 1, jitter: 0 },
    };
    const promise = connectAcp(opts);
    const ws = MockWebSocket.last!;
    ws.fakeOpen();
    ws.fakeServerFrame(
      encode({
        kind: "ready",
        payload: { sessionId: "s", agentId: "claude-code", protocolVersion: PROTOCOL_VERSION, availableAgents: [], modelCatalog: null },
      }),
    );
    await promise;
    const before = MockWebSocket.instances.length;
    ws.fakeServerClose(1006, "abnormal");
    await new Promise((r) => setTimeout(r, 20));
    expect(MockWebSocket.instances.length).toBeGreaterThan(before);
  });
});

describe("slash commands", () => {
  test("captures available_commands_update on the session and emits `commands`", async () => {
    const { session, ws } = await openSession();
    const seen: Array<unknown> = [];
    session.on("commands", (cmds) => seen.push(cmds));

    ws.fakeServerFrame(
      encode({
        kind: "notify",
        payload: {
          direction: "a2c",
          method: "session/update",
          params: {
            sessionId: "s1",
            update: {
              sessionUpdate: "available_commands_update",
              availableCommands: [
                { name: "init", description: "set up the project" },
                { name: "review", description: "code review" },
              ],
            },
          },
        },
      }),
    );
    await new Promise((r) => setTimeout(r, 0));

    expect(session.availableCommands).toHaveLength(2);
    expect(session.availableCommands[0]?.name).toBe("init");
    expect(seen).toHaveLength(1);
  });

  test("replaces the catalog on each notification (no merging)", async () => {
    const { session, ws } = await openSession();

    ws.fakeServerFrame(
      encode({
        kind: "notify",
        payload: {
          direction: "a2c",
          method: "session/update",
          params: {
            sessionId: "s1",
            update: {
              sessionUpdate: "available_commands_update",
              availableCommands: [{ name: "a", description: "" }, { name: "b", description: "" }],
            },
          },
        },
      }),
    );
    ws.fakeServerFrame(
      encode({
        kind: "notify",
        payload: {
          direction: "a2c",
          method: "session/update",
          params: {
            sessionId: "s1",
            update: {
              sessionUpdate: "available_commands_update",
              availableCommands: [{ name: "c", description: "" }],
            },
          },
        },
      }),
    );
    await new Promise((r) => setTimeout(r, 0));

    expect(session.availableCommands.map((c) => c.name)).toEqual(["c"]);
  });

  test("resets the catalog on a fresh `ready` (agent switch)", async () => {
    const { session, ws } = await openSession();

    ws.fakeServerFrame(
      encode({
        kind: "notify",
        payload: {
          direction: "a2c",
          method: "session/update",
          params: {
            sessionId: "s1",
            update: {
              sessionUpdate: "available_commands_update",
              availableCommands: [{ name: "init", description: "" }],
            },
          },
        },
      }),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(session.availableCommands).toHaveLength(1);

    // Simulate the gateway sending a fresh `ready` (post-switchAgent).
    ws.fakeServerFrame(
      encode({
        kind: "ready",
        payload: {
          sessionId: "s2",
          agentId: "gemini",
          protocolVersion: PROTOCOL_VERSION,
          availableAgents: [],
          modelCatalog: null,
        },
      }),
    );
    await new Promise((r) => setTimeout(r, 0));

    expect(session.availableCommands).toHaveLength(0);
  });

  test("non-command session/update notifications do not touch the catalog", async () => {
    const { session, ws } = await openSession();
    ws.fakeServerFrame(
      encode({
        kind: "notify",
        payload: {
          direction: "a2c",
          method: "session/update",
          params: {
            sessionId: "s1",
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "hi" },
            },
          },
        },
      }),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(session.availableCommands).toHaveLength(0);
  });
});

describe("agent authentication", () => {
  async function openWithAuth(): Promise<{ session: AcpSession; ws: MockWebSocket }> {
    const promise = connectAcp(baseOpts());
    const ws = MockWebSocket.last!;
    ws.fakeOpen();
    ws.fakeServerFrame(
      encode({
        kind: "ready",
        payload: {
          sessionId: "s-auth",
          agentId: "claude-code",
          protocolVersion: PROTOCOL_VERSION,
          availableAgents: [
            { id: "claude-code", label: "Claude Code", login: "acp_native" },
            { id: "copilot", label: "Copilot", login: "tty" },
          ],
          modelCatalog: null,
          authMethods: [
            { id: "oauth", name: "OAuth", description: "Sign in" },
            { id: "api-key", name: "API key" },
          ],
        },
      }),
    );
    const session = await promise;
    return { session, ws };
  }

  test("ready frame populates session.authMethods", async () => {
    const { session } = await openWithAuth();
    expect(session.authMethods).toEqual([
      { id: "oauth", name: "OAuth", description: "Sign in" },
      { id: "api-key", name: "API key" },
    ]);
  });

  test("availableAgents carries the login.kind projection", async () => {
    const { session } = await openWithAuth();
    expect(session.availableAgents).toEqual([
      { id: "claude-code", label: "Claude Code", login: "acp_native" },
      { id: "copilot", label: "Copilot", login: "tty" },
    ]);
  });

  test("authenticate() sends an authenticate RPC and resolves on success", async () => {
    const { session, ws } = await openWithAuth();
    const sentBefore = ws.sent.length;
    const promise = session.authenticate("oauth");
    // The RPC frame should be on the wire.
    const last = decode(ws.sent[ws.sent.length - 1]!) as Extract<WireMessage, { kind: "rpc" }>;
    expect(last.kind).toBe("rpc");
    expect(last.payload.method).toBe("authenticate");
    expect(last.payload.params).toEqual({ methodId: "oauth" });
    // Server replies success.
    ws.fakeServerFrame(
      encode({ kind: "rpc-result", payload: { id: last.payload.id, result: {} } }),
    );
    await promise;
    expect(ws.sent.length).toBeGreaterThan(sentBefore);
  });

  test("rpc-error with message 'auth_required' emits the auth_required event", async () => {
    const { session, ws } = await openWithAuth();
    const events: Array<{ methodIds: string[] }> = [];
    session.on("auth_required", (e) => events.push(e));
    // Issue a prompt; the server replies with an auth_required error.
    const stream = session.prompt("hi");
    const last = decode(ws.sent[ws.sent.length - 1]!) as Extract<WireMessage, { kind: "rpc" }>;
    ws.fakeServerFrame(
      encode({
        kind: "rpc-error",
        payload: {
          id: last.payload.id,
          error: { code: -32000, message: "auth_required" },
        },
      }),
    );
    await expect(stream.result).rejects.toBeDefined();
    expect(events).toHaveLength(1);
    expect(events[0]!.methodIds).toEqual(["oauth", "api-key"]);
  });
});

describe("startLogin() PTY stream", () => {
  test("sends login-start, resolves on login-ready, streams data, ends on login-end", async () => {
    const { session, ws } = await openSession();
    const promise = session.startLogin("copilot");
    const startFrame = decode(ws.sent[ws.sent.length - 1]!) as Extract<
      WireMessage,
      { kind: "login-start" }
    >;
    expect(startFrame.kind).toBe("login-start");
    expect(startFrame.agentId).toBe("copilot");
    const requestId = startFrame.requestId;
    ws.fakeServerFrame(
      encode({ kind: "login-ready", requestId, loginId: "L1" }),
    );
    const stream = await promise;
    expect(stream.loginId).toBe("L1");

    // Drive a chunk of data + end-of-stream.
    ws.fakeServerFrame(encode({ kind: "login-data", loginId: "L1", data: "hello\r\n" }));
    ws.fakeServerFrame(
      encode({ kind: "login-end", loginId: "L1", exitCode: 0, reason: "success_marker" }),
    );

    const chunks: string[] = [];
    for await (const chunk of stream) chunks.push(chunk);
    expect(chunks).toEqual(["hello\r\n"]);
    const exit = await stream.exit;
    expect(exit.reason).toBe("success_marker");
    expect(exit.exitCode).toBe(0);
  });

  test("write() and resize() send the right wire frames", async () => {
    const { session, ws } = await openSession();
    const promise = session.startLogin();
    const startFrame = decode(ws.sent[ws.sent.length - 1]!) as Extract<
      WireMessage,
      { kind: "login-start" }
    >;
    ws.fakeServerFrame(
      encode({ kind: "login-ready", requestId: startFrame.requestId, loginId: "L2" }),
    );
    const stream = await promise;
    stream.write("ping\n");
    stream.resize(120, 40);
    const writeFrame = decode(ws.sent[ws.sent.length - 2]!) as Extract<
      WireMessage,
      { kind: "login-data" }
    >;
    const resizeFrame = decode(ws.sent[ws.sent.length - 1]!) as Extract<
      WireMessage,
      { kind: "login-resize" }
    >;
    expect(writeFrame.kind).toBe("login-data");
    expect(writeFrame.data).toBe("ping\n");
    expect(resizeFrame.kind).toBe("login-resize");
    expect(resizeFrame.cols).toBe(120);
    expect(resizeFrame.rows).toBe(40);
  });

  test("cancel() sends login-cancel and resolves when login-end arrives", async () => {
    const { session, ws } = await openSession();
    const promise = session.startLogin();
    const startFrame = decode(ws.sent[ws.sent.length - 1]!) as Extract<
      WireMessage,
      { kind: "login-start" }
    >;
    ws.fakeServerFrame(
      encode({ kind: "login-ready", requestId: startFrame.requestId, loginId: "L3" }),
    );
    const stream = await promise;
    const cancelPromise = stream.cancel();
    const cancelFrame = decode(ws.sent[ws.sent.length - 1]!) as Extract<
      WireMessage,
      { kind: "login-cancel" }
    >;
    expect(cancelFrame.kind).toBe("login-cancel");
    expect(cancelFrame.loginId).toBe("L3");
    ws.fakeServerFrame(
      encode({ kind: "login-end", loginId: "L3", exitCode: null, reason: "cancelled" }),
    );
    await cancelPromise;
    const exit = await stream.exit;
    expect(exit.reason).toBe("cancelled");
  });
});
