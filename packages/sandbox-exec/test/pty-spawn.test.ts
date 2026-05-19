import { describe, expect, it } from "bun:test";
import { createPtySpawn } from "../src/pty-spawn.js";
import { makeFakeSandbox } from "./_fake-sandbox.js";

const enc = (s: string) => new TextEncoder().encode(s);

describe("createPtySpawn", () => {
  it("configures the builder with tty + stdinPipe and the requested cwd/env", async () => {
    const fake = makeFakeSandbox([
      { kind: "started", pid: 42 },
      { kind: "exited", code: 0 },
    ]);
    const spawn = createPtySpawn(fake.sandbox);

    spawn("/bin/zsh", ["-l"], {
      cwd: "/root",
      env: { TERM: "xterm-256color" },
    });

    // Builder configuration happens inside execStreamWith — wait a tick for it.
    await new Promise((r) => setTimeout(r, 5));

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.cmd).toBe("/bin/zsh");
    expect(fake.calls[0]!.args).toEqual(["-l"]);
    expect(fake.calls[0]!.cwd).toBe("/root");
    expect(fake.calls[0]!.env).toEqual({ TERM: "xterm-256color" });
    expect(fake.calls[0]!.tty).toBe(true);
    expect(fake.calls[0]!.stdinPiped).toBe(true);
  });

  it("forwards stdout/stderr as utf-8 strings to onData listeners", async () => {
    const fake = makeFakeSandbox([
      { kind: "started", pid: 7 },
      { kind: "stdout", data: enc("hello ") },
      { kind: "stderr", data: enc("world") },
      { kind: "exited", code: 0 },
    ]);
    const spawn = createPtySpawn(fake.sandbox);
    const pty = spawn("/bin/sh", [], {});

    const chunks: string[] = [];
    pty.onData((d) => chunks.push(d));

    const exitCode = await new Promise<number>((resolve) =>
      pty.onExit((e) => resolve(e.exitCode)),
    );

    expect(chunks.join("")).toBe("hello world");
    expect(exitCode).toBe(0);
    expect(pty.pid).toBe(7);
  });

  it("queues writes that arrive before stdin is ready", async () => {
    const fake = makeFakeSandbox([
      { kind: "started", pid: 1, delayMs: 20 },
      { kind: "exited", code: 0 },
    ]);
    const spawn = createPtySpawn(fake.sandbox);
    const pty = spawn("/bin/sh", [], {});

    pty.write("early-1");
    pty.write("early-2");

    await new Promise((r) => setTimeout(r, 50));

    expect(fake.stdinChunks.map((b) => b.toString("utf8"))).toEqual([
      "early-1",
      "early-2",
    ]);
  });

  it("resize is a no-op (microsandbox has no winsize API)", async () => {
    const fake = makeFakeSandbox([
      { kind: "started", pid: 1 },
      { kind: "exited", code: 0 },
    ]);
    const spawn = createPtySpawn(fake.sandbox);
    const pty = spawn("/bin/sh", [], {});
    expect(() => pty.resize(120, 40)).not.toThrow();
  });

  it("kill before spawn lands aborts the handle once it resolves", async () => {
    const fake = makeFakeSandbox([
      { kind: "started", pid: 1, delayMs: 30 },
      { kind: "exited", code: 0 },
    ]);
    const spawn = createPtySpawn(fake.sandbox);
    const pty = spawn("/bin/sh", [], {});
    pty.kill();
    await new Promise((r) => setTimeout(r, 50));
    expect(fake.wasKilled()).toBe(true);
  });
});
