import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Image, Sandbox, Snapshot, install as installRuntime, isInstalled } from "microsandbox";
import type { ExecOutput } from "microsandbox";
import { parseDockerfile } from "./dockerfile-parser.js";
import type {
  BuildOptions,
  BuildStep,
  ImageMetadata,
  PortMapping,
  PortSpec,
  RunOptions,
  VolumeMount,
  VolumeSpec,
} from "./types.js";

const METADATA_DIR = path.join(os.homedir(), ".microsandbox", "images");
const SNAPSHOT_DIR = path.join(os.homedir(), ".microsandbox", "snapshots");

/**
 * Check whether the on-disk snapshot artifact for `snapshotName` still
 * exists. Microsandbox can GC snapshots out from under us; the metadata
 * file we own under METADATA_DIR can outlive the snapshot, so cache-hit
 * decisions need to verify both.
 */
async function snapshotArtifactExists(snapshotName: string): Promise<boolean> {
  try {
    await fs.access(path.join(SNAPSHOT_DIR, snapshotName));
    return true;
  } catch {
    return false;
  }
}

export class SandboxImage {
  private readonly steps: BuildStep[] = [];

  /** Start a fluent build. Equivalent to a Dockerfile with no directives yet. */
  static builder(): SandboxImage {
    return new SandboxImage();
  }

  /** Build directly from Dockerfile text. */
  static fromDockerfileString(source: string): SandboxImage {
    const img = new SandboxImage();
    for (const s of parseDockerfile(source)) img.steps.push(s);
    return img;
  }

  /** Build from a Dockerfile on disk. */
  static async fromDockerfile(filePath: string): Promise<SandboxImage> {
    const source = await fs.readFile(filePath, "utf8");
    return SandboxImage.fromDockerfileString(source);
  }

  /**
   * Spawn a sandbox directly from a previously-built image, identified by
   * either its exact snapshot name (`my-app:1.0-abc123def456`) or its tag
   * (`my-app:1.0`). When multiple snapshots share a tag, the most recently
   * built one wins.
   *
   * Throws `ImageNotFoundError` if no matching snapshot metadata exists in
   * `~/.microsandbox/images/`.
   */
  static async run(nameOrTag: string, options: RunOptions): Promise<Sandbox> {
    const metadata = await resolveImage(nameOrTag);
    return new ImageRef(metadata).run(options);
  }

  from(image: string): this {
    this.steps.push({ kind: "FROM", image });
    return this;
  }

  run(command: string): this {
    this.steps.push({ kind: "RUN", command });
    return this;
  }

  copy(src: string, dst: string): this {
    this.steps.push({ kind: "COPY", src, dst });
    return this;
  }

  add(src: string, dst: string): this {
    this.steps.push({ kind: "ADD", src, dst });
    return this;
  }

  env(key: string, value: string): this {
    this.steps.push({ kind: "ENV", key, value });
    return this;
  }

  workdir(p: string): this {
    this.steps.push({ kind: "WORKDIR", path: p });
    return this;
  }

  user(u: string): this {
    this.steps.push({ kind: "USER", user: u });
    return this;
  }

  entrypoint(argv: string[]): this {
    this.steps.push({ kind: "ENTRYPOINT", argv });
    return this;
  }

  cmd(argv: string[]): this {
    this.steps.push({ kind: "CMD", argv });
    return this;
  }

