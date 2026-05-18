/**
 * Tests for connectAcpP2P. Uses a fake trystero room + a hand-rolled fake
 * "host" peer that mimics what createAcpP2PHost broadcasts. This keeps the
 * peer test independent of the gateway code while still proving the
 * shared-session semantics work end-to-end.
 */
import { describe, expect, test } from "bun:test";
import {
  PROTOCOL_VERSION,
  decode,
  encode,
  type WireMessage,
} from "@beamhop/acp-protocol";
import { FakeNetwork, fakeJoinRoom } from "./__fixtures__/fake-room.js";
import { connectAcpP2P } from "./peer.js";

const tick = () => new Promise<void>((r) => queueMicrotask(r));

/**
 * Minimal "host" simulating what createAcpP2PHost+gateway would broadcast.
 * Captures one hello frame, replies with ready, and replies to any
 * session/prompt RPC with a synthetic update + result.
 */
function fakeHost(network: FakeNetwork) {
  const room = network.spawn();
  const [send, onFrame] = room.makeAction<string>("acp");
  let lastReady: string | null = null;

  const replyReady = (agent: string) => {
    const frame = encode({
      kind: "ready",
      payload: {
        sessionId: "test-session",
        agentId: agent,
        protocolVersion: PROTOCOL_VERSION,
        availableAgents: [],
        modelCatalog: null,
      },
    });
    lastReady = frame;
    void send(frame);
  };

  room.onPeerJoin((peerId) => {
    if (lastReady) void send(lastReady, peerId);
  });

  onFrame((raw) => {
    let msg: WireMessage;
    try {
      msg = decode(raw);
    } catch {
      return;
    }
    if (msg.kind === "hello") {
      replyReady(String(msg.agent ?? "fake"));
      return;
    }
    if (msg.kind === "rpc" && msg.payload.method === "session/prompt") {
      const id = msg.payload.id;
      void send(
        encode({
          kind: "notify",
          payload: {
            direction: "a2c",
            method: "session/update",
            params: {
              sessionId: "test-session",
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "hi" },
              },
            },
          },
        }),
      );
      void send(
        encode({
          kind: "rpc-result",
          payload: { id, result: { stopReason: "end_turn" } },
        }),
      );
    }
  });

  return room;
}

describe("connectAcpP2P", () => {
  test("first peer: hello -> ready resolves the session", async () => {
    const net = new FakeNetwork();
    fakeHost(net);

    const session = await connectAcpP2P({
      joinRoom: fakeJoinRoom(net),
      appId: "test",
      roomId: "r",
      agent: "fake",
      clientInfo: { name: "peer", version: "0.0.0" },
      handlers: { onPermissionRequest: () => "reject_once" },
      readyTimeoutMs: 2000,
    });

    expect(session.sessionId).toBe("test-session");
    expect(session.agentId).toBe("fake");
    await session.close();
  });

  test("prompt returns result and streams updates", async () => {
    const net = new FakeNetwork();
    fakeHost(net);

    const session = await connectAcpP2P({
      joinRoom: fakeJoinRoom(net),
      appId: "test",
      roomId: "r",
      agent: "fake",
      clientInfo: { name: "peer", version: "0.0.0" },
      handlers: { onPermissionRequest: () => "reject_once" },
      readyTimeoutMs: 2000,
    });

    const stream = session.prompt("hello");
    const updates: unknown[] = [];
    for await (const u of stream) updates.push(u);
    const result = (await stream.result) as { stopReason: string };

    expect(updates.length).toBe(1);
    expect(result.stopReason).toBe("end_turn");
    await session.close();
  });

  test("two peers share one session; both see ready", async () => {
    const net = new FakeNetwork();
    fakeHost(net);

    const a = await connectAcpP2P({
      joinRoom: fakeJoinRoom(net),
      appId: "t",
      roomId: "r",
      agent: "fake",
      clientInfo: { name: "a", version: "0.0.0" },
      handlers: { onPermissionRequest: () => "reject_once" },
      readyTimeoutMs: 2000,
    });

    const b = await connectAcpP2P({
      joinRoom: fakeJoinRoom(net),
      appId: "t",
      roomId: "r",
      agent: "fake",
      clientInfo: { name: "b", version: "0.0.0" },
      handlers: { onPermissionRequest: () => "reject_once" },
      readyTimeoutMs: 2000,
    });

    expect(a.sessionId).toBe("test-session");
    expect(b.sessionId).toBe("test-session");
    await a.close();
    await b.close();
  });

  test("peer A's prompt result does not resolve peer B's promise", async () => {
    const net = new FakeNetwork();
    fakeHost(net);

    const a = await connectAcpP2P({
      joinRoom: fakeJoinRoom(net),
      appId: "t",
      roomId: "r",
      agent: "fake",
      clientInfo: { name: "a", version: "0.0.0" },
      handlers: { onPermissionRequest: () => "reject_once" },
      readyTimeoutMs: 2000,
    });

    const b = await connectAcpP2P({
      joinRoom: fakeJoinRoom(net),
      appId: "t",
      roomId: "r",
      agent: "fake",
      clientInfo: { name: "b", version: "0.0.0" },
      handlers: { onPermissionRequest: () => "reject_once" },
      readyTimeoutMs: 2000,
    });

    const bUpdates: unknown[] = [];
    b.on("update", (u) => bUpdates.push(u));

    const stream = a.prompt("hi");
    const result = (await stream.result) as { stopReason: string };
    expect(result.stopReason).toBe("end_turn");

    await tick();
    await tick();
    expect(bUpdates.length).toBeGreaterThanOrEqual(1);

    await a.close();
    await b.close();
  });

  test("missing onPermissionRequest fails fast", async () => {
    const net = new FakeNetwork();
    fakeHost(net);

    await expect(
      connectAcpP2P({
        joinRoom: fakeJoinRoom(net),
        appId: "t",
        roomId: "r",
        agent: "fake",
        clientInfo: { name: "p", version: "0.0.0" },
        // @ts-expect-error - intentionally missing required handler
        handlers: {},
      }),
    ).rejects.toThrow(/onPermissionRequest/);
  });

  test("ready timeout fires when no host is present", async () => {
    const net = new FakeNetwork();
    // No fakeHost(net) — the lone peer should time out.

    await expect(
      connectAcpP2P({
        joinRoom: fakeJoinRoom(net),
        appId: "t",
        roomId: "r",
        agent: "fake",
        clientInfo: { name: "p", version: "0.0.0" },
        handlers: { onPermissionRequest: () => "reject_once" },
        readyTimeoutMs: 100,
      }),
    ).rejects.toThrow(/timed out/);
  });
});
