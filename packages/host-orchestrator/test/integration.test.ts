import { afterAll, describe, expect, it } from "bun:test";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SandboxImage } from "@beamhop/beambox";
import { HostOrchestrator } from "../src/index.js";

// Integration test — boots real microsandbox. Gated by RUN_INTEGRATION.
const skip = !process.env.RUN_INTEGRATION;
if (skip) {
  console.error(
    "[host-orchestrator integration] skipping — set RUN_INTEGRATION=1 to run",
  );
}

describe.skipIf(skip)("HostOrchestrator (terminal lifecycle, no share)", () => {
  const tag = `orchtest-${Math.random().toString(36).slice(2, 8)}`;
  const created: string[] = [];

  afterAll(async () => {
    const metaDir = path.join(os.homedir(), ".microsandbox", "images");
    for (const name of created) {
      await fs.unlink(path.join(metaDir, `${name}.json`)).catch(() => {});
    }
  });

  it("creates a sandbox, starts a terminal, runs uname, cleans up", async () => {
    const img = await SandboxImage.builder()
      .from("alpine:3.19")
      .build(`${tag}-img`);
    created.push(img.snapshotName);

    const orch = new HostOrchestrator();
    const sandboxEvents: string[] = [];
    const sessionEvents: string[] = [];
    orch.on("sandbox:created", (r) => sandboxEvents.push(`created:${r.id}`));
    orch.on("sandbox:closed", (id) => sandboxEvents.push(`closed:${id}`));
    orch.on("session:created", (r) => sessionEvents.push(`created:${r.id}`));
    orch.on("session:closed", (id) => sessionEvents.push(`closed:${id}`));

    const sandboxId = await orch.createSandbox(`${tag}-img`);
    const sessionId = await orch.startTerminal(sandboxId);

    // Drive the PTY directly through the session record so we don't need a transport.
    const session = orch.listSessions().find((s) => s.id === sessionId);
    expect(session?.pty).toBeDefined();
    const chunks: Buffer[] = [];
    const detach = session!.pty!.attach("test", 80, 24, (b) =>
      chunks.push(Buffer.from(b)),
    );
    await new Promise((r) => setTimeout(r, 1500));
    session!.pty!.write("uname -a\n");
    await new Promise((r) => setTimeout(r, 1500));
    detach();

    expect(Buffer.concat(chunks).toString("utf8")).toMatch(/Linux/);

    await orch.close();

    expect(sandboxEvents).toContain(`created:${sandboxId}`);
    expect(sandboxEvents).toContain(`closed:${sandboxId}`);
    expect(sessionEvents).toContain(`created:${sessionId}`);
    expect(sessionEvents).toContain(`closed:${sessionId}`);
  }, 120_000);
});
