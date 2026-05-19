// Beamhop desktop sidecar.
//
// Boots a HostOrchestrator (werift + microsandbox + ACP + shell-server) and
// exposes it to the Tauri webview over a local-only WebSocket using a small
// JSON-RPC-shaped protocol (see ./protocol.ts).
//
// Prints exactly one line to stdout on startup:
//   {"ready":true,"port":NNNN}
// — the Tauri Rust side parses this to learn where to connect the webview.

import { promises as fs } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { RTCPeerConnection } from "werift";
import {
  HostOrchestrator,
  type SandboxRecord,
  type SessionRecord,
} from "@beamhop/host-orchestrator";
import { SandboxImage, listImages, removeImage } from "@beamhop/beambox";
import { Sandbox } from "microsandbox";
import { builtInAgents } from "@beamhop/acp-server";
import {
  joinRoom as joinNostrRoom,
} from "@trystero-p2p/nostr";
import {
  projectSandbox,
  projectSession,
  type AgentView,
  type RpcEvent,
  type RpcOutbound,
  type RpcRequest,
  type RpcResponse,
  type SandboxView,
  type SessionView,
} from "./protocol.js";

const log = (...args: unknown[]) =>
  console.error("[sidecar]", ...args);

// ---------- orphan reap ---------------------------------------------------
//
// Each sidecar PID writes a sentinel file under ~/.beamhop/desktop/owned/{pid}.json
// listing every sandbox it created. On startup, we scan sentinels whose PIDs
// are no longer alive, fetch the listed sandboxes, and remove them. Catches
// the SIGKILL / hard-crash path where process.on('exit') wouldn't fire.

const SENTINEL_DIR = path.join(os.homedir(), ".beamhop", "desktop", "owned");
const SENTINEL_PATH = path.join(SENTINEL_DIR, `${process.pid}.json`);
const ownedSandboxes = new Set<string>();
let sentinelWriteQueue: Promise<void> = Promise.resolve();

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function writeSentinel(): Promise<void> {
  sentinelWriteQueue = sentinelWriteQueue.then(async () => {
    await fs.mkdir(SENTINEL_DIR, { recursive: true });
    await fs.writeFile(
      SENTINEL_PATH,
      JSON.stringify(
        { pid: process.pid, sandboxes: [...ownedSandboxes], updatedAt: Date.now() },
        null,
        2,
      ),
      "utf8",
    );
  });
  return sentinelWriteQueue;
}

async function reapOrphans(): Promise<void> {
  await fs.mkdir(SENTINEL_DIR, { recursive: true });
  let entries: string[] = [];
  try {
    entries = await fs.readdir(SENTINEL_DIR);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const pidStr = name.slice(0, -5);
    const pid = Number(pidStr);
    if (!Number.isFinite(pid) || pid === process.pid) continue;
    if (isPidAlive(pid)) continue;

    const filePath = path.join(SENTINEL_DIR, name);
    let raw = "";
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch {
      continue;
    }
    let parsed: { sandboxes?: string[] } = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      // bad file — drop it
      await fs.unlink(filePath).catch(() => {});
      continue;
    }
    const names = parsed.sandboxes ?? [];
    if (names.length === 0) {
      await fs.unlink(filePath).catch(() => {});
      continue;
    }
    log(`reaping ${names.length} orphan sandbox(es) from dead pid ${pid}`);
    for (const sbName of names) {
      try {
        await Sandbox.remove(sbName);
      } catch (err) {
        log(`  failed to remove ${sbName}:`, errMsg(err));
      }
    }
    await fs.unlink(filePath).catch(() => {});
  }
}

// ---------- subscriptions -------------------------------------------------
//
// Each connected client (the Tauri webview) can subscribe to a session's
// terminal output stream or agent prompt stream. We track these per-client
// so cleanup is automatic on socket close.

interface ClientState {
  ws: WebSocket;
  /** subId → cleanup function */
  subs: Map<string, () => void>;
  /** connectionId → in-process ACP transport (one per chat panel). */
  acpConns: Map<string, import("@beamhop/acp-server").InProcessTransport>;
}

const clients = new Set<ClientState>();

function send(ws: WebSocket, msg: RpcOutbound) {
  if (ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify(msg));
  } catch (err) {
    log("ws send failed:", errMsg(err));
  }
}

function broadcast(msg: RpcOutbound) {
  for (const c of clients) send(c.ws, msg);
}

// ---------- orchestrator wiring ------------------------------------------

const orch = new HostOrchestrator({ rtcPolyfill: RTCPeerConnection });