  /**
   * Materialize the image as a microsandbox snapshot.
   *
   * Returns an `ImageRef` whose `.run()` spawns sandboxes with the
   * accumulated metadata (env/workdir/user/entrypoint/cmd) applied.
   *
   * If a snapshot with the content-addressed name already exists,
   * the existing one is returned without rebuilding (unless
   * `noCache: true`).
   */
  async build(tag: string, options: BuildOptions = {}): Promise<ImageRef> {
    if (this.steps.length === 0) throw new Error("no build steps — call .from(...) first");
    if (this.steps[0]!.kind !== "FROM") throw new Error("first step must be FROM");

    const contextDir = path.resolve(options.contextDir ?? process.cwd());
    const digest = await computeDigest(this.steps, contextDir);
    const snapshotName = `${sanitizeTag(tag)}-${digest.slice(0, 12)}`;

    if (!options.noCache) {
      const cached = await loadMetadata(snapshotName).catch(() => null);
      if (cached && (await snapshotArtifactExists(snapshotName))) {
        log(options, `cache hit: ${snapshotName}`);
        // Refresh createdAt and the user-facing tag so `resolveImage(tag)`'s
        // newest-wins tiebreak lands on the snapshot the caller just asked
        // for. Without this, iterating on a Dockerfile under a stable tag
        // can resurrect an older snapshot whose content differs.
        //
        // Also backfill base-image env if the cached metadata predates env
        // merging — old snapshots have an empty env even though the OCI
        // image config defines PATH etc. Dockerfile env still wins.
        const baseConfig = await inspectImageConfig(cached.baseImage);
        const refreshed: ImageMetadata = {
          ...cached,
          tag,
          env: { ...baseConfig.env, ...cached.env },
          createdAt: new Date().toISOString(),
        };
        await saveMetadata(refreshed);
        return new ImageRef(refreshed);
      }
      if (cached) {
        // Metadata exists but the snapshot artifact is gone — orphan from
        // microsandbox GC, manual `msb snapshot rm`, or a previous failed
        // build. Drop the stale metadata so we don't keep cache-hitting on
        // a ghost, then fall through to rebuild.
        log(options, `cache miss: ${snapshotName} (metadata orphan, rebuilding)`);
        await fs
          .unlink(path.join(METADATA_DIR, `${snapshotName}.json`))
          .catch(() => {});
      }
    }

    if (!options.skipInstall) await ensureRuntime({ quiet: options.quiet });
    log(options, `building ${tag} → snapshot ${snapshotName}`);
    const tempName = `msb-build-${randomId()}`;
    const baseImage = (this.steps[0] as { kind: "FROM"; image: string }).image;

    // Default to 1024 MiB at build time so package installers (bun, npm,
    // apt) don't get OOM-killed mid-resolution. Callers can override.
    const buildMemory = options.memory ?? 1024;
    let sandbox: Sandbox | null = null;
    try {
      sandbox = await Sandbox.builder(tempName)
        .image(baseImage)
        .memory(buildMemory)
        .create();

      // Seed env/workdir/etc from the base image's OCI config so terminals
      // spawned later see the right PATH (`oven/bun` puts `bun` at
      // /usr/local/bin, etc.) without the user having to redeclare it.
      // Done AFTER .create() so the image is guaranteed to be pulled and
      // inspectable. Dockerfile directives below still override.
      const baseConfig = await inspectImageConfig(baseImage);
      const env: Record<string, string> = { ...baseConfig.env };
      let workdir: string | null = baseConfig.workdir;
      let userCtx: string | null = baseConfig.user;
      let entrypoint: string[] | null = baseConfig.entrypoint;
      let cmd: string[] | null = baseConfig.cmd;

      for (const step of this.steps.slice(1)) {
        switch (step.kind) {
          case "FROM":
            throw new Error("multiple FROM directives are not supported");
          case "ENV":
            env[step.key] = step.value;
            break;
          case "WORKDIR":
            workdir = step.path;
            break;
          case "USER":
            userCtx = step.user;
            break;
          case "ENTRYPOINT":
            entrypoint = step.argv;
            break;
          case "CMD":
            cmd = step.argv;
            break;
          case "RUN":
            await runStep(sandbox, step.command, env, workdir, userCtx);
            break;
          case "COPY":
          case "ADD":
            await copyStep(sandbox, contextDir, step.src, step.dst);
            break;
        }
      }

      // Fence: flush guest dirty pages into the upper layer before the VM
      // halts. Without this, snapshot() captures the pre-build base image.
      await flushGuestFs(sandbox);
      await sandbox.stopAndWait();
      sandbox = null;

      const handle = await Sandbox.get(tempName);
      await handle.snapshot(snapshotName);

      const metadata: ImageMetadata = {
        snapshotName,
        tag,
        digest,
        baseImage,
        env,
        workdir,
        user: userCtx,
        entrypoint,
        cmd,
        createdAt: new Date().toISOString(),
      };
      await saveMetadata(metadata);

      return new ImageRef(metadata);
    } finally {
      if (sandbox !== null) {
        await sandbox.stop().catch(() => {});
      }
      await Sandbox.remove(tempName).catch(() => {});
    }
  }
}

