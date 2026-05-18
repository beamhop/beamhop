import { describe, expect, test } from "bun:test";
import { encode } from "@beamhop/acp-protocol";
import { FakeNetwork } from "./__fixtures__/fake-room.js";
import { createRoomSocket } from "./host.js";

const microtaskDrain = () => new Promise<void>((r) => queueMicrotask(r));

describe("createRoomSocket", () => {
  test("delivers frames from any peer to onMessage", async () => {
    const net = new FakeNetwork();
    const hostRoom = net.spawn();
    const peerRoom = net.spawn();

    const socket = createRoomSocket(hostRoom);
    const received: string[] = [];
    socket.onMessage((data) => received.push(data));

    const [sendFromPeer] = peerRoom.makeAction<string>("acp");
    await sendFromPeer("frame-1");
    await sendFromPeer("frame-2");
    await microtaskDrain();

    expect(received).toEqual(["frame-1", "frame-2"]);
  });

  test("send() broadcasts to all peers", async () => {
    const net = new FakeNetwork();
    const hostRoom = net.spawn();
    const peerA = net.spawn();
    const peerB = net.spawn();

    const socket = createRoomSocket(hostRoom);
    const [, onFrameA] = peerA.makeAction<string>("acp");
    const [, onFrameB] = peerB.makeAction<string>("acp");
    const aGot: string[] = [];
    const bGot: string[] = [];
    onFrameA((d) => aGot.push(d));
    onFrameB((d) => bGot.push(d));

    socket.send("hello-all");
    await microtaskDrain();

    expect(aGot).toEqual(["hello-all"]);
    expect(bGot).toEqual(["hello-all"]);
  });

  test("replays the most recent ready frame to late joiners only", async () => {
    const net = new FakeNetwork();
    const hostRoom = net.spawn();
    const socket = createRoomSocket(hostRoom);

    const readyFrame = encode({
      kind: "ready",
      payload: {
        sessionId: "s-1",
        agentId: "claude-code",
        protocolVersion: 1,
        availableAgents: [],
        modelCatalog: null,
      },
    });
    const otherFrame = encode({
      kind: "log",
      payload: { level: "info", message: "noise", ts: Date.now() },
    });

    const earlyPeer = net.spawn();
    const [, earlyRecv] = earlyPeer.makeAction<string>("acp");
    const earlyGot: string[] = [];
    earlyRecv((d) => earlyGot.push(d));

    socket.send(readyFrame);
    socket.send(otherFrame);
    await microtaskDrain();

    const lateGot: string[] = [];
    const latePeer = net.spawn();
    const [, lateRecv] = latePeer.makeAction<string>("acp");
    lateRecv((d) => lateGot.push(d));
    await microtaskDrain();
    await microtaskDrain();

    expect(earlyGot).toContain(readyFrame);
    expect(earlyGot).toContain(otherFrame);
    expect(lateGot).toEqual([readyFrame]);
  });

  test("close() leaves the room", async () => {
    const net = new FakeNetwork();
    const hostRoom = net.spawn();
    const peerRoom = net.spawn();
    const socket = createRoomSocket(hostRoom);

    let closeFired = false;
    socket.onClose(() => {
      closeFired = true;
    });

    const leaveSeen: string[] = [];
    peerRoom.onPeerLeave((id) => leaveSeen.push(id));

    socket.close(1000, "test");
    await microtaskDrain();
    await microtaskDrain();

    expect(closeFired).toBe(true);
    expect(leaveSeen).toContain(hostRoom.peerId);
  });
});
