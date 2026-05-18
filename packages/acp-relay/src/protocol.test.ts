import { describe, expect, test } from "bun:test";
import { decode, encode, type RelayFrame } from "./protocol.js";

describe("relay protocol encode/decode", () => {
  const cases: RelayFrame[] = [
    { kind: "joined", protocolVersion: 1, selfPeerId: "p-1", peers: ["p-2", "p-3"] },
    { kind: "peer-join", peerId: "p-4" },
    { kind: "peer-leave", peerId: "p-3" },
    { kind: "send", ns: "acp", data: "{\"x\":1}", to: ["p-2"], meta: { trace: "abc" } },
    { kind: "send", ns: "acp", data: "broadcast" },
    { kind: "recv", ns: "acp", data: "hi", from: "p-2" },
    { kind: "ping", ts: 12345 },
    { kind: "pong", ts: 12345 },
    { kind: "error", code: "version_mismatch", message: "client speaks v0" },
  ];

  for (const frame of cases) {
    test(`round-trips ${frame.kind}`, () => {
      const round = decode(encode(frame));
      expect(round).toEqual(frame);
    });
  }

  test("throws on garbage", () => {
    expect(() => decode("not json")).toThrow();
    expect(() => decode("{}")).toThrow(/kind/);
  });
});