export class ImageRef {
  constructor(public readonly metadata: ImageMetadata) {}

  get snapshotName(): string {
    return this.metadata.snapshotName;
  }

  get digest(): string {
    return this.metadata.digest;
  }

  /** Spawn a sandbox from this image, applying its metadata. */
  async run(options: RunOptions): Promise<Sandbox> {
    await ensureRuntime({ quiet: true });
    const builder = applyRunOptions(
      Sandbox.builder(options.name).fromSnapshot(this.metadata.snapshotName),
      this.metadata,
      options,
    );
    return options.detached ? builder.createDetached() : builder.create();
  }

  /**
   * One-shot exec: spawn a sandbox, run `argv` inside it, dispose the
   * sandbox, and return the result. `argv[0]` is the program; the rest
   * are arguments.
   *
   * By default this throws `SandboxExitError` if the command exits
   * non-zero. Pass `{ throwOnNonZero: false }` to inspect the
   * `ExecOutput.code` directly.
   *
   * `name` is optional — a unique name is generated from the snapshot
   * tag if omitted. `detached` and `entrypoint` are not accepted.
   */
  async exec(
    argv: string[],
    options: OneShotOptions = {},
  ): Promise<ExecOutput> {
    if (argv.length === 0) {
      throw new Error("ImageRef.exec: argv must contain at least the program name");
    }
    const program = argv[0]!;
    const args = argv.slice(1);
    const out = await this.runOneShot(options, (sb) => sb.exec(program, args));
    return assertExitOk(out, argv.join(" "), options.throwOnNonZero);
  }

  /**
   * One-shot shell: spawn a sandbox, run `script` via `/bin/sh -c`,
   * dispose, and return the result. Useful for pipelines and shell
   * builtins (`ls | wc -l`, `cd /tmp && tar xzf …`).
   *
   * Same defaults as `exec`: throws on non-zero unless
   * `{ throwOnNonZero: false }`; auto-generates `name` if omitted.
   */
  async shell(script: string, options: OneShotOptions = {}): Promise<ExecOutput> {
    const out = await this.runOneShot(options, (sb) => sb.shell(script));
    return assertExitOk(out, script, options.throwOnNonZero);
  }

  private async runOneShot(
    options: OneShotOptions,
    body: (sb: Sandbox) => Promise<ExecOutput>,
  ): Promise<ExecOutput> {
    const name = options.name ?? generateSandboxName(this.metadata.snapshotName);
    await using sandbox = await this.run({ ...options, name, detached: false });
    return body(sandbox);
  }
}

export interface OneShotOptions
  extends Omit<RunOptions, "name" | "detached" | "entrypoint"> {
  /** Sandbox name. Auto-generated from the snapshot tag if omitted. */
  name?: string;
  /** Throw `SandboxExitError` on non-zero exit. Default: true. */
  throwOnNonZero?: boolean;
}

/**
 * Throw `SandboxExitError` on a non-zero exit unless `throwOnNonZero` is
 * explicitly false. Exported for unit tests.
 */
export function assertExitOk(
  out: ExecOutput,
  command: string,
  throwOnNonZero: boolean | undefined,
): ExecOutput {
  if (throwOnNonZero === false) return out;
  if (out.code === 0) return out;
  throw new SandboxExitError(command, out.code, out.stdout(), out.stderr(), out);
}

/**
 * Derive a unique sandbox name from a snapshot name. Exported for unit
 * tests.
 */
export function generateSandboxName(snapshotName: string): string {
  // Strip the trailing "-<sha-prefix>" beambox appends so the prefix
  // stays readable; fall back to the full name if there's no dash.
  const dash = snapshotName.lastIndexOf("-");
  const stem = dash > 0 ? snapshotName.slice(0, dash) : snapshotName;
  return `${stem}-${randomUUID().slice(0, 8)}`;
}

/**
 * Apply RunOptions + ImageMetadata to a SandboxBuilder. Exported for unit
 * tests that want to assert the call sequence without booting a microVM.
 */