orch.on("sandbox:created", (r: SandboxRecord) => {
  ownedSandboxes.add(r.sandbox.name);
  void writeSentinel();
  broadcast({ event: "sandbox:created", data: projectSandbox(r) });
});
orch.on("sandbox:closed", (id: string) => {
  // The orchestrator only knows the orchestrator-id (sb_xxx), which it uses
  // as the microsandbox name when creating. So removing by id == removing by
  // sandbox name.
  ownedSandboxes.delete(id);
  void writeSentinel();
  broadcast({ event: "sandbox:closed", data: { id } });
});
orch.on("session:created", (r: SessionRecord) =>
  broadcast({ event: "session:created", data: projectSession(r) }),
);
orch.on("session:closed", (id: string) =>
  broadcast({ event: "session:closed", data: { id } }),
);
orch.on("share:state-changed", (d) =>
  broadcast({ event: "share:state-changed", data: d }),
);
orch.on("peer:joined", (info) =>
  broadcast({ event: "peer:joined", data: info }),
);
orch.on("peer:left", (info) =>
  broadcast({ event: "peer:left", data: info }),
);

// ---------- agent registry projection ------------------------------------

function listAgents(): AgentView[] {
  return Object.values(builtInAgents).map((a) => ({
    id: a.id,
    label: a.label,
    command: a.command,
  }));
}

// ---------- sandbox listing -----------------------------------------------
//
// `orch.listSandboxes()` only knows about sandboxes the orchestrator created
// this session. The host has many more on disk — from prior sessions, from
// the `msb` CLI, from build artifacts. We surface every one of them.

function parseImage(configJson: string): string | null {
  try {
    const cfg = JSON.parse(configJson) as { image?: unknown };
    const img = cfg.image;
    if (typeof img === "string") return img;
    if (img && typeof img === "object") {
      // microsandbox encodes image as a tagged union: `{"Oci": "ubuntu:24.04"}`
      // or `{"Snapshot": "my-snap"}`. Use the first string value.
      for (const v of Object.values(img as Record<string, unknown>)) {
        if (typeof v === "string") return v;
      }
    }
  } catch {}
  return null;
}

async function listAllSandboxes(): Promise<SandboxView[]> {
  const handles = await Sandbox.list();
  // Build a lookup of orchestrator-known sandboxes so we can mark them
  // non-external (and prefer the orchestrator's imageTag, which preserves
  // user-provided casing/tags lost in microsandbox's normalized form).
  const tracked = new Map<string, SandboxRecord>();
  for (const r of orch.listSandboxes()) tracked.set(r.id, r);

  const views: SandboxView[] = handles.map((h) => {
    const t = tracked.get(h.name);
    return {
      id: h.name,
      imageTag: t?.imageTag ?? parseImage(h.configJson) ?? "unknown",
      status: h.status,
      createdAt: h.createdAt ? h.createdAt.getTime() : Date.now(),
      external: t === undefined,
    };
  });
  // Newest first.
  views.sort((a, b) => b.createdAt - a.createdAt);
  return views;
}

/**
 * Remove a sandbox by name. For orchestrator-tracked sandboxes, go through
 * `orch.closeSandbox` so sessions and shares get torn down cleanly. For
 * external ones (or non-running), call microsandbox's Sandbox API directly;
 * stop/kill if running, then remove.
 */
async function removeSandboxByName(name: string, force: boolean): Promise<void> {
  // 1) If the orchestrator knows about this sandbox, tear down its sessions
  //    and shares cleanly first. `closeSandbox` also disposes the live
  //    Sandbox handle (no-op for adopted non-owning handles).
  const tracked = orch.listSandboxes().some((r) => r.id === name);
  if (tracked) {
    await orch.closeSandbox(name);
  }

  // 2) Stop the VM if it's still running, then erase it from disk. The user
  //    clicked "remove" — they want it gone, not parked.
  const handle = await Sandbox.get(name).catch(() => null);
  if (handle) {
    if (handle.status === "running" || handle.status === "draining") {
      if (!force) throw new Error("sandbox is running; force required");
      try {
        await handle.stop();
      } catch {
        await handle.kill();
      }
    }
    await handle.remove();
  }

  // 3) If we removed an external sandbox without going through the
  //    orchestrator, no `sandbox:closed` event fired — broadcast one so the
  //    UI updates immediately.
  if (!tracked) {
    broadcast({ event: "sandbox:closed", data: { id: name } });
  }
}

// ---------- RPC handlers --------------------------------------------------

async function handleRequest(
  client: ClientState,
  req: RpcRequest,
): Promise<RpcResponse> {
  try {
    const result = await dispatch(client, req);
    return { id: req.id, result };
  } catch (err) {
    return {
      id: req.id,
      error: { code: -32000, message: errMsg(err) },
    };
  }
}

