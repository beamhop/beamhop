import { describe, it } from "./_shim.js";
import assert from "./_shim.js";
import {
  ImageRef,
  SandboxExitError,
  assertExitOk,
  generateSandboxName,
} from "../src/image-builder.js";
import type { ImageMetadata } from "../src/index.js";

// Minimal ExecOutput-compatible fake. The real class is from the
// microsandbox SDK; we only need the surface assertExitOk + the
// SandboxExitError constructor touch.
function fakeOutput(code: number, stdout = "", stderr = ""): any {
  return {
    code,
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

describe("assertExitOk", () => {
  it("returns the output untouched on exit 0", () => {
    const out = fakeOutput(0, "hello\n");
    assert.equal(assertExitOk(out, "true", undefined), out);
  });

  it("throws SandboxExitError on non-zero by default", () => {
    const out = fakeOutput(1, "", "boom");
    assert.throws(
      () => assertExitOk(out, "false", undefined),
      (err: unknown) => {
        assert.ok(err instanceof SandboxExitError);
        assert.equal(err.command, "false");
        assert.equal(err.exitCode, 1);
        assert.equal(err.stderr, "boom");
        assert.equal(err.output, out);
        return true;
      },
    );
  });

  it("does not throw when throwOnNonZero is explicitly false", () => {
    const out = fakeOutput(7);
    assert.equal(assertExitOk(out, "exit 7", false), out);
  });

  it("does throw when throwOnNonZero is explicitly true", () => {
    const out = fakeOutput(2);
    assert.throws(
      () => assertExitOk(out, "x", true),
      (err: unknown) => err instanceof SandboxExitError,
    );
  });
});

describe("generateSandboxName", () => {
  it("strips the trailing -<sha-prefix> beambox appends", () => {
    const name = generateSandboxName("my-app_1.0-abc123def456");
    assert.match(name, /^my-app_1\.0-[0-9a-f]{8}$/);
  });

  it("falls back to the full name when there's no dash", () => {
    const name = generateSandboxName("nodash");
    assert.match(name, /^nodash-[0-9a-f]{8}$/);
  });

  it("produces a different suffix per call", () => {
    const a = generateSandboxName("x-abc");
    const b = generateSandboxName("x-abc");
    assert.notEqual(a, b);
  });
});

// --- ImageRef.exec / shell wiring (mocks Sandbox to avoid booting a VM) ---

const meta: ImageMetadata = {
  snapshotName: "tag-deadbeefcafe",
  digest: "deadbeefcafe".repeat(5).slice(0, 64),
  baseImage: "alpine:3.19",
  env: {},
  workdir: null,
  user: null,
  entrypoint: null,
  cmd: null,
  createdAt: new Date(0).toISOString(),
};

function makeMockedRef(opts: {
  exec?: (cmd: string, args: string[]) => Promise<any>;
  shell?: (script: string) => Promise<any>;
}): { ref: ImageRef; runNames: string[] } {
  const ref = new ImageRef(meta);
  const runNames: string[] = [];
  // Replace `run` so no real microVM is created. The returned object
  // pretends to be a Sandbox: it provides exec/shell and is an
  // async-disposable.
  (ref as any).run = async (options: any) => {
    runNames.push(options.name);
    const sb: any = {
      exec: opts.exec ?? (async () => fakeOutput(0)),
      shell: opts.shell ?? (async () => fakeOutput(0)),
      [Symbol.asyncDispose]: async () => {},
    };
    return sb;
  };
  return { ref, runNames };
}

describe("ImageRef.exec", () => {
  it("forwards argv[0] as command and argv[1..] as args", async () => {
    let captured: { cmd: string; args: string[] } | null = null;
    const { ref } = makeMockedRef({
      exec: async (cmd, args) => {
        captured = { cmd, args };
        return fakeOutput(0);
      },
    });
    await ref.exec(["node", "-e", "1+1"]);
    assert.deepEqual(captured, { cmd: "node", args: ["-e", "1+1"] });
  });

  it("throws on empty argv", async () => {
    const { ref } = makeMockedRef({});
    await assert.rejects(() => ref.exec([]), /at least the program name/);
  });

  it("auto-generates a sandbox name when omitted", async () => {
    const { ref, runNames } = makeMockedRef({});
    await ref.exec(["true"]);
    assert.equal(runNames.length, 1);
    assert.match(runNames[0]!, /^tag-[0-9a-f]{8}$/);
  });

  it("uses the caller-provided name when set", async () => {
    const { ref, runNames } = makeMockedRef({});
    await ref.exec(["true"], { name: "explicit" });
    assert.deepEqual(runNames, ["explicit"]);
  });

  it("throws SandboxExitError on non-zero exit", async () => {
    const { ref } = makeMockedRef({
      exec: async () => fakeOutput(2, "", "nope"),
    });
    await assert.rejects(
      () => ref.exec(["false"]),
      (err: unknown) => {
        assert.ok(err instanceof SandboxExitError);
        assert.equal(err.exitCode, 2);
        assert.equal(err.command, "false");
        return true;
      },
    );
  });

  it("does not throw when throwOnNonZero is false", async () => {
    const { ref } = makeMockedRef({
      exec: async () => fakeOutput(2, "out", "err"),
    });
    const out = await ref.exec(["false"], { throwOnNonZero: false });
    assert.equal(out.code, 2);
    assert.equal(out.stderr(), "err");
  });
});

describe("ImageRef.shell", () => {
  it("forwards the script to Sandbox.shell", async () => {
    let captured: string | null = null;
    const { ref } = makeMockedRef({
      shell: async (script) => {
        captured = script;
        return fakeOutput(0);
      },
    });
    await ref.shell("ls -la | wc -l");
    assert.equal(captured, "ls -la | wc -l");
  });

  it("auto-generates name when omitted", async () => {
    const { ref, runNames } = makeMockedRef({});
    await ref.shell("true");
    assert.match(runNames[0]!, /^tag-[0-9a-f]{8}$/);
  });

  it("throws SandboxExitError on non-zero exit", async () => {
    const { ref } = makeMockedRef({
      shell: async () => fakeOutput(1, "", "boom"),
    });
    await assert.rejects(
      () => ref.shell("exit 1"),
      (err: unknown) => err instanceof SandboxExitError && err.command === "exit 1",
    );
  });

  it("does not throw when throwOnNonZero is false", async () => {
    const { ref } = makeMockedRef({
      shell: async () => fakeOutput(3),
    });
    const out = await ref.shell("exit 3", { throwOnNonZero: false });
    assert.equal(out.code, 3);
  });
});