export function applyRunOptions<B>(
  initial: B,
  metadata: Pick<ImageMetadata, "env" | "workdir" | "user" | "entrypoint" | "cmd">,
  options: RunOptions,
): B {
  let builder = initial as any;

  if (options.cpus !== undefined) builder = builder.cpus(options.cpus);
  if (options.memory !== undefined) builder = builder.memory(options.memory);

  const mergedEnv = { ...metadata.env, ...(options.env ?? {}) };
  if (Object.keys(mergedEnv).length > 0) builder = builder.envs(mergedEnv);

  const wd = options.workdir ?? metadata.workdir;
  if (wd) builder = builder.workdir(wd);

  const usr = options.user ?? metadata.user;
  if (usr) builder = builder.user(usr);

  const ep = options.entrypoint ?? metadata.entrypoint ?? metadata.cmd;
  if (ep) builder = builder.entrypoint(ep);

  if (options.hostname !== undefined) builder = builder.hostname(options.hostname);
  if (options.maxDuration !== undefined) builder = builder.maxDuration(options.maxDuration);
  if (options.idleTimeout !== undefined) builder = builder.idleTimeout(options.idleTimeout);

  if (options.replace !== undefined) {
    const r = options.replace;
    if (typeof r === "number") builder = builder.replaceWithGrace(r);
    else if (typeof r === "object" && r !== null) builder = builder.replaceWithGrace(r.graceMs);
    else if (r === true) builder = builder.replace();
  }

  if (options.network === false) {
    builder = builder.disableNetwork();
  } else if (typeof options.network === "function") {
    builder = builder.network(options.network);
  }

  for (const spec of options.ports ?? []) {
    const p = parsePortSpec(spec);
    builder = p.protocol === "udp"
      ? builder.portUdp(p.host, p.guest)
      : builder.port(p.host, p.guest);
  }

  for (const spec of options.volumes ?? []) {
    const v = parseVolumeSpec(spec);
    builder = builder.volume(v.guest, (mb: any) => {
      let m = mb;
      if ("bind" in v) m = m.bind(v.bind);
      else if ("volume" in v) m = m.named(v.volume);
      else if ("tmpfs" in v) m = m.tmpfs();
      if (v.readonly) m = m.readonly();
      return m;
    });
  }

  return builder as B;
}

/**
 * Normalize a `PortSpec` into a `PortMapping`. Exported for tests.
 *
 * - `8080` → `{ host: 8080, guest: 8080 }`
 * - `"8080:80"` → `{ host: 8080, guest: 80 }`
 * - `"5353:53/udp"` → `{ host: 5353, guest: 53, protocol: "udp" }`
 */
export function parsePortSpec(spec: PortSpec): PortMapping {
  if (typeof spec === "number") {
    return { host: spec, guest: spec };
  }
  if (typeof spec === "string") {
    const slash = spec.split("/");
    const hostGuest = slash[0] ?? "";
    const proto = slash[1];
    const parts = hostGuest.split(":");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error(`invalid port spec "${spec}" (expected "host:guest" or "host:guest/proto")`);
    }
    const host = Number(parts[0]);
    const guest = Number(parts[1]);
    if (!Number.isFinite(host) || !Number.isFinite(guest)) {
      throw new Error(`invalid port spec "${spec}" (host/guest must be numbers)`);
    }
    const out: PortMapping = { host, guest };
    if (proto !== undefined) {
      if (proto !== "tcp" && proto !== "udp") {
        throw new Error(`invalid port spec "${spec}" (protocol must be tcp or udp)`);
      }
      if (proto === "udp") out.protocol = "udp";
    }
    return out;
  }
  return spec;
}

/**
 * Normalize a `VolumeSpec` into a `VolumeMount`. Exported for tests.
 *
 * Docker-style strings, with optional trailing `:ro`:
 * - `"./data:/data"` → bind mount
 * - `"./etc:/etc:ro"` → bind, read-only
 * - `"build-cache:/cache"` → named volume (no leading `.` or `/`)
 * - `"tmpfs:/tmp"` → tmpfs at `/tmp`
 */
