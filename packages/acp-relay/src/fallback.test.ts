import { describe, expect, test } from "bun:test";
import type { JoinRoom, Room } from "@trystero-p2p/core";
import { withFallback } from "./fallback.js";

const tick = () => new Promise<void>((r) => queueMicrotask(r));
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Minimal fake Room: lets tests fire onPeerJoin / onPeerLeave manually. */
function makeFakeRoom() {
  const joinHandlers: Array<(p: string) => void> = [];
  const leaveHandlers: Array<(p: string) => void> = [];
  const receivers = new Map<string, Array<(d: unknown, p: string, m?: unknown) => void>>();
  const sent: Array<{ ns: string; data: unknown; targets?: unknown; metadata?: unknown }> = [];
  let left = false;

  const room: Room = {
    makeAction: ((ns: string) => {
      let list = receivers.get(ns);
      if (!list) {
        list = [];
        receivers.set(ns, list);
      }
      const send = async (data: unknown, targets?: unknown, metadata?: unknown) => {
        sent.push({ ns, data, targets, metadata });
        return [];
      };
      const receive = (cb: (d: unknown, p: string, m?: unknown) => void) => {
        list!.push(cb);
      };
      const onProgress = () => {};
      return [send, receive, onProgress];
    }) as Room["makeAction"],
    ping: () => Promise.resolve(0),
    leave: async () => {
      left = true;
    },
    getPeers: () => ({}),
    addStream: () => [],
    removeStream: () => {},
    addTrack: () => [],
    removeTrack: () => {},
    replaceTrack: () => [],
    onPeerJoin: (fn) => joinHandlers.push(fn),
    onPeerLeave: (fn) => leaveHandlers.push(fn),
    onPeerStream: () => {},
    onPeerTrack: () => {},
  };

  return {
    room,
    sent,
    get left() {
      return left;
    },
    firePeerJoin(p: string) {
      for (const h of joinHandlers) h(p);
    },
    firePeerLeave(p: string) {
      for (const h of leaveHandlers) h(p);
    },
    deliver(ns: string, data: unknown, from = "p-other", meta?: unknown) {
      for (const cb of receivers.get(ns) ?? []) cb(data, from, meta);
    },
  };
}

