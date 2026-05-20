// Wire protocol between the Tauri webview and the Bun sidecar.
// JSON-RPC 2.0-shaped messages over a local-only WebSocket.

import type {
  SandboxRecord,
  SessionRecord,
  ShareDescriptor,
} from "@beamhop/host-orchestrator";
import type { BuildEvent } from "@beamhop/beambox";

export type { BuildEvent };

export type BuildStatus = "running" | "succeeded" | "failed" | "cancelled";

/**
 * A live or recently-completed image build tracked by the sidecar. Returned
 * by `builds.list` / `builds.get`. The `events` array is full replay history
 * (lifecycle events always kept, stdout/stderr capped — see sidecar
 * registry for the policy).
 */
export interface BuildView {
  buildId: string;
  tag: string;
  dockerfile: string;
  memory?: number;
  autoBoot: boolean;
  startedAt: number;
  endedAt?: number;
  status: BuildStatus;
  snapshotName?: string;
  sandboxId?: string;
  error?: string;
}

/** Same shape with the full event log attached. Used by `builds.get`. */
export interface BuildDetail extends BuildView {
  events: BuildEvent[];
  /**
   * True when the in-memory ring trimmed older stdout/stderr lines.
   * Lifecycle events (`build:start`, `step:*`, `build:end/error`) are
   * always preserved.
   */
  truncated: boolean;
}

export type SandboxStatus = "running" | "stopped" | "crashed" | "draining";

/**
 * Wire shape for a sandbox row. `id` is the microsandbox name — for sandboxes
 * the orchestrator created this is the auto-generated `sb_<hex>`, for
 * pre-existing or externally-created ones it's whatever name `msb list` shows.
 * `external` means the orchestrator didn't create it this session; its
 * `createdAt` may have been parsed from on-disk metadata.
 */
export interface SandboxView {
  id: string;
  imageTag: string;
  status: SandboxStatus;
  createdAt: number;
  external: boolean;
}

export interface SessionView {
  id: string;
  kind: "terminal" | "agent";
  sandboxId: string;
  agentId?: string;
  createdAt: number;
}

export interface AgentView {
  id: string;
  label: string;
  command: string;
}

export interface BuildImageProgress {
  tag: string;
  step?: string;
  done?: boolean;
  error?: string;
}

export interface ImageView {
  tag: string;
  snapshotName: string;
  baseImage: string;
  createdAt: string;
}

// ---------- request/response ----------

export type RpcRequest =
  | { id: string; method: "sandboxes.list" }
  | {
      id: string;
      method: "sandboxes.create";
      params: { imageTag: string; memory?: number };
    }
  | { id: string; method: "sandboxes.remove"; params: { id: string } }
  | {
      id: string;
      method: "sandboxes.removeMany";
      params: { ids: string[]; force?: boolean };
    }
  | {
      id: string;
      method: "sandboxes.buildImage";
      params: { tag: string; dockerfile: string; memory?: number };
    }
  | {
      id: string;
      method: "builds.start";
      params: {
        tag: string;
        dockerfile: string;
        memory?: number;
        /** Boot a sandbox from the freshly-built snapshot. Default true. */
        autoBoot?: boolean;
      };
    }
  | { id: string; method: "builds.list" }
  | { id: string; method: "builds.get"; params: { buildId: string } }
  | { id: string; method: "builds.cancel"; params: { buildId: string } }
  | { id: string; method: "sandboxes.listImages" }
  | {
      id: string;
      method: "sandboxes.removeImages";
      params: { snapshotNames: string[] };
    }
  | { id: string; method: "sessions.list" }
  | {
      id: string;
      method: "sessions.startTerminal";
      params: { sandboxId: string };
    }
  | {
      id: string;
      method: "sessions.startAgent";
      params: { sandboxId: string; agentId: string };
    }
  | { id: string; method: "sessions.close"; params: { id: string } }
  | {
      id: string;
      method: "shares.toggle";
      params: { sessionId: string; on: boolean };
    }
  | { id: string; method: "shares.list" }
  | { id: string; method: "agents.list" }
  | {
      id: string;
      method: "terminal.write";
      params: { sessionId: string; data: string };
    }
  | {
      id: string;
      method: "terminal.resize";
      params: { sessionId: string; cols: number; rows: number };
    }
  | {
      id: string;
      method: "subscribe.terminal";
      params: { sessionId: string; cols?: number; rows?: number };
    }
  | {
      id: string;
      method: "acp.open";
      params: { sessionId: string };
    }
  | {
      id: string;
      method: "acp.send";
      params: { connectionId: string; frame: string };
    }
  | {
      id: string;
      method: "acp.close";
      params: { connectionId: string };
    }
  | {
      id: string;
      method: "unsubscribe";
      params: { subId: string };
    };

export type RpcResponse =
  | { id: string; result: unknown }
  | { id: string; error: { code: number; message: string } };

/** Server-pushed event (no `id`). */
export type RpcEvent =
  | { event: "sandbox:created"; data: SandboxView }
  | { event: "sandbox:closed"; data: { id: string } }
  | { event: "session:created"; data: SessionView }
  | { event: "session:closed"; data: { id: string } }
  | {
      event: "share:state-changed";
      data: ShareDescriptor | { sessionId: string; shared: false };
    }
  | { event: "peer:joined"; data: { sessionId: string; peerId: string } }
  | { event: "peer:left"; data: { sessionId: string; peerId: string } }
  | {
      event: "terminal:data";
      data: { subId: string; sessionId: string; bytes: string };
    }
  | {
      event: "acp:frame";
      data: { connectionId: string; frame: string };
    }
  | {
      event: "acp:closed";
      data: { connectionId: string; code: number; reason: string };
    }
  | { event: "image:progress"; data: BuildImageProgress }
  | { event: "build:event"; data: { buildId: string; event: BuildEvent } }
  | { event: "build:state"; data: BuildView };

export type RpcInbound = RpcRequest;
export type RpcOutbound = RpcResponse | RpcEvent;

export function projectSandbox(r: SandboxRecord): SandboxView {
  return {
    id: r.id,
    imageTag: r.imageTag,
    status: "running",
    createdAt: r.createdAt,
    external: false,
  };
}

export function projectSession(r: SessionRecord): SessionView {
  return {
    id: r.id,
    kind: r.kind,
    sandboxId: r.sandboxId,
    agentId: r.kind === "agent" ? r.agentDef.id : undefined,
    createdAt: r.createdAt,
  };
}
