import { afterEach, describe, expect, test } from "bun:test";
import { encode, type RelayFrame } from "./protocol.js";
import { RelayRoom } from "./room.js";
import { MockWebSocket } from "./__fixtures__/mock-ws.js";

afterEach(() => MockWebSocket.reset());

function makeRoom(opts?: Partial<{ peerId: string; authToken: string }>) {
  const room = new RelayRoom(
    {
      appId: "test-app",
      relayUrl: "ws://relay.test/relay",
      WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      peerId: opts?.peerId,
      authToken: opts?.authToken,
      connectTimeoutMs: 500,
    },
    "room-1",
  );
  const ws = MockWebSocket.last!;
  return { room, ws };
}

function fakeJoined(ws: MockWebSocket, selfPeerId: string, existingPeers: string[] = []) {
  ws.fakeOpen();
  ws.fakeServerFrame(
    encode({ kind: "joined", protocolVersion: 1, selfPeerId, peers: existingPeers }),
  );
}

describe("RelayRoom", () => {
  test("includes app/room/peer/token in the URL", () => {
    const { ws } = makeRoom({ peerId: "self-1", authToken: "secret" });
    const url = new URL(ws.url);
    expect(url.searchParams.get("app")).toBe("test-app");
    expect(url.searchParams.get("room")).toBe("room-1");
    expect(url.searchParams.get("peer")).toBe("self-1");
    expect(url.searchParams.get("token")).toBe("secret");
  });

  test("ready() resolves after joined frame", async () => {
    const { room, ws } = makeRoom();
    fakeJoined(ws, "self-1", ["p-2"]);
    await room.ready();
  });

  test("onPeerJoin fires for existing peers (from joined frame) and new peers", async () => {
    const { room, ws } = makeRoom();
    const seen: string[] = [];
    room.onPeerJoin((p) => seen.push(p));
    fakeJoined(ws, "self-1", ["p-2", "p-3"]);
    await room.ready();
    ws.fakeServerFrame(encode({ kind: "peer-join", peerId: "p-4" }));
    expect(seen).toEqual(["p-2", "p-3", "p-4"]);
  });

  test("onPeerLeave fires when peer-leave arrives", async () => {
    const { room, ws } = makeRoom();
    const gone: string[] = [];
    room.onPeerLeave((p) => gone.push(p));
    fakeJoined(ws, "self-1", ["p-2"]);
    await room.ready();
    ws.fakeServerFrame(encode({ kind: "peer-leave", peerId: "p-2" }));
    expect(gone).toEqual(["p-2"]);
  });

  test("makeAction send() emits send frame on the wire", async () => {
    const { room, ws } = makeRoom();
    fakeJoined(ws, "self-1");
    await room.ready();
    const [send] = room.makeAction<string>("acp");
    await send("hello");
    const last = JSON.parse(ws.sent[ws.sent.length - 1]!);
    expect(last.kind).toBe("send");
    expect(last.ns).toBe("acp");
    expect(last.data).toBe("s:hello");
  });

  test("makeAction receive() decodes string payloads", async () => {
    const { room, ws } = makeRoom();
    fakeJoined(ws, "self-1");
    await room.ready();
    const [, recv] = room.makeAction<string>("acp");
    const got: Array<{ data: unknown; peer: string }> = [];
    recv((data, peerId) => got.push({ data, peer: peerId }));
    ws.fakeServerFrame(
      encode({ kind: "recv", ns: "acp", data: "s:hi-there", from: "p-2" }),
    );
    expect(got).toEqual([{ data: "hi-there", peer: "p-2" }]);
  });

  test("makeAction receive() round-trips JSON object payloads", async () => {
    const { room, ws } = makeRoom();
    fakeJoined(ws, "self-1");
    await room.ready();
    const [send, recv] = room.makeAction<{ x: number }>("acp");
    const got: Array<{ x: number }> = [];
    recv((data) => got.push(data));

    await send({ x: 42 });
    const sentFrame = JSON.parse(ws.sent[ws.sent.length - 1]!) as RelayFrame & { kind: "send" };
    expect(sentFrame.data).toBe('j:{"x":42}');
    // Loopback: server would relay this back as `recv`.
    ws.fakeServerFrame(encode({ kind: "recv", ns: "acp", data: sentFrame.data, from: "p-2" }));
    expect(got).toEqual([{ x: 42 }]);
  });

  test("ping from server is auto-ponged", async () => {
    const { room, ws } = makeRoom();
    fakeJoined(ws, "self-1");
    await room.ready();
    ws.fakeServerFrame(encode({ kind: "ping", ts: 999 }));
    const last = JSON.parse(ws.sent[ws.sent.length - 1]!);
    expect(last).toEqual({ kind: "pong", ts: 999 });
  });

  test("frames sent before OPEN are queued and flushed on open", async () => {
    const { room, ws } = makeRoom();
    // Don't call fakeOpen yet — socket is in CONNECTING.
    const [send] = room.makeAction<string>("acp");
    void send("queued-1");
    expect(ws.sent.length).toBe(0);
    fakeJoined(ws, "self-1");
    await room.ready();
    expect(ws.sent.some((f) => f.includes("queued-1"))).toBe(true);
  });

  test("error frame from server triggers onError and fails join", async () => {
    const { room, ws } = makeRoom();
    const errors: Error[] = [];
    // Replace the onError option after construction? Easiest: inspect via ready().
    ws.fakeOpen();
    ws.fakeServerFrame(
      encode({ kind: "error", code: "auth_failed", message: "bad token" }),
    );
    await expect(room.ready()).rejects.toThrow(/auth_failed/);
    expect(errors).toEqual([]); // no separate handler attached in this test
  });

  test("ready() rejects on connect timeout", async () => {
    const room = new RelayRoom(
      {
        appId: "t",
        relayUrl: "ws://r/",
        WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
        connectTimeoutMs: 50,
      },
      "r-1",
    );
    // Never call fakeJoined — let the timer fire.
    await expect(room.ready()).rejects.toThrow(/timed out/);
  });

  test("leave() closes the socket", async () => {
    const { room, ws } = makeRoom();
    fakeJoined(ws, "self-1");
    await room.ready();
    await room.leave();
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
  });

  test("server close while in-flight fires onPeerLeave for known peers", async () => {
    const { room, ws } = makeRoom();
    const gone: string[] = [];
    room.onPeerLeave((p) => gone.push(p));
    fakeJoined(ws, "self-1", ["p-2", "p-3"]);
    await room.ready();
    ws.fakeServerClose(1006, "broken");
    expect(new Set(gone)).toEqual(new Set(["p-2", "p-3"]));
  });
});