async function dispatch(
  client: ClientState,
  req: RpcRequest,
): Promise<unknown> {
  switch (req.method) {
    case "sandboxes.list": {
      return await listAllSandboxes();
    }
    case "sandboxes.create": {
      const id = await orch.createSandbox(req.params.imageTag, {
        memory: req.params.memory,
      });
      return { id };
    }
    case "sandboxes.remove": {
      await removeSandboxByName(req.params.id, true);
      return null;
    }
    case "sandboxes.removeMany": {
      const force = Boolean(req.params.force);
      const results: Array<{ id: string; ok: boolean; error?: string }> = [];
      for (const id of req.params.ids) {
        try {
          await removeSandboxByName(id, force);
          results.push({ id, ok: true });
        } catch (err) {
          results.push({ id, ok: false, error: errMsg(err) });
        }
      }
      return { results };
    }
    case "sandboxes.buildImage": {
      return await buildImage(
        req.params.tag,
        req.params.dockerfile,
        req.params.memory,
      );
    }
    case "sandboxes.listImages": {
      const metas = await listImages();
      return metas.map((m) => ({
        // Prefer the verbatim tag we stored at build time. Fall back to
        // stripping the 12-hex digest suffix for metadata files written
        // before `tag` was persisted (the strip is lossy — sanitizeTag
        // mapped `:` to `_` — but it's the best we can do for old entries).
        tag: m.tag ?? m.snapshotName.replace(/-[a-f0-9]{12}$/, ""),
        snapshotName: m.snapshotName,
        baseImage: m.baseImage,
        createdAt: m.createdAt,
      }));
    }
    case "sandboxes.removeImages": {
      const errors: { snapshotName: string; message: string }[] = [];
      for (const name of req.params.snapshotNames) {
        try {
          await removeImage(name);
        } catch (err) {
          errors.push({ snapshotName: name, message: errMsg(err) });
        }
      }
      return { removed: req.params.snapshotNames.length - errors.length, errors };
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
        // Default: nostr strategy, pre-resolved joinRoom (avoids dynamic
        // import path-resolution issues from the orchestrator's own context).
        const descriptor = await orch.share(req.params.sessionId, {
          strategy: { strategy: "nostr" },
          joinRoom: joinNostrRoom as never,
        });
        return descriptor;
      }
      await orch.unshare(req.params.sessionId);
      return null;
    }
    case "shares.list": {
      const out: unknown[] = [];
      for (const session of orch.listSessions()) {
        const d = orch.getShare(session.id);
        if (d) out.push(d);
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
      session.pty.resize(
        "desktop", // single local peer id
        req.params.cols,
        req.params.rows,
      );
      return null;
    }
    case "acp.open": {
      const connectionId = randomUUID();
      const transport = orch.connectAgentLocal(req.params.sessionId);
      transport.onMessage((frame) => {
        send(client.ws, {
          event: "acp:frame",
          data: { connectionId, frame },
        });
      });
      transport.onClose(({ code, reason }) => {
        send(client.ws, {
          event: "acp:closed",
          data: { connectionId, code, reason },
        });
        client.acpConns.delete(connectionId);
      });
      // Mark the transport as open so the consumer's Session can proceed.
      // For in-process channels this is synchronous.
      await transport.open();
      client.acpConns.set(connectionId, transport);
      return { connectionId };
    }
    case "acp.send": {
      const transport = client.acpConns.get(req.params.connectionId);
      if (!transport) throw new Error(`unknown acp connection: ${req.params.connectionId}`);
      transport.send(req.params.frame);
      return null;
    }
    case "acp.close": {
      const transport = client.acpConns.get(req.params.connectionId);
      if (!transport) return null;
      transport.close(1000, "client closed");
      client.acpConns.delete(req.params.connectionId);
      return null;
    }
    case "subscribe.terminal": {
      const subId = randomUUID();
      const session = findSession(req.params.sessionId, "terminal");
      // Honor cols/rows from the client so the guest PTY is born with the
      // right COLUMNS/LINES. Fall back to a roomy default when the client
      // doesn't say — better than 80×24 for modern TUIs.
      const cols = req.params.cols && req.params.cols > 0 ? req.params.cols : 120;
      const rows = req.params.rows && req.params.rows > 0 ? req.params.rows : 32;
      const detach = session.pty.attach(
        `desktop-${subId}`,
        cols,
        rows,
        (chunk) => {
          send(client.ws, {
            event: "terminal:data",
            data: {
              subId,
              sessionId: req.params.sessionId,
              bytes: bufferToBase64(chunk),
            },
          });
        },
      );
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
      const exhaustive: never = req;
      throw new Error(`unknown method: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function findSession(
  id: string,
  kind: "terminal",
): Extract<SessionRecord, { kind: "terminal" }>;
function findSession(
  id: string,
  kind: "agent",
): Extract<SessionRecord, { kind: "agent" }>;
function findSession(
  id: string,
  kind: "terminal" | "agent",
): SessionRecord {
  const s = orch.listSessions().find((s) => s.id === id);
  if (!s) throw new Error(`unknown session: ${id}`);
  if (s.kind !== kind) throw new Error(`session ${id} is ${s.kind}, not ${kind}`);
  return s;
}

async function buildImage(
  tag: string,
  dockerfile: string,
  memory?: number,
): Promise<{ tag: string; snapshotName: string }> {
  // Materialize the Dockerfile into a temp context so beambox can resolve
  // any COPY/ADD instructions relative to a real directory.
  const ctx = await mkdtemp(path.join(os.tmpdir(), "beamhop-build-"));
  const dockerfilePath = path.join(ctx, "Dockerfile");
  await writeFile(dockerfilePath, dockerfile, "utf8");

  broadcast({
    event: "image:progress",
    data: { tag, step: "starting build" },
  });
  try {
    const img = await SandboxImage.fromDockerfileString(dockerfile).build(tag, {
      contextDir: ctx,
      memory,
    });
    broadcast({
      event: "image:progress",
      data: { tag, done: true, step: `built ${img.snapshotName}` },
    });
    return { tag, snapshotName: img.snapshotName };
  } catch (err) {
    broadcast({
      event: "image:progress",
      data: { tag, done: true, error: errMsg(err) },
    });
    throw err;
  } finally {
    await fs.rm(ctx, { recursive: true, force: true }).catch(() => {});
  }
}

function bufferToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------- WS server -----------------------------------------------------

function startServer(): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    // Honor BEAMHOP_SIDECAR_PORT when set (Tauri dev wires the sidecar on a
    // fixed port via beforeDevCommand). Default 0 = OS-assigned, useful in
    // standalone dev (`bun run dev:sidecar`) and tests.
    const portEnv = process.env.BEAMHOP_SIDECAR_PORT;
    const port = portEnv ? Number(portEnv) : 0;
    const wss = new WebSocketServer({ host: "127.0.0.1", port });
    wss.on("listening", () => {
      const addr = wss.address();
      if (typeof addr !== "object" || addr === null) {
        throw new Error("ws server failed to bind");
      }
      resolve({
        port: addr.port,
        close: () => wss.close(),
      });
    });
    wss.on("connection", (ws) => {
      const client: ClientState = {
        ws,
        subs: new Map(),
        acpConns: new Map(),
      };
      clients.add(client);
      ws.on("message", (raw) => {
        let req: RpcRequest;
        try {
          req = JSON.parse(raw.toString()) as RpcRequest;
        } catch (err) {
          send(ws, {
            id: "?",
            error: { code: -32700, message: `parse error: ${errMsg(err)}` },
          });
          return;
        }
        void handleRequest(client, req).then((res) => send(ws, res));
      });
      ws.on("close", () => {
        for (const off of client.subs.values()) {
          try {
            off();
          } catch {
            /* best effort */
          }
        }
        client.subs.clear();
        for (const conn of client.acpConns.values()) {
          try {
            conn.close(1001, "client disconnect");
          } catch {
            /* best effort */
          }
        }
        client.acpConns.clear();
        clients.delete(client);
      });
      ws.on("error", (err) => log("ws client error:", errMsg(err)));
    });
  });
}

// ---------- main -----------------------------------------------------------

async function main() {
  await reapOrphans();
  await writeSentinel();

  const server = await startServer();

  // Single ready line — Tauri parses this from stdout.
  // Everything else goes to stderr via `log`.
  console.log(JSON.stringify({ ready: true, port: server.port }));
  log(`listening on 127.0.0.1:${server.port}`);

  const shutdown = async (signal: string) => {
    log(`received ${signal}, shutting down…`);
    server.close();
    try {
      await orch.close();
    } catch (err) {
      log("orchestrator shutdown error:", errMsg(err));
    }
    try {
      await fs.unlink(SENTINEL_PATH);
    } catch {
      /* best effort */
    }
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // Park forever — Tauri owns our lifecycle.
  await new Promise(() => {});
}

void main().catch((err) => {
  log("fatal:", errMsg(err));
  process.exit(1);
});

// Type-only re-exports the UI side imports without pulling sidecar runtime
// code into the browser bundle.
export type {
  AgentView,
  RpcEvent,
  RpcRequest,
  RpcResponse,
  SandboxView,
  SessionView,
} from "./protocol.js";
