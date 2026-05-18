/**
 * End-to-end p2p test: real createAcpGateway + fake-agent subprocess from
 * @beamhop/acp-server fixtures + two FakeRoom "peers" sharing one network.
 *
 * Verifies the contract that matters most: peer-issued prompts get routed
 * back to the issuing peer's promise, while every peer observes the same
 * session/update stream.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { decode, encode, PROTOCOL_VERSION, type WireMessage } from "@beamhop/acp-protocol";
import { defineAgent } from "@beamhop/acp-server";
import { FakeNetwork, fakeJoinRoom } from "./__fixtures__/fake-room.js";
import { createAcpP2PHost, type AcpP2PHost } from "./host.js";

// Resolve the fake-agent fixture from the sibling acp-server package.
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

function makeAgent(id: string, behavior: string) {
  return defineAgent({
    id,
    command: "bun",
    args: [fakeAgentPath],
    env: { FAKE_AGENT_BEHAVIOR: behavior },
    healthCheck: () => true,
  });
}

let host: AcpP2PHost | null = null;

afterEach(async () => {
  await host?.close();
  host = null;
});

interface RawPeer {
  peerId: string;
  sent: string[];
  inbox: WireMessage[];
  send(msg: WireMessage): Promise<void>;
  waitFor<K extends WireMessage["kind"]>(
    kind: K,
    predicate?: (m: Extract<WireMessage, { kind: K }>) => boolean,
    timeoutMs?: number,
  ): Promise<Extract<WireMessage, { kind: K }>>;
}

function makePeer(network: FakeNetwork): RawPeer {
  const room = network.spawn();
  const inbox: WireMessage[] = [];
  const waiters: Array<{
    kind: WireMessage["kind"];
    predicate?: (m: WireMessage) => boolean;
    resolve: (m: WireMessage) => void;
  }> = [];
  const [sender, onFrame] = room.makeAction<string>("acp");
  const sent: string[] = [];

  onFrame((raw) => {
    try {
      const msg = decode(raw);
      inbox.push(msg);
      for (let i = waiters.length - 1; i >= 0; i--) {
        const w = waiters[i]!;
        if (w.kind === msg.kind && (!w.predicate || w.predicate(msg))) {
          waiters.splice(i, 1);
          w.resolve(msg);
        }
      }
    } catch {
      /* drop garbage */
    }
  });

  return {
    peerId: room.peerId,
    sent,
    inbox,
    async send(msg: WireMessage) {
      const raw = encode(msg);
      sent.push(raw);
      await sender(raw);
    },
    waitFor<K extends WireMessage["kind"]>(
      kind: K,
      predicate?: (m: Extract<WireMessage, { kind: K }>) => boolean,
      timeoutMs = 5000,
    ) {
      for (const m of inbox) {
        if (m.kind === kind && (!predicate || predicate(m as Extract<WireMessage, { kind: K }>))) {
          return Promise.resolve(m as Extract<WireMessage, { kind: K }>);
        }
      }
      return new Promise<Extract<WireMessage, { kind: K }>>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`timed out waiting for kind=${kind}`));
        }, timeoutMs);
        waiters.push({
          kind,
          predicate: predicate as ((m: WireMessage) => boolean) | undefined,
          resolve: (m) => {
            clearTimeout(timer);
            resolve(m as Extract<WireMessage, { kind: K }>);
          },
        });
      });
    },
  };
}

describe("createAcpP2PHost end-to-end", () => {
  test("two peers share one session; both see ready and updates", async () => {
    const network = new FakeNetwork();
    const joinRoom = fakeJoinRoom(network);

    host = await createAcpP2PHost({
      joinRoom,
      appId: "test",
      roomId: "r1",
      gateway: {
        agents: { "fake-normal": makeAgent("fake-normal", "normal") },
        defaultAgent: "fake-normal",
        auth: { mode: "none" },
      },
    });

    const a = makePeer(network);
    const b = makePeer(network);

    await a.send({
      kind: "hello",
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: { name: "peer-a", version: "0.0.0" },
      agent: "fake-normal",
    });

    const readyA = await a.waitFor("ready");
    const readyB = await b.waitFor("ready");
    expect(readyA.payload.agentId).toBe("fake-normal");
    expect(readyB.payload.agentId).toBe("fake-normal");
    expect(readyA.payload.sessionId).toBe(readyB.payload.sessionId);

    await a.send({
      kind: "rpc",
      payload: {
        direction: "c2a",
        id: "a-prompt-1",
        method: "session/prompt",
        params: { prompt: [{ type: "text", text: "hi" }] },
      },
    });

    const updateA = await a.waitFor(
      "notify",
      (m) => (m.payload.method as string) === "session/update",
    );
    const updateB = await b.waitFor(
      "notify",
      (m) => (m.payload.method as string) === "session/update",
    );
    expect(updateA.payload).toEqual(updateB.payload);

    const resultA = await a.waitFor("rpc-result", (m) => m.payload.id === "a-prompt-1");
    expect((resultA.payload.result as { stopReason: string }).stopReason).toBe("end_turn");

    const sawResult = b.inbox.some(
      (m) => m.kind === "rpc-result" && m.payload.id === "a-prompt-1",
    );
    expect(sawResult).toBe(true);
  });

  test("late joiner receives replayed ready frame", async () => {
    const network = new FakeNetwork();
    const joinRoom = fakeJoinRoom(network);

    host = await createAcpP2PHost({
      joinRoom,
      appId: "test",
      roomId: "r2",
      gateway: {
        agents: { "fake-normal": makeAgent("fake-normal", "normal") },
        defaultAgent: "fake-normal",
        auth: { mode: "none" },
      },
    });

    const first = makePeer(network);
    await first.send({
      kind: "hello",
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: { name: "first", version: "0.0.0" },
      agent: "fake-normal",
    });

    const readyFirst = await first.waitFor("ready");
    const originalSessionId = readyFirst.payload.sessionId;

    const late = makePeer(network);
    const readyLate = await late.waitFor("ready");
    expect(readyLate.payload.sessionId).toBe(originalSessionId);
  });
});
