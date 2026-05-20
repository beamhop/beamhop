import { createRequire } from "node:module";
var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// sidecar/index.ts
import { promises as fs2 } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import * as os3 from "node:os";
import * as path2 from "node:path";
import { randomUUID as randomUUID7 } from "node:crypto";
import { WebSocketServer as WebSocketServer3 } from "ws";
import { RTCPeerConnection } from "werift";

// ../../packages/host-orchestrator/dist/index.js
import { createRequire as createRequire2 } from "node:module";
import { EventEmitter as EventEmitter2 } from "node:events";
import { randomUUID as randomUUID6 } from "node:crypto";

// ../../packages/beambox/dist/index.js
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Image, Sandbox, Snapshot, install as installRuntime, isInstalled } from "microsandbox";
var __dispose = Symbol.dispose || /* @__PURE__ */ Symbol.for("Symbol.dispose");
var __asyncDispose = Symbol.asyncDispose || /* @__PURE__ */ Symbol.for("Symbol.asyncDispose");
var __using = (stack, value, async) => {
  if (value != null) {
    if (typeof value !== "object" && typeof value !== "function")
      throw TypeError('Object expected to be assigned to "using" declaration');
    var dispose;
    if (async)
      dispose = value[__asyncDispose];
    if (dispose === undefined)
      dispose = value[__dispose];
    if (typeof dispose !== "function")
      throw TypeError("Object not disposable");
    stack.push([async, dispose, value]);
  } else if (async) {
    stack.push([async]);
  }
  return value;
};
var __callDispose = (stack, error, hasError) => {
  var E = typeof SuppressedError === "function" ? SuppressedError : function(e, s, m, _) {
    return _ = Error(m), _.name = "SuppressedError", _.error = e, _.suppressed = s, _;
  }, fail = (e) => error = hasError ? new E(e, error, "An error was suppressed during disposal") : (hasError = true, e), next = (it) => {
    while (it = stack.pop()) {
      try {
        var result = it[1] && it[1].call(it[2]);
        if (it[0])
          return Promise.resolve(result).then(next, (e) => (fail(e), next()));
      } catch (e) {
        fail(e);
      }
    }
    if (hasError)
      throw error;
  };
  return next();
};
var SUPPORTED = new Set([
  "FROM",
  "RUN",
  "COPY",
  "ADD",
  "ENV",
  "WORKDIR",
  "USER",
  "ENTRYPOINT",
  "CMD"
]);
var UNSUPPORTED = new Set([
  "ARG",
  "HEALTHCHECK",
  "ONBUILD",
  "SHELL",
  "VOLUME",
  "EXPOSE",
  "LABEL",
  "STOPSIGNAL",
  "MAINTAINER"
]);

class DockerfileParseError extends Error {
  line;
  constructor(message, line) {
    super(`Dockerfile line ${line}: ${message}`);
    this.line = line;
    this.name = "DockerfileParseError";
  }
}
function parseDockerfile(source) {
  const logical = joinContinuations(source);
  const steps = [];
  for (const { text, line } of logical) {
    const trimmed = text.trim();
    if (trimmed === "" || trimmed.startsWith("#"))
      continue;
    const match = trimmed.match(/^(\w+)\s+(.*)$/s);
    if (!match)
      throw new DockerfileParseError(`unrecognized directive "${trimmed}"`, line);
    const directive = match[1].toUpperCase();
    const args = match[2].trim();
    if (UNSUPPORTED.has(directive)) {
      throw new DockerfileParseError(`directive "${directive}" is not supported`, line);
    }
    if (!SUPPORTED.has(directive)) {
      throw new DockerfileParseError(`unknown directive "${directive}"`, line);
    }
    steps.push(parseDirective(directive, args, line));
  }
  if (steps.length === 0 || steps[0].kind !== "FROM") {
    throw new DockerfileParseError("Dockerfile must start with a FROM directive", 1);
  }
  return steps;
}
function parseDirective(directive, args, line) {
  switch (directive) {
    case "FROM":
      return { kind: "FROM", image: args };
    case "RUN":
      return { kind: "RUN", command: shellOrExec(args) };
    case "COPY":
    case "ADD": {
      const parts = splitArgs(args);
      if (parts.length < 2) {
        throw new DockerfileParseError(`${directive} requires <src> <dst>`, line);
      }
      const dst = parts[parts.length - 1];
      const src = parts.slice(0, -1).join(" ");
      return directive === "COPY" ? { kind: "COPY", src, dst } : { kind: "ADD", src, dst };
    }
    case "ENV": {
      const { key, value } = parseEnv(args, line);
      return { kind: "ENV", key, value };
    }
    case "WORKDIR":
      return { kind: "WORKDIR", path: args };
    case "USER":
      return { kind: "USER", user: args };
    case "ENTRYPOINT":
      return { kind: "ENTRYPOINT", argv: parseArgv(args, line) };
    case "CMD":
      return { kind: "CMD", argv: parseArgv(args, line) };
    default:
      throw new DockerfileParseError(`unknown directive "${directive}"`, line);
  }
}
function joinContinuations(source) {
  const rawLines = source.split(/\r?\n/);
  const out = [];
  let buf = "";
  let bufStart = 0;
  for (let i = 0;i < rawLines.length; i++) {
    const raw = rawLines[i];
    if (buf === "")
      bufStart = i + 1;
    if (raw.endsWith("\\")) {
      buf += raw.slice(0, -1);
    } else {
      buf += raw;
      out.push({ text: buf, line: bufStart });
      buf = "";
    }
  }
  if (buf !== "")
    out.push({ text: buf, line: bufStart });
  return out;
}
function shellOrExec(args) {
  const trimmed = args.trim();
  if (trimmed.startsWith("[")) {
    const argv = tryParseJsonArray(trimmed);
    if (argv)
      return argv.map(shellQuote).join(" ");
  }
  return trimmed;
}
function parseArgv(args, line) {
  const trimmed = args.trim();
  if (trimmed.startsWith("[")) {
    const parsed = tryParseJsonArray(trimmed);
    if (!parsed)
      throw new DockerfileParseError(`invalid exec-form JSON: ${trimmed}`, line);
    return parsed;
  }
  return ["/bin/sh", "-c", trimmed];
}
function tryParseJsonArray(s) {
  try {
    const v = JSON.parse(s);
    if (Array.isArray(v) && v.every((x) => typeof x === "string"))
      return v;
    return null;
  } catch {
    return null;
  }
}
function parseEnv(args, line) {
  const eq = args.indexOf("=");
  const space = args.search(/\s/);
  if (eq !== -1 && (space === -1 || eq < space)) {
    const key = args.slice(0, eq).trim();
    let value = args.slice(eq + 1).trim();
    value = stripQuotes(value);
    if (!key)
      throw new DockerfileParseError("ENV requires a key", line);
    return { key, value };
  }
  if (space !== -1) {
    const key = args.slice(0, space);
    const value = stripQuotes(args.slice(space + 1).trim());
    return { key, value };
  }
  throw new DockerfileParseError(`ENV "${args}" must be KEY=value or KEY value`, line);
}
function stripQuotes(s) {
  if (s.startsWith('"') && s.endsWith('"') || s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1);
  }
  return s;
}
function splitArgs(s) {
  const out = [];
  let cur = "";
  let inQuote = false;
  for (const ch of s) {
    if (ch === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote && /\s/.test(ch)) {
      if (cur !== "") {
        out.push(cur);
        cur = "";
      }
      continue;
    }
    cur += ch;
  }
  if (cur !== "")
    out.push(cur);
  return out;
}
function shellQuote(s) {
  if (/^[A-Za-z0-9_\-./=:@%+,]+$/.test(s))
    return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
var METADATA_DIR = path.join(os.homedir(), ".microsandbox", "images");
var SNAPSHOT_DIR = path.join(os.homedir(), ".microsandbox", "snapshots");
async function snapshotArtifactExists(snapshotName) {
  try {
    await fs.access(path.join(SNAPSHOT_DIR, snapshotName));
    return true;
  } catch {
    return false;
  }
}

class SandboxImage {
  steps = [];
  static builder() {
    return new SandboxImage;
  }
  static fromDockerfileString(source) {
    const img = new SandboxImage;
    for (const s of parseDockerfile(source))
      img.steps.push(s);
    return img;
  }
  static async fromDockerfile(filePath) {
    const source = await fs.readFile(filePath, "utf8");
    return SandboxImage.fromDockerfileString(source);
  }
  static async run(nameOrTag, options) {
    const metadata = await resolveImage(nameOrTag);
    return new ImageRef(metadata).run(options);
  }
  from(image) {
    this.steps.push({ kind: "FROM", image });
    return this;
  }
  run(command) {
    this.steps.push({ kind: "RUN", command });
    return this;
  }
  copy(src, dst) {
    this.steps.push({ kind: "COPY", src, dst });
    return this;
  }
  add(src, dst) {
    this.steps.push({ kind: "ADD", src, dst });
    return this;
  }
  env(key, value) {
    this.steps.push({ kind: "ENV", key, value });
    return this;
  }
  workdir(p) {
    this.steps.push({ kind: "WORKDIR", path: p });
    return this;
  }
  user(u) {
    this.steps.push({ kind: "USER", user: u });
    return this;
  }
  entrypoint(argv) {
    this.steps.push({ kind: "ENTRYPOINT", argv });
    return this;
  }
  cmd(argv) {
    this.steps.push({ kind: "CMD", argv });
    return this;
  }
  async build(tag, options = {}) {
    if (this.steps.length === 0)
      throw new Error("no build steps — call .from(...) first");
    if (this.steps[0].kind !== "FROM")
      throw new Error("first step must be FROM");
    const emit = makeEmit(options.onEvent);
    const checkAborted = () => {
      if (options.signal?.aborted)
        throw new BuildCancelledError;
    };
    const contextDir = path.resolve(options.contextDir ?? process.cwd());
    const digest = await computeDigest(this.steps, contextDir);
    const snapshotName = `${sanitizeTag(tag)}-${digest.slice(0, 12)}`;
    const baseImage = this.steps[0].image;
    if (!options.noCache) {
      const cached = await loadMetadata(snapshotName).catch(() => null);
      if (cached && await snapshotArtifactExists(snapshotName)) {
        log(options, `cache hit: ${snapshotName}`);
        emit({ kind: "build:start", tag, snapshotName, steps: this.steps.length, cached: true });
        const baseConfig = await inspectImageConfig(cached.baseImage);
        const refreshed = {
          ...cached,
          tag,
          env: { ...baseConfig.env, ...cached.env },
          createdAt: new Date().toISOString()
        };
        await saveMetadata(refreshed);
        emit({ kind: "build:end", snapshotName, cached: true });
        return new ImageRef(refreshed);
      }
      if (cached) {
        log(options, `cache miss: ${snapshotName} (metadata orphan, rebuilding)`);
        await fs.unlink(path.join(METADATA_DIR, `${snapshotName}.json`)).catch(() => {});
      }
    }
    emit({ kind: "build:start", tag, snapshotName, steps: this.steps.length, cached: false });
    checkAborted();
    if (!options.skipInstall)
      await ensureRuntime({ quiet: options.quiet });
    log(options, `building ${tag} → snapshot ${snapshotName}`);
    const tempName = `msb-build-${randomId()}`;
    const buildMemory = options.memory ?? 1024;
    let sandbox = null;
    let currentStepIndex = -1;
    try {
      const fromStart = Date.now();
      emit({ kind: "step:start", index: 0, step: this.steps[0], label: `FROM ${baseImage}` });
      sandbox = await Sandbox.builder(tempName).image(baseImage).memory(buildMemory).create();
      emit({ kind: "step:end", index: 0, exitCode: 0, durationMs: Date.now() - fromStart });
      const baseConfig = await inspectImageConfig(baseImage);
      const env = { ...baseConfig.env };
      let workdir = baseConfig.workdir;
      let userCtx = baseConfig.user;
      let entrypoint = baseConfig.entrypoint;
      let cmd = baseConfig.cmd;
      const debianFamily = isDebianFamily(baseImage);
      for (let i = 1;i < this.steps.length; i++) {
        const step = this.steps[i];
        checkAborted();
        const stepStart = Date.now();
        currentStepIndex = i;
        emit({ kind: "step:start", index: i, step, label: labelStep(step) });
        try {
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
            case "RUN": {
              const runEnv = debianFamily && env.DEBIAN_FRONTEND === undefined ? { ...env, DEBIAN_FRONTEND: "noninteractive" } : env;
              await runStep(sandbox, step.command, runEnv, workdir, userCtx, i, emit, options.signal);
              break;
            }
            case "COPY":
            case "ADD":
              await copyStep(sandbox, contextDir, step.src, step.dst);
              break;
          }
          emit({ kind: "step:end", index: i, exitCode: 0, durationMs: Date.now() - stepStart });
        } catch (err) {
          const code = err instanceof BuildStepError ? err.exitCode : 1;
          emit({ kind: "step:end", index: i, exitCode: code, durationMs: Date.now() - stepStart });
          throw err;
        }
      }
      await flushGuestFs(sandbox);
      await sandbox.stopAndWait();
      sandbox = null;
      const handle = await Sandbox.get(tempName);
      await handle.snapshot(snapshotName);
      const metadata = {
        snapshotName,
        tag,
        digest,
        baseImage,
        env,
        workdir,
        user: userCtx,
        entrypoint,
        cmd,
        createdAt: new Date().toISOString()
      };
      await saveMetadata(metadata);
      emit({ kind: "build:end", snapshotName, cached: false });
      return new ImageRef(metadata);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stepIndex = currentStepIndex >= 0 ? currentStepIndex : undefined;
      emit({ kind: "build:error", message, stepIndex });
      throw err;
    } finally {
      if (sandbox !== null) {
        await sandbox.stop().catch(() => {});
      }
      await Sandbox.remove(tempName).catch(() => {});
    }
  }
}

class ImageRef {
  metadata;
  constructor(metadata) {
    this.metadata = metadata;
  }
  get snapshotName() {
    return this.metadata.snapshotName;
  }
  get digest() {
    return this.metadata.digest;
  }
  async run(options) {
    await ensureRuntime({ quiet: true });
    const builder = applyRunOptions(Sandbox.builder(options.name).fromSnapshot(this.metadata.snapshotName), this.metadata, options);
    return options.detached ? builder.createDetached() : builder.create();
  }
  async exec(argv, options = {}) {
    if (argv.length === 0) {
      throw new Error("ImageRef.exec: argv must contain at least the program name");
    }
    const program = argv[0];
    const args = argv.slice(1);
    const out = await this.runOneShot(options, (sb) => sb.exec(program, args));
    return assertExitOk(out, argv.join(" "), options.throwOnNonZero);
  }
  async shell(script, options = {}) {
    const out = await this.runOneShot(options, (sb) => sb.shell(script));
    return assertExitOk(out, script, options.throwOnNonZero);
  }
  async runOneShot(options, body) {
    let __stack = [];
    try {
      const name = options.name ?? generateSandboxName(this.metadata.snapshotName);
      const sandbox = __using(__stack, await this.run({ ...options, name, detached: false }), 1);
      return body(sandbox);
    } catch (_catch) {
      var _err = _catch, _hasErr = 1;
    } finally {
      var _promise = __callDispose(__stack, _err, _hasErr);
      _promise && await _promise;
    }
  }
}
function assertExitOk(out, command, throwOnNonZero) {
  if (throwOnNonZero === false)
    return out;
  if (out.code === 0)
    return out;
  throw new SandboxExitError(command, out.code, out.stdout(), out.stderr(), out);
}
function generateSandboxName(snapshotName) {
  const dash = snapshotName.lastIndexOf("-");
  const stem = dash > 0 ? snapshotName.slice(0, dash) : snapshotName;
  return `${stem}-${randomUUID().slice(0, 8)}`;
}
function applyRunOptions(initial, metadata, options) {
  let builder = initial;
  if (options.cpus !== undefined)
    builder = builder.cpus(options.cpus);
  if (options.memory !== undefined)
    builder = builder.memory(options.memory);
  const mergedEnv = { ...metadata.env, ...options.env ?? {} };
  if (Object.keys(mergedEnv).length > 0)
    builder = builder.envs(mergedEnv);
  const wd = options.workdir ?? metadata.workdir;
  if (wd)
    builder = builder.workdir(wd);
  const usr = options.user ?? metadata.user;
  if (usr)
    builder = builder.user(usr);
  const ep = options.entrypoint ?? metadata.entrypoint ?? metadata.cmd;
  if (ep)
    builder = builder.entrypoint(ep);
  if (options.hostname !== undefined)
    builder = builder.hostname(options.hostname);
  if (options.maxDuration !== undefined)
    builder = builder.maxDuration(options.maxDuration);
  if (options.idleTimeout !== undefined)
    builder = builder.idleTimeout(options.idleTimeout);
  if (options.replace !== undefined) {
    const r = options.replace;
    if (typeof r === "number")
      builder = builder.replaceWithGrace(r);
    else if (typeof r === "object" && r !== null)
      builder = builder.replaceWithGrace(r.graceMs);
    else if (r === true)
      builder = builder.replace();
  }
  if (options.network === false) {
    builder = builder.disableNetwork();
  } else if (typeof options.network === "function") {
    builder = builder.network(options.network);
  }
  for (const spec of options.ports ?? []) {
    const p = parsePortSpec(spec);
    builder = p.protocol === "udp" ? builder.portUdp(p.host, p.guest) : builder.port(p.host, p.guest);
  }
  for (const spec of options.volumes ?? []) {
    const v = parseVolumeSpec(spec);
    builder = builder.volume(v.guest, (mb) => {
      let m = mb;
      if ("bind" in v)
        m = m.bind(v.bind);
      else if ("volume" in v)
        m = m.named(v.volume);
      else if ("tmpfs" in v)
        m = m.tmpfs();
      if (v.readonly)
        m = m.readonly();
      return m;
    });
  }
  return builder;
}
function parsePortSpec(spec) {
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
    const out = { host, guest };
    if (proto !== undefined) {
      if (proto !== "tcp" && proto !== "udp") {
        throw new Error(`invalid port spec "${spec}" (protocol must be tcp or udp)`);
      }
      if (proto === "udp")
        out.protocol = "udp";
    }
    return out;
  }
  return spec;
}
function parseVolumeSpec(spec) {
  if (typeof spec !== "string")
    return spec;
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
  const ro = readonly ? { readonly: true } : {};
  if (source === "tmpfs") {
    return { guest, tmpfs: true, ...ro };
  }
  if (source.startsWith("/") || source.startsWith("./") || source.startsWith("../") || source === ".") {
    return { guest, bind: source, ...ro };
  }
  return { guest, volume: source, ...ro };
}
var runtimeReady = null;
async function ensureRuntime(opts = {}) {
  if (runtimeReady)
    return runtimeReady;
  runtimeReady = (async () => {
    if (isInstalled())
      return;
    if (!opts.quiet)
      console.error("[beambox] installing microsandbox runtime…");
    await installRuntime();
  })();
  try {
    await runtimeReady;
  } catch (err) {
    runtimeReady = null;
    throw err;
  }
}
async function inspectImageConfig(reference) {
  const empty = {
    env: {},
    workdir: null,
    user: null,
    entrypoint: null,
    cmd: null
  };
  try {
    const detail = await Image.inspect(reference);
    const cfg = detail.config;
    if (!cfg)
      return empty;
    const env = {};
    for (const entry of cfg.env) {
      const eq = entry.indexOf("=");
      if (eq <= 0)
        continue;
      env[entry.slice(0, eq)] = entry.slice(eq + 1);
    }
    return {
      env,
      workdir: cfg.workingDir || null,
      user: cfg.user || null,
      entrypoint: cfg.entrypoint ? [...cfg.entrypoint] : null,
      cmd: cfg.cmd ? [...cfg.cmd] : null
    };
  } catch {
    return empty;
  }
}
async function runStep(sandbox, command, env, workdir, user, stepIndex, emit, signal) {
  const handle = await sandbox.execStreamWith("/bin/sh", (e) => {
    let b = e.args(["-c", command]);
    if (Object.keys(env).length > 0)
      b = b.envs(env);
    if (workdir !== null)
      b = b.cwd(workdir);
    if (user !== null)
      b = b.user(user);
    return b;
  });
  let stdoutBuf = "";
  let stderrBuf = "";
  let exitCode = null;
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const onAbort = () => {
    handle.kill().catch(() => {});
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    for await (const ev of handle) {
      if (ev.kind === "stdout") {
        const text = decoder.decode(ev.data, { stream: true });
        if (text) {
          stdoutBuf += text;
          emit({ kind: "step:stdout", index: stepIndex, text });
        }
      } else if (ev.kind === "stderr") {
        const text = decoder.decode(ev.data, { stream: true });
        if (text) {
          stderrBuf += text;
          emit({ kind: "step:stderr", index: stepIndex, text });
        }
      } else if (ev.kind === "exited") {
        exitCode = ev.code;
      }
    }
    const tailOut = decoder.decode();
    if (tailOut)
      stdoutBuf += tailOut;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
  if (signal?.aborted)
    throw new BuildCancelledError(stepIndex);
  if (exitCode === null) {
    throw new BuildStepError(command, -1, stdoutBuf, stderrBuf);
  }
  if (exitCode !== 0) {
    throw new BuildStepError(command, exitCode, stdoutBuf, stderrBuf);
  }
}
function makeEmit(onEvent) {
  if (!onEvent)
    return () => {};
  return (event) => {
    try {
      onEvent(event);
    } catch {}
  };
}
function labelStep(step) {
  switch (step.kind) {
    case "FROM":
      return `FROM ${step.image}`;
    case "RUN":
      return `RUN ${truncate(step.command, 80)}`;
    case "COPY":
      return `COPY ${step.src} ${step.dst}`;
    case "ADD":
      return `ADD ${step.src} ${step.dst}`;
    case "ENV":
      return `ENV ${step.key}=${truncate(step.value, 40)}`;
    case "WORKDIR":
      return `WORKDIR ${step.path}`;
    case "USER":
      return `USER ${step.user}`;
    case "ENTRYPOINT":
      return `ENTRYPOINT ${step.argv.join(" ")}`;
    case "CMD":
      return `CMD ${step.argv.join(" ")}`;
  }
}
function truncate(s, max) {
  if (s.length <= max)
    return s;
  return `${s.slice(0, max - 1)}…`;
}
function isDebianFamily(baseImage) {
  const name = baseImage.toLowerCase();
  return /(^|\/)(ubuntu|debian)(:|@|$)/.test(name) || /-(ubuntu|debian)\b/.test(name);
}
async function flushGuestFs(sandbox) {
  const result = await sandbox.exec("sync", []).catch((err) => ({
    code: -1,
    stderr: () => String(err),
    stdout: () => ""
  }));
  if (result.code !== 0) {
    console.warn("[beambox] guest filesystem sync failed (snapshot may be stale):", result.stderr());
  }
}
async function copyStep(sandbox, contextDir, src, dst) {
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
      const relPath = path.relative(absSrc, path.join(entry.parentPath ?? entry.path ?? absSrc, entry.name));
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
async function ensureGuestParent(sandbox, guestPath) {
  const parent = posixDirname(guestPath);
  if (parent === "" || parent === "/" || parent === ".")
    return;
  await ensureGuestDir(sandbox, parent);
}
async function ensureGuestDir(sandbox, guestPath) {
  const parts = guestPath.split("/").filter((p) => p !== "");
  let cur = guestPath.startsWith("/") ? "" : ".";
  for (const part of parts) {
    cur = cur === "" ? `/${part}` : `${cur}/${part}`;
    if (await sandbox.fs().exists(cur))
      continue;
    await sandbox.fs().mkdir(cur);
  }
}
function posixDirname(p) {
  const i = p.lastIndexOf("/");
  if (i === -1)
    return "";
  if (i === 0)
    return "/";
  return p.slice(0, i);
}
function posixJoin(a, b) {
  if (a.endsWith("/"))
    return `${a}${b}`;
  return `${a}/${b}`;
}
async function computeDigest(steps, contextDir) {
  const hash = createHash("sha256");
  hash.update(JSON.stringify(steps));
  for (const step of steps) {
    if (step.kind === "COPY" || step.kind === "ADD") {
      await hashPath(hash, path.resolve(contextDir, step.src));
    }
  }
  return hash.digest("hex");
}
async function hashPath(hash, abs) {
  let stat;
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
    const records = entries.filter((e) => e.isFile()).map((e) => {
      const parent = e.parentPath ?? e.path ?? abs;
      return path.join(parent, e.name);
    }).sort();
    for (const f of records) {
      const st = await fs.stat(f);
      hash.update(`\x00file:${f}:${st.size}:${st.mtimeMs}`);
    }
  }
}
async function saveMetadata(meta) {
  await fs.mkdir(METADATA_DIR, { recursive: true });
  const file = path.join(METADATA_DIR, `${meta.snapshotName}.json`);
  await fs.writeFile(file, JSON.stringify(meta, null, 2), "utf8");
}
async function loadMetadata(snapshotName, dir = METADATA_DIR) {
  const file = path.join(dir, `${snapshotName}.json`);
  const raw = await fs.readFile(file, "utf8");
  return JSON.parse(raw);
}
async function removeImage(snapshotName, dir = METADATA_DIR) {
  try {
    await Snapshot.remove(snapshotName, { force: true });
  } catch {}
  const file = path.join(dir, `${snapshotName}.json`);
  await fs.unlink(file).catch(() => {});
}
async function listImages(metadataDir = METADATA_DIR, snapshotDir = SNAPSHOT_DIR) {
  const tracked = [];
  const trackedNames = new Set;
  try {
    const entries = await fs.readdir(metadataDir);
    const jsonFiles = entries.filter((n) => n.endsWith(".json"));
    const metas = await Promise.all(jsonFiles.map((name) => loadMetadata(name.replace(/\.json$/, ""), metadataDir).catch(() => null)));
    for (const m of metas) {
      if (m === null)
        continue;
      tracked.push(m);
      trackedNames.add(m.snapshotName);
    }
  } catch (err) {
    if (err.code !== "ENOENT")
      throw err;
  }
  const orphans = [];
  try {
    const snapEntries = await fs.readdir(snapshotDir, { withFileTypes: true });
    for (const ent of snapEntries) {
      if (ent.name.startsWith("."))
        continue;
      if (trackedNames.has(ent.name))
        continue;
      orphans.push(await synthesizeOrphanMetadata(ent.name, snapshotDir));
    }
  } catch (err) {
    if (err.code !== "ENOENT")
      throw err;
  }
  return [...tracked, ...orphans].sort((a, b) => a.createdAt < b.createdAt ? 1 : -1);
}
async function synthesizeOrphanMetadata(snapshotName, snapshotDir) {
  const m = /-([a-f0-9]{12})$/.exec(snapshotName);
  const tag = m ? snapshotName.slice(0, -m[0].length) : snapshotName;
  const digest = m ? m[1] : "";
  let createdAt = new Date().toISOString();
  try {
    const st = await fs.stat(path.join(snapshotDir, snapshotName));
    createdAt = new Date(st.mtimeMs).toISOString();
  } catch {}
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
    createdAt
  };
}
async function resolveImage(nameOrTag, dir = METADATA_DIR) {
  const checkArtifact = dir === METADATA_DIR;
  const exact = await loadMetadata(nameOrTag, dir).catch((err) => {
    if (err.code === "ENOENT")
      return null;
    throw err;
  });
  if (exact) {
    if (!checkArtifact || await snapshotArtifactExists(exact.snapshotName)) {
      return exact;
    }
  }
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new ImageNotFoundError(nameOrTag, []);
    }
    throw err;
  }
  const prefix = `${sanitizeTag(nameOrTag)}-`;
  const candidates = entries.filter((n) => n.startsWith(prefix) && n.endsWith(".json"));
  if (candidates.length === 0) {
    throw new ImageNotFoundError(nameOrTag, entries.filter((n) => n.endsWith(".json")));
  }
  const metas = await Promise.all(candidates.map((name) => loadMetadata(name.replace(/\.json$/, ""), dir)));
  metas.sort((a, b) => a.createdAt < b.createdAt ? 1 : -1);
  if (!checkArtifact)
    return metas[0];
  for (const meta of metas) {
    if (await snapshotArtifactExists(meta.snapshotName))
      return meta;
  }
  throw new ImageNotFoundError(nameOrTag, candidates);
}
function sanitizeTag(tag) {
  return tag.replace(/[^A-Za-z0-9._-]/g, "_");
}
function randomId() {
  return Math.random().toString(36).slice(2, 10);
}
function log(opts, msg) {
  if (!opts.quiet)
    console.error(`[beambox] ${msg}`);
}

