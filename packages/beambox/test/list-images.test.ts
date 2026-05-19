import { describe, it, before, after } from "./_shim.js";
import assert from "./_shim.js";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { listImages } from "../src/image-builder.js";
import type { ImageMetadata } from "../src/types.js";

function makeMeta(snapshotName: string, createdAt: string): ImageMetadata {
  return {
    snapshotName,
    tag: snapshotName.replace(/-[a-f0-9]{12}$/, ""),
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

describe("listImages", () => {
  let metaDir: string;
  let snapDir: string;

  before(async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "list-images-"));
    metaDir = path.join(root, "images");
    snapDir = path.join(root, "snapshots");
    await fs.mkdir(metaDir, { recursive: true });
    await fs.mkdir(snapDir, { recursive: true });
  });

  after(async () => {
    await fs.rm(path.dirname(metaDir), { recursive: true, force: true });
  });

  it("returns metadata-tracked images and orphan snapshots in one list", async () => {
    // Tracked: a metadata file AND a matching snapshot artifact.
    const tracked = makeMeta("hello-aaaaaaaaaaaa", "2026-01-01T00:00:00Z");
    await fs.writeFile(
      path.join(metaDir, `${tracked.snapshotName}.json`),
      JSON.stringify(tracked),
    );
    await fs.writeFile(path.join(snapDir, tracked.snapshotName), "snap-bytes");

    // Orphan: snapshot exists, no metadata file.
    const orphanName = "bunbun";
    await fs.writeFile(path.join(snapDir, orphanName), "snap-bytes");

    // Junk that should be filtered out — .DS_Store and other dotfiles.
    await fs.writeFile(path.join(snapDir, ".DS_Store"), "junk");

    const list = await listImages(metaDir, snapDir);
    assert.equal(list.length, 2);

    const byName = new Map(list.map((m) => [m.snapshotName, m]));
    const t = byName.get("hello-aaaaaaaaaaaa")!;
    assert.equal(t.baseImage, "alpine:3.19");
    assert.equal(t.tag, "hello");

    const o = byName.get("bunbun")!;
    // Orphan stub uses the snapshot name verbatim as tag when no -<12hex>
    // suffix is present, and flags itself as unknown-baseImage so consumers
    // can spot it without re-querying.
    assert.equal(o.tag, "bunbun");
    assert.equal(o.digest, "");
    assert.equal(o.baseImage, "unknown");
    assert.equal(o.entrypoint, null);
    // createdAt comes from the snapshot file's mtime — just verify it's an
    // ISO string.
    assert.match(o.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  it("strips a -<12 hex> suffix to recover the original tag for orphans", async () => {
    const orphan = "imported-snap-deadbeefcafe";
    await fs.writeFile(path.join(snapDir, orphan), "snap-bytes");

    const list = await listImages(metaDir, snapDir);
    const o = list.find((m) => m.snapshotName === orphan)!;
    assert.equal(o.tag, "imported-snap");
    assert.equal(o.digest, "deadbeefcafe");
  });

  it("returns metadata-only entries when the snapshot dir is missing entirely", async () => {
    const onlyMetaRoot = await fs.mkdtemp(path.join(os.tmpdir(), "list-images-mo-"));
    const onlyMetaDir = path.join(onlyMetaRoot, "images");
    await fs.mkdir(onlyMetaDir, { recursive: true });
    const m = makeMeta("solo-cccccccccccc", "2026-03-01T00:00:00Z");
    await fs.writeFile(path.join(onlyMetaDir, `${m.snapshotName}.json`), JSON.stringify(m));

    const list = await listImages(onlyMetaDir, path.join(onlyMetaRoot, "no-snapshots"));
    assert.equal(list.length, 1);
    assert.equal(list[0]!.snapshotName, "solo-cccccccccccc");

    await fs.rm(onlyMetaRoot, { recursive: true, force: true });
  });

  it("returns orphans only when the metadata dir is missing entirely", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "list-images-os-"));
    const snaps = path.join(root, "snapshots");
    await fs.mkdir(snaps, { recursive: true });
    await fs.writeFile(path.join(snaps, "lonely"), "snap-bytes");

    const list = await listImages(path.join(root, "no-images"), snaps);
    assert.equal(list.length, 1);
    assert.equal(list[0]!.snapshotName, "lonely");
    assert.equal(list[0]!.baseImage, "unknown");

    await fs.rm(root, { recursive: true, force: true });
  });

  it("sorts newest first across tracked and orphan entries", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "list-images-sort-"));
    const md = path.join(root, "images");
    const sd = path.join(root, "snapshots");
    await fs.mkdir(md, { recursive: true });
    await fs.mkdir(sd, { recursive: true });

    // Tracked image dated 2026-01.
    const tracked = makeMeta("old-track-aaaaaaaaaaaa", "2026-01-01T00:00:00Z");
    await fs.writeFile(path.join(md, `${tracked.snapshotName}.json`), JSON.stringify(tracked));
    await fs.writeFile(path.join(sd, tracked.snapshotName), "x");
    // Orphan whose mtime is "now" — must sort first.
    await fs.writeFile(path.join(sd, "fresh-orphan"), "x");

    const list = await listImages(md, sd);
    assert.equal(list.length, 2);
    assert.equal(list[0]!.snapshotName, "fresh-orphan");
    assert.equal(list[1]!.snapshotName, "old-track-aaaaaaaaaaaa");

    await fs.rm(root, { recursive: true, force: true });
  });
});
