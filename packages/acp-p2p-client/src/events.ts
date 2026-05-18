import type {
  AgentDescriptor,
  AuthMethod,
  AvailableCommand,
  LogEntry,
  ModelCatalog,
  WireError,
} from "@beamhop/acp-protocol";

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
        console.warn(
          "[@beamhop/acp-p2p-client] received an error but no `.on('error', ...)` handler is attached. " +
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
        console.error("[@beamhop/acp-p2p-client] event handler threw", err);
      }
    }
  }

  removeAll(event?: keyof E): void {
    if (event) this.handlers.delete(event);
    else this.handlers.clear();
  }
}

/**
 * Events the p2p session surfaces. Mirrors the @beamhop/acp-client surface
 * minus reconnect (trystero handles peer churn under the hood).
 */
export interface SessionEvents extends EventMap {
  ready: {
    sessionId: string;
    agentId: string;
    agentCapabilities?: unknown;
    availableAgents: AgentDescriptor[];
    authMethods: AuthMethod[];
  };
  update: { method: string; params: unknown };
  commands: AvailableCommand[];
  model: ModelCatalog | null;
  log: LogEntry;
  error: WireError;
  fatal: WireError;
  /** Trystero peer joined the room (presence). */
  peer_join: { peerId: string };
  /** Trystero peer left the room (presence). */
  peer_leave: { peerId: string };
  auth_required: { methodIds: string[] };
  login_data: { loginId: string; data: string };
}