export function parseVolumeSpec(spec: VolumeSpec): VolumeMount {
  if (typeof spec !== "string") return spec;

  const parts = spec.split(":");
  let readonly = false;
  if (parts.length >= 3 && parts[parts.length - 1] === "ro") {
    readonly = true;
    parts.pop();
  }
  if (parts.length !== 2) {
    throw new Error(`invalid volume spec "${spec}" (expected "source:guest" or "source:guest:ro")`);
  }
  const source = parts[0];
  const guest = parts[1];
  if (!source || !guest || !guest.startsWith("/")) {
    throw new Error(`invalid volume spec "${spec}" (guest path must be absolute)`);
  }

  const ro = readonly ? { readonly: true as const } : {};
  if (source === "tmpfs") {
    return { guest, tmpfs: true, ...ro };
  }
  if (source.startsWith("/") || source.startsWith("./") || source.startsWith("../") || source === ".") {
    return { guest, bind: source, ...ro };
  }
  return { guest, volume: source, ...ro };
}

// --- runtime ---

let runtimeReady: Promise<void> | null = null;

/**
 * Ensure the microsandbox runtime (`msb` + `libkrunfw`) is installed under
 * `~/.microsandbox/`. Called automatically by `SandboxImage.build()`; you
 * can also call it eagerly at app startup to front-load the download.
 */
export async function ensureRuntime(opts: { quiet?: boolean } = {}): Promise<void> {
  if (runtimeReady) return runtimeReady;
  runtimeReady = (async () => {
    if (isInstalled()) return;
    if (!opts.quiet) console.error("[beambox] installing microsandbox runtime…");
    await installRuntime();
  })();
  try {
    await runtimeReady;
  } catch (err) {
    runtimeReady = null;
    throw err;
  }
}

// --- internals ---

interface BaseImageConfig {
  env: Record<string, string>;
  workdir: string | null;
  user: string | null;
  entrypoint: string[] | null;
  cmd: string[] | null;
}

/**
 * Read the OCI config of `reference` from microsandbox's image cache and
 * coerce it into the shape we persist in `ImageMetadata`. Returns empty
 * defaults if inspect fails — base-image config is a quality-of-life
 * signal, not load-bearing for the build itself.
 */
async function inspectImageConfig(reference: string): Promise<BaseImageConfig> {
  const empty: BaseImageConfig = {
    env: {},
    workdir: null,
    user: null,
    entrypoint: null,
    cmd: null,
  };
  try {
    const detail = await Image.inspect(reference);
    const cfg = detail.config;
    if (!cfg) return empty;
    const env: Record<string, string> = {};
    for (const entry of cfg.env) {
      const eq = entry.indexOf("=");
      if (eq <= 0) continue;
      env[entry.slice(0, eq)] = entry.slice(eq + 1);
    }
    return {
      env,
      workdir: cfg.workingDir || null,
      user: cfg.user || null,
      entrypoint: cfg.entrypoint ? [...cfg.entrypoint] : null,
      cmd: cfg.cmd ? [...cfg.cmd] : null,
    };
  } catch {
    return empty;
  }
}

async function runStep(
  sandbox: Sandbox,
  command: string,
  env: Record<string, string>,
  workdir: string | null,
  user: string | null,
): Promise<void> {
  const result = await sandbox.execWith("/bin/sh", (e) => {
    let b = e.args(["-c", command]);
    if (Object.keys(env).length > 0) b = b.envs(env);
    if (workdir !== null) b = b.cwd(workdir);
    if (user !== null) b = b.user(user);
    return b;
  });
  if (result.code !== 0) {
    const stderr = result.stderr();
    const stdout = result.stdout();
    throw new BuildStepError(command, result.code, stdout, stderr);
  }
}

/**
 * Flush the guest's filesystem before `stopAndWait()` halts the VM.
 *
 * Microsandbox `stopAndWait()` doesn't fsync the upper layer when it
 * stops, so any writes from RUN/COPY/ADD steps that are still in the
 * guest's page cache vanish — the snapshot picks up the pre-write
 * state. Running `sync` from inside the guest is the only reliable
 * way to force those dirty pages onto the upper before the VM
 * stops. One fence right before stop catches everything from every
 * preceding step.
 *
 * Best-effort: if `sync` itself fails (e.g. broken base image), we
 * surface a warning but don't abort the build — the snapshot may be
 * stale, but the caller still gets actionable output.
 */
