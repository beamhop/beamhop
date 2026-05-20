// Browser-side client for the sidecar's local WS RPC.
//
// The webview obtains the sidecar's port via either:
//   - Tauri's `__BEAMHOP_SIDECAR_PORT__` injected into window, or
//   - the `?sidecarPort=N` URL param (used by `bun --hot src/server.ts` during
//     dev — see ../server.ts), or
//   - a hardcoded fallback for `bun sidecar/index.ts` in standalone dev.

import type {
  AgentView,
  BuildDetail,
  BuildView,
  ImageView,
  RpcEvent,
  RpcRequest,
  RpcResponse,
  SandboxView,
  SessionView,
} from "../../sidecar/protocol.ts";

declare global {
  interface Window {
    __BEAMHOP_SIDECAR_PORT__?: number;
  }
}

export type SidecarEvent = RpcEvent;

type AnyMethod = RpcRequest["method"];
type ParamsOf<M extends AnyMethod> = Extract<
  RpcRequest,
  { method: M }
> extends { params: infer P }
  ? P
  : undefined;

export interface SidecarClient {
  call<M extends AnyMethod>(
    method: M,
    ...params: ParamsOf<M> extends undefined ? [] : [ParamsOf<M>]
  ): Promise<unknown>;
  on<E extends RpcEvent["event"]>(
    event: E,
    cb: (data: Extract<RpcEvent, { event: E }>["data"]) => void,
  ): () => void;
  close(): void;
  readonly readyState: "connecting" | "open" | "closed";
}

// Fixed dev port. tauri.conf.json's beforeDevCommand boots the sidecar with
// BEAMHOP_SIDECAR_PORT set to this value, so the webview can connect without
// out-of-band port negotiation. Override with ?sidecarPort=N for ad-hoc runs.
export const DEV_SIDECAR_PORT = 5176;

export function discoverPort(): number | null {
  if (typeof window !== "undefined" && window.__BEAMHOP_SIDECAR_PORT__) {
    return window.__BEAMHOP_SIDECAR_PORT__;
  }
  if (typeof window !== "undefined") {
    const url = new URL(window.location.href);
    const p = url.searchParams.get("sidecarPort");
    if (p) return Number(p);
  }
  // In dev (Tauri or `bun run dev:ui`), fall back to the known fixed port.
  if (typeof window !== "undefined") {
    return DEV_SIDECAR_PORT;
  }
  return null;
}

export function createSidecarClient(port: number): SidecarClient {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  let readyState: "connecting" | "open" | "closed" = "connecting";
  const pending = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  const eventSubs = new Map<string, Set<(data: unknown) => void>>();
  const openWaiters: Array<() => void> = [];

  ws.addEventListener("open", () => {
    readyState = "open";
    for (const cb of openWaiters) cb();
    openWaiters.length = 0;
  });
  ws.addEventListener("close", () => {
    readyState = "closed";
    for (const [, p] of pending) p.reject(new Error("sidecar disconnected"));
    pending.clear();
  });
  ws.addEventListener("error", (ev) => {
    console.error("[sidecar-client] ws error", ev);
  });
  ws.addEventListener("message", (ev) => {
    let msg: RpcResponse | RpcEvent;
    try {
      msg = JSON.parse(String(ev.data));
    } catch (err) {
      console.error("[sidecar-client] parse error", err);
      return;
    }
    if ("id" in msg) {
      const waiter = pending.get(msg.id);
      if (!waiter) return;
      pending.delete(msg.id);
      if ("error" in msg) waiter.reject(new Error(msg.error.message));
      else waiter.resolve(msg.result);
    } else if ("event" in msg) {
      const subs = eventSubs.get(msg.event);
      if (!subs) return;
      for (const cb of subs) {
        try {
          cb(msg.data);
        } catch (err) {
          console.error(`[sidecar-client] event handler for ${msg.event}`, err);
        }
      }
    }
  });

  const awaitOpen = () =>
    new Promise<void>((resolve) => {
      if (readyState === "open") resolve();
      else openWaiters.push(resolve);
    });

  return {
    get readyState() {
      return readyState;
    },
    async call(method, ...params) {
      if (readyState === "connecting") await awaitOpen();
      if (readyState === "closed") throw new Error("sidecar disconnected");
      const id = `r${Math.random().toString(36).slice(2, 12)}`;
      return new Promise<unknown>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        const payload =
          params.length > 0 ? { id, method, params: params[0] } : { id, method };
        ws.send(JSON.stringify(payload));
      });
    },
    on(event, cb) {
      let subs = eventSubs.get(event);
      if (!subs) {
        subs = new Set();
        eventSubs.set(event, subs);
      }
      subs.add(cb as (d: unknown) => void);
      return () => subs!.delete(cb as (d: unknown) => void);
    },
    close() {
      ws.close();
    },
  };
}

