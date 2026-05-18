import type {
  AgentDescriptor,
  AuthMethod,
  AvailableCommand,
  LogEntry,
  ModelCatalog,
  WireError,
} from "@beamhop/acp-protocol";

/**
 * Tiny typed event emitter. We avoid `node:events` to keep the bundle browser-only.
 */
export type EventMap = Record<string, unknown>;

export type Unsubscribe = () => void;

export class TypedEmitter<E extends EventMap> {
  private readonly handlers = new Map<keyof E, Set<(payload: E[keyof E]) => void>>();
  private warnedNoErrorHandler = false;

  on<K extends keyof E>(event: K, handler: (payload: E[K]) => void): Unsubscribe {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as (payload: E[keyof E]) => void);
    return () => set!.delete(handler as (payload: E[keyof E]) => void);
  }

  emit<K extends keyof E>(event: K, payload: E[K]): void {
    const set = this.handlers.get(event);
    if (!set || set.size === 0) {
      if (event === "error" && !this.warnedNoErrorHandler) {
        this.warnedNoErrorHandler = true;
        // Loud DX warning: silent errors are the #1 way SDKs become unusable.
        console.warn(
          "[@beamhop/acp-client] received an error but no `.on('error', ...)` handler is attached. " +
            "Errors will be dropped silently until one is registered.",
          payload,
        );
      }
      return;
    }
    for (const h of set) {
      try {
        h(payload);
      } catch (err) {
        console.error("[@beamhop/acp-client] event handler threw", err);
      }
    }
  }

  removeAll(event?: keyof E): void {
    if (event) this.handlers.delete(event);
    else this.handlers.clear();
  }
}

/**
 * Events the AcpSession surfaces. `update` is the firehose of agent
 * notifications (session/update payloads, etc); `rpc` is fired for every
 * raw RPC traffic frame for observability tooling.
 */
export interface SessionEvents extends EventMap {
  open: { reconnect: boolean };
  ready: {
    sessionId: string;
    agentId: string;
    agentCapabilities?: unknown;
    availableAgents: AgentDescriptor[];
    /** Auth methods the current agent advertises. Empty array if none. */
    authMethods: AuthMethod[];
  };
  /** Streaming agent notification (most importantly `session/update`). */
  update: { method: string; params: unknown };
  /**
   * Slash-command list advertised by the agent. Replaces the previous list
   * entirely (ACP semantics: the notification is the full set, not a delta).
   * Fires with `[]` on a fresh session before the agent has emitted any.
   */
  commands: AvailableCommand[];
  /**
   * Normalised model catalog. Fires on `ready` (new agent), after every
   * successful `setModel()`, or when the server pushes a `model-update`.
   * Payload is `null` when the current agent doesn't expose model selection.
   */
  model: ModelCatalog | null;
  /** Server-side log forwarded for the developer console. */
  log: LogEntry;
  /** Non-fatal protocol/transport error. */
  error: WireError;
  /** Fatal error; the connection is closing. */
  fatal: WireError;
  /** WS closed (clean or otherwise). */
  close: { code: number; reason: string };
  /** Reconnect attempt scheduled. */
  reconnecting: { attempt: number; delayMs: number };
  /**
   * Fired when the agent rejects a request (typically `session/new` or
   * `session/prompt`) with the conventional ACP `auth_required` message.
   * Payload carries the agent's advertised auth-method ids (from the last
   * `ready` frame) so the UI knows what choices to offer.
   */
  auth_required: { methodIds: string[] };
  /**
   * Streaming PTY output from an in-flight agent-login session. Optional
   * observability hook — most consumers should use `useAgentLogin` instead.
   */
  login_data: { loginId: string; data: string };
}