async function flushGuestFs(sandbox: Sandbox): Promise<void> {
  const result = await sandbox.exec("sync", []).catch((err) => ({
    code: -1,
    stderr: () => String(err),
    stdout: () => "",
  }));
  if (result.code !== 0) {
    console.warn(
      "[beambox] guest filesystem sync failed (snapshot may be stale):",
      result.stderr(),
    );
  }
}

async function copyStep(
  sandbox: Sandbox,
  contextDir: string,
  src: string,
  dst: string,
): Promise<void> {
  const absSrc = path.resolve(contextDir, src);
  const stat = await fs.stat(absSrc);

  if (stat.isFile()) {
    await ensureGuestParent(sandbox, dst);
    await sandbox.fs().copyFromHost(absSrc, dst);
    return;
  }

  if (stat.isDirectory()) {
    await ensureGuestDir(sandbox, dst);
    const entries = await fs.readdir(absSrc, { withFileTypes: true, recursive: true });
    for (const entry of entries) {
      const relPath = path.relative(
        absSrc,
        path.join((entry as any).parentPath ?? (entry as any).path ?? absSrc, entry.name),
      );
      const hostPath = path.join(absSrc, relPath);
      const guestPath = posixJoin(dst, relPath);
      if (entry.isDirectory()) {
        await ensureGuestDir(sandbox, guestPath);
      } else if (entry.isFile()) {
        await ensureGuestParent(sandbox, guestPath);
        await sandbox.fs().copyFromHost(hostPath, guestPath);
      }
    }
    return;
  }

  throw new Error(`COPY source ${src} is neither a file nor a directory`);
}

async function ensureGuestParent(sandbox: Sandbox, guestPath: string): Promise<void> {
  const parent = posixDirname(guestPath);
  if (parent === "" || parent === "/" || parent === ".") return;
  await ensureGuestDir(sandbox, parent);
}

async function ensureGuestDir(sandbox: Sandbox, guestPath: string): Promise<void> {
  // SDK mkdir is not recursive; walk the parents.
  const parts = guestPath.split("/").filter((p) => p !== "");
  let cur = guestPath.startsWith("/") ? "" : ".";
  for (const part of parts) {
    cur = cur === "" ? `/${part}` : `${cur}/${part}`;
    if (await sandbox.fs().exists(cur)) continue;
    await sandbox.fs().mkdir(cur);
  }
}

function posixDirname(p: string): string {
  const i = p.lastIndexOf("/");
  if (i === -1) return "";
  if (i === 0) return "/";
  return p.slice(0, i);
}

function posixJoin(a: string, b: string): string {
  if (a.endsWith("/")) return `${a}${b}`;
  return `${a}/${b}`;
}

async function computeDigest(steps: BuildStep[], contextDir: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(JSON.stringify(steps));
  for (const step of steps) {
    if (step.kind === "COPY" || step.kind === "ADD") {
      await hashPath(hash, path.resolve(contextDir, step.src));
    }
  }
  return hash.digest("hex");
}

async function hashPath(hash: ReturnType<typeof createHash>, abs: string): Promise<void> {
  let stat: import("node:fs").Stats;
  try {
    stat = await fs.stat(abs);
  } catch {
    hash.update(`\x00missing:${abs}`);
    return;
  }
  if (stat.isFile()) {
    hash.update(`\x00file:${abs}:${stat.size}:${stat.mtimeMs}`);
    return;
  }
  if (stat.isDirectory()) {
    const entries = await fs.readdir(abs, { withFileTypes: true, recursive: true });
    const records = entries
      .filter((e) => e.isFile())
      .map((e) => {
        const parent = (e as any).parentPath ?? (e as any).path ?? abs;
        return path.join(parent, e.name);
      })
      .sort();
    for (const f of records) {
      const st = await fs.stat(f);
      hash.update(`\x00file:${f}:${st.size}:${st.mtimeMs}`);
    }
  }
}