class ImageNotFoundError extends Error {
  nameOrTag;
  available;
  constructor(nameOrTag, available) {
    const hint = available.length === 0 ? "no images have been built yet" : `available: ${available.map((n) => n.replace(/\.json$/, "")).join(", ")}`;
    super(`no image found for "${nameOrTag}" — ${hint}`);
    this.nameOrTag = nameOrTag;
    this.available = available;
    this.name = "ImageNotFoundError";
  }
}

class BuildCancelledError extends Error {
  stepIndex;
  constructor(stepIndex) {
    super(stepIndex !== undefined ? `build cancelled during step ${stepIndex}` : "build cancelled");
    this.stepIndex = stepIndex;
    this.name = "BuildCancelledError";
  }
}

class BuildStepError extends Error {
  command;
  exitCode;
  stdout;
  stderr;
  constructor(command, exitCode, stdout, stderr) {
    super(`build step failed (exit ${exitCode}): ${command}
` + (stderr ? `--- stderr ---
${stderr}
` : "") + (stdout ? `--- stdout ---
${stdout}
` : ""));
    this.command = command;
    this.exitCode = exitCode;
    this.stdout = stdout;
    this.stderr = stderr;
    this.name = "BuildStepError";
  }
}

class SandboxExitError extends Error {
  command;
  exitCode;
  stdout;
  stderr;
  output;
  constructor(command, exitCode, stdout, stderr, output) {
    super(`command failed (exit ${exitCode}): ${command}
` + (stderr ? `--- stderr ---
${stderr}
` : "") + (stdout ? `--- stdout ---
${stdout}
` : ""));
    this.command = command;
    this.exitCode = exitCode;
    this.stdout = stdout;
    this.stderr = stderr;
    this.output = output;
    this.name = "SandboxExitError";
  }
}

// ../../packages/host-orchestrator/dist/index.js
import { Sandbox as Sandbox2 } from "microsandbox";

// ../../packages/sandbox-exec/dist/index.js
import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";
function createPtySpawn(sandbox) {
  return (shell, args, options) => new SandboxPtyImpl(sandbox, shell, args, options);
}

class SandboxPtyImpl {
  pid = 0;
  handle = null;
  stdin = null;
  dataListeners = new Set;
  exitListeners = new Set;
  pendingWrites = [];
  killed = false;
  constructor(sandbox, shell, args, options) {
    this.start(sandbox, shell, args, options);
  }
  async start(sandbox, shell, args, options) {
    let handle;
    try {
      handle = await sandbox.execStreamWith(shell, (b) => {
        for (const a of args)
          b.arg(a);
        if (options.cwd)
          b.cwd(options.cwd);
        if (options.cols && options.cols > 0) {
          b.env("COLUMNS", String(options.cols));
        }
        if (options.rows && options.rows > 0) {
          b.env("LINES", String(options.rows));
        }
        if (options.env) {
          for (const [k, v] of Object.entries(options.env))
            b.env(k, v);
        }
        b.tty(true).stdinPipe();
        return b;
      });
    } catch (err) {
      for (const cb of this.exitListeners)
        cb({ exitCode: 1 });
      return;
    }
    if (this.killed) {
      await handle.kill().catch(() => {});
      return;
    }
    this.handle = handle;
    this.stdin = await handle.takeStdin();
    if (this.pendingWrites.length && this.stdin) {
      const queued = this.pendingWrites;
      this.pendingWrites = [];
      for (const chunk of queued) {
        await this.stdin.write(chunk).catch(() => {});
      }
    }
    this.pump(handle);
  }
  async pump(handle) {
    for await (const ev of handle) {
      if (ev.kind === "started") {
        this.pid = ev.pid;
      } else if (ev.kind === "stdout" || ev.kind === "stderr") {
        const text = bytesToUtf8(ev.data);
        for (const cb of this.dataListeners)
          cb(text);
      } else if (ev.kind === "exited") {
        for (const cb of this.exitListeners)
          cb({ exitCode: ev.code });
      }
    }
  }
  onData(cb) {
    this.dataListeners.add(cb);
  }
  onExit(cb) {
    this.exitListeners.add(cb);
  }
  write(data) {
    if (this.stdin) {
      this.stdin.write(data).catch(() => {});
    } else {
      this.pendingWrites.push(data);
    }
  }
  resize(_cols, _rows) {}
  kill(_signal) {
    this.killed = true;
    if (this.handle) {
      this.handle.kill().catch(() => {});
    }
  }
}
function bytesToUtf8(bytes) {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}
function createChildProcessSpawn(sandbox) {
  return (command, args, options = {}) => new SandboxChildProcess(sandbox, command, args, options);
}

class SandboxChildProcess extends EventEmitter {
  pid = -1;
  exitCode = null;
  signalCode = null;
  stdin;
  stdout;
  stderr;
  handle = null;
  stdinSink = null;
  pendingStdin = [];
  stdinClosed = false;
  killed = false;
  constructor(sandbox, command, args, options) {
    super();
    this.stdout = new Readable({ read() {} });
    this.stderr = new Readable({ read() {} });
    this.stdin = new Writable({
      write: (chunk, _enc, cb) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (this.stdinSink) {
          this.stdinSink.write(buf).then(() => cb()).catch((err) => cb(err));
        } else {
          this.pendingStdin.push(buf);
          cb();
        }
      },
      final: (cb) => {
        this.stdinClosed = true;
        if (this.stdinSink) {
          this.stdinSink.close().then(() => cb()).catch((err) => cb(err));
        } else {
          cb();
        }
      }
    });
    this.start(sandbox, command, args, options);
  }
  async start(sandbox, command, args, options) {
    let handle;
    const needsShellLookup = !command.includes("/");
    try {
      if (needsShellLookup) {
        const script = [command, ...args].map(shellQuote2).join(" ");
        handle = await sandbox.execStreamWith("/bin/sh", (b) => {
          b.arg("-c").arg(script);
          if (options.cwd)
            b.cwd(options.cwd);
          if (options.env) {
            for (const [k, v] of Object.entries(options.env)) {
              if (v !== undefined)
                b.env(k, v);
            }
          }
          b.stdinPipe();
          return b;
        });
      } else {
        handle = await sandbox.execStreamWith(command, (b) => {
          for (const a of args)
            b.arg(a);
          if (options.cwd)
            b.cwd(options.cwd);
          if (options.env) {
            for (const [k, v] of Object.entries(options.env)) {
              if (v !== undefined)
                b.env(k, v);
            }
          }
          b.stdinPipe();
          return b;
        });
      }
    } catch (err) {
      queueMicrotask(() => this.emit("error", err));
      return;
    }
    if (this.killed) {
      await handle.kill().catch(() => {});
      return;
    }
    this.handle = handle;
    this.stdinSink = await handle.takeStdin();
    if (this.pendingStdin.length && this.stdinSink) {
      const queued = this.pendingStdin;
      this.pendingStdin = [];
      for (const chunk of queued) {
        await this.stdinSink.write(chunk).catch(() => {});
      }
    }
    if (this.stdinClosed && this.stdinSink) {
      await this.stdinSink.close().catch(() => {});
    }
    this.pump(handle);
  }
  async pump(handle) {
    try {
      for await (const ev of handle) {
        if (ev.kind === "started") {
          this.pid = ev.pid;
          this.emit("spawn");
        } else if (ev.kind === "stdout") {
          this.stdout.push(Buffer.from(ev.data));
        } else if (ev.kind === "stderr") {
          this.stderr.push(Buffer.from(ev.data));
        } else if (ev.kind === "exited") {
          this.exitCode = ev.code;
          this.stdout.push(null);
          this.stderr.push(null);
          this.emit("exit", ev.code, null);
        }
      }
    } catch (err) {
      this.emit("error", err);
    }
  }
  kill(signal) {
    this.killed = true;
    if (typeof signal === "string")
      this.signalCode = signal;
    if (this.handle) {
      this.handle.kill().catch(() => {});
    }
    return true;
  }
}
function shellQuote2(s) {
  if (/^[A-Za-z0-9_\-./=:@%+,]+$/.test(s))
    return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

// ../../packages/shell-server/dist/index.js
import { randomBytes, timingSafeEqual } from "node:crypto";
import { spawn as nodePtySpawn } from "node-pty";
import { randomUUID as randomUUID2 } from "node:crypto";
import * as os2 from "node:os";
import { WebSocketServer } from "ws";

// ../../packages/shell-protocol/dist/index.js
function encodeControl(msg) {
  return JSON.stringify(msg);
}
function decodeControl(raw) {
  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || typeof parsed.type !== "string") {
    throw new Error("invalid control message");
  }
  return parsed;
}

// ../../packages/shell-server/dist/index.js
function generateToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}
function safeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length)
    return false;
  return timingSafeEqual(ab, bb);
}
function makeVerifier(auth, fallbackToken) {
  if (!auth)
    return (t) => safeEqual(t, fallbackToken);
  if ("verify" in auth)
    return auth.verify;
  return (t) => safeEqual(t, auth.token);
}

class SharedPtySession {
  opts;
  id = randomUUID2();
  pty = null;
  subs = new Map;
  idleTimer = null;
  cols = 80;
  rows = 24;
  history = new PtyHistoryBuffer(64 * 1024);
  constructor(opts) {
    this.opts = opts;
  }
  get peerCount() {
    return this.subs.size;
  }
  get dimensions() {
    return { cols: this.cols, rows: this.rows };
  }
  attach(peerId, cols, rows, sink) {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.subs.set(peerId, { peerId, sink, cols, rows });
    if (!this.pty) {
      this.cols = Math.max(2, cols);
      this.rows = Math.max(2, rows);
      this.spawn();
    } else {
      const snapshot = this.history.snapshot();
      if (snapshot.length > 0) {
        try {
          sink(snapshot);
        } catch {}
      }
    }
    this.recomputeSize();
    return () => this.detach(peerId);
  }
  write(data) {
    if (!this.pty)
      return;
    if (typeof data === "string") {
      this.pty.write(data);
    } else {
      this.pty.write(Buffer.from(data).toString("utf8"));
    }
  }
  resize(peerId, cols, rows) {
    const sub = this.subs.get(peerId);
    if (!sub)
      return;
    sub.cols = cols;
    sub.rows = rows;
    this.recomputeSize();
  }
  detach(peerId) {
    this.subs.delete(peerId);
    if (this.subs.size === 0) {
      this.idleTimer = setTimeout(() => this.kill(), this.opts.idleTimeoutMs);
    } else {
      this.recomputeSize();
    }
  }
  spawn() {
    const spawnFn = this.opts.spawn ?? getDefaultPtySpawn();
    this.pty = spawnFn(this.opts.shell, this.opts.args, {
      name: "xterm-256color",
      cols: this.cols,
      rows: this.rows,
      cwd: this.opts.cwd,
      env: this.opts.env
    });
    this.pty.onData((data) => {
      const bytes = Buffer.from(data, "utf8");
      this.history.push(bytes);
      for (const sub of this.subs.values())
        sub.sink(bytes);
    });
    this.pty.onExit(() => {
      this.pty = null;
    });
  }
  recomputeSize() {
    if (this.subs.size === 0 || !this.pty)
      return;
    let minCols = Infinity;
    let minRows = Infinity;
    for (const s of this.subs.values()) {
      if (s.cols < minCols)
        minCols = s.cols;
      if (s.rows < minRows)
        minRows = s.rows;
    }
    const cols = Number.isFinite(minCols) ? Math.max(2, minCols) : 80;
    const rows = Number.isFinite(minRows) ? Math.max(2, minRows) : 24;
    if (cols !== this.cols || rows !== this.rows) {
      this.cols = cols;
      this.rows = rows;
      try {
        this.pty.resize(cols, rows);
      } catch {}
    }
  }
  kill() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.pty) {
      try {
        this.pty.kill();
      } catch {}
      this.pty = null;
    }
    this.subs.clear();
    this.history.clear();
  }
}

class PtyHistoryBuffer {
  capacity;
  buf;
  written = 0;
  head = 0;
  constructor(capacity) {
    this.capacity = capacity;
    this.buf = Buffer.allocUnsafe(capacity);
  }
  push(chunk) {
    if (chunk.length === 0)
      return;
    const slice = chunk.length > this.capacity ? chunk.subarray(chunk.length - this.capacity) : chunk;
    const first = Math.min(slice.length, this.capacity - this.head);
    slice.copy(this.buf, this.head, 0, first);
    if (first < slice.length) {
      slice.copy(this.buf, 0, first, slice.length);
    }
    this.head = (this.head + slice.length) % this.capacity;
    this.written += slice.length;
  }
  snapshot() {
    const len = Math.min(this.written, this.capacity);
    if (len === 0)
      return Buffer.alloc(0);
    const out = Buffer.allocUnsafe(len);
    if (this.written <= this.capacity) {
      this.buf.copy(out, 0, 0, len);
      return out;
    }
    const tail = this.capacity - this.head;
    this.buf.copy(out, 0, this.head, this.capacity);
    this.buf.copy(out, tail, 0, this.head);
    return out;
  }
  clear() {
    this.written = 0;
    this.head = 0;
  }
}
function defaultPtyOptions(overrides = {}) {
  return {
    shell: overrides.shell ?? process.env.SHELL ?? "/bin/zsh",
    args: overrides.args ?? ["-l"],
    cwd: overrides.cwd ?? os2.homedir(),
    env: overrides.env ?? process.env,
    idleTimeoutMs: overrides.idleTimeoutMs ?? 30 * 60 * 1000,
    spawn: overrides.spawn
  };
}
function getDefaultPtySpawn() {
  return (shell, args, options) => nodePtySpawn(shell, args, {
    name: options.name ?? "xterm-256color",
    cols: options.cols ?? 80,
    rows: options.rows ?? 24,
    cwd: options.cwd,
    env: options.env
  });
}
var FALLBACK_APP_ID = "use-my-shell";
var installHint = (name) => `optional dep '@trystero-p2p/${name}' is not installed — run: bun add @trystero-p2p/${name}`;
async function importStrategy(pkg, pretty) {
  try {
    return await import(pkg);
  } catch {
    throw new Error(installHint(pretty));
  }
}
async function joinStrategyRoom(opts) {
  const appId = opts.appId ?? FALLBACK_APP_ID;
  const password = opts.password;
  const rtcPolyfill = opts.rtcPolyfill;
  switch (opts.strategy) {
    case "ws-relay": {
      const { joinRoom } = await importStrategy("@trystero-p2p/ws-relay", "ws-relay");
      return joinRoom({
        appId,
        password,
        rtcPolyfill,
        relayConfig: { urls: opts.relayUrls }
      }, opts.roomId);
    }
    case "nostr":
    case "mqtt":
    case "torrent": {
      const { joinRoom } = await importStrategy(`@trystero-p2p/${opts.strategy}`, opts.strategy);
      return joinRoom({
        appId,
        password,
        rtcPolyfill,
        relayConfig: opts.relayUrls || opts.redundancy ? { urls: opts.relayUrls, redundancy: opts.redundancy } : undefined
      }, opts.roomId);
    }
    case "supabase": {
      const { joinRoom } = await importStrategy("@trystero-p2p/supabase", "supabase");
      return joinRoom({
        appId: opts.supabaseUrl,
        password,
        rtcPolyfill,
        relayConfig: { supabaseKey: opts.supabaseKey }
      }, opts.roomId);
    }
    case "firebase": {
      const { joinRoom } = await importStrategy("@trystero-p2p/firebase", "firebase");
      return joinRoom({
        appId: opts.databaseURL ?? appId,
        password,
        rtcPolyfill,
        relayConfig: opts.firebaseApp || opts.firebasePath ? {
          firebaseApp: opts.firebaseApp,
          firebasePath: opts.firebasePath
        } : undefined
      }, opts.roomId);
    }
    case "ipfs": {
      const { joinRoom } = await importStrategy("@trystero-p2p/ipfs", "ipfs");
      return joinRoom({ appId, password, rtcPolyfill }, opts.roomId);
    }
    case "custom": {
      return opts.joinRoom({ appId, password, rtcPolyfill, ...opts.config }, opts.roomId);
    }
    default: {
      const exhaustive = opts;
      throw new Error(`unknown strategy: ${JSON.stringify(exhaustive)}`);
    }
  }
}
async function readSelfId(strategy) {
  const pkg = strategy === "ws-relay" ? "@trystero-p2p/ws-relay" : `@trystero-p2p/${strategy === "custom" ? "ws-relay" : strategy}`;
  try {
    const mod = await import(pkg);
    return mod.selfId;
  } catch {
    return "";
  }
}
async function startP2PTransport(opts) {
  const room = await joinStrategyRoom({
    ...opts.strategy,
    roomId: opts.roomId,
    rtcPolyfill: opts.rtcPolyfill
  });
  const [sendIo, onIo] = room.makeAction("io");
  const [sendCtl, onCtl] = room.makeAction("ctl");
  const peers = new Map;
  const sendCtlTo = (msg, peerId) => void sendCtl(encodeControl(msg), peerId);
  const broadcastCtl = (msg) => void sendCtl(encodeControl(msg));
  const holderTtlMs = opts.holderTtlMs ?? 800;
  let holder = null;
  let holderTimer = null;
  const releaseHolder = () => {
    if (holder === null)
      return;
    holder = null;
    if (holderTimer) {
      clearTimeout(holderTimer);
      holderTimer = null;
    }
    broadcastCtl({ type: "holder", peerId: null, ttlMs: holderTtlMs });
  };
  const armHolder = (peerId) => {
    const isNew = holder !== peerId;
    holder = peerId;
    if (holderTimer)
      clearTimeout(holderTimer);
    holderTimer = setTimeout(releaseHolder, holderTtlMs);
    if (isNew) {
      broadcastCtl({ type: "holder", peerId, ttlMs: holderTtlMs });
    }
  };
  const arbitrate = (peerId) => {
    if (holderTtlMs <= 0)
      return true;
    if (holder === null || holder === peerId) {
      armHolder(peerId);
      return true;
    }
    return false;
  };
  room.onPeerJoin((peerId) => {
    const authTimer = setTimeout(() => {
      const state = peers.get(peerId);
      if (state && !state.authed) {
        sendCtlTo({ type: "error", code: "auth_timeout", message: "no auth" }, peerId);
      }
    }, opts.authTimeoutMs ?? 30000);
    peers.set(peerId, { authed: false, authTimer });
  });
  room.onPeerLeave((peerId) => {
    const state = peers.get(peerId);
    if (state) {
      clearTimeout(state.authTimer);
      state.detach?.();
      peers.delete(peerId);
    }
    if (holder === peerId)
      releaseHolder();
  });
  onCtl(async (raw, peerId) => {
    const state = peers.get(peerId);
    if (!state)
      return;
    let msg;
    try {
      msg = decodeControl(raw);
    } catch {
      return;
    }
    if (!state.authed) {
      if (msg.type !== "auth") {
        sendCtlTo({
          type: "error",
          code: "protocol_error",
          message: "expected auth"
        }, peerId);
        return;
      }
      const ok = await opts.verifier(msg.token);
      if (!ok) {
        sendCtlTo({ type: "error", code: "auth_failed", message: "bad token" }, peerId);
        return;
      }
      if (opts.session.peerCount >= opts.maxPeers) {
        sendCtlTo({ type: "error", code: "server_full", message: "max peers" }, peerId);
        return;
      }
      clearTimeout(state.authTimer);
      state.authed = true;
      state.detach = opts.session.attach(peerId, msg.cols, msg.rows, (chunk) => void sendIo(chunk, peerId));
      sendCtlTo({
        type: "ready",
        sessionId: opts.session.id,
        cols: opts.session.dimensions.cols,
        rows: opts.session.dimensions.rows,
        selfPeerId: peerId
      }, peerId);
      sendCtlTo({ type: "holder", peerId: holder, ttlMs: holderTtlMs }, peerId);
      opts.onPeer?.(peerId);
      return;
    }
    if (msg.type === "resize") {
      opts.session.resize(peerId, msg.cols, msg.rows);
    }
  });
  onIo((data, peerId) => {
    const state = peers.get(peerId);
    if (!state?.authed)
      return;
    if (!arbitrate(peerId))
      return;
    opts.session.write(data);
  });
  const hostPeerId = await readSelfId(opts.strategy.strategy);
  return {
    hostPeerId,
    async close() {
      for (const state of peers.values()) {
        clearTimeout(state.authTimer);
        state.detach?.();
      }
      peers.clear();
      if (holderTimer) {
        clearTimeout(holderTimer);
        holderTimer = null;
      }
      holder = null;
      await room.leave();
    }
  };
}

