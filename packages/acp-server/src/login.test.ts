import { describe, expect, test } from "bun:test";
import { createConsoleLogger } from "./logger.js";
import {
  PendingLogins,
  resolveLogin,
  type IPty,
  type PtySpawn,
} from "./login.js";
import { defineAgent } from "./registry.js";

const silentLogger = createConsoleLogger({ level: "error", format: "json" });

/**
 * In-memory PTY mock. node-pty's event callbacks fire reliably under Node
 * (which is how the gateway runs at runtime via the Bun adapter) but not
 * under bun:test, so we mock the surface and exercise PendingLogins' own
 * logic — which is the entire point of these tests.
 */
function makeFakePty(): {
  spawn: PtySpawn;
  /** All ptys spawned, in order. */
  readonly all: FakePty[];
} {
  const all: FakePty[] = [];
  const spawn: PtySpawn = (file, args, opts) => {
    const p = new FakePty(file, args, opts);
    all.push(p);
    return p;
  };
  return { spawn, all };
}

class FakePty implements IPty {
  pid = Math.floor(Math.random() * 100000);
  private dataCbs: ((d: string) => void)[] = [];
  private exitCbs: ((e: { exitCode: number; signal?: number }) => void)[] = [];
  killed = false;
  writes: string[] = [];
  resizes: [number, number][] = [];
  constructor(
    public readonly file: string,
    public readonly args: string[],
    public readonly opts: { cols: number; rows: number; cwd: string; env: Record<string, string> },
  ) {}
  onData(cb: (d: string) => void) {
    this.dataCbs.push(cb);
  }
  onExit(cb: (e: { exitCode: number; signal?: number }) => void) {
    this.exitCbs.push(cb);
  }
  write(data: string) {
    this.writes.push(data);
  }
  resize(cols: number, rows: number) {
    this.resizes.push([cols, rows]);
  }
  kill(_signal?: string) {
    this.killed = true;
    // Real node-pty fires onExit synchronously here on most platforms.
    queueMicrotask(() => {
      for (const cb of this.exitCbs) cb({ exitCode: 0, signal: 15 });
    });
  }
  /** Test-only: simulate the PTY child writing to stdout. */
  emitData(data: string) {
    for (const cb of this.dataCbs) cb(data);
  }
  /** Test-only: simulate the PTY child exiting on its own. */
  emitExit(exitCode: number) {
    for (const cb of this.exitCbs) cb({ exitCode });
  }
}

function sinks() {
  let buf = "";
  let resolver: (v: { exitCode: number | null; reason: string }) => void = () => {};
  const ended = new Promise<{ exitCode: number | null; reason: string }>(
    (r) => (resolver = r),
  );
  return {
    sinks: {
      onData(data: string) {
        buf += data;
      },
      onEnd(exitCode: number | null, reason: string) {
        resolver({ exitCode, reason });
      },
    },
    get output() {
      return buf;
    },
    ended,
  };
}

const stubAgent = defineAgent({ id: "stub", command: "/bin/cat" });
const stubSpec = {
  kind: "tty" as const,
  command: "/bin/sh",
  args: ["-c", "exit 0"],
};