async function saveMetadata(meta: ImageMetadata): Promise<void> {
  await fs.mkdir(METADATA_DIR, { recursive: true });
  const file = path.join(METADATA_DIR, `${meta.snapshotName}.json`);
  await fs.writeFile(file, JSON.stringify(meta, null, 2), "utf8");
}

async function loadMetadata(
  snapshotName: string,
  dir: string = METADATA_DIR,
): Promise<ImageMetadata> {
  const file = path.join(dir, `${snapshotName}.json`);
  const raw = await fs.readFile(file, "utf8");
  return JSON.parse(raw) as ImageMetadata;
}

/**
 * Delete a locally-built image: remove its snapshot artifact (via
 * `Snapshot.remove(name, { force: true })`) and its metadata file. Safe to
 * call for unknown names — missing files are ignored.
 */
export async function removeImage(
  snapshotName: string,
  dir: string = METADATA_DIR,
): Promise<void> {
  try {
    await Snapshot.remove(snapshotName, { force: true });
  } catch {
    // snapshot may already be gone; the metadata file is still removed below
  }
  const file = path.join(dir, `${snapshotName}.json`);
  await fs.unlink(file).catch(() => {});
}

/**
 * List every locally-available image, newest first.
 *
 * Two sources are merged:
 *   1. `METADATA_DIR` — JSON files we write at build time. These carry full
 *      provenance (tag, digest, baseImage, env, entrypoint, ...).
 *   2. `SNAPSHOT_DIR` — the raw snapshot artifacts microsandbox stores.
 *      Snapshots that have no matching JSON (e.g. built directly via the
 *      `msb` CLI, restored from a backup, imported by hand) get a synthesised
 *      stub so they still surface in tooling. The stub flags itself with
 *      `baseImage: "unknown"` and a digest of `""` — callers that need the
 *      full metadata must look it up explicitly via `resolveImage`.
 *
 * Returns `[]` when neither directory exists. The `metadataDir` /
 * `snapshotDir` args are exposed for tests; production callers use the defaults.
 */
