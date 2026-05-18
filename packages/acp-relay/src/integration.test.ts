/**
 * End-to-end integration: a real relay server + the acp-p2p stack on top.
 *
 *   relay (this package) ──┐
 *                          │
 *   createAcpP2PHost ──────┤── all-WebSocket transport, no WebRTC
 *                          │
 *   connectAcpP2P (× 2) ──┘
 *
 * Proves the headline claim: the relay is a drop-in trystero transport;
 * the acp-p2p shared-session contract still holds.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import WebSocket from "ws";
import { defineAgent } from "@beamhop/acp-server";
import { createAcpP2PHost, type AcpP2PHost } from "@beamhop/acp-p2p/host";
import { connectAcpP2P, type AcpP2PSession } from "@beamhop/acp-p2p/peer";
import { serveRelay, type ServeRelayHandle } from "./adapters/standalone.js";
import { createRelayJoinRoom } from "./client.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fakeAgentPath = path.resolve(
  here,
  "..",
  "..",
  "acp-server",
  "src",
  "__fixtures__",
  "fake-agent.ts",
);

const makeAgent = () =>
  defineAgent({
    id: "fake-normal",
    command: "bun",
    args: [fakeAgentPath],
    env: { FAKE_AGENT_BEHAVIOR: "normal" },
    healthCheck: () => true,
  });

let relay: ServeRelayHandle | null = null;
let host: AcpP2PHost | null = null;
const sessions: AcpP2PSession[] = [];

beforeEach(async () => {
  relay = await serveRelay({ port: 0, pingIntervalMs: 0, idleTimeoutMs: 0 });
});

afterEach(async () => {
  for (const s of sessions) {
    try {
      await s.close();
    } catch {
      /* ignore */
    }
  }
  sessions.length = 0;
  await host?.close();
  host = null;
  await relay?.close();
  relay = null;
});

function relayUrl() {
  return `ws://127.0.0.1:${relay!.port}/relay`;
}

describe("acp-relay end-to-end with the acp-p2p stack", () => {
  test("two clients share one session, exchange prompts, see same updates", async () => {
    const joinRoom = createRelayJoinRoom({
      relayUrl: relayUrl(),
      WebSocketImpl: WebSocket as unknown as typeof globalThis.WebSocket,
    });

    host = await createAcpP2PHost({
      joinRoom,
      appId: "demo",
      roomId: "room-1",
      gateway: {
        agents: { "fake-normal": makeAgent() },
        defaultAgent: "fake-normal",
        auth: { mode: "none" },
      },
    });

    const a = await connectAcpP2P({
      joinRoom,
      appId: "demo",
      roomId: "room-1",
      agent: "fake-normal",
      clientInfo: { name: "a", version: "0.0.0" },
      handlers: { onPermissionRequest: () => "reject_once" },
      readyTimeoutMs: 5_000,
    });
    sessions.push(a);

    const b = await connectAcpP2P({
      joinRoom,
      appId: "demo",
      roomId: "room-1",
      agent: "fake-normal",
      clientInfo: { name: "b", version: "0.0.0" },
      handlers: { onPermissionRequest: () => "reject_once" },
      readyTimeoutMs: 5_000,
    });
    sessions.push(b);

    expect(a.sessionId).toBeTruthy();
    expect(a.sessionId).toBe(b.sessionId);

    const bUpdates: unknown[] = [];
    b.on("update", (u) => bUpdates.push(u));

    const stream = a.prompt("hi");
    const aUpdates: unknown[] = [];
    for await (const u of stream) aUpdates.push(u);
    const result = (await stream.result) as { stopReason: string };
    expect(result.stopReason).toBe("end_turn");
    expect(aUpdates.length).toBeGreaterThan(0);

    // Give B's microtasks a tick to flush the broadcast.
    await new Promise((r) => setTimeout(r, 10));
    expect(bUpdates.length).toBeGreaterThan(0);
  }, 15_000);

  test("late joiner receives replayed ready frame", async () => {
    const joinRoom = createRelayJoinRoom({
      relayUrl: relayUrl(),
      WebSocketImpl: WebSocket as unknown as typeof globalThis.WebSocket,
    });

    host = await createAcpP2PHost({
      joinRoom,
      appId: "demo",
      roomId: "room-2",
      gateway: {
        agents: { "fake-normal": makeAgent() },
        defaultAgent: "fake-normal",
        auth: { mode: "none" },
      },
    });

    const first = await connectAcpP2P({
      joinRoom,
      appId: "demo",
      roomId: "room-2",
      agent: "fake-normal",
      clientInfo: { name: "first", version: "0.0.0" },
      handlers: { onPermissionRequest: () => "reject_once" },
      readyTimeoutMs: 5_000,
    });
    sessions.push(first);

    const originalSessionId = first.sessionId;
    expect(originalSessionId).toBeTruthy();

    // Late joiner — must receive the cached ready replay from acp-p2p-server.
    const late = await connectAcpP2P({
      joinRoom,
      appId: "demo",
      roomId: "room-2",
      agent: "fake-normal",
      clientInfo: { name: "late", version: "0.0.0" },
      handlers: { onPermissionRequest: () => "reject_once" },
      readyTimeoutMs: 5_000,
    });
    sessions.push(late);
    expect(late.sessionId).toBe(originalSessionId);
  }, 15_000);
});
