import { describe, expect, it } from "bun:test";
import { createChildProcessSpawn } from "../src/child-process-spawn.js";
import { makeFakeSandbox } from "./_fake-sandbox.js";

const enc = (s: string) => new TextEncoder().encode(s);

function collect(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

describe("createChildProcessSpawn", () => {
  it("emits 'spawn' with pid set, then 'exit' with the exit code", async () => {
    const fake = makeFakeSandbox([
      { kind: "started", pid: 99 },
      { kind: "exited", code: 0 },
    ]);
    const spawn = createChildProcessSpawn(fake.sandbox);
    const child = spawn("/bin/echo", ["hi"], {});

    const spawnEvent = new Promise<void>((r) => child.once("spawn", () => r()));
    const exitInfo = new Promise<[number | null, NodeJS.Signals | null]>((r) =>
      child.once("exit", (code, signal) => r([code as number | null, signal as NodeJS.Signals | null])),
    );

    await spawnEvent;
    expect(child.pid).toBe(99);

    const [code, signal] = await exitInfo;
    expect(code).toBe(0);
    expect(signal).toBeNull();
    expect(child.exitCode).toBe(0);
  });

  it("pushes stdout / stderr chunks into the respective streams", async () => {
    const fake = makeFakeSandbox([
      { kind: "started", pid: 1 },
      { kind: "stdout", data: enc("OUT") },
      { kind: "stderr", data: enc("ERR") },
      { kind: "exited", code: 0 },
    ]);
    const spawn = createChildProcessSpawn(fake.sandbox);
    const child = spawn("/bin/sh", [], {});

    const [stdout, stderr] = await Promise.all([
      collect(child.stdout),
      collect(child.stderr),
    ]);

    expect(stdout).toBe("OUT");
    expect(stderr).toBe("ERR");
  });

  it("forwards stdin writes (queueing if stdin sink not yet bound)", async () => {
    const fake = makeFakeSandbox([
      { kind: "started", pid: 1, delayMs: 20 },
      { kind: "exited", code: 0 },
    ]);
    const spawn = createChildProcessSpawn(fake.sandbox);
    const child = spawn("/bin/sh", [], {});

    child.stdin.write("hello\n");
    child.stdin.write("world\n");

    await new Promise((r) => setTimeout(r, 50));

    expect(fake.stdinChunks.map((b) => b.toString("utf8")).join("")).toBe(
      "hello\nworld\n",
    );
  });

  it("emits 'error' (not throw) when execStreamWith rejects", async () => {
    const sandbox: any = {
      async execStreamWith() {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    };
    const spawn = createChildProcessSpawn(sandbox);
    const child = spawn("/no/such/cmd", [], {});
    const err = await new Promise<unknown>((r) =>
      child.once("error", (e) => r(e)),
    );
    expect((err as Error).message).toBe("ENOENT");
  });

  it("kill() invokes handle.kill()", async () => {
    const fake = makeFakeSandbox([
      { kind: "started", pid: 1 },
      { kind: "exited", code: 0 },
    ]);
    const spawn = createChildProcessSpawn(fake.sandbox);
    const child = spawn("/bin/sleep", ["60"], {});
    await new Promise((r) => child.once("spawn", () => r(undefined)));
    child.kill("SIGTERM");
    expect(fake.wasKilled()).toBe(true);
    expect(child.signalCode).toBe("SIGTERM");
  });

  it("passes cwd and env through to the builder", async () => {
    const fake = makeFakeSandbox([
      { kind: "started", pid: 1 },
      { kind: "exited", code: 0 },
    ]);
    const spawn = createChildProcessSpawn(fake.sandbox);
    spawn("/bin/env", [], {
      cwd: "/tmp",
      env: { FOO: "bar", BAZ: "qux" },
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(fake.calls[0]!.cwd).toBe("/tmp");
    expect(fake.calls[0]!.env).toEqual({ FOO: "bar", BAZ: "qux" });
    expect(fake.calls[0]!.stdinPiped).toBe(true);
    expect(fake.calls[0]!.tty).toBe(false);
  });
});
