import { afterAll, describe, expect, it } from "bun:test";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SandboxImage } from "@beamhop/beambox";
import { SharedPtySession, defaultPtyOptions } from "@beamhop/shell-server";
import { createPtySpawn } from "../src/pty-spawn.js";

// Integration test: boots a real microsandbox. Gated behind RUN_INTEGRATION
// so default `bun test` stays fast and works on CI without KVM / apple-virt.
const skip = !process.env.RUN_INTEGRATION;

if (skip) {
  console.error(
    "[integration.test] skipping — set RUN_INTEGRATION=1 to run (boots a real microVM)",
  );
}

describe.skipIf(skip)("PTY inside a microsandbox via SharedPtySession", () => {
  const tag = `sxexec-${Math.random().toString(36).slice(2, 8)}`;
  const created: string[] = [];

  afterAll(async () => {
    const metaDir = path.join(os.homedir(), ".microsandbox", "images");
    for (const name of created) {
      await fs.unlink(path.join(metaDir, `${name}.json`)).catch(() => {});
    }
  });

  it("runs a real shell inside the VM via createPtySpawn + SharedPtySession", async () => {
    const img = await SandboxImage.builder()
      .from("alpine:3.19")
      .build(`${tag}-base`);
    created.push(img.snapshotName);

    await using sandbox = await img.run({ name: `${tag}-run` });

    const session = new SharedPtySession(
      defaultPtyOptions({
        shell: "/bin/sh",
        args: [],
        cwd: "/",
        env: { PATH: "/usr/sbin:/usr/bin:/sbin:/bin", TERM: "xterm-256color" },
        idleTimeoutMs: 60_000,
        spawn: createPtySpawn(sandbox as never),
      }),
    );

    const chunks: Buffer[] = [];
    const detach = session.attach("test-peer", 80, 24, (bytes) => {
      chunks.push(Buffer.from(bytes));
    });

    // Wait for the prompt to settle, then ask for uname.
    await new Promise((r) => setTimeout(r, 1500));
    session.write("uname -a\n");
    await new Promise((r) => setTimeout(r, 1500));

    detach();
    session.kill();

    const output = Buffer.concat(chunks).toString("utf8");
    expect(output).toMatch(/Linux/);
  }, 120_000);
});