// ../../packages/acp-protocol/dist/index.js
var PROTOCOL_VERSION = 1;
var ACP_ROOM_ACTION = "acp";
class DecodeError extends Error {
  name = "DecodeError";
  raw;
  constructor(message, raw, cause) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.raw = raw;
  }
}
function encode(msg) {
  return JSON.stringify(msg);
}
var KNOWN_KINDS = new Set([
  "hello",
  "ready",
  "rpc",
  "rpc-result",
  "rpc-error",
  "notify",
  "switch-agent",
  "session-new",
  "session-new-result",
  "session-close",
  "cancel",
  "permission-prompt",
  "permission-response",
  "login-start",
  "login-ready",
  "login-data",
  "login-resize",
  "login-cancel",
  "login-end",
  "log",
  "error",
  "ping",
  "pong",
  "close",
  "set-model",
  "set-model-result",
  "model-update"
]);
function decode(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new DecodeError("invalid JSON in wire frame", raw, cause);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new DecodeError("wire frame is not an object", raw);
  }
  const kind = parsed.kind;
  if (typeof kind !== "string" || !KNOWN_KINDS.has(kind)) {
    throw new DecodeError(`unknown wire kind: ${String(kind)}`, raw);
  }
  return parsed;
}
var CLOSE_CODES = {
  NORMAL: 1000,
  GOING_AWAY: 1001,
  PROTOCOL_ERROR: 1002,
  AUTH_REQUIRED: 4401,
  AUTH_FAILED: 4403,
  RATE_LIMITED: 4429,
  SESSION_LIMIT: 4430,
  VERSION_MISMATCH: 4460,
  AGENT_CRASHED: 4500,
  INTERNAL_ERROR: 4501
};

// ../../packages/acp-server/dist/index-3ysae6hf.js
import { WebSocketServer as WebSocketServer2 } from "ws";

// ../../packages/acp-server/dist/index-cc41jy9j.js
import { randomUUID as randomUUID3 } from "node:crypto";
import { randomBytes as randomBytes2, timingSafeEqual as timingSafeEqual2 } from "node:crypto";
import { randomUUID as randomUUID4 } from "node:crypto";
import { randomUUID as randomUUID22 } from "node:crypto";
import {
  spawn as nodeSpawn
} from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, isAbsolute, join as join2 } from "node:path";
import { Readable as Readable2, Writable as Writable2 } from "node:stream";

// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v3/external.js
var exports_external = {};
__export(exports_external, {
  void: () => voidType,
  util: () => util,
  unknown: () => unknownType,
  union: () => unionType,
  undefined: () => undefinedType,
  tuple: () => tupleType,
  transformer: () => effectsType,
  symbol: () => symbolType,
  string: () => stringType,
  strictObject: () => strictObjectType,
  setErrorMap: () => setErrorMap,
  set: () => setType,
  record: () => recordType,
  quotelessJson: () => quotelessJson,
  promise: () => promiseType,
  preprocess: () => preprocessType,
  pipeline: () => pipelineType,
  ostring: () => ostring,
  optional: () => optionalType,
  onumber: () => onumber,
  oboolean: () => oboolean,
  objectUtil: () => objectUtil,
  object: () => objectType,
  number: () => numberType,
  nullable: () => nullableType,
  null: () => nullType,
  never: () => neverType,
  nativeEnum: () => nativeEnumType,
  nan: () => nanType,
  map: () => mapType,
  makeIssue: () => makeIssue,
  literal: () => literalType,
  lazy: () => lazyType,
  late: () => late,
  isValid: () => isValid,
  isDirty: () => isDirty,
  isAsync: () => isAsync,
  isAborted: () => isAborted,
  intersection: () => intersectionType,
  instanceof: () => instanceOfType,
  getParsedType: () => getParsedType,
  getErrorMap: () => getErrorMap,
  function: () => functionType,
  enum: () => enumType,
  effect: () => effectsType,
  discriminatedUnion: () => discriminatedUnionType,
  defaultErrorMap: () => en_default,
  datetimeRegex: () => datetimeRegex,
  date: () => dateType,
  custom: () => custom,
  coerce: () => coerce,
  boolean: () => booleanType,
  bigint: () => bigIntType,
  array: () => arrayType,
  any: () => anyType,
  addIssueToContext: () => addIssueToContext,
  ZodVoid: () => ZodVoid,
  ZodUnknown: () => ZodUnknown,
  ZodUnion: () => ZodUnion,
  ZodUndefined: () => ZodUndefined,
  ZodType: () => ZodType,
  ZodTuple: () => ZodTuple,
  ZodTransformer: () => ZodEffects,
  ZodSymbol: () => ZodSymbol,
  ZodString: () => ZodString,
  ZodSet: () => ZodSet,
  ZodSchema: () => ZodType,
  ZodRecord: () => ZodRecord,
  ZodReadonly: () => ZodReadonly,
  ZodPromise: () => ZodPromise,
  ZodPipeline: () => ZodPipeline,
  ZodParsedType: () => ZodParsedType,
  ZodOptional: () => ZodOptional,
  ZodObject: () => ZodObject,
  ZodNumber: () => ZodNumber,
  ZodNullable: () => ZodNullable,
  ZodNull: () => ZodNull,
  ZodNever: () => ZodNever,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNaN: () => ZodNaN,
  ZodMap: () => ZodMap,
  ZodLiteral: () => ZodLiteral,
  ZodLazy: () => ZodLazy,
  ZodIssueCode: () => ZodIssueCode,
  ZodIntersection: () => ZodIntersection,
  ZodFunction: () => ZodFunction,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodError: () => ZodError,
  ZodEnum: () => ZodEnum,
  ZodEffects: () => ZodEffects,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodDefault: () => ZodDefault,
  ZodDate: () => ZodDate,
  ZodCatch: () => ZodCatch,
  ZodBranded: () => ZodBranded,
  ZodBoolean: () => ZodBoolean,
  ZodBigInt: () => ZodBigInt,
  ZodArray: () => ZodArray,
  ZodAny: () => ZodAny,
  Schema: () => ZodType,
  ParseStatus: () => ParseStatus,
  OK: () => OK,
  NEVER: () => NEVER,
  INVALID: () => INVALID,
  EMPTY_PATH: () => EMPTY_PATH,
  DIRTY: () => DIRTY,
  BRAND: () => BRAND
});

// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v3/helpers/util.js
var util;
(function(util2) {
  util2.assertEqual = (_) => {};
  function assertIs(_arg) {}
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error;
  }
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};

// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v3/ZodError.js
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
};

class ZodError extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        const firstEl = sub.path[0];
        fieldErrors[firstEl] = fieldErrors[firstEl] || [];
        fieldErrors[firstEl].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
}
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};

// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v3/locales/en.js
var errorMap = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "bigint")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
};
var en_default = errorMap;

// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v3/errors.js
var overrideErrorMap = en_default;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}
// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v3/helpers/parseUtil.js
var makeIssue = (params) => {
  const { data, path: path2, errorMaps, issueData } = params;
  const fullPath = [...path2, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== undefined) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      ctx.schemaErrorMap,
      overrideMap,
      overrideMap === en_default ? undefined : en_default
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}

class ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
}
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;
// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

// ../../node_modules/.bun/zod@3.25.76/node_modules/zod/v3/types.js
class ParseInputLazyPath {
  constructor(parent, value, path2, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path2;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
}
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}

class ZodType {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus,
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    const ctx = {
      common: {
        issues: [],
        async: params?.async ?? false,
        contextualErrorMap: params?.errorMap
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if (err?.message?.toLowerCase()?.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params?.errorMap,
        async: true
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(undefined).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
}
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}

class ZodString extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus;
    let ctx = undefined;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      offset: options?.offset ?? false,
      local: options?.local ?? false,
      ...errorUtil.errToObj(options?.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      ...errorUtil.errToObj(options?.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options?.position,
      ...errorUtil.errToObj(options?.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
}
ZodString.create = (params) => {
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}

class ZodNumber extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = undefined;
    const status = new ParseStatus;
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
}
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};

class ZodBigInt extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch {
        return this._getInvalidInput(input);
      }
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = undefined;
    const status = new ParseStatus;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
}
ZodBigInt.create = (params) => {
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};

class ZodBoolean extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
}
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};

class ZodDate extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus;
    let ctx = undefined;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
}
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: params?.coerce || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};

class ZodSymbol extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
}
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};

class ZodUndefined extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
}
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};

class ZodNull extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
}
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};

class ZodAny extends ZodType {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
}
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};

class ZodUnknown extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
}
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};

class ZodNever extends ZodType {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
}
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};

class ZodVoid extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
}
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};

class ZodArray extends ZodType {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : undefined,
          maximum: tooBig ? def.exactLength.value : undefined,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
}
ZodArray.create = (schema, params) => {
  return new ZodArray({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}

class ZodObject extends ZodType {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") {} else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== undefined ? {
        errorMap: (issue, ctx) => {
          const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
          if (issue.code === "unrecognized_keys")
            return {
              message: errorUtil.errToObj(message).message ?? defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  extend(augmentation) {
    return new ZodObject({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  merge(merging) {
    const merged = new ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  catchall(index) {
    return new ZodObject({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
}
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};

class ZodUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = undefined;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
}
ZodUnion.create = (types, params) => {
  return new ZodUnion({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [undefined];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [undefined, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};

class ZodDiscriminatedUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  static create(discriminator, options, params) {
    const optionsMap = new Map;
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
}
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0;index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}

class ZodIntersection extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
}
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};

class ZodTuple extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new ZodTuple({
      ...this._def,
      rest
    });
  }
}
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};

class ZodRecord extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
}

class ZodMap extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = new Map;
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = new Map;
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
}
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};

class ZodSet extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = new Set;
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
}
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};

class ZodFunction extends ZodType {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error
        }
      });
    }
    function makeReturnsIssue(returns, error) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    });
  }
  returns(returnType) {
    return new ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
}

class ZodLazy extends ZodType {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
}
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};

class ZodLiteral extends ZodType {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
}
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}

class ZodEnum extends ZodType {
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
}
ZodEnum.create = createZodEnum;

class ZodNativeEnum extends ZodType {
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
}
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};

class ZodPromise extends ZodType {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
}
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};

class ZodEffects extends ZodType {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return INVALID;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return INVALID;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
}
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
class ZodOptional extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(undefined);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
}
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};

class ZodNullable extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
}
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};

class ZodDefault extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
}
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};

class ZodCatch extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
}
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};

class ZodNaN extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
}
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = Symbol("zod_brand");

class ZodBranded extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
}

class ZodPipeline extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
}

