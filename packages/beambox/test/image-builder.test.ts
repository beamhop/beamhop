import { describe, it, before, after } from "./_shim.js";
import assert from "./_shim.js";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { SandboxImage, BuildStepError } from "../src/index.js";

// Integration tests boot real microVMs. Gated behind RUN_INTEGRATION so
// `npm test` stays fast in CI / on machines without KVM or Apple Silicon.
const skip = !process.env.RUN_INTEGRATION;

if (skip) {
  console.error(
    "[image-builder.test] skipping integration suite — set RUN_INTEGRATION=1 to run (auto-installs the microsandbox runtime on first build)",
  );
}

describe("SandboxImage (integration)", { skip }, () => {
  const tag = `imgtest-${Math.random().toString(36).slice(2, 8)}`;
  const created: string[] = [];

  after(async () => {
    // Best-effort cleanup of metadata sidecars; snapshots can be removed via `msb` CLI.
    const metaDir = path.join(os.homedir(), ".microsandbox", "images");
    for (const name of created) {
      await fs.unlink(path.join(metaDir, `${name}.json`)).catch(() => {});
    }
  });

  it("builds a trivial fluent image and spawns from it", async () => {
    const img = await SandboxImage.builder()
      .from("alpine:3.19")
      .run("echo hello > /greeting")
      .build(`${tag}-fluent`);
    created.push(img.snapshotName);

    await using sb = await img.run({ name: `${tag}-fluent-run` });
    const out = await sb.exec("cat", ["/greeting"]);
    assert.equal(out.code, 0);
    assert.equal(out.stdout(), "hello\n");
  });

  it("builds from a Dockerfile string and applies ENV + CMD metadata", async () => {
    const ctx = await fs.mkdtemp(path.join(os.tmpdir(), "sandbox-img-"));
    await fs.writeFile(path.join(ctx, "msg.txt"), "from-context", "utf8");

    const dockerfile = `
FROM alpine:3.19
ENV GREETING=hi
WORKDIR /work
COPY msg.txt /work/msg.txt
CMD ["sh", "-c", "echo $GREETING && cat /work/msg.txt"]
`;
    const img = await SandboxImage.fromDockerfileString(dockerfile).build(`${tag}-dockerfile`, {
      contextDir: ctx,
    });
    created.push(img.snapshotName);
    assert.equal(img.metadata.env.GREETING, "hi");
    assert.equal(img.metadata.workdir, "/work");
    assert.deepEqual(img.metadata.cmd, ["sh", "-c", "echo $GREETING && cat /work/msg.txt"]);

    await using sb = await img.run({ name: `${tag}-dockerfile-run` });
    const out = await sb.exec("sh", ["-c", "echo $GREETING && cat /work/msg.txt"]);
    assert.equal(out.code, 0);
    assert.match(out.stdout(), /hi[\r\n]+from-context/);
  });

  it("returns the cached snapshot on a second build", async () => {
    const make = () =>
      SandboxImage.builder()
        .from("alpine:3.19")
        .run("echo cached")
        .build(`${tag}-cache`);

    const first = await make();
    created.push(first.snapshotName);

    const start = Date.now();
    const second = await make();
    const elapsed = Date.now() - start;

    assert.equal(second.snapshotName, first.snapshotName);
    assert.equal(second.digest, first.digest);
    assert.ok(elapsed < 1000, `cache hit should be fast, was ${elapsed}ms`);
  });

  it("throws BuildStepError on a failing RUN and cleans up the temp sandbox", async () => {
    await assert.rejects(
      () =>
        SandboxImage.builder()
          .from("alpine:3.19")
          .run("exit 1")
          .build(`${tag}-fail`),
      (err: unknown) => {
        assert.ok(err instanceof BuildStepError);
        assert.equal(err.exitCode, 1);
        return true;
      },
    );
    // No metadata sidecar should have been written.
    const file = path.join(
      os.homedir(),
      ".microsandbox",
      "images",
      // unknown digest, so just confirm no file starts with `${tag}-fail-`
    );
    const dir = path.dirname(file);
    const entries = await fs.readdir(dir).catch(() => [] as string[]);
    const leaked = entries.filter((n) => n.startsWith(`${tag}-fail-`));
    assert.equal(leaked.length, 0, `leaked metadata: ${leaked.join(", ")}`);
  });
});
