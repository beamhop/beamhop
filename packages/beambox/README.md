# @beamhop/beambox

Dockerfile-style image builds on top of [microsandbox](https://microsandbox.dev). Describe a sandbox once with a fluent builder or a Dockerfile, materialize it into a reusable **microsandbox snapshot**, and boot fresh microVMs from it in milliseconds.

The "image" produced here is a microsandbox snapshot — not an OCI tar. There's no registry push, no `docker load`, no daemon. Snapshots live under `~/.microsandbox/` with a sidecar JSON metadata file that records the env / workdir / user / entrypoint / cmd to apply on spawn.

---

## Table of contents

- [Requirements](#requirements)
- [Install](#install)
- [Runtime management — `ensureRuntime`](#runtime-management--ensureruntime)
- [Quickstart](#quickstart)
- [Concepts](#concepts)
- [API reference](#api-reference)
  - [`SandboxImage`](#sandboximage)
  - [`ImageRef`](#imageref)
  - [`parseDockerfile`](#parsedockerfile)
  - [Types](#types)
  - [Errors](#errors)
- [Supported Dockerfile directives](#supported-dockerfile-directives)
- [Caching & content addressing](#caching--content-addressing)
- [Snapshot & metadata layout on disk](#snapshot--metadata-layout-on-disk)
- [How it differs from Docker](#how-it-differs-from-docker)

---

## Requirements

- **Node.js 22+**
- **macOS on Apple Silicon** or **Linux with KVM**
- A peer install of `microsandbox`

The `msb` + `libkrunfw` runtime is downloaded automatically into `~/.microsandbox/` on the first build. You don't need to install anything globally or run a separate daemon.

## Install

From npm:

```bash
npm i @beamhop/beambox microsandbox
```

From GitHub:

```bash
npm i github:beamhop/beambox microsandbox
```

`microsandbox` is declared as a peer dependency; install it alongside.

## Runtime management — `ensureRuntime`

`SandboxImage.build()` calls `ensureRuntime()` for you, but you can call it eagerly at startup to front-load the (one-time) runtime download:

```ts
import { ensureRuntime } from "@beamhop/beambox";

await ensureRuntime();          // installs msb + libkrunfw if missing
await ensureRuntime({ quiet: true }); // suppress the install log line
```

If you manage the runtime yourself (e.g. system-wide install, baked container), pass `{ skipInstall: true }` to `build()` to bypass the check entirely:

```ts
await image.build("my-app:1.0", { skipInstall: true });
```

## Quickstart

### Fluent builder

```ts
import { SandboxImage } from "@beamhop/beambox";

const image = await SandboxImage.builder()
  .from("alpine:3.19")
  .env("NODE_ENV", "production")
  .workdir("/app")
  .run("apk add --no-cache nodejs npm")
  .copy("./package.json", "/app/package.json")
  .run("npm install --omit=dev")
  .copy("./src", "/app/src")
  .cmd(["node", "src/index.js"])
  .build("my-app:1.0");

await using sandbox = await image.run({ name: "worker-1", memory: 512 });
const out = await sandbox.exec("node", ["-e", "console.log('hi')"]);
console.log(out.stdout());
```

### From a Dockerfile on disk

```dockerfile
# ./Dockerfile
FROM alpine:3.19
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache nodejs npm
COPY package.json /app/package.json
RUN npm install --omit=dev
COPY src /app/src
CMD ["node", "src/index.js"]
```

```ts
import { SandboxImage } from "@beamhop/beambox";

const image = await (await SandboxImage.fromDockerfile("./Dockerfile"))
  .build("my-app:1.0", { contextDir: "." });
```

### From a Dockerfile string

```ts
import { SandboxImage } from "@beamhop/beambox";

const image = await SandboxImage
  .fromDockerfileString(`
    FROM alpine:3.19
    RUN apk add --no-cache curl
    CMD ["curl", "--version"]
  `)
  .build("curl-box:1");
```

### Spawn a previously-built image by name (no rebuild)

```ts
import { SandboxImage } from "@beamhop/beambox";

// Accepts either the exact snapshot name ("my-app:1.0-abc123def456")
// or just the tag ("my-app:1.0"). For tag lookups, the most recently
// built snapshot wins. Throws ImageNotFoundError on miss.
await using sandbox = await SandboxImage.run("my-app:1.0", { name: "worker-1" });
```

---

## Concepts

- **`SandboxImage`** — a list of build steps (the equivalent of a Dockerfile). You assemble it via the fluent API or by parsing a Dockerfile.
- **`build(tag)`** — replays the steps inside a temporary microVM and `snapshot()`s the result. Returns an `ImageRef`.
- **`ImageRef`** — a handle to a built snapshot plus its metadata (env, workdir, user, entrypoint, cmd). Use `.run(options)` to spawn a new sandbox from it.
- **Snapshot name** — `<sanitized-tag>-<sha256-prefix>`. Content-addressed: identical steps + identical `COPY`/`ADD` source files produce the same snapshot name and hit the cache.
- **Metadata sidecar** — `~/.microsandbox/images/<snapshot-name>.json`. Microsandbox snapshots persist only disk state; the sidecar records the configuration to reapply on spawn.

---

## API reference

### `SandboxImage`

#### Static — `SandboxImage.builder(): SandboxImage`

Returns an empty builder. Equivalent to an unwritten Dockerfile.

```ts
const img = SandboxImage.builder();
```

#### Static — `SandboxImage.fromDockerfile(filePath: string): Promise<SandboxImage>`

Reads a Dockerfile from disk and parses it into a `SandboxImage`. Throws `DockerfileParseError` on invalid syntax.

```ts
const img = await SandboxImage.fromDockerfile("./Dockerfile");
```

#### Static — `SandboxImage.fromDockerfileString(source: string): SandboxImage`

Parses a Dockerfile from an in-memory string. Throws `DockerfileParseError` on invalid syntax.

```ts
const img = SandboxImage.fromDockerfileString(`
  FROM alpine:3.19
  RUN apk add --no-cache jq
`);
```

#### Static — `SandboxImage.run(nameOrTag, options): Promise<Sandbox>`

Resolves a previously-built image (by exact snapshot name or by tag) and spawns a sandbox from it. Throws `ImageNotFoundError` if nothing matches.

```ts
// Exact name
await using sb1 = await SandboxImage.run("my-app:1.0-abc123def456", { name: "exact" });

// Tag (returns the most recently built snapshot under that tag)
await using sb2 = await SandboxImage.run("my-app:1.0", { name: "by-tag" });
```

#### Instance — fluent step methods

Each returns `this` for chaining. The first step must be `from(...)`.

| Method                            | Equivalent Dockerfile directive |
| --------------------------------- | ------------------------------- |
| `.from(image: string)`            | `FROM`                          |
| `.run(command: string)`           | `RUN` (always via `/bin/sh -c`) |
| `.copy(src: string, dst: string)` | `COPY`                          |
| `.add(src: string, dst: string)`  | `ADD` (same behavior as COPY)   |
| `.env(key: string, value: string)`| `ENV` (one pair per call)       |
| `.workdir(path: string)`          | `WORKDIR`                       |
| `.user(user: string)`             | `USER`                          |
| `.entrypoint(argv: string[])`     | `ENTRYPOINT` (exec form)        |
| `.cmd(argv: string[])`            | `CMD` (exec form)               |

```ts
const img = SandboxImage.builder()
  .from("ubuntu:22.04")
  .env("DEBIAN_FRONTEND", "noninteractive")
  .workdir("/srv")
  .user("root")
  .run("apt-get update && apt-get install -y python3")
  .copy("./app", "/srv/app")
  .add("./assets.tar", "/srv/assets")
  .entrypoint(["python3"])
  .cmd(["/srv/app/main.py"]);
```

#### Instance — `build(tag, options?): Promise<ImageRef>`

Materializes the image as a microsandbox snapshot.

- `tag` is sanitized (non-`[A-Za-z0-9._-]` characters become `_`) and combined with the first 12 hex chars of the content digest to form the final snapshot name.
- If a snapshot with that name already exists in `~/.microsandbox/images/`, it's returned from cache without rebuilding.
- Otherwise a temporary microVM is created from the `FROM` base, each step is replayed, the VM is snapshotted, and the snapshot's metadata is persisted as a sidecar JSON.
- The temp microVM is always cleaned up (even on error).

```ts
const ref = await img.build("my-app:1.0", {
  contextDir: ".",      // anchor for COPY/ADD sources; defaults to process.cwd()
  noCache: false,       // force rebuild even if a cached snapshot exists
  quiet: false,         // suppress "[beambox] …" progress logs
  skipInstall: false,   // skip the embedded runtime install check
});

console.log(ref.snapshotName); // e.g. "my-app_1.0-abc123def456"
console.log(ref.digest);       // full sha256 hex of the build inputs
console.log(ref.metadata);     // full ImageMetadata object
```

Throws:
- `Error("no build steps — call .from(...) first")` if you call `build()` on an empty builder.
- `Error("first step must be FROM")` if the first step isn't `FROM`.
- `Error("multiple FROM directives are not supported")` if more than one `FROM` is present.
- `BuildStepError` if a `RUN` exits non-zero (carries `command`, `exitCode`, `stdout`, `stderr`).

### `ImageRef`

Returned by `SandboxImage.build()` and constructed internally by `SandboxImage.run()`. Wraps an `ImageMetadata` record and knows how to spawn from it.

```ts
class ImageRef {
  readonly metadata: ImageMetadata;
  get snapshotName(): string;   // metadata.snapshotName
  get digest(): string;         // metadata.digest (full sha256)

  run(options: RunOptions): Promise<Sandbox>;
}
```

#### `imageRef.run(options): Promise<Sandbox>`

Spawns a microsandbox `Sandbox` from this snapshot, applying the stored metadata. Per-call options override the image defaults; envs are **merged** (caller env wins on conflict).

```ts
await using sandbox = await ref.run({
  name: "worker-7",                         // required, unique
  cpus: 2,                                  // SDK default if omitted
  memory: 512,                              // MiB; SDK default if omitted
  env: { REQUEST_ID: "abc" },               // merged on top of image ENV
  workdir: "/custom",                       // overrides image WORKDIR
  user: "node",                             // overrides image USER
  entrypoint: ["node", "src/worker.js"],    // overrides ENTRYPOINT (falls back to CMD)
  detached: false,                          // default: attached + auto-dispose
  ports: [8080, "5353:53/udp"],             // shorthand or { host, guest, protocol }
  volumes: [
    "./data:/data",                         // bind mount
    "build-cache:/cache",                   // named volume
    "tmpfs:/tmp",                           // in-memory
    "./etc:/etc:ro",                        // bind, read-only
  ],
  hostname: "worker",
  maxDuration: 600,                         // hard wall-clock cap, seconds
  idleTimeout: 60,                          // auto-shutdown after N idle seconds
  network: false,                           // disable networking; or pass (b) => b.dns(...) for custom
  replace: true,                            // or { graceMs: 5000 } for graceful shutdown first
});

const result = await sandbox.exec("ls", ["-la", "/app"]);
console.log(result.stdout());
```

#### `imageRef.exec(argv, options?)` — one-shot

Spawn → exec → dispose, in a single call. Useful for short jobs where
you don't need the sandbox to outlive the command.

```ts
const out = await ref.exec(["node", "-e", "console.log(2+2)"]);
console.log(out.stdout()); // "4\n"

// throws SandboxExitError on non-zero exit
await ref.exec(["false"]); // ← throws

// opt out to inspect the code yourself
const out2 = await ref.exec(["false"], { throwOnNonZero: false });
out2.code; // 1
```

- `name` is optional; auto-generated from the snapshot tag if omitted.
- `detached` and `entrypoint` are not accepted — `argv` is the command.
- Throws `SandboxExitError` on non-zero exit by default. Opt out with
  `{ throwOnNonZero: false }`.
- Everything else from [`RunOptions`](#types) is forwarded (`env`,
  `cpus`, `memory`, `ports`, `volumes`, …).

#### `imageRef.shell(script, options?)` — one-shot shell

Same semantics as `exec`, but the script runs through `/bin/sh -c`.
Useful for pipelines and shell builtins.

```ts
const out = await ref.shell("ls -la /app | wc -l");
console.log(out.stdout().trim()); // e.g. "12"
```

Entrypoint resolution order on spawn:
1. `options.entrypoint` (if provided)
2. `metadata.entrypoint` (if set by `.entrypoint(...)`)
3. `metadata.cmd` (if set by `.cmd(...)`)
4. None — the SDK uses the base image's default

If `detached: true`, the returned sandbox is created via `createDetached()` and survives beyond the current process; otherwise it's attached and disposed on `await using` scope exit.

### `parseDockerfile`

Low-level parser. Exposed for tools that want to inspect or transform build steps without materializing them.

```ts
import { parseDockerfile, type BuildStep } from "@beamhop/beambox";

const steps: BuildStep[] = parseDockerfile(`
  FROM alpine:3.19
  RUN apk add --no-cache curl
  CMD ["curl", "--version"]
`);
// → [
//     { kind: "FROM", image: "alpine:3.19" },
//     { kind: "RUN",  command: "apk add --no-cache curl" },
//     { kind: "CMD",  argv: ["curl", "--version"] },
//   ]
```

Throws `DockerfileParseError` (carries `.line`) on:
- A first non-comment directive other than `FROM`.
- An unsupported directive (`ARG`, `HEALTHCHECK`, `ONBUILD`, `SHELL`, `VOLUME`, `EXPOSE`, `LABEL`, `STOPSIGNAL`, `MAINTAINER`).
- An unknown directive.
- A malformed `ENV` (missing key, no `=` and no whitespace separator).
- A `COPY`/`ADD` with fewer than two arguments.
- Invalid JSON in the exec form of `CMD`/`ENTRYPOINT`.

Parser behavior worth knowing:
- Blank lines and `#` comments are skipped.
- Backslash line continuations are joined.
- `RUN` accepts both shell form (`RUN apk add curl`) and exec form (`RUN ["apk","add","curl"]`); exec form is shell-quoted and joined into a single string because the build replays each `RUN` via `/bin/sh -c`.
- `CMD` / `ENTRYPOINT` accept both forms; shell form is wrapped as `["/bin/sh", "-c", "<command>"]`.
- `ENV` supports `KEY=value` and `KEY value` (single pair per directive); surrounding quotes are stripped.
- `COPY` / `ADD` honor double-quoted segments when splitting args.

### Types

```ts
type BuildStep =
  | { kind: "FROM";       image: string }
  | { kind: "RUN";        command: string }
  | { kind: "COPY";       src: string; dst: string }
  | { kind: "ADD";        src: string; dst: string }
  | { kind: "ENV";        key: string; value: string }
  | { kind: "WORKDIR";    path: string }
  | { kind: "USER";       user: string }
  | { kind: "ENTRYPOINT"; argv: string[] }
  | { kind: "CMD";        argv: string[] };

interface ImageMetadata {
  snapshotName: string;            // "<sanitized-tag>-<sha256-prefix>"
  digest: string;                  // full sha256 hex of build inputs
  baseImage: string;               // the FROM reference
  env: Record<string, string>;     // accumulated ENV
  workdir: string | null;
  user: string | null;
  entrypoint: string[] | null;
  cmd: string[] | null;
  createdAt: string;               // ISO timestamp
}

interface BuildOptions {
  contextDir?: string;   // anchor for COPY/ADD sources (default: process.cwd())
  noCache?: boolean;     // force rebuild even if a cached snapshot exists
  quiet?: boolean;       // suppress progress logs
  skipInstall?: boolean; // skip the embedded runtime install check
}

interface RunOptions {
  name: string;                       // required, unique sandbox name
  cpus?: number;                      // guest CPU count (SDK default if omitted)
  memory?: number;                    // guest memory in MiB (SDK default if omitted)
  env?: Record<string, string>;       // merged on top of image ENV
  entrypoint?: string[];              // overrides image ENTRYPOINT/CMD
  workdir?: string;                   // overrides image WORKDIR
  user?: string;                      // overrides image USER
  detached?: boolean;                 // default false (attached + auto-dispose)
  ports?: PortSpec[];                 // number | "host:guest[/udp]" | PortMapping
  volumes?: VolumeSpec[];             // "source:guest[:ro]" | VolumeMount
  hostname?: string;                  // guest hostname
  maxDuration?: number;               // hard wall-clock cap, seconds
  idleTimeout?: number;               // auto-shutdown after N idle seconds
  network?: false | ((b: any) => any);// false = disable; fn = configure NetworkBuilder
  replace?: boolean | number | { graceMs: number };
}

type PortSpec = number | string | PortMapping;
interface PortMapping {
  host: number;
  guest: number;
  protocol?: "tcp" | "udp";           // default "tcp"
}

type VolumeSpec = string | VolumeMount;
type VolumeMount = BindMount | NamedVolumeMount | TmpfsMount;
interface BindMount        { guest: string; bind: string;   readonly?: boolean }
interface NamedVolumeMount { guest: string; volume: string; readonly?: boolean }
interface TmpfsMount       { guest: string; tmpfs: true;    readonly?: boolean }

interface OneShotOptions extends Omit<RunOptions, "name" | "detached" | "entrypoint"> {
  name?: string;            // auto-generated from the snapshot tag if omitted
  throwOnNonZero?: boolean; // default true
}
```

**Port shorthand:** `8080` ≡ `{ host: 8080, guest: 8080 }`, `"8080:80"` ≡
`{ host: 8080, guest: 80 }`, `"5353:53/udp"` adds `protocol: "udp"`.

**Volume shorthand:** `"./data:/data"` is a bind mount,
`"build-cache:/cache"` is a named volume (anything without a leading `.`
or `/` is treated as a volume name), `"tmpfs:/tmp"` is a tmpfs. Append
`:ro` to make any of them read-only.

### Errors

All errors are exported from the package root.

#### `BuildStepError`

Thrown when a `RUN` step exits non-zero during `build()`. The temp microVM is cleaned up before throwing; no metadata sidecar is written.

```ts
class BuildStepError extends Error {
  readonly command: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}
```

```ts
import { SandboxImage, BuildStepError } from "@beamhop/beambox";

try {
  await SandboxImage.builder().from("alpine:3.19").run("exit 7").build("bad");
} catch (err) {
  if (err instanceof BuildStepError) {
    console.error(`step "${err.command}" failed with code ${err.exitCode}`);
    console.error("stderr:", err.stderr);
  }
}
```

#### `ImageNotFoundError`

Thrown by `SandboxImage.run(nameOrTag, ...)` (and the underlying `resolveImage`) when nothing matches.

```ts
class ImageNotFoundError extends Error {
  readonly nameOrTag: string;
  readonly available: string[]; // metadata filenames present in ~/.microsandbox/images/
}
```

```ts
import { SandboxImage, ImageNotFoundError } from "@beamhop/beambox";

try {
  await SandboxImage.run("ghost:9.9", { name: "x" });
} catch (err) {
  if (err instanceof ImageNotFoundError) {
    console.error(`no match for ${err.nameOrTag}; have: ${err.available.join(", ")}`);
  }
}
```

#### `SandboxExitError`

Thrown by `imageRef.exec` and `imageRef.shell` when the command exits non-zero. Opt out with `{ throwOnNonZero: false }` to inspect the `code` directly.

```ts
class SandboxExitError extends Error {
  readonly command: string;   // e.g. "node -e 1+1" or the script body
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly output: ExecOutput; // the raw SDK output object
}
```

```ts
import { SandboxExitError } from "@beamhop/beambox";

try {
  await ref.exec(["node", "missing.js"]);
} catch (err) {
  if (err instanceof SandboxExitError) {
    console.error(`exit ${err.exitCode}: ${err.stderr}`);
  }
}
```

#### `DockerfileParseError`

Thrown by `parseDockerfile`, `SandboxImage.fromDockerfile`, and `SandboxImage.fromDockerfileString`.

```ts
class DockerfileParseError extends Error {
  readonly line: number; // 1-based line number of the offending directive
}
```

---

## Supported Dockerfile directives

| Directive    | Notes                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------- |
| `FROM`       | OCI image reference. Must be the first directive. Exactly one allowed.                         |
| `RUN`        | Replayed via `/bin/sh -c`. Non-zero exit throws `BuildStepError` with stdout + stderr.         |
| `COPY`       | Recursive host → guest copy. `contextDir` anchors the source path.                             |
| `ADD`        | Currently identical to `COPY` (no tar/url extraction).                                         |
| `ENV`        | `KEY=value` or `KEY value`. Accumulates; persisted into image metadata.                        |
| `WORKDIR`    | Applied to subsequent `RUN`s and to spawned sandboxes.                                         |
| `USER`       | Applied to subsequent `RUN`s and to spawned sandboxes.                                         |
| `ENTRYPOINT` | Stored in image metadata; applied as the spawn entrypoint.                                     |
| `CMD`        | Stored in image metadata; used as the fallback entrypoint when no `ENTRYPOINT` is set.         |

**Not supported** (parser rejects with `DockerfileParseError`): `ARG`, `HEALTHCHECK`, `ONBUILD`, `SHELL`, `VOLUME`, `EXPOSE`, `LABEL`, `STOPSIGNAL`, `MAINTAINER`, multi-stage builds, BuildKit `--mount`.

---

## Caching & content addressing

The snapshot name is `<sanitized-tag>-<sha256-prefix>`, where the sha256 covers:

1. The full ordered list of build steps (JSON-serialized).
2. Every `COPY`/`ADD` source path, resolved against `contextDir`:
   - **Files** contribute `path + size + mtimeMs`.
   - **Directories** are walked recursively; each file inside contributes the same.
   - **Missing sources** contribute a `missing:<path>` marker (so a previously-missing file becoming present invalidates the cache).

This means:

- Identical source files at the same paths → cache hit → `build()` returns the existing `ImageRef` immediately, no microVM boot.
- A single edited file (size or mtime change) → new digest → rebuild.
- Pass `{ noCache: true }` to force a rebuild even on a hit.

```ts
const a = await img.build("app:1");                          // builds
const b = await img.build("app:1");                          // cache hit, same snapshotName
const c = await img.build("app:1", { noCache: true });       // forced rebuild
```

---

## Snapshot & metadata layout on disk

```
~/.microsandbox/
├── images/
│   ├── my-app_1.0-abc123def456.json   ← ImageMetadata sidecar (this package)
│   └── …
└── … (msb + libkrunfw runtime, snapshot store managed by microsandbox)
```

The snapshot itself is stored by microsandbox; this package only owns the sidecar JSON. To delete an image:

1. Remove the snapshot via the `msb` CLI (out of scope for this package).
2. Remove the corresponding `~/.microsandbox/images/<snapshot-name>.json` sidecar.

---

## How it differs from Docker

- **Output is a snapshot, not an OCI tar.** No registry push/pull, no `docker load`, no cross-image layer reuse.
- **One `FROM` only.** Multi-stage builds are not supported.
- **No `ARG` / build-time substitution.** Pass env at spawn time via `RunOptions.env`.
- **Each `RUN` shares the same temp microVM.** There is no per-layer commit; the whole build produces a single snapshot.
- **`ADD` does not extract archives or fetch URLs.** It behaves identically to `COPY`.
- **Entrypoint metadata is applied at spawn, not baked into the rootfs.** That's why `ImageMetadata` carries `env` / `workdir` / `user` / `entrypoint` / `cmd` — microsandbox snapshots persist disk state only.

---

## License

Apache 2.0. See [LICENSE](./LICENSE).
