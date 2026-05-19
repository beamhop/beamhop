export type BuildStep =
  | { kind: "FROM"; image: string }
  | { kind: "RUN"; command: string }
  | { kind: "COPY"; src: string; dst: string }
  | { kind: "ADD"; src: string; dst: string }
  | { kind: "ENV"; key: string; value: string }
  | { kind: "WORKDIR"; path: string }
  | { kind: "USER"; user: string }
  | { kind: "ENTRYPOINT"; argv: string[] }
  | { kind: "CMD"; argv: string[] };

export interface ImageMetadata {
  snapshotName: string;
  /**
   * The tag the user passed to `.build(tag, ...)`, verbatim. Distinct from
   * `snapshotName`, which is sanitized + content-addressed. Optional for
   * back-compat with metadata files written before this field existed.
   */
  tag?: string;
  digest: string;
  baseImage: string;
  env: Record<string, string>;
  workdir: string | null;
  user: string | null;
  entrypoint: string[] | null;
  cmd: string[] | null;
  createdAt: string;
}

export interface BuildOptions {
  /** Root directory for COPY/ADD source resolution. Defaults to process.cwd(). */
  contextDir?: string;
  /** Skip the snapshot cache and rebuild from scratch. */
  noCache?: boolean;
  /** Suppress progress logs. */
  quiet?: boolean;
  /**
   * Build-time guest memory in MiB. Defaults to 1024.
   *
   * microsandbox's built-in default (~256 MiB) is enough for simple shell
   * steps but OOM-kills modern installers — `bun install`, `npm install`,
   * `apt-get install`, `pip install` — during dep resolution. Failure
   * surfaces as `exit 137` (SIGKILL) with no other diagnostic.
   */
  memory?: number;
  /**
   * Skip the embedded runtime install check. Use this if you manage
   * the microsandbox runtime out-of-band (e.g. system-wide install
   * or a baked Docker image).
   */
  skipInstall?: boolean;
}

/** Host → guest port forward. `protocol` defaults to `"tcp"`. */
export interface PortMapping {
  host: number;
  guest: number;
  protocol?: "tcp" | "udp";
}

/**
 * Convenience shorthand for `PortMapping`:
 * - `8080` → host 8080 → guest 8080 (TCP)
 * - `"8080:80"` → host 8080 → guest 80 (TCP)
 * - `"5353:53/udp"` → host 5353 → guest 53 (UDP)
 * - object form is passed through unchanged
 */
export type PortSpec = number | string | PortMapping;

/** Bind mount from a host path. */
export interface BindMount {
  guest: string;
  bind: string;
  readonly?: boolean;
}

/** Named microsandbox volume. */
export interface NamedVolumeMount {
  guest: string;
  volume: string;
  readonly?: boolean;
}

/** In-memory tmpfs mount. */
export interface TmpfsMount {
  guest: string;
  tmpfs: true;
  readonly?: boolean;
}

/**
 * Guest-side mount. Pick exactly one source via the discriminant
 * (`bind`, `volume`, or `tmpfs`).
 */
export type VolumeMount = BindMount | NamedVolumeMount | TmpfsMount;

/**
 * Convenience shorthand for `VolumeMount`. Docker-style strings:
 * - `"./data:/data"` → bind `./data` → `/data`
 * - `"./etc:/etc:ro"` → bind read-only
 * - `"build-cache:/cache"` → named volume `build-cache` → `/cache`
 *   (anything without a leading `.` or `/` is treated as a volume name)
 * - `"tmpfs:/tmp"` → tmpfs at `/tmp` (optional `:ro` suffix)
 * - object form is passed through unchanged
 */
export type VolumeSpec = string | VolumeMount;

export interface RunOptions {
  /** Unique sandbox name. Required. */
  name: string;
  /** Guest CPU count. Defaults to SDK default. */
  cpus?: number;
  /** Guest memory in MiB. Defaults to SDK default. */
  memory?: number;
  /** Extra env vars merged on top of the image's ENV. */
  env?: Record<string, string>;
  /** Override the image's ENTRYPOINT. */
  entrypoint?: string[];
  /** Override the working directory. */
  workdir?: string;
  /** Override the user. */
  user?: string;
  /** Boot in detached mode. Defaults to false (attached + auto-dispose). */
  detached?: boolean;
  /**
   * Host → guest port forwards. Accepts a bare number (host=guest, TCP),
   * a Docker-style string (`"8080:80"`, `"5353:53/udp"`), or a
   * `PortMapping` object.
   */
  ports?: PortSpec[];
  /**
   * Mounts to attach to the guest. Accepts a Docker-style string
   * (`"./data:/data"`, `"./etc:/etc:ro"`, `"cache:/cache"`, `"tmpfs:/tmp"`)
   * or a `VolumeMount` object.
   */
  volumes?: VolumeSpec[];
  /** Guest hostname. */
  hostname?: string;
  /** Hard wall-clock cap, in seconds. SDK shuts the sandbox down past this. */
  maxDuration?: number;
  /** Auto-shutdown when the sandbox has been idle for this many seconds. */
  idleTimeout?: number;
  /**
   * Network controls. Set to `false` to disable networking entirely. For
   * fine-grained policy (DNS, TLS, secrets, egress rules), pass a function
   * that configures the SDK's `NetworkBuilder` directly.
   */
  network?: false | ((b: any) => any);
  /**
   * If a sandbox with the same name is already running, replace it.
   * `true` evicts immediately. `{ graceMs }` waits that long for
   * graceful shutdown first. A bare number is also accepted as
   * milliseconds for back-compat.
   */
  replace?: boolean | number | { graceMs: number };
}