describe("PendingLogins", () => {
  test("forwards PTY data to the sink and emits exit on natural exit", async () => {
    const fake = makeFakePty();
    const pending = new PendingLogins(silentLogger, resolveLogin(undefined), {
      spawn: fake.spawn,
    });
    const s = sinks();
    await pending.start(stubAgent, stubSpec, s.sinks);
    const pty = fake.all[0]!;
    pty.emitData("hello\r\n");
    pty.emitExit(0);
    const end = await s.ended;
    expect(end.reason).toBe("exit");
    expect(end.exitCode).toBe(0);
    expect(s.output).toBe("hello\r\n");
  });

  test("write() forwards bytes to the PTY", async () => {
    const fake = makeFakePty();
    const pending = new PendingLogins(silentLogger, resolveLogin(undefined), {
      spawn: fake.spawn,
    });
    const s = sinks();
    const loginId = await pending.start(stubAgent, stubSpec, s.sinks);
    pending.write(loginId, "ping\n");
    expect(fake.all[0]!.writes).toEqual(["ping\n"]);
  });

  test("success_marker ends with reason=success_marker after grace", async () => {
    const fake = makeFakePty();
    const pending = new PendingLogins(silentLogger, resolveLogin(undefined), {
      spawn: fake.spawn,
    });
    const s = sinks();
    await pending.start(
      stubAgent,
      { ...stubSpec, successMarker: /Signed in as/ },
      s.sinks,
    );
    fake.all[0]!.emitData("Signed in as kucukkanat\r\n");
    const end = await s.ended;
    expect(end.reason).toBe("success_marker");
    expect(fake.all[0]!.killed).toBe(true);
  });

  test("cancel() ends with reason=cancelled", async () => {
    const fake = makeFakePty();
    const pending = new PendingLogins(silentLogger, resolveLogin(undefined), {
      spawn: fake.spawn,
    });
    const s = sinks();
    const loginId = await pending.start(stubAgent, stubSpec, s.sinks);
    pending.cancel(loginId);
    const end = await s.ended;
    expect(end.reason).toBe("cancelled");
    expect(fake.all[0]!.killed).toBe(true);
  });

  test("timeout fires when spec.timeoutMs is exceeded", async () => {
    const fake = makeFakePty();
    const pending = new PendingLogins(silentLogger, resolveLogin(undefined), {
      spawn: fake.spawn,
    });
    const s = sinks();
    await pending.start(stubAgent, { ...stubSpec, timeoutMs: 30 }, s.sinks);
    const end = await s.ended;
    expect(end.reason).toBe("timeout");
  });

  test("closeAll cancels every active session", async () => {
    const fake = makeFakePty();
    const pending = new PendingLogins(silentLogger, resolveLogin(undefined), {
      spawn: fake.spawn,
    });
    const a = sinks();
    const b = sinks();
    await pending.start(stubAgent, stubSpec, a.sinks);
    await pending.start(stubAgent, stubSpec, b.sinks);
    expect(pending.activeCount).toBe(2);
    pending.closeAll("test_shutdown");
    const [endA, endB] = await Promise.all([a.ended, b.ended]);
    expect(endA.reason).toBe("cancelled");
    expect(endB.reason).toBe("cancelled");
    expect(pending.activeCount).toBe(0);
  });

  test("resize() returns true while the PTY is alive, false after end", async () => {
    const fake = makeFakePty();
    const pending = new PendingLogins(silentLogger, resolveLogin(undefined), {
      spawn: fake.spawn,
    });
    const s = sinks();
    const loginId = await pending.start(stubAgent, stubSpec, s.sinks);
    expect(pending.resize(loginId, 120, 40)).toBe(true);
    expect(fake.all[0]!.resizes).toEqual([[120, 40]]);
    pending.cancel(loginId);
    await s.ended;
    expect(pending.resize(loginId, 80, 24)).toBe(false);
  });

  test("write to unknown loginId returns false", async () => {
    const fake = makeFakePty();
    const pending = new PendingLogins(silentLogger, resolveLogin(undefined), {
      spawn: fake.spawn,
    });
    expect(pending.write("nonexistent", "x")).toBe(false);
  });

  test("inherits spec.env and spec.cwd into the spawn options", async () => {
    const fake = makeFakePty();
    const pending = new PendingLogins(silentLogger, resolveLogin(undefined), {
      spawn: fake.spawn,
    });
    const s = sinks();
    await pending.start(
      stubAgent,
      { ...stubSpec, env: { FOO: "bar" }, cwd: "/tmp" },
      s.sinks,
    );
    const opts = fake.all[0]!.opts;
    expect(opts.cwd).toBe("/tmp");
    expect(opts.env.FOO).toBe("bar");
  });

});