describe("withFallback", () => {
  test("uses primary when primary sees a peer join", async () => {
    const primary = makeFakeRoom();
    const fallback = makeFakeRoom();
    let fallbackCalled = false;
    const fallbackReasons: Array<"timeout" | "error"> = [];

    const join: JoinRoom = withFallback(
      (() => primary.room) as unknown as JoinRoom,
      (() => {
        fallbackCalled = true;
        return fallback.room;
      }) as unknown as JoinRoom,
      { timeoutMs: 100, onFallback: (r) => fallbackReasons.push(r) },
    );

    const room = join({ appId: "x" }, "r");
    const seen: string[] = [];
    room.onPeerJoin((p) => seen.push(p));

    // Signal life on the primary before timeout fires.
    primary.firePeerJoin("p-1");
    await wait(150);
    expect(seen).toEqual(["p-1"]);
    expect(fallbackCalled).toBe(false);
    expect(fallbackReasons).toEqual([]);
    await room.leave();
  });

  test("switches to fallback on timeout when primary is silent", async () => {
    const primary = makeFakeRoom();
    const fallback = makeFakeRoom();
    const fallbackReasons: Array<"timeout" | "error"> = [];

    const join: JoinRoom = withFallback(
      (() => primary.room) as unknown as JoinRoom,
      (() => fallback.room) as unknown as JoinRoom,
      { timeoutMs: 50, onFallback: (r) => fallbackReasons.push(r) },
    );
    const room = join({ appId: "x" }, "r");
    const seen: string[] = [];
    room.onPeerJoin((p) => seen.push(p));

    await wait(100);
    expect(fallbackReasons).toEqual(["timeout"]);
    expect(primary.left).toBe(true);

    // Now the fallback's peer events come through.
    fallback.firePeerJoin("p-fallback");
    await tick();
    expect(seen).toEqual(["p-fallback"]);
    await room.leave();
  });

  test("send() routes to whichever room is active", async () => {
    const primary = makeFakeRoom();
    const fallback = makeFakeRoom();

    const join: JoinRoom = withFallback(
      (() => primary.room) as unknown as JoinRoom,
      (() => fallback.room) as unknown as JoinRoom,
      { timeoutMs: 30 },
    );
    const room = join({ appId: "x" }, "r");
    const [send] = room.makeAction<string>("acp");

    // Send during primary phase.
    await send("first");
    expect(primary.sent.length).toBe(1);

    // Wait for switch.
    await wait(80);

    await send("second");
    expect(fallback.sent.length).toBe(1);
    expect(fallback.sent[0]?.data).toBe("second");
    await room.leave();
  });

  test("receive() fires for the fallback room after switch", async () => {
    // Primary stays silent → switch to fallback → fallback delivers → user cb fires.
    const primary = makeFakeRoom();
    const fallback = makeFakeRoom();

    const join: JoinRoom = withFallback(
      (() => primary.room) as unknown as JoinRoom,
      (() => fallback.room) as unknown as JoinRoom,
      { timeoutMs: 30 },
    );
    const room = join({ appId: "x" }, "r");
    const got: unknown[] = [];
    const [, recv] = room.makeAction<string>("acp");
    recv((data) => got.push(data));

    await wait(80); // primary silent → switch fires
    fallback.deliver("acp", "via-fallback");
    await tick();
    expect(got).toEqual(["via-fallback"]);
    await room.leave();
  });

  test("receive() fires for the primary room when no switch happens", async () => {
    const primary = makeFakeRoom();
    const fallback = makeFakeRoom();

    const join: JoinRoom = withFallback(
      (() => primary.room) as unknown as JoinRoom,
      (() => fallback.room) as unknown as JoinRoom,
      { timeoutMs: 30 },
    );
    const room = join({ appId: "x" }, "r");
    const got: unknown[] = [];
    const [, recv] = room.makeAction<string>("acp");
    recv((data) => got.push(data));

    primary.deliver("acp", "via-primary");
    await tick();
    expect(got).toEqual(["via-primary"]);
    await wait(80); // primary already proved alive → no switch
    expect(fallback.sent.length).toBe(0);
    await room.leave();
  });

  test("primary delivering a frame counts as signal-of-life and prevents fallback", async () => {
    const primary = makeFakeRoom();
    const fallback = makeFakeRoom();
    let fallbackCalled = false;

    const join: JoinRoom = withFallback(
      (() => primary.room) as unknown as JoinRoom,
      (() => {
        fallbackCalled = true;
        return fallback.room;
      }) as unknown as JoinRoom,
      { timeoutMs: 50 },
    );
    const room = join({ appId: "x" }, "r");
    const [, recv] = room.makeAction<string>("acp");
    recv(() => {});

    // No peer join, but a frame arrives.
    primary.deliver("acp", "anything");
    await wait(100);
    expect(fallbackCalled).toBe(false);
    await room.leave();
  });

  test("primary constructor throwing switches to fallback immediately", async () => {
    const fallback = makeFakeRoom();
    const fallbackReasons: Array<"timeout" | "error"> = [];

    const join: JoinRoom = withFallback(
      (() => {
        throw new Error("primary broken");
      }) as unknown as JoinRoom,
      (() => fallback.room) as unknown as JoinRoom,
      { timeoutMs: 1000, onFallback: (r) => fallbackReasons.push(r) },
    );
    const room = join({ appId: "x" }, "r");
    const seen: string[] = [];
    room.onPeerJoin((p) => seen.push(p));
    expect(fallbackReasons).toEqual(["error"]);

    fallback.firePeerJoin("p-1");
    await tick();
    expect(seen).toEqual(["p-1"]);
    await room.leave();
  });
});