export async function listImages(
  metadataDir: string = METADATA_DIR,
  snapshotDir: string = SNAPSHOT_DIR,
): Promise<ImageMetadata[]> {
  // 1) Metadata-tracked images.
  const tracked: ImageMetadata[] = [];
  const trackedNames = new Set<string>();
  try {
    const entries = await fs.readdir(metadataDir);
    const jsonFiles = entries.filter((n) => n.endsWith(".json"));
    const metas = await Promise.all(
      jsonFiles.map((name) =>
        loadMetadata(name.replace(/\.json$/, ""), metadataDir).catch(() => null),
      ),
    );
    for (const m of metas) {
      if (m === null) continue;
      tracked.push(m);
      trackedNames.add(m.snapshotName);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    // metadataDir missing is fine — we may still find orphans below.
  }

  // 2) Orphan snapshots — present on disk but with no metadata file.
  const orphans: ImageMetadata[] = [];
  try {
    const snapEntries = await fs.readdir(snapshotDir, { withFileTypes: true });
    for (const ent of snapEntries) {
      // Snapshot entries are either files or directories depending on the
      // microsandbox version; both shapes are valid. Skip dotfiles
      // (e.g. .DS_Store) so we don't synthesise junk entries.
      if (ent.name.startsWith(".")) continue;
      if (trackedNames.has(ent.name)) continue;
      orphans.push(await synthesizeOrphanMetadata(ent.name, snapshotDir));
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  return [...tracked, ...orphans].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : -1,
  );
}

/**
 * Build a placeholder `ImageMetadata` for a snapshot we know exists on disk
 * but have no record of. We can't recover the original Dockerfile or env, so
 * fields like `digest`/`entrypoint`/`cmd` are intentionally blank/null — the
 * caller can still launch the snapshot by name, and the desktop UI can
 * render it. The tag is taken as everything before a trailing `-<12 hex>`
 * suffix if present; otherwise the full name (matches the same projection
 * the sidecar applies to old-format tracked entries).
 */
async function synthesizeOrphanMetadata(
  snapshotName: string,
  snapshotDir: string,
): Promise<ImageMetadata> {
  const m = /-([a-f0-9]{12})$/.exec(snapshotName);
  const tag = m ? snapshotName.slice(0, -m[0].length) : snapshotName;
  const digest = m ? m[1]! : "";
  let createdAt = new Date().toISOString();
  try {
    const st = await fs.stat(path.join(snapshotDir, snapshotName));
    createdAt = new Date(st.mtimeMs).toISOString();
  } catch {
    // Snapshot vanished between readdir and stat — fall back to "now".
  }
  return {
    snapshotName,
    tag,
    digest,
    baseImage: "unknown",
    env: {},
    workdir: null,
    user: null,
    entrypoint: null,
    cmd: null,
    createdAt,
  };
}

/**
 * Resolve a tag or exact snapshot name to its metadata. The `dir` arg is
 * exposed for tests; production callers use the default.
 */
export async function resolveImage(
  nameOrTag: string,
  dir: string = METADATA_DIR,
): Promise<ImageMetadata> {
  // Only enforce snapshot-artifact existence when using the real metadata
  // dir. Tests pass synthetic dirs without a corresponding snapshots tree.
  const checkArtifact = dir === METADATA_DIR;

  const exact = await loadMetadata(nameOrTag, dir).catch((err) => {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  });
  if (exact) {
    if (!checkArtifact || (await snapshotArtifactExists(exact.snapshotName))) {
      return exact;
    }
    // Orphan metadata — fall through to the tag-prefix scan in case
    // another snapshot under the same tag is still healthy.
  }

  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ImageNotFoundError(nameOrTag, []);
    }
    throw err;
  }

  const prefix = `${sanitizeTag(nameOrTag)}-`;
  const candidates = entries.filter((n) => n.startsWith(prefix) && n.endsWith(".json"));
  if (candidates.length === 0) {
    throw new ImageNotFoundError(nameOrTag, entries.filter((n) => n.endsWith(".json")));
  }

  const metas = await Promise.all(
    candidates.map((name) => loadMetadata(name.replace(/\.json$/, ""), dir)),
  );
  metas.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  if (!checkArtifact) return metas[0]!;

  // Pick the newest snapshot whose on-disk artifact still exists. If all
  // metadata is orphan, treat the tag as unresolvable.
  for (const meta of metas) {
    if (await snapshotArtifactExists(meta.snapshotName)) return meta;
  }
  throw new ImageNotFoundError(nameOrTag, candidates);
}

function sanitizeTag(tag: string): string {
  return tag.replace(/[^A-Za-z0-9._-]/g, "_");
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function log(opts: BuildOptions, msg: string): void {
  if (!opts.quiet) console.error(`[beambox] ${msg}`);
}

export class ImageNotFoundError extends Error {
  constructor(
    public readonly nameOrTag: string,
    public readonly available: string[],
  ) {
    const hint = available.length === 0
      ? "no images have been built yet"
      : `available: ${available.map((n) => n.replace(/\.json$/, "")).join(", ")}`;
    super(`no image found for "${nameOrTag}" — ${hint}`);
    this.name = "ImageNotFoundError";
  }
}

export class BuildStepError extends Error {
  constructor(
    public readonly command: string,
    public readonly exitCode: number,
    public readonly stdout: string,
    public readonly stderr: string,
  ) {
    super(
      `build step failed (exit ${exitCode}): ${command}\n` +
        (stderr ? `--- stderr ---\n${stderr}\n` : "") +
        (stdout ? `--- stdout ---\n${stdout}\n` : ""),
    );
    this.name = "BuildStepError";
  }
}

/**
 * Thrown by `ImageRef.exec` / `ImageRef.shell` when the command exits
 * non-zero. Pass `{ throwOnNonZero: false }` to opt out and inspect the
 * `ExecOutput.code` directly.
 */
export class SandboxExitError extends Error {
  constructor(
    public readonly command: string,
    public readonly exitCode: number,
    public readonly stdout: string,
    public readonly stderr: string,
    public readonly output: ExecOutput,
  ) {
    super(
      `command failed (exit ${exitCode}): ${command}\n` +
        (stderr ? `--- stderr ---\n${stderr}\n` : "") +
        (stdout ? `--- stdout ---\n${stdout}\n` : ""),
    );
    this.name = "SandboxExitError";
  }
}
