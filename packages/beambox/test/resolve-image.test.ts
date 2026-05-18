import { describe, it, before, after } from "./_shim.js";
import assert from "./_shim.js";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { resolveImage, ImageNotFoundError } from "../src/image-builder.js";
import type { ImageMetadata } from "../src/types.js";

function makeMeta(snapshotName: string, createdAt: string): ImageMetadata {
  return {
    snapshotName,
    digest: snapshotName.split("-").pop() ?? "",
    baseImage: "alpine:3.19",
    env: {},
    workdir: null,
    user: null,
    entrypoint: null,
    cmd: null,
    createdAt,
  };
}

describe("resolveImage", () => {
  let dir: string;

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "resolve-image-"));
  });

  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("resolves an exact snapshot name", async () => {
    const meta = makeMeta("exact_tag-abc123", "2026-01-01T00:00:00Z");
    await fs.writeFile(path.join(dir, "exact_tag-abc123.json"), JSON.stringify(meta));

    const found = await resolveImage("exact_tag-abc123", dir);
    assert.equal(found.snapshotName, "exact_tag-abc123");
  });

  it("resolves a tag to the most recently built snapshot", async () => {
    const older = makeMeta("my-app_1.0-aaaaaaaaaaaa", "2026-01-01T00:00:00Z");
    const newer = makeMeta("my-app_1.0-bbbbbbbbbbbb", "2026-02-01T00:00:00Z");
    await fs.writeFile(path.join(dir, "my-app_1.0-aaaaaaaaaaaa.json"), JSON.stringify(older));
    await fs.writeFile(path.join(dir, "my-app_1.0-bbbbbbbbbbbb.json"), JSON.stringify(newer));

    const found = await resolveImage("my-app:1.0", dir);
    assert.equal(found.snapshotName, "my-app_1.0-bbbbbbbbbbbb");
  });

  it("throws ImageNotFoundError when nothing matches", async () => {
    await assert.rejects(
      () => resolveImage("does-not-exist:9.9", dir),
      (err: unknown) => err instanceof ImageNotFoundError,
    );
  });

  it("throws ImageNotFoundError when the metadata dir is missing", async () => {
    const missing = path.join(dir, "no-such-subdir");
    await assert.rejects(
      () => resolveImage("anything", missing),
      (err: unknown) => err instanceof ImageNotFoundError,
    );
  });
});
