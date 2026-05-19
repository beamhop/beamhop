import { describe, expect, test } from "bun:test";
import {
  SharedPtySession,
  defaultPtyOptions,
  type PtyHandle,
  type PtySpawn,
} from "./pty-session.js";

/**
 * Build a fake PTY handle whose lifecycle is controlled by the test. The fake
 * surface mirrors what `SharedPtySession` actually uses — no node-pty needed.
 */
function fakePty(): {
  pty: PtyHandle;
  emit: (data: string) => void;
  exit: () => void;
  writes: string[];
  resizes: Array<[number, number]>;
  killed: boolean;
} {
  let dataCb: ((data: string) => void) | null = null;
  let exitCb: ((e: { exitCode: number; signal?: number }) => void) | null = null;
  const state = { writes: [] as string[], resizes: [] as Array<[number, number]>, killed: false };
  const pty: PtyHandle = {
    pid: 1234,
    onData(cb) {
      dataCb = cb;
    },
    onExit(cb) {
      exitCb = cb;
    },
    write(d) {
      state.writes.push(d);
    },
    resize(c, r) {
      state.resizes.push([c, r]);
    },
    kill() {
      state.killed = true;
    },
  };
  return {
    pty,
    emit: (data) => dataCb?.(data),
    exit: () => exitCb?.({ exitCode: 0 }),
    get writes() {
      return state.writes;
    },
    get resizes() {
      return state.resizes;
    },
    get killed() {
      return state.killed;
    },
  } as ReturnType<typeof fakePty>;
}

function options(spawn: PtySpawn) {
  return defaultPtyOptions({ shell: "fake", args: [], cwd: "/", env: {}, spawn });
}

describe("SharedPtySession history replay", () => {
  test("attach() to a fresh PTY does not replay anything (no history yet)", () => {
    const fp = fakePty();
    const session = new SharedPtySession(options(() => fp.pty));
    const chunks: string[] = [];
    session.attach("peer-1", 80, 24, (b) => chunks.push(Buffer.from(b).toString("utf8")));
    // No data has flowed yet.
    expect(chunks).toEqual([]);
    session.kill();
  });

  test("attach() to an existing PTY replays buffered output to the new sink", () => {
    const fp = fakePty();
    const session = new SharedPtySession(options(() => fp.pty));

    // First peer attaches, PTY spawns, PTY emits some output.
    const peer1: string[] = [];
    session.attach("peer-1", 80, 24, (b) => peer1.push(Buffer.from(b).toString("utf8")));
    fp.emit("hello\r\n");
    fp.emit("world\r\n");

    // Second peer attaches mid-session — should see the existing scrollback.
    const peer2: string[] = [];
    session.attach("peer-2", 80, 24, (b) => peer2.push(Buffer.from(b).toString("utf8")));
    expect(peer2.join("")).toBe("hello\r\nworld\r\n");

    // Subsequent live chunks fan out to both peers.
    fp.emit("after\r\n");
    expect(peer1.join("")).toBe("hello\r\nworld\r\nafter\r\n");
    expect(peer2.join("")).toBe("hello\r\nworld\r\nafter\r\n");

    session.kill();
  });

  test("a peer that detaches and re-attaches sees the replay (the tab-switch case)", () => {
    const fp = fakePty();
    const session = new SharedPtySession(options(() => fp.pty));

    // Hold a second peer permanently so the PTY doesn't enter idle-timeout
    // territory when peer A detaches — this mirrors the desktop app where the
    // user has another tab open while switching away from this one.
    session.attach("anchor", 80, 24, () => void 0);

    const detachA = session.attach("peer-A", 80, 24, () => void 0);
    fp.emit("line-1\r\n");
    detachA();

    // PTY keeps streaming while peer-A is detached.
    fp.emit("line-2\r\n");

    // Peer-A re-attaches — must see the full backlog, in order.
    const replayed: string[] = [];
    session.attach("peer-A", 80, 24, (b) => replayed.push(Buffer.from(b).toString("utf8")));
    expect(replayed.join("")).toBe("line-1\r\nline-2\r\n");

    session.kill();
  });

  test("history caps at the configured capacity (oldest bytes are dropped)", () => {
    const fp = fakePty();
    const session = new SharedPtySession(options(() => fp.pty));
    session.attach("anchor", 80, 24, () => void 0);

    // Push 80 KiB into a 64 KiB ring — oldest 16 KiB should fall off.
    const cap = 64 * 1024;
    const big = "a".repeat(cap) + "b".repeat(cap / 4);
    fp.emit(big);

    const replayed: string[] = [];
    session.attach("late", 80, 24, (b) => replayed.push(Buffer.from(b).toString("utf8")));
    const seen = Buffer.concat(replayed.map((s) => Buffer.from(s, "utf8")));
    expect(seen.length).toBe(cap);
    // The newest chunk lives at the tail.
    expect(seen.subarray(cap - cap / 4).toString("utf8")).toBe(
      "b".repeat(cap / 4),
    );
    // The 'a' suffix that survived the overwrite occupies the rest.
    expect(seen.subarray(0, cap - cap / 4).toString("utf8")).toBe(
      "a".repeat(cap - cap / 4),
    );

    session.kill();
  });

  test("kill() clears history (new sessions don't leak prior output)", () => {
    const fp1 = fakePty();
    const session = new SharedPtySession(options(() => fp1.pty));
    session.attach("p1", 80, 24, () => void 0);
    fp1.emit("first-session-output");
    session.kill();

    // Build a *new* session with its own fake PTY and confirm no bleed.
    const fp2 = fakePty();
    const session2 = new SharedPtySession(options(() => fp2.pty));
    const replayed: string[] = [];
    session2.attach("p2", 80, 24, (b) => replayed.push(Buffer.from(b).toString("utf8")));
    expect(replayed).toEqual([]);
    session2.kill();
  });
});
