import { useEffect, useState } from "react";
import type { AgentDescriptor, LogEntry, WireError } from "@beamhop/acp-protocol";
import { useAcp } from "../context.js";

export type AcpStatus = "connecting" | "ready" | "reconnecting" | "closed" | "error";

export interface AcpSessionState {
  status: AcpStatus;
  sessionId: string | null;
  agentId: string;
  /** Agents registered on the server, learned at `ready`. */
  availableAgents: AgentDescriptor[];
  lastError: WireError | null;
  logs: LogEntry[];
}

export interface UseAcpSessionOptions {
  /** Cap the in-memory log buffer. Default: 200. */
  maxLogs?: number;
}

/**
 * Subscribe to high-level session state. Returns an object that re-renders
 * on status changes, ready, errors, and log entries.
 */
export function useAcpSession(opts: UseAcpSessionOptions = {}): AcpSessionState {
  const session = useAcp();
  const maxLogs = opts.maxLogs ?? 200;
  const [state, setState] = useState<AcpSessionState>(() => ({
    status: session.sessionId ? "ready" : "connecting",
    sessionId: session.sessionId,
    agentId: String(session.agentId),
    availableAgents: session.availableAgents,
    lastError: null,
    logs: [],
  }));

  useEffect(() => {
    const offs = [
      session.on("ready", (p) =>
        setState((s) => ({
          ...s,
          status: "ready",
          sessionId: p.sessionId,
          agentId: p.agentId,
          availableAgents: p.availableAgents,
        })),
      ),
      session.on("reconnecting", () => setState((s) => ({ ...s, status: "reconnecting" }))),
      session.on("open", () => setState((s) => ({ ...s, status: "connecting" }))),
      session.on("close", () => setState((s) => ({ ...s, status: "closed" }))),
      session.on("error", (e) => setState((s) => ({ ...s, lastError: e }))),
      session.on("fatal", (e) => setState((s) => ({ ...s, status: "error", lastError: e }))),
      session.on("log", (entry) =>
        setState((s) => ({ ...s, logs: [...s.logs.slice(-(maxLogs - 1)), entry] })),
      ),
    ];
    return () => offs.forEach((off) => off());
  }, [session, maxLogs]);

  return state;
}