// Helpers — small typed wrappers so call sites don't need to remember
// method strings and the cast at every callsite.
export const api = (c: SidecarClient) => ({
  listSandboxes: () => c.call("sandboxes.list") as Promise<SandboxView[]>,
  createSandbox: (imageTag: string, memory?: number) =>
    c.call("sandboxes.create", { imageTag, memory }) as Promise<{ id: string }>,
  removeSandbox: (id: string) => c.call("sandboxes.remove", { id }),
  removeManySandboxes: (ids: string[], force = false) =>
    c.call("sandboxes.removeMany", { ids, force }) as Promise<{
      results: { id: string; ok: boolean; error?: string }[];
    }>,
  buildImage: (tag: string, dockerfile: string, memory?: number) =>
    c.call("sandboxes.buildImage", { tag, dockerfile, memory }) as Promise<{
      tag: string;
      snapshotName: string;
    }>,
  startBuild: (
    tag: string,
    dockerfile: string,
    options: { memory?: number; autoBoot?: boolean } = {},
  ) =>
    c.call("builds.start", {
      tag,
      dockerfile,
      memory: options.memory,
      autoBoot: options.autoBoot,
    }) as Promise<{ buildId: string }>,
  listBuilds: () => c.call("builds.list") as Promise<BuildView[]>,
  getBuild: (buildId: string) =>
    c.call("builds.get", { buildId }) as Promise<BuildDetail>,
  cancelBuild: (buildId: string) =>
    c.call("builds.cancel", { buildId }) as Promise<null>,
  listImages: () => c.call("sandboxes.listImages") as Promise<ImageView[]>,
  removeImages: (snapshotNames: string[]) =>
    c.call("sandboxes.removeImages", { snapshotNames }) as Promise<{
      removed: number;
      errors: { snapshotName: string; message: string }[];
    }>,
  listSessions: () => c.call("sessions.list") as Promise<SessionView[]>,
  startTerminal: (sandboxId: string) =>
    c.call("sessions.startTerminal", { sandboxId }) as Promise<{ id: string }>,
  startAgent: (sandboxId: string, agentId: string) =>
    c.call("sessions.startAgent", { sandboxId, agentId }) as Promise<{
      id: string;
    }>,
  closeSession: (id: string) => c.call("sessions.close", { id }),
  toggleShare: (sessionId: string, on: boolean) =>
    c.call("shares.toggle", { sessionId, on }),
  listShares: () => c.call("shares.list"),
  listAgents: () => c.call("agents.list") as Promise<AgentView[]>,
  terminalWrite: (sessionId: string, data: string) =>
    c.call("terminal.write", { sessionId, data }),
  terminalResize: (sessionId: string, cols: number, rows: number) =>
    c.call("terminal.resize", { sessionId, cols, rows }),
  subscribeTerminal: (sessionId: string, cols?: number, rows?: number) =>
    c.call("subscribe.terminal", { sessionId, cols, rows }) as Promise<{
      subId: string;
    }>,
  unsubscribe: (subId: string) => c.call("unsubscribe", { subId }),
  acpOpen: (sessionId: string) =>
    c.call("acp.open", { sessionId }) as Promise<{ connectionId: string }>,
  acpSend: (connectionId: string, frame: string) =>
    c.call("acp.send", { connectionId, frame }),
  acpClose: (connectionId: string) =>
    c.call("acp.close", { connectionId }),
});

export type SidecarApi = ReturnType<typeof api>;
