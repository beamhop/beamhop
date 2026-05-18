import { describe, expect, test } from "bun:test";
import { decode, encode, type RelayFrame } from "./protocol.js";
import { createRelayServer, type ConnectionContext } from "./server.js";
import { createPairedSockets, PairedSocket } from "./__fixtures__/paired-sockets.js";

const tick = () => new Promise<void>((r) => queueMicrotask(r));
const drain = async () => {
  for (let i = 0; i < 4; i++) await tick();
};

interface ConnectedPeer {
  ctx: ConnectionContext;
  client: PairedSocket;
  /** All frames the server sent us, decoded. */
  inbox: RelayFrame[];
}

function connect(
  relay: ReturnType<typeof createRelayServer>,
  ctx: ConnectionContext,
): ConnectedPeer {
  const [client, server] = createPairedSockets();
  const inbox: RelayFrame[] = [];
  client.onMessage((raw) => {
    try {
      inbox.push(decode(raw));
    } catch {
      /* skip undecodable */
    }
  });
  relay.handleConnection(server, ctx);
  return { ctx, client, inbox };
}

function lastOfKind<K extends RelayFrame["kind"]>(
  inbox: RelayFrame[],
  kind: K,
): Extract<RelayFrame, { kind: K }> | undefined {
  for (let i = inbox.length - 1; i >= 0; i--) {
    if (inbox[i]!.kind === kind) return inbox[i] as Extract<RelayFrame, { kind: K }>;
  }
  return undefined;
}

describe("createRelayServer", () => {
  test("two peers in same room exchange frames", async () => {
    const relay = createRelayServer({ pingIntervalMs: 0, idleTimeoutMs: 0 });
    const a = connect(relay, { appId: "app", roomId: "room", peerId: "a" });
    const b = connect(relay, { appId: "app", roomId: "room", peerId: "b" });
    await drain();

    // Both got a joined frame.
    expect(lastOfKind(a.inbox, "joined")?.selfPeerId).toBe("a");
    expect(lastOfKind(b.inbox, "joined")?.selfPeerId).toBe("b");
    // A got peer-join for B.
    expect(a.inbox.some((f) => f.kind === "peer-join" && f.peerId === "b")).toBe(true);

    // A sends to all; B receives.
    a.client.send(encode({ kind: "send", ns: "acp", data: "hello" }));
    await drain();
    const recv = lastOfKind(b.inbox, "recv");
    expect(recv).toMatchObject({ ns: "acp", data: "hello", from: "a" });

    await relay.close();
  });

  test("targeted send only reaches named peers", async () => {
    const relay = createRelayServer({ pingIntervalMs: 0, idleTimeoutMs: 0 });
    const a = connect(relay, { appId: "app", roomId: "room", peerId: "a" });
    const b = connect(relay, { appId: "app", roomId: "room", peerId: "b" });
    const c = connect(relay, { appId: "app", roomId: "room", peerId: "c" });
    await drain();

    a.client.send(encode({ kind: "send", ns: "acp", data: "private", to: ["b"] }));
    await drain();

    expect(b.inbox.some((f) => f.kind === "recv" && f.data === "private")).toBe(true);
    expect(c.inbox.some((f) => f.kind === "recv" && f.data === "private")).toBe(false);
    await relay.close();
  });

  test("rooms are isolated by (appId, roomId)", async () => {
    const relay = createRelayServer({ pingIntervalMs: 0, idleTimeoutMs: 0 });
    const a = connect(relay, { appId: "app1", roomId: "r", peerId: "a" });
    const b = connect(relay, { appId: "app2", roomId: "r", peerId: "b" });
    const c = connect(relay, { appId: "app1", roomId: "other", peerId: "c" });
    await drain();

    a.client.send(encode({ kind: "send", ns: "acp", data: "x" }));
    await drain();

    expect(b.inbox.some((f) => f.kind === "recv")).toBe(false);
    expect(c.inbox.some((f) => f.kind === "recv")).toBe(false);
    await relay.close();
  });

  test("authToken rejects bad creds", async () => {
    const relay = createRelayServer({
      authToken: "good",
      pingIntervalMs: 0,
      idleTimeoutMs: 0,
    });
    const a = connect(relay, { appId: "x", roomId: "r", peerId: "a", authToken: "bad" });
    await drain();

    const err = lastOfKind(a.inbox, "error");
    expect(err?.code).toBe("auth_failed");
    await relay.close();
  });

  test("authToken accepts good creds", async () => {
    const relay = createRelayServer({
      authToken: "good",
      pingIntervalMs: 0,
      idleTimeoutMs: 0,
    });
    const a = connect(relay, { appId: "x", roomId: "r", peerId: "a", authToken: "good" });
    await drain();
    expect(lastOfKind(a.inbox, "joined")?.selfPeerId).toBe("a");
    await relay.close();
  });

  test("maxPeersPerRoom rejects with room_full", async () => {
    const relay = createRelayServer({
      maxPeersPerRoom: 2,
      pingIntervalMs: 0,
      idleTimeoutMs: 0,
    });
    connect(relay, { appId: "x", roomId: "r", peerId: "a" });
    connect(relay, { appId: "x", roomId: "r", peerId: "b" });
    const third = connect(relay, { appId: "x", roomId: "r", peerId: "c" });
    await drain();
    expect(lastOfKind(third.inbox, "error")?.code).toBe("room_full");
    await relay.close();
  });

  test("peer-leave broadcasts when a peer disconnects", async () => {
    const relay = createRelayServer({ pingIntervalMs: 0, idleTimeoutMs: 0 });
    const a = connect(relay, { appId: "x", roomId: "r", peerId: "a" });
    const b = connect(relay, { appId: "x", roomId: "r", peerId: "b" });
    await drain();

    b.client.close(1000, "bye");
    await drain();
    expect(a.inbox.some((f) => f.kind === "peer-leave" && f.peerId === "b")).toBe(true);
    await relay.close();
  });

  test("ping from client gets pong", async () => {
    const relay = createRelayServer({ pingIntervalMs: 0, idleTimeoutMs: 0 });
    const a = connect(relay, { appId: "x", roomId: "r", peerId: "a" });
    await drain();
    a.client.send(encode({ kind: "ping", ts: 1234 }));
    await drain();
    expect(a.inbox.some((f) => f.kind === "pong" && f.ts === 1234)).toBe(true);
    await relay.close();
  });

  test("missing appId is rejected as protocol_error", async () => {
    const relay = createRelayServer({ pingIntervalMs: 0, idleTimeoutMs: 0 });
    const a = connect(relay, { appId: "", roomId: "r", peerId: "a" });
    await drain();
    expect(lastOfKind(a.inbox, "error")?.code).toBe("protocol_error");
    await relay.close();
  });
});