class ZodReadonly extends ZodType {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
}
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params);
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: (arg) => ZodString.create({ ...arg, coerce: true }),
  number: (arg) => ZodNumber.create({ ...arg, coerce: true }),
  boolean: (arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  }),
  bigint: (arg) => ZodBigInt.create({ ...arg, coerce: true }),
  date: (arg) => ZodDate.create({ ...arg, coerce: true })
};
var NEVER = INVALID;
// ../../node_modules/.bun/@zed-industries+agent-client-protocol@0.4.5/node_modules/@zed-industries/agent-client-protocol/dist/schema.js
var AGENT_METHODS = {
  authenticate: "authenticate",
  initialize: "initialize",
  session_cancel: "session/cancel",
  session_load: "session/load",
  session_new: "session/new",
  session_prompt: "session/prompt",
  session_set_mode: "session/set_mode",
  session_set_model: "session/set_model"
};
var CLIENT_METHODS = {
  fs_read_text_file: "fs/read_text_file",
  fs_write_text_file: "fs/write_text_file",
  session_request_permission: "session/request_permission",
  session_update: "session/update",
  terminal_create: "terminal/create",
  terminal_kill: "terminal/kill",
  terminal_output: "terminal/output",
  terminal_release: "terminal/release",
  terminal_wait_for_exit: "terminal/wait_for_exit"
};
var writeTextFileRequestSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  content: exports_external.string(),
  path: exports_external.string(),
  sessionId: exports_external.string()
});
var readTextFileRequestSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  limit: exports_external.number().optional().nullable(),
  line: exports_external.number().optional().nullable(),
  path: exports_external.string(),
  sessionId: exports_external.string()
});
var terminalOutputRequestSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  sessionId: exports_external.string(),
  terminalId: exports_external.string()
});
var releaseTerminalRequestSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  sessionId: exports_external.string(),
  terminalId: exports_external.string()
});
var waitForTerminalExitRequestSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  sessionId: exports_external.string(),
  terminalId: exports_external.string()
});
var killTerminalCommandRequestSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  sessionId: exports_external.string(),
  terminalId: exports_external.string()
});
var extMethodRequestSchema = exports_external.record(exports_external.unknown());
var roleSchema = exports_external.union([exports_external.literal("assistant"), exports_external.literal("user")]);
var textResourceContentsSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  mimeType: exports_external.string().optional().nullable(),
  text: exports_external.string(),
  uri: exports_external.string()
});
var blobResourceContentsSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  blob: exports_external.string(),
  mimeType: exports_external.string().optional().nullable(),
  uri: exports_external.string()
});
var toolKindSchema = exports_external.union([
  exports_external.literal("read"),
  exports_external.literal("edit"),
  exports_external.literal("delete"),
  exports_external.literal("move"),
  exports_external.literal("search"),
  exports_external.literal("execute"),
  exports_external.literal("think"),
  exports_external.literal("fetch"),
  exports_external.literal("switch_mode"),
  exports_external.literal("other")
]);
var toolCallStatusSchema = exports_external.union([
  exports_external.literal("pending"),
  exports_external.literal("in_progress"),
  exports_external.literal("completed"),
  exports_external.literal("failed")
]);
var writeTextFileResponseSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional()
});
var readTextFileResponseSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  content: exports_external.string()
});
var requestPermissionResponseSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  outcome: exports_external.union([
    exports_external.object({
      outcome: exports_external.literal("cancelled")
    }),
    exports_external.object({
      optionId: exports_external.string(),
      outcome: exports_external.literal("selected")
    })
  ])
});
var createTerminalResponseSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  terminalId: exports_external.string()
});
var releaseTerminalResponseSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional()
});
var waitForTerminalExitResponseSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  exitCode: exports_external.number().optional().nullable(),
  signal: exports_external.string().optional().nullable()
});
var killTerminalResponseSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional()
});
var extMethodResponseSchema = exports_external.record(exports_external.unknown());
var cancelNotificationSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  sessionId: exports_external.string()
});
var extNotificationSchema = exports_external.record(exports_external.unknown());
var authenticateRequestSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  methodId: exports_external.string()
});
var setSessionModeRequestSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  modeId: exports_external.string(),
  sessionId: exports_external.string()
});
var setSessionModelRequestSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  modelId: exports_external.string(),
  sessionId: exports_external.string()
});
var extMethodRequest1Schema = exports_external.record(exports_external.unknown());
var httpHeaderSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  name: exports_external.string(),
  value: exports_external.string()
});
var annotationsSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  audience: exports_external.array(roleSchema).optional().nullable(),
  lastModified: exports_external.string().optional().nullable(),
  priority: exports_external.number().optional().nullable()
});
var embeddedResourceResourceSchema = exports_external.union([
  textResourceContentsSchema,
  blobResourceContentsSchema
]);
var authenticateResponseSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional()
});
var setSessionModeResponseSchema = exports_external.object({
  meta: exports_external.unknown().optional()
});
var promptResponseSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  stopReason: exports_external.union([
    exports_external.literal("end_turn"),
    exports_external.literal("max_tokens"),
    exports_external.literal("max_turn_requests"),
    exports_external.literal("refusal"),
    exports_external.literal("cancelled")
  ])
});
var setSessionModelResponseSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional()
});
var extMethodResponse1Schema = exports_external.record(exports_external.unknown());
var sessionModeIdSchema = exports_external.string();
var extNotification1Schema = exports_external.record(exports_external.unknown());
var unstructuredCommandInputSchema = exports_external.object({
  hint: exports_external.string()
});
var permissionOptionSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  kind: exports_external.union([
    exports_external.literal("allow_once"),
    exports_external.literal("allow_always"),
    exports_external.literal("reject_once"),
    exports_external.literal("reject_always")
  ]),
  name: exports_external.string(),
  optionId: exports_external.string()
});
var toolCallContentSchema = exports_external.union([
  exports_external.object({
    content: exports_external.union([
      exports_external.object({
        _meta: exports_external.record(exports_external.unknown()).optional(),
        annotations: annotationsSchema.optional().nullable(),
        text: exports_external.string(),
        type: exports_external.literal("text")
      }),
      exports_external.object({
        _meta: exports_external.record(exports_external.unknown()).optional(),
        annotations: annotationsSchema.optional().nullable(),
        data: exports_external.string(),
        mimeType: exports_external.string(),
        type: exports_external.literal("image"),
        uri: exports_external.string().optional().nullable()
      }),
      exports_external.object({
        _meta: exports_external.record(exports_external.unknown()).optional(),
        annotations: annotationsSchema.optional().nullable(),
        data: exports_external.string(),
        mimeType: exports_external.string(),
        type: exports_external.literal("audio")
      }),
      exports_external.object({
        _meta: exports_external.record(exports_external.unknown()).optional(),
        annotations: annotationsSchema.optional().nullable(),
        description: exports_external.string().optional().nullable(),
        mimeType: exports_external.string().optional().nullable(),
        name: exports_external.string(),
        size: exports_external.number().optional().nullable(),
        title: exports_external.string().optional().nullable(),
        type: exports_external.literal("resource_link"),
        uri: exports_external.string()
      }),
      exports_external.object({
        _meta: exports_external.record(exports_external.unknown()).optional(),
        annotations: annotationsSchema.optional().nullable(),
        resource: embeddedResourceResourceSchema,
        type: exports_external.literal("resource")
      })
    ]),
    type: exports_external.literal("content")
  }),
  exports_external.object({
    _meta: exports_external.record(exports_external.unknown()).optional(),
    newText: exports_external.string(),
    oldText: exports_external.string().optional().nullable(),
    path: exports_external.string(),
    type: exports_external.literal("diff")
  }),
  exports_external.object({
    terminalId: exports_external.string(),
    type: exports_external.literal("terminal")
  })
]);
var toolCallLocationSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  line: exports_external.number().optional().nullable(),
  path: exports_external.string()
});
var envVariableSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  name: exports_external.string(),
  value: exports_external.string()
});
var terminalExitStatusSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  exitCode: exports_external.number().optional().nullable(),
  signal: exports_external.string().optional().nullable()
});
var fileSystemCapabilitySchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  readTextFile: exports_external.boolean().optional(),
  writeTextFile: exports_external.boolean().optional()
});
var stdioSchema = exports_external.object({
  args: exports_external.array(exports_external.string()),
  command: exports_external.string(),
  env: exports_external.array(envVariableSchema),
  name: exports_external.string()
});
var mcpServerSchema = exports_external.union([
  exports_external.object({
    headers: exports_external.array(httpHeaderSchema),
    name: exports_external.string(),
    type: exports_external.literal("http"),
    url: exports_external.string()
  }),
  exports_external.object({
    headers: exports_external.array(httpHeaderSchema),
    name: exports_external.string(),
    type: exports_external.literal("sse"),
    url: exports_external.string()
  }),
  stdioSchema
]);
var contentBlockSchema = exports_external.union([
  exports_external.object({
    _meta: exports_external.record(exports_external.unknown()).optional(),
    annotations: annotationsSchema.optional().nullable(),
    text: exports_external.string(),
    type: exports_external.literal("text")
  }),
  exports_external.object({
    _meta: exports_external.record(exports_external.unknown()).optional(),
    annotations: annotationsSchema.optional().nullable(),
    data: exports_external.string(),
    mimeType: exports_external.string(),
    type: exports_external.literal("image"),
    uri: exports_external.string().optional().nullable()
  }),
  exports_external.object({
    _meta: exports_external.record(exports_external.unknown()).optional(),
    annotations: annotationsSchema.optional().nullable(),
    data: exports_external.string(),
    mimeType: exports_external.string(),
    type: exports_external.literal("audio")
  }),
  exports_external.object({
    _meta: exports_external.record(exports_external.unknown()).optional(),
    annotations: annotationsSchema.optional().nullable(),
    description: exports_external.string().optional().nullable(),
    mimeType: exports_external.string().optional().nullable(),
    name: exports_external.string(),
    size: exports_external.number().optional().nullable(),
    title: exports_external.string().optional().nullable(),
    type: exports_external.literal("resource_link"),
    uri: exports_external.string()
  }),
  exports_external.object({
    _meta: exports_external.record(exports_external.unknown()).optional(),
    annotations: annotationsSchema.optional().nullable(),
    resource: embeddedResourceResourceSchema,
    type: exports_external.literal("resource")
  })
]);
var authMethodSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  description: exports_external.string().optional().nullable(),
  id: exports_external.string(),
  name: exports_external.string()
});
var mcpCapabilitiesSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  http: exports_external.boolean().optional(),
  sse: exports_external.boolean().optional()
});
var promptCapabilitiesSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  audio: exports_external.boolean().optional(),
  embeddedContext: exports_external.boolean().optional(),
  image: exports_external.boolean().optional()
});
var modelInfoSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  description: exports_external.string().optional().nullable(),
  modelId: exports_external.string(),
  name: exports_external.string()
});
var sessionModeSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  description: exports_external.string().optional().nullable(),
  id: sessionModeIdSchema,
  name: exports_external.string()
});
var sessionModelStateSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  availableModels: exports_external.array(modelInfoSchema),
  currentModelId: exports_external.string()
});
var sessionModeStateSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  availableModes: exports_external.array(sessionModeSchema),
  currentModeId: exports_external.string()
});
var planEntrySchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  content: exports_external.string(),
  priority: exports_external.union([exports_external.literal("high"), exports_external.literal("medium"), exports_external.literal("low")]),
  status: exports_external.union([
    exports_external.literal("pending"),
    exports_external.literal("in_progress"),
    exports_external.literal("completed")
  ])
});
var availableCommandInputSchema = unstructuredCommandInputSchema;
var clientNotificationSchema = exports_external.union([
  cancelNotificationSchema,
  extNotificationSchema
]);
var createTerminalRequestSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  args: exports_external.array(exports_external.string()).optional(),
  command: exports_external.string(),
  cwd: exports_external.string().optional().nullable(),
  env: exports_external.array(envVariableSchema).optional(),
  outputByteLimit: exports_external.number().optional().nullable(),
  sessionId: exports_external.string()
});
var terminalOutputResponseSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  exitStatus: terminalExitStatusSchema.optional().nullable(),
  output: exports_external.string(),
  truncated: exports_external.boolean()
});
var newSessionRequestSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  cwd: exports_external.string(),
  mcpServers: exports_external.array(mcpServerSchema)
});
var loadSessionRequestSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  cwd: exports_external.string(),
  mcpServers: exports_external.array(mcpServerSchema),
  sessionId: exports_external.string()
});
var promptRequestSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  prompt: exports_external.array(contentBlockSchema),
  sessionId: exports_external.string()
});
var newSessionResponseSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  models: sessionModelStateSchema.optional().nullable(),
  modes: sessionModeStateSchema.optional().nullable(),
  sessionId: exports_external.string()
});
var loadSessionResponseSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  models: sessionModelStateSchema.optional().nullable(),
  modes: sessionModeStateSchema.optional().nullable()
});
var toolCallUpdateSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  content: exports_external.array(toolCallContentSchema).optional().nullable(),
  kind: toolKindSchema.optional().nullable(),
  locations: exports_external.array(toolCallLocationSchema).optional().nullable(),
  rawInput: exports_external.record(exports_external.unknown()).optional(),
  rawOutput: exports_external.record(exports_external.unknown()).optional(),
  status: toolCallStatusSchema.optional().nullable(),
  title: exports_external.string().optional().nullable(),
  toolCallId: exports_external.string()
});
var clientCapabilitiesSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  fs: fileSystemCapabilitySchema.optional(),
  terminal: exports_external.boolean().optional()
});
var agentCapabilitiesSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  loadSession: exports_external.boolean().optional(),
  mcpCapabilities: mcpCapabilitiesSchema.optional(),
  promptCapabilities: promptCapabilitiesSchema.optional()
});
var availableCommandSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  description: exports_external.string(),
  input: availableCommandInputSchema.optional().nullable(),
  name: exports_external.string()
});
var clientResponseSchema = exports_external.union([
  writeTextFileResponseSchema,
  readTextFileResponseSchema,
  requestPermissionResponseSchema,
  createTerminalResponseSchema,
  terminalOutputResponseSchema,
  releaseTerminalResponseSchema,
  waitForTerminalExitResponseSchema,
  killTerminalResponseSchema,
  extMethodResponseSchema
]);
var requestPermissionRequestSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  options: exports_external.array(permissionOptionSchema),
  sessionId: exports_external.string(),
  toolCall: toolCallUpdateSchema
});
var initializeRequestSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  clientCapabilities: clientCapabilitiesSchema.optional(),
  protocolVersion: exports_external.number()
});
var initializeResponseSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  agentCapabilities: agentCapabilitiesSchema.optional(),
  authMethods: exports_external.array(authMethodSchema).optional(),
  protocolVersion: exports_external.number()
});
var sessionNotificationSchema = exports_external.object({
  _meta: exports_external.record(exports_external.unknown()).optional(),
  sessionId: exports_external.string(),
  update: exports_external.union([
    exports_external.object({
      content: contentBlockSchema,
      sessionUpdate: exports_external.literal("user_message_chunk")
    }),
    exports_external.object({
      content: contentBlockSchema,
      sessionUpdate: exports_external.literal("agent_message_chunk")
    }),
    exports_external.object({
      content: contentBlockSchema,
      sessionUpdate: exports_external.literal("agent_thought_chunk")
    }),
    exports_external.object({
      _meta: exports_external.record(exports_external.unknown()).optional(),
      content: exports_external.array(toolCallContentSchema).optional(),
      kind: exports_external.union([
        exports_external.literal("read"),
        exports_external.literal("edit"),
        exports_external.literal("delete"),
        exports_external.literal("move"),
        exports_external.literal("search"),
        exports_external.literal("execute"),
        exports_external.literal("think"),
        exports_external.literal("fetch"),
        exports_external.literal("switch_mode"),
        exports_external.literal("other")
      ]).optional(),
      locations: exports_external.array(toolCallLocationSchema).optional(),
      rawInput: exports_external.record(exports_external.unknown()).optional(),
      rawOutput: exports_external.record(exports_external.unknown()).optional(),
      sessionUpdate: exports_external.literal("tool_call"),
      status: exports_external.union([
        exports_external.literal("pending"),
        exports_external.literal("in_progress"),
        exports_external.literal("completed"),
        exports_external.literal("failed")
      ]).optional(),
      title: exports_external.string(),
      toolCallId: exports_external.string()
    }),
    exports_external.object({
      _meta: exports_external.record(exports_external.unknown()).optional(),
      content: exports_external.array(toolCallContentSchema).optional().nullable(),
      kind: toolKindSchema.optional().nullable(),
      locations: exports_external.array(toolCallLocationSchema).optional().nullable(),
      rawInput: exports_external.record(exports_external.unknown()).optional(),
      rawOutput: exports_external.record(exports_external.unknown()).optional(),
      sessionUpdate: exports_external.literal("tool_call_update"),
      status: toolCallStatusSchema.optional().nullable(),
      title: exports_external.string().optional().nullable(),
      toolCallId: exports_external.string()
    }),
    exports_external.object({
      _meta: exports_external.record(exports_external.unknown()).optional(),
      entries: exports_external.array(planEntrySchema),
      sessionUpdate: exports_external.literal("plan")
    }),
    exports_external.object({
      availableCommands: exports_external.array(availableCommandSchema),
      sessionUpdate: exports_external.literal("available_commands_update")
    }),
    exports_external.object({
      currentModeId: sessionModeIdSchema,
      sessionUpdate: exports_external.literal("current_mode_update")
    })
  ])
});
var clientRequestSchema = exports_external.union([
  writeTextFileRequestSchema,
  readTextFileRequestSchema,
  requestPermissionRequestSchema,
  createTerminalRequestSchema,
  terminalOutputRequestSchema,
  releaseTerminalRequestSchema,
  waitForTerminalExitRequestSchema,
  killTerminalCommandRequestSchema,
  extMethodRequestSchema
]);
var agentRequestSchema = exports_external.union([
  initializeRequestSchema,
  authenticateRequestSchema,
  newSessionRequestSchema,
  loadSessionRequestSchema,
  setSessionModeRequestSchema,
  promptRequestSchema,
  setSessionModelRequestSchema,
  extMethodRequest1Schema
]);
var agentResponseSchema = exports_external.union([
  initializeResponseSchema,
  authenticateResponseSchema,
  newSessionResponseSchema,
  loadSessionResponseSchema,
  setSessionModeResponseSchema,
  promptResponseSchema,
  setSessionModelResponseSchema,
  extMethodResponse1Schema
]);
var agentNotificationSchema = exports_external.union([
  sessionNotificationSchema,
  extNotification1Schema
]);
var agentClientProtocolSchema = exports_external.union([
  clientRequestSchema,
  clientResponseSchema,
  clientNotificationSchema,
  agentRequestSchema,
  agentResponseSchema,
  agentNotificationSchema
]);
// ../../node_modules/.bun/@zed-industries+agent-client-protocol@0.4.5/node_modules/@zed-industries/agent-client-protocol/dist/stream.js
function ndJsonStream(output, input) {
  const textEncoder = new TextEncoder;
  const textDecoder = new TextDecoder;
  const readable = new ReadableStream({
    async start(controller) {
      let content = "";
      const reader = input.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }
          if (!value) {
            continue;
          }
          content += textDecoder.decode(value, { stream: true });
          const lines = content.split(`
`);
          content = lines.pop() || "";
          for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine) {
              try {
                const message = JSON.parse(trimmedLine);
                controller.enqueue(message);
              } catch (err) {
                console.error("Failed to parse JSON message:", trimmedLine, err);
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
        controller.close();
      }
    }
  });
  const writable = new WritableStream({
    async write(message) {
      const content = JSON.stringify(message) + `
`;
      const writer = output.getWriter();
      try {
        await writer.write(textEncoder.encode(content));
      } finally {
        writer.releaseLock();
      }
    }
  });
  return { readable, writable };
}

// ../../node_modules/.bun/@zed-industries+agent-client-protocol@0.4.5/node_modules/@zed-industries/agent-client-protocol/dist/acp.js
class AgentSideConnection {
  #connection;
  constructor(toAgent, stream2) {
    const agent = toAgent(this);
    const requestHandler = async (method, params) => {
      switch (method) {
        case AGENT_METHODS.initialize: {
          const validatedParams = initializeRequestSchema.parse(params);
          return agent.initialize(validatedParams);
        }
        case AGENT_METHODS.session_new: {
          const validatedParams = newSessionRequestSchema.parse(params);
          return agent.newSession(validatedParams);
        }
        case AGENT_METHODS.session_load: {
          if (!agent.loadSession) {
            throw RequestError.methodNotFound(method);
          }
          const validatedParams = loadSessionRequestSchema.parse(params);
          return agent.loadSession(validatedParams);
        }
        case AGENT_METHODS.session_set_mode: {
          if (!agent.setSessionMode) {
            throw RequestError.methodNotFound(method);
          }
          const validatedParams = setSessionModeRequestSchema.parse(params);
          const result = await agent.setSessionMode(validatedParams);
          return result ?? {};
        }
        case AGENT_METHODS.authenticate: {
          const validatedParams = authenticateRequestSchema.parse(params);
          const result = await agent.authenticate(validatedParams);
          return result ?? {};
        }
        case AGENT_METHODS.session_prompt: {
          const validatedParams = promptRequestSchema.parse(params);
          return agent.prompt(validatedParams);
        }
        case AGENT_METHODS.session_set_model: {
          if (!agent.setSessionModel) {
            throw RequestError.methodNotFound(method);
          }
          const validatedParams = setSessionModelRequestSchema.parse(params);
          return agent.setSessionModel(validatedParams);
        }
        default:
          if (method.startsWith("_")) {
            if (!agent.extMethod) {
              throw RequestError.methodNotFound(method);
            }
            return agent.extMethod(method.substring(1), params);
          }
          throw RequestError.methodNotFound(method);
      }
    };
    const notificationHandler = async (method, params) => {
      switch (method) {
        case AGENT_METHODS.session_cancel: {
          const validatedParams = cancelNotificationSchema.parse(params);
          return agent.cancel(validatedParams);
        }
        default:
          if (method.startsWith("_")) {
            if (!agent.extNotification) {
              return;
            }
            return agent.extNotification(method.substring(1), params);
          }
          throw RequestError.methodNotFound(method);
      }
    };
    this.#connection = new Connection(requestHandler, notificationHandler, stream2);
  }
  async sessionUpdate(params) {
    return await this.#connection.sendNotification(CLIENT_METHODS.session_update, params);
  }
  async requestPermission(params) {
    return await this.#connection.sendRequest(CLIENT_METHODS.session_request_permission, params);
  }
  async readTextFile(params) {
    return await this.#connection.sendRequest(CLIENT_METHODS.fs_read_text_file, params);
  }
  async writeTextFile(params) {
    return await this.#connection.sendRequest(CLIENT_METHODS.fs_write_text_file, params) ?? {};
  }
  async createTerminal(params) {
    const response = await this.#connection.sendRequest(CLIENT_METHODS.terminal_create, params);
    return new TerminalHandle(response.terminalId, params.sessionId, this.#connection);
  }
  async extMethod(method, params) {
    return await this.#connection.sendRequest(`_${method}`, params);
  }
  async extNotification(method, params) {
    return await this.#connection.sendNotification(`_${method}`, params);
  }
}

class TerminalHandle {
  id;
  #sessionId;
  #connection;
  constructor(id, sessionId, conn) {
    this.id = id;
    this.#sessionId = sessionId;
    this.#connection = conn;
  }
  async currentOutput() {
    return await this.#connection.sendRequest(CLIENT_METHODS.terminal_output, {
      sessionId: this.#sessionId,
      terminalId: this.id
    });
  }
  async waitForExit() {
    return await this.#connection.sendRequest(CLIENT_METHODS.terminal_wait_for_exit, {
      sessionId: this.#sessionId,
      terminalId: this.id
    });
  }
  async kill() {
    return await this.#connection.sendRequest(CLIENT_METHODS.terminal_kill, {
      sessionId: this.#sessionId,
      terminalId: this.id
    }) ?? {};
  }
  async release() {
    return await this.#connection.sendRequest(CLIENT_METHODS.terminal_release, {
      sessionId: this.#sessionId,
      terminalId: this.id
    }) ?? {};
  }
  async[Symbol.asyncDispose]() {
    await this.release();
  }
}

class ClientSideConnection {
  #connection;
  constructor(toClient, stream2) {
    const client = toClient(this);
    const requestHandler = async (method, params) => {
      switch (method) {
        case CLIENT_METHODS.fs_write_text_file: {
          const validatedParams = writeTextFileRequestSchema.parse(params);
          return client.writeTextFile?.(validatedParams);
        }
        case CLIENT_METHODS.fs_read_text_file: {
          const validatedParams = readTextFileRequestSchema.parse(params);
          return client.readTextFile?.(validatedParams);
        }
        case CLIENT_METHODS.session_request_permission: {
          const validatedParams = requestPermissionRequestSchema.parse(params);
          return client.requestPermission(validatedParams);
        }
        case CLIENT_METHODS.terminal_create: {
          const validatedParams = createTerminalRequestSchema.parse(params);
          return client.createTerminal?.(validatedParams);
        }
        case CLIENT_METHODS.terminal_output: {
          const validatedParams = terminalOutputRequestSchema.parse(params);
          return client.terminalOutput?.(validatedParams);
        }
        case CLIENT_METHODS.terminal_release: {
          const validatedParams = releaseTerminalRequestSchema.parse(params);
          const result = await client.releaseTerminal?.(validatedParams);
          return result ?? {};
        }
        case CLIENT_METHODS.terminal_wait_for_exit: {
          const validatedParams = waitForTerminalExitRequestSchema.parse(params);
          return client.waitForTerminalExit?.(validatedParams);
        }
        case CLIENT_METHODS.terminal_kill: {
          const validatedParams = killTerminalCommandRequestSchema.parse(params);
          const result = await client.killTerminal?.(validatedParams);
          return result ?? {};
        }
        default:
          if (method.startsWith("_")) {
            const customMethod = method.substring(1);
            if (!client.extMethod) {
              throw RequestError.methodNotFound(method);
            }
            return client.extMethod(customMethod, params);
          }
          throw RequestError.methodNotFound(method);
      }
    };
    const notificationHandler = async (method, params) => {
      switch (method) {
        case CLIENT_METHODS.session_update: {
          const validatedParams = sessionNotificationSchema.parse(params);
          return client.sessionUpdate(validatedParams);
        }
        default:
          if (method.startsWith("_")) {
            const customMethod = method.substring(1);
            if (!client.extNotification) {
              return;
            }
            return client.extNotification(customMethod, params);
          }
          throw RequestError.methodNotFound(method);
      }
    };
    this.#connection = new Connection(requestHandler, notificationHandler, stream2);
  }
  async initialize(params) {
    return await this.#connection.sendRequest(AGENT_METHODS.initialize, params);
  }
  async newSession(params) {
    return await this.#connection.sendRequest(AGENT_METHODS.session_new, params);
  }
  async loadSession(params) {
    return await this.#connection.sendRequest(AGENT_METHODS.session_load, params) ?? {};
  }
  async setSessionMode(params) {
    return await this.#connection.sendRequest(AGENT_METHODS.session_set_mode, params) ?? {};
  }
  async setSessionModel(params) {
    return await this.#connection.sendRequest(AGENT_METHODS.session_set_mode, params) ?? {};
  }
  async authenticate(params) {
    return await this.#connection.sendRequest(AGENT_METHODS.authenticate, params) ?? {};
  }
  async prompt(params) {
    return await this.#connection.sendRequest(AGENT_METHODS.session_prompt, params);
  }
  async cancel(params) {
    return await this.#connection.sendNotification(AGENT_METHODS.session_cancel, params);
  }
  async extMethod(method, params) {
    return await this.#connection.sendRequest(`_${method}`, params);
  }
  async extNotification(method, params) {
    return await this.#connection.sendNotification(`_${method}`, params);
  }
}

class Connection {
  #pendingResponses = new Map;
  #nextRequestId = 0;
  #requestHandler;
  #notificationHandler;
  #stream;
  #writeQueue = Promise.resolve();
  constructor(requestHandler, notificationHandler, stream2) {
    this.#requestHandler = requestHandler;
    this.#notificationHandler = notificationHandler;
    this.#stream = stream2;
    this.#receive();
  }
  async#receive() {
    const reader = this.#stream.readable.getReader();
    try {
      while (true) {
        const { value: message, done } = await reader.read();
        if (done) {
          break;
        }
        if (!message) {
          continue;
        }
        try {
          this.#processMessage(message);
        } catch (err) {
          console.error("Unexpected error during message processing:", message, err);
          if ("id" in message && message.id !== undefined) {
            this.#sendMessage({
              jsonrpc: "2.0",
              id: message.id,
              error: {
                code: -32700,
                message: "Parse error"
              }
            });
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
  async#processMessage(message) {
    if ("method" in message && "id" in message) {
      const response = await this.#tryCallRequestHandler(message.method, message.params);
      if ("error" in response) {
        console.error("Error handling request", message, response.error);
      }
      await this.#sendMessage({
        jsonrpc: "2.0",
        id: message.id,
        ...response
      });
    } else if ("method" in message) {
      const response = await this.#tryCallNotificationHandler(message.method, message.params);
      if ("error" in response) {
        console.error("Error handling notification", message, response.error);
      }
    } else if ("id" in message) {
      this.#handleResponse(message);
    } else {
      console.error("Invalid message", { message });
    }
  }
  async#tryCallRequestHandler(method, params) {
    try {
      const result = await this.#requestHandler(method, params);
      return { result: result ?? null };
    } catch (error) {
      if (error instanceof RequestError) {
        return error.toResult();
      }
      if (error instanceof exports_external.ZodError) {
        return RequestError.invalidParams(error.format()).toResult();
      }
      let details;
      if (error instanceof Error) {
        details = error.message;
      } else if (typeof error === "object" && error != null && "message" in error && typeof error.message === "string") {
        details = error.message;
      }
      try {
        return RequestError.internalError(details ? JSON.parse(details) : {}).toResult();
      } catch (_err) {
        return RequestError.internalError({ details }).toResult();
      }
    }
  }
  async#tryCallNotificationHandler(method, params) {
    try {
      await this.#notificationHandler(method, params);
      return { result: null };
    } catch (error) {
      if (error instanceof RequestError) {
        return error.toResult();
      }
      if (error instanceof exports_external.ZodError) {
        return RequestError.invalidParams(error.format()).toResult();
      }
      let details;
      if (error instanceof Error) {
        details = error.message;
      } else if (typeof error === "object" && error != null && "message" in error && typeof error.message === "string") {
        details = error.message;
      }
      try {
        return RequestError.internalError(details ? JSON.parse(details) : {}).toResult();
      } catch (_err) {
        return RequestError.internalError({ details }).toResult();
      }
    }
  }
  #handleResponse(response) {
    const pendingResponse = this.#pendingResponses.get(response.id);
    if (pendingResponse) {
      if ("result" in response) {
        pendingResponse.resolve(response.result);
      } else if ("error" in response) {
        pendingResponse.reject(response.error);
      }
      this.#pendingResponses.delete(response.id);
    } else {
      console.error("Got response to unknown request", response.id);
    }
  }
  async sendRequest(method, params) {
    const id = this.#nextRequestId++;
    const responsePromise = new Promise((resolve2, reject) => {
      this.#pendingResponses.set(id, { resolve: resolve2, reject });
    });
    await this.#sendMessage({ jsonrpc: "2.0", id, method, params });
    return responsePromise;
  }
  async sendNotification(method, params) {
    await this.#sendMessage({ jsonrpc: "2.0", method, params });
  }
  async#sendMessage(message) {
    this.#writeQueue = this.#writeQueue.then(async () => {
      const writer = this.#stream.writable.getWriter();
      try {
        await writer.write(message);
      } finally {
        writer.releaseLock();
      }
    }).catch((error) => {
      console.error("ACP write error:", error);
    });
    return this.#writeQueue;
  }
}

class RequestError extends Error {
  code;
  data;
  constructor(code, message, data) {
    super(message);
    this.code = code;
    this.name = "RequestError";
    this.data = data;
  }
  static parseError(data) {
    return new RequestError(-32700, "Parse error", data);
  }
  static invalidRequest(data) {
    return new RequestError(-32600, "Invalid request", data);
  }
  static methodNotFound(method) {
    return new RequestError(-32601, "Method not found", { method });
  }
  static invalidParams(data) {
    return new RequestError(-32602, "Invalid params", data);
  }
  static internalError(data) {
    return new RequestError(-32603, "Internal error", data);
  }
  static authRequired(data) {
    return new RequestError(-32000, "Authentication required", data);
  }
  static resourceNotFound(uri) {
    return new RequestError(-32002, "Resource not found", uri && { uri });
  }
  toResult() {
    return {
      error: {
        code: this.code,
        message: this.message,
        data: this.data
      }
    };
  }
  toErrorResponse() {
    return {
      code: this.code,
      message: this.message,
      data: this.data
    };
  }
}

// ../../packages/acp-server/dist/index-cc41jy9j.js
function generateToken2(bytes = 32) {
  return randomBytes2(bytes).toString("base64url");
}
function safeEqual2(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length)
    return false;
  return timingSafeEqual2(ab, bb);
}
function resolveAuth(config) {
  if (!config || config.mode === "none") {
    return {
      config: { mode: "none" },
      verifyToken: null,
      verifyUpgrade: null
    };
  }
  if (config.mode === "token") {
    if (config.verify) {
      return { config, verifyToken: config.verify, verifyUpgrade: null };
    }
    const token = config.token ?? generateToken2();
    return {
      config: { mode: "token", token },
      generatedToken: config.token ? undefined : token,
      verifyToken: (t) => safeEqual2(t, token),
      verifyUpgrade: null
    };
  }
  if (config.mode === "upgrade") {
    return { config, verifyToken: null, verifyUpgrade: config.verify };
  }
  const sharedToken = config.token ?? (config.verifyToken ? undefined : generateToken2());
  const verifyToken = config.verifyToken ?? ((t) => sharedToken ? safeEqual2(t, sharedToken) : false);
  return {
    config,
    generatedToken: config.token || config.verifyToken ? undefined : sharedToken,
    verifyToken,
    verifyUpgrade: config.verifyUpgrade
  };
}
var LEVEL_ORDER = { debug: 10, info: 20, warn: 30, error: 40 };
function createConsoleLogger(opts = {}) {
  const minLevel = opts.level ?? "info";
  const format = opts.format ?? "pretty";
  const base = opts.baseContext ?? {};
  function write(level, message, context) {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel])
      return;
    const merged = context ? { ...base, ...context } : base;
    const entry = { level, message, ts: Date.now(), context: merged };
    opts.sink?.(entry);
    if (format === "json") {
      console[level === "debug" ? "log" : level](JSON.stringify(entry));
      return;
    }
    const tag = `[acp:${level}]`;
    const ctxStr = Object.keys(merged).length ? ` ${JSON.stringify(merged)}` : "";
    console[level === "debug" ? "log" : level](`${tag} ${message}${ctxStr}`);
  }
  return {
    debug: (m, c) => write("debug", m, c),
    info: (m, c) => write("info", m, c),
    warn: (m, c) => write("warn", m, c),
    error: (m, c) => write("error", m, c),
    child(context) {
      return createConsoleLogger({ ...opts, baseContext: { ...base, ...context } });
    }
  };
}
function resolvePermission(config) {
  return {
    forward: config?.forward ?? true,
    timeoutMs: config?.timeoutMs ?? 60000,
    policy: config?.policy
  };
}

class PendingPermissions {
  logger;
  pending = new Map;
  constructor(logger) {
    this.logger = logger;
  }
  open(timeoutMs) {
    const id = randomUUID4();
    const promise = new Promise((resolve2, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.logger.warn("permission prompt timed out, auto-denying", { id });
        resolve2("reject_once");
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve2, reject, timer });
    });
    return { id, promise };
  }
  resolve(id, decision) {
    const entry = this.pending.get(id);
    if (!entry) {
      this.logger.warn("permission response for unknown id", { id, decision });
      return false;
    }
    clearTimeout(entry.timer);
    this.pending.delete(id);
    entry.resolve(decision);
    return true;
  }
  rejectAll(reason) {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
      this.pending.delete(id);
    }
  }
}
var cachedSpawn = null;
var ptyImportFailed = false;
async function loadPtySpawn() {
  if (cachedSpawn)
    return cachedSpawn;
  if (ptyImportFailed)
    return null;
  try {
    const mod = await import("node-pty");
    cachedSpawn = mod.spawn;
    return cachedSpawn;
  } catch {
    ptyImportFailed = true;
    return null;
  }
}
function resolveLogin(config) {
  return { timeoutMs: config?.timeoutMs ?? 300000 };
}

class PendingLogins {
  logger;
  active = new Map;
  defaultTimeoutMs;
  spawnOverride;
  constructor(logger, config, options = {}) {
    this.logger = logger;
    this.defaultTimeoutMs = config.timeoutMs;
    this.spawnOverride = options.spawn ?? null;
  }
  async resolveSpawn() {
    return this.spawnOverride ?? await loadPtySpawn();
  }
  async start(def, spec, sinks, dims = { cols: 80, rows: 24 }) {
    const spawn = await this.resolveSpawn();
    if (!spawn) {
      throw new Error("node-pty is not available — install the optional dependency to enable agent login flows");
    }
    const loginId = randomUUID22();
    const env = { ...process.env, ...spec.env };
    const cwd = spec.cwd ?? def.cwd ?? process.cwd();
    const pty = spawn(spec.command, spec.args, {
      name: "xterm-256color",
      cols: dims.cols,
      rows: dims.rows,
      cwd,
      env
    });
    const timeoutMs = spec.timeoutMs ?? this.defaultTimeoutMs;
    const timer = setTimeout(() => this.endWith(loginId, "timeout"), timeoutMs);
    const entry = {
      pty,
      timer,
      successMarker: spec.successMarker,
      pendingReason: null,
      sinks,
      agentId: String(def.id)
    };
    this.active.set(loginId, entry);
    pty.onData((data) => {
      const e = this.active.get(loginId);
      if (!e)
        return;
      e.sinks.onData(data);
      if (e.pendingReason)
        return;
      if (e.successMarker && e.successMarker.test(data)) {
        e.pendingReason = "success_marker";
        setTimeout(() => this.endWith(loginId, "success_marker"), 250);
      }
    });
    pty.onExit(({ exitCode }) => {
      const e = this.active.get(loginId);
      if (!e)
        return;
      clearTimeout(e.timer);
      this.active.delete(loginId);
      e.sinks.onEnd(exitCode ?? null, e.pendingReason ?? "exit");
    });
    this.logger.info("login session started", {
      loginId,
      agentId: def.id,
      command: spec.command,
      pid: pty.pid
    });
    return loginId;
  }
  write(loginId, data) {
    const entry = this.active.get(loginId);
    if (!entry)
      return false;
    entry.pty.write(data);
    return true;
  }
  resize(loginId, cols, rows) {
    const entry = this.active.get(loginId);
    if (!entry)
      return false;
    try {
      entry.pty.resize(Math.max(2, cols), Math.max(2, rows));
    } catch {
      return false;
    }
    return true;
  }
  cancel(loginId) {
    return this.endWith(loginId, "cancelled");
  }
  endWith(loginId, reason) {
    const entry = this.active.get(loginId);
    if (!entry)
      return false;
    entry.pendingReason = reason;
    clearTimeout(entry.timer);
    try {
      entry.pty.kill("SIGTERM");
    } catch {}
    setTimeout(() => {
      const e = this.active.get(loginId);
      if (!e)
        return;
      try {
        e.pty.kill("SIGKILL");
      } catch {}
      this.active.delete(loginId);
      e.sinks.onEnd(null, reason);
    }, 1000);
    return true;
  }
  closeAll(_reason) {
    for (const loginId of [...this.active.keys()]) {
      this.endWith(loginId, "cancelled");
    }
  }
  get activeCount() {
    return this.active.size;
  }
}
function defineAgent(input) {
  return {
    id: input.id,
    label: input.label ?? String(input.id),
    command: input.command,
    args: input.args ?? [],
    env: input.env,
    cwd: input.cwd,
    installHint: input.installHint,
    healthCheck: input.healthCheck,
    login: input.login
  };
}
function loginKindOf(def) {
  return def.login?.kind ?? "none";
}
var builtInAgents = {
  "claude-code": defineAgent({
    id: "claude-code",
    label: "Claude Code",
    command: "bunx",
    args: ["-y", "@zed-industries/claude-code-acp"],
    installHint: "no install needed (auto-downloaded via bunx). For faster startup: `bun i -g @zed-industries/claude-code-acp` and change the command to `claude-code-acp`.",
    healthCheck: () => true,
    login: { kind: "acp_native" }
  }),
  gemini: defineAgent({
    id: "gemini",
    label: "Gemini CLI",
    command: "gemini",
    args: ["--experimental-acp"],
    installHint: "bun i -g @google/gemini-cli",
    login: { kind: "acp_native" }
  }),
  codex: defineAgent({
    id: "codex",
    label: "Codex",
    command: "bunx",
    args: ["-y", "@zed-industries/codex-acp"],
    installHint: "no install needed (auto-downloaded via bunx). Requires the OpenAI Codex CLI to be installed and authenticated first: `bun i -g @openai/codex && codex login`.",
    healthCheck: () => true,
    login: { kind: "acp_native" }
  }),
  opencode: defineAgent({
    id: "opencode",
    label: "OpenCode",
    command: "bunx",
    args: ["-y", "--package=opencode-ai", "opencode", "acp"],
    installHint: "no install needed (auto-downloaded via bunx). Requires an LLM provider API key (e.g. ANTHROPIC_API_KEY, OPENAI_API_KEY) in env, or run `opencode auth login` first.",
    healthCheck: () => true,
    login: {
      kind: "tty",
      command: "bunx",
      args: ["-y", "--package=opencode-ai", "opencode", "auth", "login"],
      successMarker: /authenticated|logged in|saved/i
    }
  }),
  copilot: defineAgent({
    id: "copilot",
    label: "GitHub Copilot CLI",
    command: "bunx",
    args: ["-y", "--package=@github/copilot", "copilot", "--acp"],
    installHint: "no install needed (auto-downloaded via bunx). Requires an active Copilot subscription. On first use, run `bunx -y --package=@github/copilot copilot` interactively and `/login`.",
    healthCheck: () => true,
    login: {
      kind: "tty",
      command: "bunx",
      args: ["-y", "--package=@github/copilot", "copilot"],
      successMarker: /signed in as|logged in/i
    }
  }),
  "pi-mono": defineAgent({
    id: "pi-mono",
    label: "Pi",
    command: "bunx",
    args: ["-y", "pi-acp"],
    installHint: "no install needed (auto-downloaded via bunx). On first use, run `bunx -y pi-acp --terminal-login` once to set up provider auth (Pi uses ANTHROPIC_API_KEY / OPENAI_API_KEY).",
    healthCheck: () => true,
    login: {
      kind: "tty",
      command: "bunx",
      args: ["-y", "pi-acp", "--terminal-login"],
      successMarker: /authenticated|saved|configured/i
    }
  })
};
function resolveAgent(registry, id) {
  return registry[String(id)] ?? null;
}
var MAX_STDERR_TAIL_BYTES = 8192;
async function spawnAgent(opts) {
  const { definition, hooks, logger } = opts;
  const log2 = logger.child({ agentId: definition.id, command: definition.command });
  const spawnFn = opts.spawn ?? defaultSpawn;
  if (!opts.spawn && !resolveBinary(definition.command, definition.env)) {
    const err = Object.assign(new Error(`binary not found on PATH: ${definition.command}`), {
      code: "ENOENT"
    });
    hooks.onSpawnError(err);
    throw err;
  }
  const child = spawnFn(definition.command, definition.args, {
    env: { ...process.env, ...definition.env },
    cwd: definition.cwd,
    stdio: ["pipe", "pipe", "pipe"]
  });
  if (child.pid === undefined) {
    const err = Object.assign(new Error(`failed to spawn ${definition.command}`), {
      code: "ENOENT"
    });
    hooks.onSpawnError(err);
    throw err;
  }
  const pid = child.pid;
  const earlyError = new Promise((_, reject) => {
    const onError = (err) => {
      child.removeListener("spawn", onSpawn);
      hooks.onSpawnError(err);
      reject(err);
    };
    const onSpawn = () => {
      child.removeListener("error", onError);
    };
    child.once("error", onError);
    child.once("spawn", onSpawn);
  });
  earlyError.catch(() => {});
  await Promise.race([
    new Promise((resolve2) => child.once("spawn", () => resolve2())),
    earlyError
  ]);
  log2.info("agent spawned", { pid: child.pid });
  let stderrTail = "";
  let stderrLineBuf = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderrTail = (stderrTail + chunk).slice(-MAX_STDERR_TAIL_BYTES);
    log2.debug("agent stderr", { chunk: chunk.trimEnd() });
    if (!hooks.onStderrLine)
      return;
    stderrLineBuf += chunk;
    let nl;
    while ((nl = stderrLineBuf.indexOf(`
`)) >= 0) {
      const line = stderrLineBuf.slice(0, nl);
      stderrLineBuf = stderrLineBuf.slice(nl + 1);
      if (line.trim())
        hooks.onStderrLine(line);
    }
  });
  const stdoutWeb = Readable2.toWeb(child.stdout);
  const stdinWeb = Writable2.toWeb(child.stdin);
  const [stdoutRaw, stdoutForFilter] = stdoutWeb.tee();
  const RAW_ID_FLOOR = 1e6;
  const stdoutForAcp = stdoutForFilter.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      const text = new TextDecoder().decode(chunk);
      const lines = text.split(`
`);
      const kept = [];
      for (const line of lines) {
        if (!line.trim()) {
          kept.push(line);
          continue;
        }
        try {
          const m = JSON.parse(line);
          if (typeof m.id === "number" && m.id >= RAW_ID_FLOOR)
            continue;
        } catch {}
        kept.push(line);
      }
      controller.enqueue(new TextEncoder().encode(kept.join(`
`)));
    }
  }));
  const stream2 = ndJsonStream(stdinWeb, stdoutForAcp);
  const rawPending = new Map;
  let rawIdCounter = 1e6;
  (async () => {
    const reader = stdoutRaw.getReader();
    const decoder = new TextDecoder;
    let buf = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done)
          break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf(`
`)) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim())
            continue;
          try {
            const m = JSON.parse(line);
            if (typeof m.id !== "number")
              continue;
            const waiter = rawPending.get(m.id);
            if (!waiter)
              continue;
            rawPending.delete(m.id);
            if (m.error !== undefined)
              waiter.reject(m.error);
            else
              waiter.resolve(m.result);
          } catch {}
        }
      }
    } catch (err) {
      log2.debug("raw rpc reader ended", { err: errMsg(err) });
    } finally {
      for (const [, w] of rawPending)
        w.reject(new Error("agent stream closed"));
      rawPending.clear();
    }
  })();
  function sendRawRpc(method, params, timeoutMs = 30000) {
    const id = rawIdCounter++;
    return new Promise((resolve2, reject) => {
      rawPending.set(id, { resolve: resolve2, reject });
      const timer = setTimeout(() => {
        if (rawPending.delete(id))
          reject(new Error(`raw rpc ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref?.();
      const wrappedResolve = resolve2;
      const wrappedReject = reject;
      rawPending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          wrappedResolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          wrappedReject(e);
        }
      });
      const line = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + `
`;
      child.stdin.write(line);
    });
  }
  const clientHandler = {
    async sessionUpdate(notification) {
      try {
        hooks.onSessionUpdate(notification);
      } catch (err) {
        log2.error("sessionUpdate handler threw", { err: errMsg(err) });
      }
    },
    requestPermission: (req) => guard(() => hooks.onRequestPermission(req), log2, "requestPermission"),
    readTextFile: (req) => guard(() => hooks.onReadTextFile(req), log2, "readTextFile"),
    writeTextFile: (req) => guard(() => hooks.onWriteTextFile(req), log2, "writeTextFile"),
    createTerminal: (req) => guard(() => hooks.onCreateTerminal(req), log2, "createTerminal"),
    terminalOutput: (req) => guard(() => hooks.onTerminalOutput(req), log2, "terminalOutput"),
    waitForTerminalExit: (req) => guard(() => hooks.onWaitForTerminalExit(req), log2, "waitForTerminalExit"),
    killTerminal: (req) => guard(() => hooks.onKillTerminal(req), log2, "killTerminal"),
    releaseTerminal: (req) => guard(() => hooks.onReleaseTerminal(req), log2, "releaseTerminal")
  };
  const connection = new ClientSideConnection(() => clientHandler, stream2);
  const exitOnce = onceExit(child, (code, signal) => {
    log2.info("agent exited", { code, signal, pid: child.pid });
    hooks.onExit({ code, signal, stderrTail });
  });
  return {
    definition,
    pid,
    connection,
    sendRawRpc,
    async kill(signal = "SIGTERM") {
      if (child.exitCode !== null || child.signalCode !== null)
        return;
      log2.debug("killing agent", { signal, pid: child.pid });
      child.kill(signal);
      const hardStop = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          log2.warn("agent did not exit after SIGTERM, sending SIGKILL", { pid: child.pid });
          child.kill("SIGKILL");
        }
      }, 3000);
      hardStop.unref();
      await exitOnce;
    }
  };
}
function onceExit(child, cb) {
  return new Promise((resolve2) => {
    child.once("exit", (code, signal) => {
      cb(code, signal);
      resolve2();
    });
  });
}
async function guard(fn, log2, op) {
  try {
    return await fn();
  } catch (err) {
    log2.error(`client handler ${op} threw`, { err: errMsg(err) });
    if (err instanceof RequestError)
      throw err;
    throw RequestError.internalError({ op, message: errMsg(err) });
  }
}
function errMsg(err) {
  return err instanceof Error ? err.message : String(err);
}
var defaultSpawn = (cmd, args, options) => nodeSpawn(cmd, args, options);
function resolveBinary(command, extraEnv) {
  if (isAbsolute(command))
    return existsSync(command) ? command : null;
  if (command.includes("/"))
    return existsSync(command) ? command : null;
  const env = { ...process.env, ...extraEnv };
  const PATH = env.PATH ?? "";
  for (const dir of PATH.split(delimiter)) {
    if (!dir)
      continue;
    const candidate = join2(dir, command);
    if (existsSync(candidate))
      return candidate;
  }
  return null;
}
function createAcpGateway(opts = {}) {
  const logger = opts.logger ?? createConsoleLogger();
  const agents = opts.agents ?? builtInAgents;
  const auth = resolveAuth(opts.auth);
  const perm = resolvePermission(opts.permission);
  const login = resolveLogin({
    timeoutMs: opts.login?.timeoutMs ?? opts.limits?.loginTimeoutMs
  });
  const limits = {
    maxConcurrentSessions: opts.limits?.maxConcurrentSessions ?? 64,
    sessionIdleTimeoutMs: opts.limits?.sessionIdleTimeoutMs ?? 1800000,
    spawnTimeoutMs: opts.limits?.spawnTimeoutMs ?? 15000,
    promptTimeoutMs: opts.limits?.promptTimeoutMs ?? 120000,
    loginTimeoutMs: login.timeoutMs
  };
  if (auth.config.mode === "none") {
    logger.warn("ACP gateway started with no auth. Anyone reachable on this port can drive coding agents on this host. Pass `auth: { mode: 'token' }` to enable token auth.");
  }
  if (auth.generatedToken) {
    logger.info("auth token generated (set `auth.token` to pin a value)", {
      token: auth.generatedToken
    });
  }
  if (perm.forward === false && !perm.policy) {
    logger.warn("permission.forward is false and no policy was supplied — all permission requests will be auto-denied");
  }
  const sessions = new Set;
  function emit(e) {
    try {
      opts.onEvent?.(e);
    } catch (err) {
      logger.error("onEvent handler threw", { err: errMsg2(err) });
    }
  }
  function handleConnection(socket, authCtx) {
    if (sessions.size >= limits.maxConcurrentSessions) {
      sendError(socket, true, {
        code: "session_limit_exceeded",
        message: `gateway is at capacity (${limits.maxConcurrentSessions})`
      });
      socket.close(CLOSE_CODES.SESSION_LIMIT, "session_limit");
      return;
    }
    const ctx = new SessionContext({
      socket,
      authCtx,
      auth,
      agents,
      defaultAgent: opts.defaultAgent,
      permission: perm,
      login,
      workspace: opts.workspace ?? {},
      limits,
      logger,
      emit,
      spawn: opts.spawn
    });
    sessions.add(ctx);
    ctx.start().catch((err) => {
      logger.error("session crashed during start", { err: errMsg2(err) });
    });
    ctx.onClosed(() => sessions.delete(ctx));
  }
  return {
    token: auth.generatedToken,
    agents,
    handleConnection,
    get activeSessions() {
      return sessions.size;
    },
    async close() {
      await Promise.all([...sessions].map((s) => s.shutdown("gateway_close")));
    }
  };
}

class SessionSlot {
  key;
  agentId;
  agent = null;
  agentSessionId = null;
  expectingExit = false;
  promptInFlight = false;
  respawnPromise = null;
  modelCatalog = null;
  closed = false;
  constructor(key, agentId) {
    this.key = key;
    this.agentId = agentId;
  }
}

class SessionContext {
  init;
  sessionId = randomUUID3();
  socket;
  logger;
  authCtx;
  closed = false;
  primaryKey = "primary";
  slots = new Map;
  pendingPermissions;
  pendingLogins;
  closeCallbacks = [];
  idleTimer = null;
  constructor(init) {
    this.init = init;
    this.socket = init.socket;
    this.logger = init.logger.child({ sessionId: this.sessionId });
    this.authCtx = init.authCtx ?? null;
    this.pendingPermissions = new PendingPermissions(this.logger);
    this.pendingLogins = new PendingLogins(this.logger, init.login);
  }
  onClosed(cb) {
    this.closeCallbacks.push(cb);
  }
  async start() {
    this.socket.onError((err) => this.logger.warn("socket error", { err: errMsg2(err) }));
    this.socket.onClose((code, reason) => {
      this.logger.info("socket closed", { code, reason });
      this.shutdown(reason || "socket_close");
    });
    this.socket.onMessage((data) => {
      this.bumpIdle();
      this.dispatchFrame(data).catch((err) => {
        this.logger.error("frame dispatch crashed", { err: errMsg2(err) });
        this.fatal({ code: "internal_error", message: errMsg2(err) });
      });
    });
    this.bumpIdle();
  }
  bumpIdle() {
    if (this.idleTimer)
      clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.logger.warn("session idle timeout");
      this.fatal({ code: "session_idle_timeout", message: "session idle" });
    }, this.init.limits.sessionIdleTimeoutMs);
    this.idleTimer.unref?.();
  }
  async dispatchFrame(raw) {
    let msg;
    try {
      msg = decode(raw);
    } catch (err) {
      this.sendNonFatal({
        code: "protocol_error",
        message: `decode failed: ${errMsg2(err)}`
      });
      return;
    }
    if (!this.isAuthed() && msg.kind !== "hello") {
      this.fatal({ code: "auth_required", message: "auth required before first frame" });
      return;
    }
    switch (msg.kind) {
      case "hello":
        return this.handleHello(msg);
      case "rpc":
        return this.handleRpc(msg.sessionKey, msg.payload);
      case "session-new":
        return this.handleNewSession(msg.payload);
      case "session-close":
        return this.handleCloseSession(msg.sessionKey, msg.reason);
      case "rpc-result":
      case "rpc-error": {
        const waiter = this.browserRpcWaiters.get(String(msg.payload.id));
        if (waiter) {
          this.browserRpcWaiters.delete(String(msg.payload.id));
          if (msg.kind === "rpc-result")
            waiter.resolve(msg.payload.result);
          else
            waiter.reject(msg.payload.error);
          return;
        }
        this.sendNonFatal({
          code: "protocol_error",
          message: `unmatched ${msg.kind} for id=${String(msg.payload.id)}`
        });
        return;
      }
      case "notify":
        this.sendNonFatal({
          code: "protocol_error",
          message: "unexpected notify frame from client"
        });
        return;
      case "switch-agent":
        return this.handleSwitchAgent(msg.sessionKey ?? this.primaryKey, msg.agentId);
      case "cancel":
        return this.handleCancel(msg.sessionKey ?? this.primaryKey);
      case "permission-response":
        this.pendingPermissions.resolve(msg.payload.id, msg.payload.decision);
        return;
      case "set-model":
        return this.handleSetModel(msg.sessionKey ?? this.primaryKey, msg.modelId, msg.requestId);
      case "login-start":
        return this.handleLoginStart(msg.agentId, msg.requestId);
      case "login-data":
        this.pendingLogins.write(msg.loginId, msg.data);
        return;
      case "login-resize":
        this.pendingLogins.resize(msg.loginId, msg.cols, msg.rows);
        return;
      case "login-cancel":
        this.pendingLogins.cancel(msg.loginId);
        return;
      case "set-model-result":
      case "model-update":
      case "login-ready":
      case "login-end":
      case "session-new-result":
        this.sendNonFatal({
          code: "protocol_error",
          message: `unexpected client-side kind: ${msg.kind}`
        });
        return;
      case "ping":
        this.send({ kind: "pong", ts: msg.ts });
        return;
      case "close":
        return this.shutdown(msg.reason || "client_close");
      default:
        this.sendNonFatal({
          code: "protocol_error",
          message: `unhandled wire kind: ${msg.kind}`
        });
    }
  }
  async handleHello(msg) {
    if (msg.protocolVersion !== PROTOCOL_VERSION) {
      this.fatal({
        code: "version_mismatch",
        message: `server speaks v${PROTOCOL_VERSION}, client sent v${msg.protocolVersion}`
      });
      return;
    }
    if (this.authCtx === null) {
      const mode = this.init.auth.config.mode;
      if (mode === "none") {
        this.authCtx = { authenticatedAt: Date.now() };
      } else if (mode === "upgrade") {
        this.fatal({ code: "auth_required", message: "upgrade-mode auth requires HTTP-layer credentials" });
        return;
      } else {
        const token = msg.clientInfo.meta?.token;
        if (!token || !this.init.auth.verifyToken) {
          this.init.emit({ type: "auth_failed", reason: "missing_token" });
          this.fatal({ code: "auth_required", message: "no token provided in clientInfo.meta.token" });
          return;
        }
        let ok;
        try {
          ok = await this.init.auth.verifyToken(token);
        } catch (err) {
          this.logger.error("token verifier threw", { err: errMsg2(err) });
          ok = false;
        }
        if (!ok) {
          this.init.emit({ type: "auth_failed", reason: "invalid_token" });
          this.fatal({ code: "auth_failed", message: "token rejected" });
          return;
        }
        this.authCtx = { authenticatedAt: Date.now() };
      }
    }
    const agentId = msg.agent ?? this.init.defaultAgent;
    if (!agentId) {
      this.fatal({
        code: "agent_not_registered",
        message: "no agent specified in hello and no defaultAgent on the gateway"
      });
      return;
    }
    const slot = this.openSlot(this.primaryKey, agentId);
    await this.startAgent(slot, { kind: "primary" });
  }
  openSlot(key, agentId) {
    const existing = this.slots.get(key);
    if (existing)
      return existing;
    const slot = new SessionSlot(key, agentId);
    this.slots.set(key, slot);
    return slot;
  }
  async startAgent(slot, role) {
    const reportFailure = (err) => {
      if (role.kind === "primary") {
        this.fatal(err);
      } else {
        this.send({
          kind: "session-new-result",
          payload: { sessionKey: slot.key, ok: false, error: err }
        });
        this.slots.delete(slot.key);
      }
    };
    const def = resolveAgent(this.init.agents, slot.agentId);
    if (!def) {
      reportFailure({
        code: "agent_not_registered",
        message: `unknown agent: ${String(slot.agentId)}`,
        hint: `register it with defineAgent({ id: '${String(slot.agentId)}', ... }) or pick one of: ${Object.keys(this.init.agents).join(", ")}`
      });
      return;
    }
    if (def.healthCheck) {
      try {
        const ok = await def.healthCheck(def);
        if (!ok) {
          reportFailure(installError(def));
          return;
        }
      } catch {
        reportFailure(installError(def));
        return;
      }
    }
    let spawnTimer = null;
    let spawnFailed = false;
    try {
      const spawnPromise = spawnAgent({
        definition: def,
        logger: this.logger,
        hooks: this.buildHooks(slot, def),
        spawn: this.init.spawn
      });
      const timeoutPromise = new Promise((_, reject) => {
        spawnTimer = setTimeout(() => {
          spawnFailed = true;
          reject(new Error("spawn timeout"));
        }, this.init.limits.spawnTimeoutMs);
      });
      slot.agent = await Promise.race([spawnPromise, timeoutPromise]);
    } catch (err) {
      const errCode = err.code;
      if (errCode === "ENOENT") {
        reportFailure(installError(def));
      } else if (spawnFailed) {
        reportFailure({
          code: "agent_spawn_timeout",
          message: `agent did not respond within ${this.init.limits.spawnTimeoutMs}ms`,
          context: { agentId: def.id }
        });
      } else {
        reportFailure({
          code: "agent_spawn_timeout",
          message: `failed to spawn ${def.command}: ${errMsg2(err)}`,
          context: { agentId: def.id, errCode }
        });
      }
      return;
    } finally {
      if (spawnTimer)
        clearTimeout(spawnTimer);
    }
    try {
      const initParams = {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: true
        }
      };
      const initResp = await slot.agent.connection.initialize(initParams);
      const newSessionParams = {
        cwd: def.cwd ?? process.cwd(),
        mcpServers: []
      };
      const newSession = await slot.agent.connection.newSession(newSessionParams);
      slot.agentSessionId = newSession.sessionId;
      slot.modelCatalog = extractModelCatalog(newSession);
      this.logger.debug("agent session ready", {
        sessionKey: slot.key,
        agentSessionId: slot.agentSessionId,
        modelChannel: slot.modelCatalog?.channel ?? "none",
        modelCount: slot.modelCatalog?.models.length ?? 0
      });
      if (role.kind === "primary") {
        const ready = {
          sessionId: this.sessionId,
          agentId: def.id,
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: initResp,
          availableAgents: Object.values(this.init.agents).map((a) => ({
            id: a.id,
            label: a.label,
            login: loginKindOf(a)
          })),
          modelCatalog: slot.modelCatalog,
          authMethods: extractAuthMethods(initResp)
        };
        this.send({ kind: "ready", payload: ready });
      } else {
        this.send({
          kind: "session-new-result",
          payload: {
            sessionKey: slot.key,
            ok: true,
            agentId: def.id,
            agentSessionId: slot.agentSessionId,
            agentCapabilities: initResp,
            modelCatalog: slot.modelCatalog,
            authMethods: extractAuthMethods(initResp)
          }
        });
      }
      this.init.emit({ type: "session_start", sessionId: this.sessionId, agentId: def.id });
    } catch (err) {
      reportFailure({
        code: "internal_error",
        message: `agent initialize/newSession failed: ${errMsg2(err)}`,
        context: { agentId: def.id }
      });
    }
  }
  async handleRpc(sessionKey, req) {
    if (req.direction !== "c2a") {
      this.sendNonFatal({ code: "protocol_error", message: "rpc direction must be c2a inbound" });
      return;
    }
    const key = sessionKey ?? this.primaryKey;
    const slot = this.slots.get(key);
    if (!slot) {
      this.send({
        kind: "rpc-error",
        sessionKey,
        payload: {
          id: req.id,
          error: { code: -32000, message: `unknown sessionKey: ${String(key)}` }
        }
      });
      return;
    }
    if (!slot.agent) {
      try {
        await this.ensureAgentReady(slot);
      } catch (err) {
        this.send({
          kind: "rpc-error",
          sessionKey,
          payload: { id: req.id, error: { code: -32000, message: `respawn failed: ${errMsg2(err)}` } }
        });
        return;
      }
    }
    if (!slot.agent) {
      this.send({
        kind: "rpc-error",
        sessionKey,
        payload: { id: req.id, error: { code: -32000, message: "session not ready" } }
      });
      return;
    }
    const isPrompt = req.method === "session/prompt";
    if (isPrompt)
      slot.promptInFlight = true;
    const timeoutMs = isPrompt ? this.init.limits.promptTimeoutMs : 0;
    let timeoutFired = false;
    let timeoutHandle = null;
    const timeoutPromise = timeoutMs > 0 ? new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => {
        timeoutFired = true;
        this.logger.warn("prompt timed out, cancelling", {
          method: req.method,
          id: req.id,
          timeoutMs,
          sessionKey: slot.key
        });
        this.handleCancel(slot.key);
        reject({
          code: -32001,
          message: `prompt timed out after ${timeoutMs}ms with no agent response. The agent may be rate-limited, misconfigured, or stuck; see the log drawer for its stderr.`
        });
      }, timeoutMs);
      timeoutHandle.unref?.();
    }) : null;
    try {
      const result = timeoutPromise ? await Promise.race([this.callAgentMethod(slot, req.method, req.params), timeoutPromise]) : await this.callAgentMethod(slot, req.method, req.params);
      this.send({ kind: "rpc-result", sessionKey, payload: { id: req.id, result } });
    } catch (err) {
      const rpcErr = err && typeof err === "object" && "code" in err && "message" in err ? err : { code: -32603, message: errMsg2(err) };
      this.send({ kind: "rpc-error", sessionKey, payload: { id: req.id, error: rpcErr } });
    } finally {
      if (timeoutHandle)
        clearTimeout(timeoutHandle);
      if (isPrompt)
        slot.promptInFlight = false;
    }
  }
  ensureAgentReady(slot) {
    if (slot.agent)
      return Promise.resolve();
    if (slot.respawnPromise)
      return slot.respawnPromise;
    if (slot.closed)
      return Promise.reject(new Error("slot closed"));
    slot.respawnPromise = (async () => {
      this.logger.info("respawning agent on demand", { agentId: slot.agentId, sessionKey: slot.key });
      await this.startAgent(slot, slot.key === this.primaryKey ? { kind: "primary" } : { kind: "secondary" });
    })().finally(() => {
      slot.respawnPromise = null;
    });
    return slot.respawnPromise;
  }
  async callAgentMethod(slot, method, params) {
    const agent = slot.agent.connection;
    const withSession = (p) => {
      if (!slot.agentSessionId)
        return p;
      const obj = p && typeof p === "object" ? p : {};
      return { ...obj, sessionId: slot.agentSessionId };
    };
    switch (method) {
      case "initialize":
        return agent.initialize(params);
      case "authenticate":
        return agent.authenticate(params);
      case "session/new":
        return agent.newSession(params);
      case "session/load":
        return agent.loadSession(withSession(params));
      case "session/prompt":
        return agent.prompt(withSession(params));
      case "session/set_mode":
        return agent.setSessionMode(withSession(params));
      case "session/set_model":
        return agent.setSessionModel(withSession(params));
      default:
        return agent.extMethod(method, params ?? {});
    }
  }
  async handleCancel(sessionKey) {
    const slot = this.slots.get(sessionKey);
    if (!slot || !slot.agent || !slot.agentSessionId)
      return;
    try {
      const params = { sessionId: slot.agentSessionId };
      await slot.agent.connection.cancel(params);
    } catch (err) {
      this.logger.warn("cancel failed", { err: errMsg2(err), sessionKey });
    }
  }
  async handleNewSession(payload) {
    const { sessionKey, agentId, label } = payload;
    if (!sessionKey || typeof sessionKey !== "string") {
      this.sendNonFatal({
        code: "protocol_error",
        message: "session-new requires a non-empty sessionKey"
      });
      return;
    }
    if (this.slots.has(sessionKey)) {
      this.send({
        kind: "session-new-result",
        payload: {
          sessionKey,
          ok: false,
          error: {
            code: "session_already_active",
            message: `sessionKey "${sessionKey}" is already open`
          }
        }
      });
      return;
    }
    if (this.slots.size >= this.init.limits.maxConcurrentSessions) {
      this.send({
        kind: "session-new-result",
        payload: {
          sessionKey,
          ok: false,
          error: {
            code: "session_limit_exceeded",
            message: `connection holds the per-connection slot limit (${this.init.limits.maxConcurrentSessions})`
          }
        }
      });
      return;
    }
    const slot = this.openSlot(sessionKey, agentId);
    await this.startAgent(slot, { kind: "secondary", label });
  }
  async handleCloseSession(sessionKey, reason) {
    const slot = this.slots.get(sessionKey);
    if (!slot)
      return;
    if (sessionKey === this.primaryKey) {
      this.sendNonFatal({
        code: "protocol_error",
        message: "the primary session slot is closed only by the connection itself"
      });
      return;
    }
    await this.killSlot(slot, reason ?? "client_close");
    this.slots.delete(sessionKey);
  }
  async killSlot(slot, reason) {
    slot.closed = true;
    if (slot.agent) {
      slot.expectingExit = true;
      try {
        await slot.agent.kill();
      } catch (err) {
        this.logger.warn("agent kill threw", { err: errMsg2(err), sessionKey: slot.key });
      } finally {
        slot.expectingExit = false;
      }
      slot.agent = null;
      slot.agentSessionId = null;
    }
    this.logger.info("slot closed", { sessionKey: slot.key, reason });
  }
  async handleSwitchAgent(sessionKey, agentId) {
    const slot = this.slots.get(sessionKey);
    if (!slot) {
      this.sendNonFatal({
        code: "protocol_error",
        message: `switch-agent for unknown sessionKey: ${String(sessionKey)}`
      });
      return;
    }
    this.logger.info("switching agent", {
      from: slot.agent?.definition.id,
      to: agentId,
      sessionKey
    });
    if (slot.agent) {
      slot.expectingExit = true;
      try {
        await slot.agent.kill();
      } finally {
        slot.expectingExit = false;
      }
      slot.agent = null;
      slot.agentSessionId = null;
    }
    slot.modelCatalog = null;
    slot.agentId = agentId;
    await this.startAgent(slot, sessionKey === this.primaryKey ? { kind: "primary" } : { kind: "secondary" });
  }
  async handleSetModel(sessionKey, modelId, requestId) {
    const stampedKey = sessionKey === this.primaryKey ? undefined : sessionKey;
    const slot = this.slots.get(sessionKey);
    if (!slot || !slot.agent || !slot.agentSessionId) {
      this.send({
        kind: "set-model-result",
        sessionKey: stampedKey,
        requestId,
        ok: false,
        error: { code: "session_not_ready", message: "no active agent session" }
      });
      return;
    }
    const catalog = slot.modelCatalog;
    if (!catalog || catalog.channel === "none") {
      this.send({
        kind: "set-model-result",
        sessionKey: stampedKey,
        requestId,
        ok: false,
        error: {
          code: "model_selection_unsupported",
          message: "the current agent does not expose model selection over ACP",
          hint: "pick the model via the agent's CLI flag at spawn time, or via an env var"
        }
      });
      return;
    }
    if (!catalog.models.some((m) => m.id === modelId)) {
      this.send({
        kind: "set-model-result",
        sessionKey: stampedKey,
        requestId,
        ok: false,
        error: {
          code: "unknown_model",
          message: `model "${modelId}" is not in the agent's advertised catalog`
        }
      });
      return;
    }
    try {
      if (catalog.channel === "set_model") {
        await slot.agent.sendRawRpc("session/set_model", {
          sessionId: slot.agentSessionId,
          modelId
        });
      } else {
        await slot.agent.sendRawRpc("session/set_config_option", {
          sessionId: slot.agentSessionId,
          configId: "model",
          value: modelId
        });
      }
      const updated = { ...catalog, currentModelId: modelId };
      slot.modelCatalog = updated;
      this.send({
        kind: "set-model-result",
        sessionKey: stampedKey,
        requestId,
        ok: true,
        modelCatalog: updated
      });
    } catch (err) {
      this.logger.warn("set-model rejected by agent", {
        modelId,
        channel: catalog.channel,
        err: errMsg2(err),
        sessionKey
      });
      this.send({
        kind: "set-model-result",
        sessionKey: stampedKey,
        requestId,
        ok: false,
        error: { code: "agent_rejected", message: errMsg2(err) }
      });
    }
  }
  async handleLoginStart(agentId, requestId) {
    const def = resolveAgent(this.init.agents, agentId);
    if (!def) {
      this.sendNonFatal({
        code: "agent_not_registered",
        message: `unknown agent for login: ${String(agentId)}`,
        context: { requestId }
      });
      return;
    }
    const spec = def.login;
    if (!spec || spec.kind !== "tty") {
      this.sendNonFatal({
        code: "not_implemented",
        message: spec?.kind === "acp_native" ? `agent "${String(agentId)}" uses native ACP auth — call the authenticate RPC instead` : `agent "${String(agentId)}" does not declare a TTY login flow`,
        context: { requestId, agentId: String(agentId) }
      });
      return;
    }
    const ref = { id: null };
    try {
      const loginId = await this.pendingLogins.start(def, spec, {
        onData: (data) => {
          if (ref.id)
            this.send({ kind: "login-data", loginId: ref.id, data });
        },
        onEnd: (exitCode, reason) => {
          if (ref.id)
            this.send({ kind: "login-end", loginId: ref.id, exitCode, reason });
        }
      });
      ref.id = loginId;
      this.send({ kind: "login-ready", requestId, loginId });
    } catch (err) {
      this.sendNonFatal({
        code: "not_implemented",
        message: errMsg2(err),
        context: { requestId, agentId: String(agentId) }
      });
    }
  }
  buildHooks(slot, def) {
    const stampedKey = slot.key === this.primaryKey ? undefined : slot.key;
    const forwardNotify = (method, params) => this.send({
      kind: "notify",
      sessionKey: stampedKey,
      payload: { direction: "a2c", method, params }
    });
    return {
      onSessionUpdate: (n) => forwardNotify("session/update", n),
      onRequestPermission: (req) => this.handlePermission(slot, req, def),
      onReadTextFile: async (req) => this.callBrowserRpc(slot, "fs/read_text_file", req),
      onWriteTextFile: async (req) => this.callBrowserRpc(slot, "fs/write_text_file", req),
      onCreateTerminal: async (req) => this.callBrowserRpc(slot, "terminal/create", req),
      onTerminalOutput: async (req) => this.callBrowserRpc(slot, "terminal/output", req),
      onWaitForTerminalExit: async (req) => this.callBrowserRpc(slot, "terminal/wait_for_exit", req),
      onKillTerminal: async (req) => this.callBrowserRpc(slot, "terminal/kill", req),
      onReleaseTerminal: async (req) => this.callBrowserRpc(slot, "terminal/release", req),
      onExit: ({ code, signal, stderrTail }) => {
        if (this.closed || slot.closed)
          return;
        if (slot.expectingExit) {
          this.logger.debug("agent exit expected (switch/shutdown), suppressing fatal", {
            code,
            signal,
            agentId: def.id,
            sessionKey: slot.key
          });
          return;
        }
        const isCrash = code !== 0;
        if (isCrash || slot.promptInFlight) {
          this.init.emit({
            type: "agent_crash",
            sessionId: this.sessionId,
            agentId: def.id,
            code,
            signal
          });
          const err = {
            code: isCrash ? "agent_crashed" : "agent_exited",
            message: isCrash ? `agent crashed (exit=${code} signal=${signal})` : `agent exited mid-prompt`,
            context: { stderrTail: stderrTail.slice(-2000), agentId: def.id, sessionKey: slot.key }
          };
          if (slot.key === this.primaryKey) {
            this.fatal(err);
          } else {
            this.send({ kind: "error", sessionKey: stampedKey, fatal: false, payload: err });
            slot.agent = null;
            slot.agentSessionId = null;
            slot.closed = true;
            this.slots.delete(slot.key);
            this.send({ kind: "session-close", sessionKey: slot.key, reason: err.code });
          }
          return;
        }
        this.logger.info("agent exited while idle, will respawn on next request", {
          code,
          agentId: def.id,
          sessionKey: slot.key
        });
        slot.agent = null;
        slot.agentSessionId = null;
      },
      onSpawnError: (err) => this.logger.error("spawn error", { err: err.message, agentId: def.id, sessionKey: slot.key }),
      onStderrLine: (line) => this.forwardStderr(def, line)
    };
  }
  forwardStderr(def, line) {
    const level = classifyStderrLevel(line);
    const trimmed = line.length > 1024 ? line.slice(0, 1024) + "…" : line;
    this.send({
      kind: "log",
      payload: {
        level,
        message: trimmed,
        ts: Date.now(),
        context: { source: "agent_stderr", agentId: String(def.id) }
      }
    });
    if (level === "warn")
      this.logger.warn("agent stderr", { agentId: def.id, line: trimmed });
    else if (level === "error")
      this.logger.error("agent stderr", { agentId: def.id, line: trimmed });
  }
  async handlePermission(slot, req, def) {
    const policy = this.init.permission.policy;
    if (policy) {
      const decision2 = await policy({
        request: req,
        sessionId: this.sessionId,
        agentId: String(def.id)
      });
      if (decision2 === "allow")
        return { outcome: { outcome: "selected", optionId: pickOptionId(req, "allow") } };
      if (decision2 === "deny")
        return { outcome: { outcome: "selected", optionId: pickOptionId(req, "reject") } };
    }
    if (!this.init.permission.forward) {
      this.logger.warn("permission auto-denied (forwarding disabled, no policy match)");
      return { outcome: { outcome: "selected", optionId: pickOptionId(req, "reject") } };
    }
    const stampedKey = slot.key === this.primaryKey ? undefined : slot.key;
    const { id, promise } = this.pendingPermissions.open(this.init.permission.timeoutMs);
    this.send({ kind: "permission-prompt", sessionKey: stampedKey, payload: { id, request: req } });
    const decision = await promise;
    const allow = decision === "allow_once" || decision === "allow_always";
    return {
      outcome: { outcome: "selected", optionId: pickOptionId(req, allow ? "allow" : "reject") }
    };
  }
  callBrowserRpc(slot, method, params) {
    const id = randomUUID3();
    const stampedKey = slot.key === this.primaryKey ? undefined : slot.key;
    return new Promise((resolve2, reject) => {
      this.browserRpcWaiters.set(id, { resolve: resolve2, reject });
      this.send({ kind: "rpc", sessionKey: stampedKey, payload: { direction: "a2c", id, method, params } });
    });
  }
  browserRpcWaiters = new Map;
  send(msg) {
    if (this.closed)
      return;
    try {
      this.socket.send(encode(msg));
    } catch (err) {
      this.logger.error("socket.send threw", { err: errMsg2(err) });
    }
  }
  sendNonFatal(err) {
    this.send({ kind: "error", fatal: false, payload: err });
  }
  fatal(err) {
    this.send({ kind: "error", fatal: true, payload: err });
    this.socket.close(closeCodeFor(err.code), err.code);
    this.shutdown(err.code);
  }
  isAuthed() {
    return this.authCtx !== null;
  }
  async shutdown(reason) {
    if (this.closed)
      return;
    this.closed = true;
    if (this.idleTimer)
      clearTimeout(this.idleTimer);
    this.pendingPermissions.rejectAll(`session_closed:${reason}`);
    this.pendingLogins.closeAll(`session_closed:${reason}`);
    await Promise.all([...this.slots.values()].map((s) => this.killSlot(s, reason)));
    this.slots.clear();
    this.init.emit({ type: "session_end", sessionId: this.sessionId, reason });
    for (const cb of this.closeCallbacks)
      cb();
  }
}
function installError(def) {
  return {
    code: "agent_not_installed",
    message: `binary "${def.command}" not found on PATH`,
    hint: def.installHint,
    context: { agentId: def.id }
  };
}
function closeCodeFor(code) {
  switch (code) {
    case "auth_required":
      return CLOSE_CODES.AUTH_REQUIRED;
    case "auth_failed":
    case "auth_timeout":
      return CLOSE_CODES.AUTH_FAILED;
    case "version_mismatch":
      return CLOSE_CODES.VERSION_MISMATCH;
    case "rate_limited":
      return CLOSE_CODES.RATE_LIMITED;
    case "session_limit_exceeded":
      return CLOSE_CODES.SESSION_LIMIT;
    case "agent_crashed":
    case "agent_killed":
      return CLOSE_CODES.AGENT_CRASHED;
    default:
      return CLOSE_CODES.INTERNAL_ERROR;
  }
}
function pickOptionId(req, intent) {
  const options = req.options ?? [];
  for (const o of options) {
    if (intent === "allow" && o.kind?.startsWith("allow"))
      return o.optionId;
    if (intent === "reject" && o.kind?.startsWith("reject"))
      return o.optionId;
  }
  return options[0]?.optionId ?? "default";
}
function sendError(socket, fatal, payload) {
  try {
    socket.send(encode({ kind: "error", fatal, payload }));
  } catch {}
}
function extractModelCatalog(newSessionResponse) {
  const r = newSessionResponse;
  if (!r)
    return null;
  const std = r.models;
  if (std && Array.isArray(std.availableModels) && std.availableModels.length > 0) {
    const models = std.availableModels.map((m) => ({
      id: m.modelId,
      name: m.name,
      description: m.description ?? undefined
    }));
    return {
      channel: "set_model",
      models,
      currentModelId: std.currentModelId ?? null
    };
  }
  const cfg = Array.isArray(r.configOptions) ? r.configOptions.find((c) => c.id === "model" && Array.isArray(c.options)) : null;
  if (cfg && cfg.options && cfg.options.length > 0) {
    const models = cfg.options.map((o) => ({ id: o.value, name: o.name }));
    return {
      channel: "set_config_option",
      models,
      currentModelId: cfg.currentValue ?? null
    };
  }
  return null;
}
function extractAuthMethods(initResp) {
  const r = initResp;
  const methods = r?.authMethods;
  return Array.isArray(methods) && methods.length > 0 ? methods : undefined;
}
function classifyStderrLevel(line) {
  const clean = line.replace(/\[[0-9;]*m/g, "");
  if (/\b(ERROR|FATAL|PANIC|EXCEPTION)\b/.test(clean))
    return "error";
  if (/\b(WARN|WARNING)\b/.test(clean))
    return "warn";
  return "info";
}
function errMsg2(err) {
  if (err instanceof Error)
    return err.message;
  if (err && typeof err === "object") {
    const e = err;
    if (typeof e.message === "string") {
      const code = typeof e.code === "number" || typeof e.code === "string" ? ` (${e.code})` : "";
      return `${e.message}${code}`;
    }
    try {
      return JSON.stringify(err);
    } catch {}
  }
  return String(err);
}

// ../../packages/acp-server/dist/index.js
function createInProcessAcpChannel() {
  const gatewayMessageHandlers = [];
  const gatewayCloseHandlers = [];
  const gatewayErrorHandlers = [];
  const clientMessageHandlers = [];
  const clientCloseHandlers = [];
  const clientErrorHandlers = [];
  const clientOpenHandlers = [];
  let closed = false;
  function safe(handlers, value) {
    for (const cb of handlers) {
      try {
        cb(value);
      } catch {}
    }
  }
  function notifyClose(code, reason) {
    if (closed)
      return;
    closed = true;
    for (const cb of gatewayCloseHandlers) {
      try {
        cb(code, reason);
      } catch {}
    }
    safe(clientCloseHandlers, { code, reason });
  }
  const gateway = {
    send(data) {
      if (closed)
        return;
      for (const cb of clientMessageHandlers) {
        try {
          cb(data);
        } catch (err) {
          safe(clientErrorHandlers, err instanceof Error ? err : new Error(String(err)));
        }
      }
    },
    close(code, reason) {
      notifyClose(code, reason);
    },
    onMessage(cb) {
      gatewayMessageHandlers.push(cb);
    },
    onClose(cb) {
      gatewayCloseHandlers.push(cb);
    },
    onError(cb) {
      gatewayErrorHandlers.push(cb);
    }
  };
  const client = {
    send(frame) {
      if (closed)
        return;
      for (const cb of gatewayMessageHandlers) {
        try {
          cb(frame);
        } catch (err) {
          safe(gatewayErrorHandlers, err instanceof Error ? err : new Error(String(err)));
        }
      }
    },
    close(code = 1000, reason = "client closed") {
      notifyClose(code, reason);
    },
    onMessage(cb) {
      clientMessageHandlers.push(cb);
    },
    onClose(cb) {
      clientCloseHandlers.push(cb);
    },
    onError(cb) {
      clientErrorHandlers.push(cb);
    },
    onOpen(cb) {
      clientOpenHandlers.push(cb);
    },
    async open() {
      safe(clientOpenHandlers, { reconnect: false });
    },
    capabilities: { multiplex: false, reconnectable: false }
  };
  return { gateway, client };
}

// ../../packages/acp-p2p/dist/host.js
function createRoomSocket(room) {
  const [sendFrame, onFrame] = room.makeAction(ACP_ROOM_ACTION);
  const messageHandlers = [];
  const closeHandlers = [];
  const errorHandlers = [];
  let lastReady = null;
  function deliverInbound(data) {
    for (const cb of messageHandlers) {
      try {
        cb(data);
      } catch (err) {
        for (const ecb of errorHandlers)
          ecb(err);
      }
    }
  }
  onFrame((data) => {
    if (typeof data !== "string")
      return;
    deliverInbound(data);
  });
  room.onPeerJoin((peerId) => {
    if (lastReady) {
      sendFrame(lastReady, peerId);
    }
  });
  return {
    send(data) {
      if (data.includes('"kind":"ready"'))
        lastReady = data;
      sendFrame(data);
    },
    close(code, reason) {
      room.leave();
      for (const cb of closeHandlers) {
        try {
          cb(code, reason);
        } catch {}
      }
    },
    onMessage(cb) {
      messageHandlers.push(cb);
    },
    onClose(cb) {
      closeHandlers.push(cb);
    },
    onError(cb) {
      errorHandlers.push(cb);
    },
    injectInbound: deliverInbound,
    raw: room
  };
}
async function createAcpP2PHost(opts) {
  const room = opts.joinRoom({
    appId: opts.appId,
    password: opts.password,
    rtcPolyfill: opts.rtcPolyfill,
    rtcConfig: opts.rtcConfig,
    turnConfig: opts.turnConfig
  }, opts.roomId);
  const socket = createRoomSocket(room);
  const gateway = createAcpGateway(opts.gateway);
  const mode = opts.gateway?.auth?.mode ?? "none";
  const authCtx = opts.authCtx ?? (mode === "none" ? { authenticatedAt: Date.now() } : undefined);
  gateway.handleConnection(socket, authCtx);
  let peerCount = 0;
  room.onPeerJoin(() => {
    peerCount++;
  });
  room.onPeerLeave(() => {
    peerCount = Math.max(0, peerCount - 1);
  });
  let closed = false;
  return {
    room,
    get hasPeers() {
      return peerCount > 0;
    },
    async close() {
      if (closed)
        return;
      closed = true;
      try {
        await gateway.close();
      } finally {
        await room.leave();
      }
    }
  };
}

// ../../packages/host-orchestrator/dist/index.js
var __require3 = /* @__PURE__ */ createRequire2(import.meta.url);
var DEFAULT_STRATEGY = { strategy: "nostr" };

class HostOrchestrator extends EventEmitter2 {
  opts;
  sandboxes = new Map;
  sessions = new Map;
  shares = new Map;
  closed = false;
  constructor(opts = {}) {
    super();
    this.opts = opts;
  }
  on(event, listener) {
    return super.on(event, listener);
  }
  emit(event, ...args) {
    return super.emit(event, ...args);
  }
  async createSandbox(imageTag, opts = {}) {
    this.assertOpen();
    const id = `sb_${randomUUID6().slice(0, 8)}`;
    const image = await resolveImage(imageTag);
    const sandbox = await new ImageRef(image).run({
      name: id,
      memory: opts.memory ?? 1024,
      cpus: opts.cpus
    });
    const record = {
      id,
      imageTag,
      sandbox,
      image,
      createdAt: Date.now()
    };
    this.sandboxes.set(id, record);
    this.emit("sandbox:created", record);
    return id;
  }
  async startTerminal(sandboxId) {
    this.assertOpen();
    const sb = await this.getOrAdoptSandbox(sandboxId);
    const id = `tm_${randomUUID6().slice(0, 8)}`;
    const env = {
      PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      HOME: defaultHomeFor(sb.image.user),
      TERM: "xterm-256color",
      ...sb.image.env
    };
    const pty = new SharedPtySession(defaultPtyOptions({
      shell: "/bin/sh",
      args: [],
      cwd: sb.image.workdir ?? "/",
      env,
      spawn: createPtySpawn(sb.sandbox)
    }));
    const record = {
      id,
      kind: "terminal",
      sandboxId,
      pty,
      createdAt: Date.now()
    };
    this.sessions.set(id, record);
    this.emit("session:created", record);
    return id;
  }
  async startAgent(sandboxId, agentId, opts = {}) {
    this.assertOpen();
    await this.getOrAdoptSandbox(sandboxId);
    const registry = opts.agents ?? this.opts.agents ?? defaultAgents();
    const def = opts.agent ?? registry[agentId];
    if (!def) {
      throw new Error(`unknown agent: ${agentId} (known: ${Object.keys(registry).join(", ")})`);
    }
    const id = `ag_${randomUUID6().slice(0, 8)}`;
    const record = {
      id,
      kind: "agent",
      sandboxId,
      agentDef: def,
      agents: registry,
      execIn: opts.execIn ?? "sandbox",
      createdAt: Date.now()
    };
    this.sessions.set(id, record);
    this.emit("session:created", record);
    return id;
  }
  connectAgentLocal(sessionId) {
    this.assertOpen();
    const session = this.sessions.get(sessionId);
    if (!session)
      throw new Error(`unknown session: ${sessionId}`);
    if (session.kind !== "agent") {
      throw new Error(`session ${sessionId} is ${session.kind}, not agent`);
    }
    const sandbox = this.requireSandbox(session.sandboxId).sandbox;
    const gatewayOpts = this.buildAgentGatewayOpts(session, sandbox);
    const gateway = createAcpGateway(gatewayOpts);
    const channel = createInProcessAcpChannel();
    gateway.handleConnection(channel.gateway);
    return channel.client;
  }
  buildAgentGatewayOpts(session, sandbox) {
    const execInSandbox = session.execIn !== "host";
    const image = this.requireSandbox(session.sandboxId).image;
    const sandboxEnvDefaults = execInSandbox ? {
      HOME: defaultHomeFor(image.user),
      PATH: [
        "/root/.bun/install/global/bin",
        image.user ? `/home/${image.user.split(":")[0]}/.bun/install/global/bin` : null,
        "/usr/local/sbin",
        "/usr/local/bin",
        "/usr/sbin",
        "/usr/bin",
        "/sbin",
        "/bin"
      ].filter((p) => Boolean(p)).join(":"),
      ...image.env
    } : undefined;
    const sandboxSafeAgents = execInSandbox ? Object.fromEntries(Object.entries(session.agents ?? defaultAgents()).map(([id, def]) => [
      id,
      {
        ...def,
        healthCheck: () => true,
        env: { ...sandboxEnvDefaults, ...def.env }
      }
    ])) : session.agents ?? defaultAgents();
    return {
      agents: sandboxSafeAgents,
      defaultAgent: session.agentDef.id,
      auth: { mode: "none" },
      spawn: execInSandbox ? createChildProcessSpawn(sandbox) : undefined
    };
  }
  async share(sessionId, opts = {}) {
    this.assertOpen();
    const session = this.sessions.get(sessionId);
    if (!session)
      throw new Error(`unknown session: ${sessionId}`);
    if (this.shares.has(sessionId))
      return this.shares.get(sessionId).descriptor;
    if (session.kind === "terminal") {
      return this.shareTerminal(session, opts);
    }
    return this.shareAgent(session, opts);
  }
  async shareTerminal(session, opts) {
    const strategy = opts.strategy ?? this.opts.defaultStrategy ?? DEFAULT_STRATEGY;
    const roomId = randomUUID6();
    const token = generateToken();
    const verifier = makeVerifier({ token }, token);
    const rtcPolyfill = opts.rtcPolyfill ?? this.opts.rtcPolyfill;
    const transport = await startP2PTransport({
      strategy,
      roomId,
      maxPeers: 8,
      verifier,
      session: session.pty,
      rtcPolyfill,
      onPeer: (peerId) => this.recordPeerJoin(session.id, peerId)
    });
    const descriptor = {
      sessionId: session.id,
      kind: "terminal",
      roomId,
      token,
      hostPeerId: transport.hostPeerId,
      password: opts.password,
      relayUrls: opts.relayUrls,
      strategy: strategy.strategy,
      peers: []
    };
    this.shares.set(session.id, { kind: "terminal", descriptor, transport });
    this.emit("share:state-changed", { ...descriptor });
    return descriptor;
  }
  async shareAgent(session, opts) {
    const strategy = opts.strategy ?? this.opts.defaultStrategy ?? DEFAULT_STRATEGY;
    const roomId = randomUUID6();
    const token = generateToken();
    const rtcPolyfill = opts.rtcPolyfill ?? this.opts.rtcPolyfill;
    const sandbox = this.requireSandbox(session.sandboxId).sandbox;
    const joinRoom = opts.joinRoom ?? await resolveJoinRoom(strategy);
    const gatewayOpts = this.buildAgentGatewayOpts(session, sandbox);
    const host = await createAcpP2PHost({
      joinRoom,
      appId: "beamhop",
      roomId,
      password: opts.password,
      rtcPolyfill,
      gateway: gatewayOpts
    });
    host.room.onPeerJoin((peerId) => this.recordPeerJoin(session.id, peerId));
    host.room.onPeerLeave((peerId) => this.recordPeerLeave(session.id, peerId));
    const descriptor = {
      sessionId: session.id,
      kind: "agent",
      roomId,
      token,
      hostPeerId: "",
      password: opts.password,
      relayUrls: opts.relayUrls,
      strategy: strategy.strategy,
      peers: []
    };
    this.shares.set(session.id, { kind: "agent", descriptor, host });
    this.emit("share:state-changed", { ...descriptor });
    return descriptor;
  }
  recordPeerJoin(sessionId, peerId) {
    const entry = this.shares.get(sessionId);
    if (!entry)
      return;
    if (!entry.descriptor.peers.includes(peerId)) {
      entry.descriptor.peers.push(peerId);
      this.emit("peer:joined", { sessionId, peerId });
      this.emit("share:state-changed", { ...entry.descriptor });
    }
  }
  recordPeerLeave(sessionId, peerId) {
    const entry = this.shares.get(sessionId);
    if (!entry)
      return;
    const idx = entry.descriptor.peers.indexOf(peerId);
    if (idx >= 0) {
      entry.descriptor.peers.splice(idx, 1);
      this.emit("peer:left", { sessionId, peerId });
      this.emit("share:state-changed", { ...entry.descriptor });
    }
  }
  async unshare(sessionId) {
    const entry = this.shares.get(sessionId);
    if (!entry)
      return;
    this.shares.delete(sessionId);
    if (entry.kind === "terminal") {
      await entry.transport.close();
    } else {
      await entry.host.close();
    }
    this.emit("share:state-changed", { sessionId, shared: false });
  }
  async closeSession(sessionId) {
    await this.unshare(sessionId).catch(() => {});
    const session = this.sessions.get(sessionId);
    if (!session)
      return;
    this.sessions.delete(sessionId);
    if (session.kind === "terminal") {
      session.pty.kill();
    }
    this.emit("session:closed", sessionId);
  }
  async closeSandbox(sandboxId) {
    for (const session of [...this.sessions.values()]) {
      if (session.sandboxId === sandboxId) {
        await this.closeSession(session.id).catch(() => {});
      }
    }
    const record = this.sandboxes.get(sandboxId);
    if (!record)
      return;
    this.sandboxes.delete(sandboxId);
    await record.sandbox[Symbol.asyncDispose]?.().catch(() => {});
    this.emit("sandbox:closed", sandboxId);
  }
  listSandboxes() {
    return [...this.sandboxes.values()];
  }
  listSessions() {
    return [...this.sessions.values()];
  }
  getShare(sessionId) {
    return this.shares.get(sessionId)?.descriptor;
  }
  async close() {
    if (this.closed)
      return;
    this.closed = true;
    for (const sessionId of [...this.shares.keys()]) {
      await this.unshare(sessionId).catch(() => {});
    }
    for (const sessionId of [...this.sessions.keys()]) {
      await this.closeSession(sessionId).catch(() => {});
    }
    for (const sandboxId of [...this.sandboxes.keys()]) {
      await this.closeSandbox(sandboxId).catch(() => {});
    }
  }
  assertOpen() {
    if (this.closed)
      throw new Error("HostOrchestrator is closed");
  }
  requireSandbox(sandboxId) {
    const sb = this.sandboxes.get(sandboxId);
    if (!sb)
      throw new Error(`unknown sandbox: ${sandboxId}`);
    return sb;
  }
  async getOrAdoptSandbox(sandboxId) {
    const existing = this.sandboxes.get(sandboxId);
    if (existing)
      return existing;
    const handle = await Sandbox2.get(sandboxId).catch(() => null);
    if (!handle)
      throw new Error(`unknown sandbox: ${sandboxId}`);
    let sandbox;
    if (handle.status === "running") {
      sandbox = await handle.connect();
    } else if (handle.status === "stopped") {
      sandbox = await Sandbox2.startDetached(sandboxId);
    } else {
      throw new Error(`sandbox ${sandboxId} is ${handle.status}; cannot start a session`);
    }
    const image = synthesizeImageMetadata(sandboxId, handle.configJson);
    const record = {
      id: sandboxId,
      imageTag: image.baseImage,
      sandbox,
      image,
      createdAt: handle.createdAt ? handle.createdAt.getTime() : Date.now()
    };
    this.sandboxes.set(sandboxId, record);
    this.emit("sandbox:created", record);
    return record;
  }
}
function synthesizeImageMetadata(sandboxId, configJson) {
  let cfg = {};
  try {
    cfg = JSON.parse(configJson);
  } catch {}
  let baseImage = "unknown";
  const img = cfg.image;
  if (typeof img === "string")
    baseImage = img;
  else if (img && typeof img === "object") {
    for (const v of Object.values(img)) {
      if (typeof v === "string") {
        baseImage = v;
        break;
      }
    }
  }
  const env = {};
  for (const pair of cfg.env ?? []) {
    if (Array.isArray(pair) && pair.length === 2)
      env[pair[0]] = pair[1];
  }
  return {
    snapshotName: sandboxId,
    digest: "",
    baseImage,
    env,
    workdir: cfg.workdir ?? null,
    user: cfg.user ?? null,
    entrypoint: cfg.entrypoint ?? null,
    cmd: cfg.cmd ?? null,
    createdAt: new Date().toISOString()
  };
}
function defaultHomeFor(user) {
  if (!user || user === "root" || user === "0")
    return "/root";
  const name = user.split(":")[0] ?? user;
  return `/home/${name}`;
}
var cachedDefaultAgents = null;
function defaultAgents() {
  if (cachedDefaultAgents)
    return cachedDefaultAgents;
  const mod = __require3("@beamhop/acp-server");
  cachedDefaultAgents = mod.builtInAgents;
  return cachedDefaultAgents;
}
async function resolveJoinRoom(strategy) {
  const importStrategy2 = async (pkg) => {
    try {
      const m = await import(pkg);
      return m.joinRoom;
    } catch {
      throw new Error(`trystero strategy '${pkg}' is not installed — add it to your host package.json`);
    }
  };
  switch (strategy.strategy) {
    case "nostr":
      return importStrategy2("@trystero-p2p/nostr");
    case "ws-relay":
      return importStrategy2("@trystero-p2p/ws-relay");
    case "mqtt":
      return importStrategy2("@trystero-p2p/mqtt");
    case "torrent":
      return importStrategy2("@trystero-p2p/torrent");
    case "supabase":
      return importStrategy2("@trystero-p2p/supabase");
    case "firebase":
      return importStrategy2("@trystero-p2p/firebase");
    case "ipfs":
      return importStrategy2("@trystero-p2p/ipfs");
    case "custom":
      return strategy.joinRoom;
    default: {
      const exhaustive = strategy;
      throw new Error(`unknown strategy: ${JSON.stringify(exhaustive)}`);
    }
  }
}

// sidecar/index.ts
import { Sandbox as Sandbox3 } from "microsandbox";
import {
  joinRoom as joinNostrRoom
} from "@trystero-p2p/nostr";

// sidecar/protocol.ts
function projectSandbox(r) {
  return {
    id: r.id,
    imageTag: r.imageTag,
    status: "running",
    createdAt: r.createdAt,
    external: false
  };
}
function projectSession(r) {
  return {
    id: r.id,
    kind: r.kind,
    sandboxId: r.sandboxId,
    agentId: r.kind === "agent" ? r.agentDef.id : undefined,
    createdAt: r.createdAt
  };
}

// sidecar/index.ts
var log2 = (...args) => console.error("[sidecar]", ...args);
var SENTINEL_DIR = path2.join(os3.homedir(), ".beamhop", "desktop", "owned");
var SENTINEL_PATH = path2.join(SENTINEL_DIR, `${process.pid}.json`);
var ownedSandboxes = new Set;
var sentinelWriteQueue = Promise.resolve();
function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
async function writeSentinel() {
  sentinelWriteQueue = sentinelWriteQueue.then(async () => {
    await fs2.mkdir(SENTINEL_DIR, { recursive: true });
    await fs2.writeFile(SENTINEL_PATH, JSON.stringify({ pid: process.pid, sandboxes: [...ownedSandboxes], updatedAt: Date.now() }, null, 2), "utf8");
  });
  return sentinelWriteQueue;
}
async function reapOrphans() {
  await fs2.mkdir(SENTINEL_DIR, { recursive: true });
  let entries = [];
  try {
    entries = await fs2.readdir(SENTINEL_DIR);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!name.endsWith(".json"))
      continue;
    const pidStr = name.slice(0, -5);
    const pid = Number(pidStr);
    if (!Number.isFinite(pid) || pid === process.pid)
      continue;
    if (isPidAlive(pid))
      continue;
    const filePath = path2.join(SENTINEL_DIR, name);
    let raw = "";
    try {
      raw = await fs2.readFile(filePath, "utf8");
    } catch {
      continue;
    }
    let parsed = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      await fs2.unlink(filePath).catch(() => {});
      continue;
    }
    const names = parsed.sandboxes ?? [];
    if (names.length === 0) {
      await fs2.unlink(filePath).catch(() => {});
      continue;
    }
    log2(`reaping ${names.length} orphan sandbox(es) from dead pid ${pid}`);
    for (const sbName of names) {
      try {
        await Sandbox3.remove(sbName);
      } catch (err) {
        log2(`  failed to remove ${sbName}:`, errMsg3(err));
      }
    }
    await fs2.unlink(filePath).catch(() => {});
  }
}
var clients = new Set;
function send(ws, msg) {
  if (ws.readyState !== ws.OPEN)
    return;
  try {
    ws.send(JSON.stringify(msg));
  } catch (err) {
    log2("ws send failed:", errMsg3(err));
  }
}
function broadcast(msg) {
  for (const c of clients)
    send(c.ws, msg);
}
var BUILD_STDIO_CAP = 4000;
var BUILD_COMPLETED_TTL_MS = 30 * 60 * 1000;
var BUILD_RECENT_LIMIT = 20;
var builds = new Map;
function toBuildView(r) {
  return {
    buildId: r.buildId,
    tag: r.tag,
    dockerfile: r.dockerfile,
    memory: r.memory,
    autoBoot: r.autoBoot,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    status: r.status,
    snapshotName: r.snapshotName,
    sandboxId: r.sandboxId,
    error: r.error
  };
}
function toBuildDetail(r) {
  return { ...toBuildView(r), events: r.events.slice(), truncated: r.truncated };
}
function isStdioEvent(ev) {
  return ev.kind === "step:stdout" || ev.kind === "step:stderr";
}
function appendBuildEvent(r, ev) {
  if (isStdioEvent(ev)) {
    if (r.stdioCount >= BUILD_STDIO_CAP) {
      for (let i = 0;i < r.events.length; i++) {
        if (isStdioEvent(r.events[i])) {
          r.events.splice(i, 1);
          r.stdioCount--;
          r.truncated = true;
          break;
        }
      }
    }
    r.stdioCount++;
  }
  r.events.push(ev);
}
function publishBuildState(r) {
  broadcast({ event: "build:state", data: toBuildView(r) });
}
function scheduleBuildGc(r) {
  if (r.gcTimer)
    clearTimeout(r.gcTimer);
  r.gcTimer = setTimeout(() => {
    const completed = [...builds.values()].filter((b) => b.status !== "running").sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
    const keep = new Set(completed.slice(0, BUILD_RECENT_LIMIT).map((b) => b.buildId));
    if (!keep.has(r.buildId))
      builds.delete(r.buildId);
  }, BUILD_COMPLETED_TTL_MS);
  if (typeof r.gcTimer === "object" && r.gcTimer && "unref" in r.gcTimer) {
    r.gcTimer.unref();
  }
}
async function startBuild(params) {
  const buildId = randomUUID7();
  const record = {
    buildId,
    tag: params.tag,
    dockerfile: params.dockerfile,
    memory: params.memory,
    autoBoot: params.autoBoot,
    startedAt: Date.now(),
    status: "running",
    events: [],
    stdioCount: 0,
    truncated: false,
    abort: new AbortController
  };
  builds.set(buildId, record);
  publishBuildState(record);
  runBuild(record).catch((err) => {
    log2("internal build error:", errMsg3(err));
  });
  return { buildId };
}
async function runBuild(record) {
  const ctx = await mkdtemp(path2.join(os3.tmpdir(), "beamhop-build-"));
  const dockerfilePath = path2.join(ctx, "Dockerfile");
  await writeFile(dockerfilePath, record.dockerfile, "utf8");
  const onEvent = (event) => {
    appendBuildEvent(record, event);
    broadcast({
      event: "build:event",
      data: { buildId: record.buildId, event }
    });
  };
  try {
    const img = await SandboxImage.fromDockerfileString(record.dockerfile).build(record.tag, {
      contextDir: ctx,
      memory: record.memory,
      onEvent,
      signal: record.abort.signal
    });
    record.snapshotName = img.snapshotName;
    if (record.autoBoot && !record.abort.signal.aborted) {
      try {
        const id = await orch.createSandbox(img.snapshotName, {
          memory: record.memory
        });
        record.sandboxId = id;
      } catch (err) {
        record.status = "failed";
        record.error = `built ${img.snapshotName} but boot failed: ${errMsg3(err)}`;
        record.endedAt = Date.now();
        publishBuildState(record);
        scheduleBuildGc(record);
        return;
      }
    }
    record.status = "succeeded";
    record.endedAt = Date.now();
    publishBuildState(record);
    scheduleBuildGc(record);
  } catch (err) {
    if (err instanceof BuildCancelledError || record.abort.signal.aborted) {
      record.status = "cancelled";
      record.error = "cancelled";
    } else {
      record.status = "failed";
      record.error = errMsg3(err);
    }
    record.endedAt = Date.now();
    publishBuildState(record);
    scheduleBuildGc(record);
  } finally {
    await fs2.rm(ctx, { recursive: true, force: true }).catch(() => {});
  }
}
function cancelBuild(buildId) {
  const r = builds.get(buildId);
  if (!r)
    throw new Error(`unknown build: ${buildId}`);
  if (r.status !== "running")
    return;
  r.abort.abort();
}
var orch = new HostOrchestrator({ rtcPolyfill: RTCPeerConnection });
orch.on("sandbox:created", (r) => {
  ownedSandboxes.add(r.sandbox.name);
  writeSentinel();
  broadcast({ event: "sandbox:created", data: projectSandbox(r) });
});
orch.on("sandbox:closed", (id) => {
  ownedSandboxes.delete(id);
  writeSentinel();
  broadcast({ event: "sandbox:closed", data: { id } });
});
orch.on("session:created", (r) => broadcast({ event: "session:created", data: projectSession(r) }));
orch.on("session:closed", (id) => broadcast({ event: "session:closed", data: { id } }));
orch.on("share:state-changed", (d) => broadcast({ event: "share:state-changed", data: d }));
orch.on("peer:joined", (info) => broadcast({ event: "peer:joined", data: info }));
orch.on("peer:left", (info) => broadcast({ event: "peer:left", data: info }));
function listAgents() {
  return Object.values(builtInAgents).map((a) => ({
    id: a.id,
    label: a.label,
    command: a.command
  }));
}
function parseImage(configJson) {
  try {
    const cfg = JSON.parse(configJson);
    const img = cfg.image;
    if (typeof img === "string")
      return img;
    if (img && typeof img === "object") {
      for (const v of Object.values(img)) {
        if (typeof v === "string")
          return v;
      }
    }
  } catch {}
  return null;
}
async function listAllSandboxes() {
  const handles = await Sandbox3.list();
  const tracked = new Map;
  for (const r of orch.listSandboxes())
    tracked.set(r.id, r);
  const views = handles.map((h) => {
    const t = tracked.get(h.name);
    return {
      id: h.name,
      imageTag: t?.imageTag ?? parseImage(h.configJson) ?? "unknown",
      status: h.status,
      createdAt: h.createdAt ? h.createdAt.getTime() : Date.now(),
      external: t === undefined
    };
  });
  views.sort((a, b) => b.createdAt - a.createdAt);
  return views;
}
async function removeWithRetry(handle, name) {
  if (!handle)
    return;
  const attempts = 10;
  const backoffMs = 150;
  let lastErr;
  for (let i = 0;i < attempts; i++) {
    try {
      await handle.remove();
      return;
    } catch (err) {
      lastErr = err;
      const msg = errMsg3(err).toLowerCase();
      if (!msg.includes("still running") && !msg.includes("running")) {
        throw err;
      }
      try {
        await handle.kill();
      } catch {}
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  log2(`removeWithRetry: gave up on ${name} after ${attempts} attempts`);
  throw lastErr ?? new Error(`failed to remove sandbox ${name}`);
}
async function removeSandboxByName(name, force) {
  const tracked = orch.listSandboxes().some((r) => r.id === name);
  if (tracked) {
    await orch.closeSandbox(name);
  }
  const handle = await Sandbox3.get(name).catch(() => null);
  if (handle) {
    const isAlive = () => handle.status === "running" || handle.status === "draining";
    if (isAlive() && !force) {
      throw new Error("sandbox is running; force required");
    }
    if (isAlive()) {
      try {
        await handle.stop();
      } catch {}
    }
    if (isAlive()) {
      try {
        await handle.kill();
      } catch {}
    }
    await removeWithRetry(handle, name);
  }
  if (!tracked) {
    broadcast({ event: "sandbox:closed", data: { id: name } });
  }
}
async function handleRequest(client, req) {
  try {
    const result = await dispatch(client, req);
    return { id: req.id, result };
  } catch (err) {
    return {
      id: req.id,
      error: { code: -32000, message: errMsg3(err) }
    };
  }
}
async function dispatch(client, req) {
  switch (req.method) {
    case "sandboxes.list": {
      return await listAllSandboxes();
    }
    case "sandboxes.create": {
      const id = await orch.createSandbox(req.params.imageTag, {
        memory: req.params.memory
      });
      return { id };
    }
    case "sandboxes.remove": {
      await removeSandboxByName(req.params.id, true);
      return null;
    }
    case "sandboxes.removeMany": {
      const force = Boolean(req.params.force);
      const results = [];
      for (const id of req.params.ids) {
        try {
          await removeSandboxByName(id, force);
          results.push({ id, ok: true });
        } catch (err) {
          results.push({ id, ok: false, error: errMsg3(err) });
        }
      }
      return { results };
    }
    case "sandboxes.buildImage": {
      return await buildImage(req.params.tag, req.params.dockerfile, req.params.memory);
    }
    case "builds.start": {
      return await startBuild({
        tag: req.params.tag,
        dockerfile: req.params.dockerfile,
        memory: req.params.memory,
        autoBoot: req.params.autoBoot ?? true
      });
    }
    case "builds.list": {
      return [...builds.values()].sort((a, b) => b.startedAt - a.startedAt).map(toBuildView);
    }
    case "builds.get": {
      const r = builds.get(req.params.buildId);
      if (!r)
        throw new Error(`unknown build: ${req.params.buildId}`);
      return toBuildDetail(r);
    }
    case "builds.cancel": {
      cancelBuild(req.params.buildId);
      return null;
    }
    case "sandboxes.listImages": {
      const metas = await listImages();
      return metas.map((m) => ({
        tag: m.tag ?? m.snapshotName.replace(/-[a-f0-9]{12}$/, ""),
        snapshotName: m.snapshotName,
        baseImage: m.baseImage,
        createdAt: m.createdAt
      }));
    }
    case "sandboxes.removeImages": {
      const errors2 = [];
      for (const name of req.params.snapshotNames) {
        try {
          await removeImage(name);
        } catch (err) {
          errors2.push({ snapshotName: name, message: errMsg3(err) });
        }
      }
      return { removed: req.params.snapshotNames.length - errors2.length, errors: errors2 };
    }
    case "sessions.list": {
      return orch.listSessions().map(projectSession);
    }
    case "sessions.startTerminal": {
      const id = await orch.startTerminal(req.params.sandboxId);
      return { id };
    }
    case "sessions.startAgent": {
      const id = await orch.startAgent(req.params.sandboxId, req.params.agentId);
      return { id };
    }
    case "sessions.close": {
      await orch.closeSession(req.params.id);
      return null;
    }
    case "shares.toggle": {
      if (req.params.on) {
        const descriptor = await orch.share(req.params.sessionId, {
          strategy: { strategy: "nostr" },
          joinRoom: joinNostrRoom
        });
        return descriptor;
      }
      await orch.unshare(req.params.sessionId);
      return null;
    }
    case "shares.list": {
      const out = [];
      for (const session of orch.listSessions()) {
        const d = orch.getShare(session.id);
        if (d)
          out.push(d);
      }
      return out;
    }
    case "agents.list": {
      return listAgents();
    }
    case "terminal.write": {
      const session = findSession(req.params.sessionId, "terminal");
      session.pty.write(req.params.data);
      return null;
    }
    case "terminal.resize": {
      const session = findSession(req.params.sessionId, "terminal");
      session.pty.resize("desktop", req.params.cols, req.params.rows);
      return null;
    }
    case "acp.open": {
      const connectionId = randomUUID7();
      const transport = orch.connectAgentLocal(req.params.sessionId);
      transport.onMessage((frame) => {
        send(client.ws, {
          event: "acp:frame",
          data: { connectionId, frame }
        });
      });
      transport.onClose(({ code, reason }) => {
        send(client.ws, {
          event: "acp:closed",
          data: { connectionId, code, reason }
        });
        client.acpConns.delete(connectionId);
      });
      await transport.open();
      client.acpConns.set(connectionId, transport);
      return { connectionId };
    }
    case "acp.send": {
      const transport = client.acpConns.get(req.params.connectionId);
      if (!transport)
        throw new Error(`unknown acp connection: ${req.params.connectionId}`);
      transport.send(req.params.frame);
      return null;
    }
    case "acp.close": {
      const transport = client.acpConns.get(req.params.connectionId);
      if (!transport)
        return null;
      transport.close(1000, "client closed");
      client.acpConns.delete(req.params.connectionId);
      return null;
    }
    case "subscribe.terminal": {
      const subId = randomUUID7();
      const session = findSession(req.params.sessionId, "terminal");
      const cols = req.params.cols && req.params.cols > 0 ? req.params.cols : 120;
      const rows = req.params.rows && req.params.rows > 0 ? req.params.rows : 32;
      const detach = session.pty.attach(`desktop-${subId}`, cols, rows, (chunk) => {
        send(client.ws, {
          event: "terminal:data",
          data: {
            subId,
            sessionId: req.params.sessionId,
            bytes: bufferToBase64(chunk)
          }
        });
      });
      client.subs.set(subId, detach);
      return { subId };
    }
    case "unsubscribe": {
      const off = client.subs.get(req.params.subId);
      if (off) {
        off();
        client.subs.delete(req.params.subId);
      }
      return null;
    }
    default: {
      const exhaustive = req;
      throw new Error(`unknown method: ${JSON.stringify(exhaustive)}`);
    }
  }
}
function findSession(id, kind) {
  const s = orch.listSessions().find((s2) => s2.id === id);
  if (!s)
    throw new Error(`unknown session: ${id}`);
  if (s.kind !== kind)
    throw new Error(`session ${id} is ${s.kind}, not ${kind}`);
  return s;
}
async function buildImage(tag, dockerfile, memory) {
  const ctx = await mkdtemp(path2.join(os3.tmpdir(), "beamhop-build-"));
  const dockerfilePath = path2.join(ctx, "Dockerfile");
  await writeFile(dockerfilePath, dockerfile, "utf8");
  broadcast({
    event: "image:progress",
    data: { tag, step: "starting build" }
  });
  try {
    const img = await SandboxImage.fromDockerfileString(dockerfile).build(tag, {
      contextDir: ctx,
      memory
    });
    broadcast({
      event: "image:progress",
      data: { tag, done: true, step: `built ${img.snapshotName}` }
    });
    return { tag, snapshotName: img.snapshotName };
  } catch (err) {
    broadcast({
      event: "image:progress",
      data: { tag, done: true, error: errMsg3(err) }
    });
    throw err;
  } finally {
    await fs2.rm(ctx, { recursive: true, force: true }).catch(() => {});
  }
}
function bufferToBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
}
function errMsg3(err) {
  return err instanceof Error ? err.message : String(err);
}
function startServer() {
  return new Promise((resolve2) => {
    const portEnv = process.env.BEAMHOP_SIDECAR_PORT;
    const port = portEnv ? Number(portEnv) : 0;
    const wss = new WebSocketServer3({ host: "127.0.0.1", port });
    wss.on("listening", () => {
      const addr = wss.address();
      if (typeof addr !== "object" || addr === null) {
        throw new Error("ws server failed to bind");
      }
      resolve2({
        port: addr.port,
        close: () => wss.close()
      });
    });
    wss.on("connection", (ws) => {
      const client = {
        ws,
        subs: new Map,
        acpConns: new Map
      };
      clients.add(client);
      ws.on("message", (raw) => {
        let req;
        try {
          req = JSON.parse(raw.toString());
        } catch (err) {
          send(ws, {
            id: "?",
            error: { code: -32700, message: `parse error: ${errMsg3(err)}` }
          });
          return;
        }
        handleRequest(client, req).then((res) => send(ws, res));
      });
      ws.on("close", () => {
        for (const off of client.subs.values()) {
          try {
            off();
          } catch {}
        }
        client.subs.clear();
        for (const conn of client.acpConns.values()) {
          try {
            conn.close(1001, "client disconnect");
          } catch {}
        }
        client.acpConns.clear();
        clients.delete(client);
      });
      ws.on("error", (err) => log2("ws client error:", errMsg3(err)));
    });
  });
}
async function main() {
  await reapOrphans();
  await writeSentinel();
  const server = await startServer();
  console.log(JSON.stringify({ ready: true, port: server.port }));
  log2(`listening on 127.0.0.1:${server.port}`);
  const shutdown = async (signal) => {
    log2(`received ${signal}, shutting down…`);
    server.close();
    try {
      await orch.close();
    } catch (err) {
      log2("orchestrator shutdown error:", errMsg3(err));
    }
    try {
      await fs2.unlink(SENTINEL_PATH);
    } catch {}
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  await new Promise(() => {});
}
main().catch((err) => {
  log2("fatal:", errMsg3(err));
  process.exit(1);
});

//# debugId=ED86BFE2F7159CC064756E2164756E21
//# sourceMappingURL=sidecar.js.map
