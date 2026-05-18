import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentId } from "@beamhop/acp-protocol";
import type { LoginExitInfo, LoginStream } from "@beamhop/acp-client";
import { useAcp } from "../context.js";

export type AgentLoginStatus = "idle" | "starting" | "open" | "closed";

export interface UseAgentLoginOptions {
  /**
   * Cap the in-memory output buffer (bytes of utf-8). When exceeded, older
   * data is dropped from the front. Default 64 KiB.
   */
  maxOutputBytes?: number;
}

export interface UseAgentLoginResult {
  status: AgentLoginStatus;
  loginId: string | null;
  /** Accumulated PTY stdout/stderr (utf-8). */
  output: string;
  /** Last completion info, populated once status === "closed". */
  exitInfo: LoginExitInfo | null;
  /** Last start/cancel error, if any. */
  error: Error | null;
  /**
   * Open a new login session for `agentId` (defaults to the current agent).
   * If a session is already open, it is cancelled first. Returns once
   * `login-ready` arrives.
   */
  start(agentId?: AgentId): Promise<void>;
  /** Forward keystrokes to the PTY. */
  write(data: string): void;
  /** Resize the PTY (cols, rows). */
  resize(cols: number, rows: number): void;
  /** Cancel the current login. Resolves once the server confirms `login-end`. */
  cancel(): Promise<void>;
  /**
   * Subscribe to raw output chunks without forcing a re-render. Use this when
   * wiring xterm.js — call `term.write(chunk)` in the callback.
   */
  onData(cb: (data: string) => void): () => void;
}

/**
 * Drive an out-of-band agent login (copilot device-flow, pi-mono terminal
 * login, opencode auth login, etc.) from React. Pairs with `useAuthMethods`
 * for agents that use the native ACP `authenticate` RPC instead.
 */
export function useAgentLogin(opts: UseAgentLoginOptions = {}): UseAgentLoginResult {
  const session = useAcp();
  const maxBytes = opts.maxOutputBytes ?? 64 * 1024;
  const [status, setStatus] = useState<AgentLoginStatus>("idle");
  const [loginId, setLoginId] = useState<string | null>(null);
  const [output, setOutput] = useState("");
  const [exitInfo, setExitInfo] = useState<LoginExitInfo | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const streamRef = useRef<LoginStream | null>(null);
  const dataSubsRef = useRef<Set<(data: string) => void>>(new Set());

  // Tear down on unmount.
  useEffect(
    () => () => {
      const s = streamRef.current;
      streamRef.current = null;
      if (s) void s.cancel().catch(() => void 0);
    },
    [],
  );

  const appendOutput = useCallback(
    (chunk: string) => {
      // Notify subscribers BEFORE applying the cap so xterm.js gets everything.
      for (const cb of dataSubsRef.current) {
        try {
          cb(chunk);
        } catch {
          // user callback threw — keep going
        }
      }
      setOutput((prev) => {
        const next = prev + chunk;
        if (next.length <= maxBytes) return next;
        return next.slice(next.length - maxBytes);
      });
    },
    [maxBytes],
  );

  const consumeStream = useCallback(
    async (stream: LoginStream) => {
      try {
        for await (const chunk of stream) appendOutput(chunk);
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    },
    [appendOutput],
  );

  const start = useCallback(
    async (agentId?: AgentId) => {
      // If a previous login is still open, kill it first.
      const existing = streamRef.current;
      if (existing) {
        try {
          await existing.cancel();
        } catch {
          // ignore — server may have already closed it
        }
      }
      setStatus("starting");
      setOutput("");
      setExitInfo(null);
      setError(null);
      try {
        const stream = await session.startLogin(agentId);
        streamRef.current = stream;
        setLoginId(stream.loginId);
        setStatus("open");
        void consumeStream(stream);
        // Watch for completion so the UI flips to "closed" automatically.
        stream.exit
          .then((info) => {
            setExitInfo(info);
            setStatus("closed");
            // Don't clear loginId — callers may want it for diagnostics.
            if (streamRef.current === stream) streamRef.current = null;
          })
          .catch(() => void 0);
      } catch (err) {
        const wrapped = err instanceof Error ? err : new Error(String(err));
        setError(wrapped);
        setStatus("idle");
        throw wrapped;
      }
    },
    [session, consumeStream],
  );

  const write = useCallback((data: string) => {
    streamRef.current?.write(data);
  }, []);

  const resize = useCallback((cols: number, rows: number) => {
    streamRef.current?.resize(cols, rows);
  }, []);

  const cancel = useCallback(async () => {
    const s = streamRef.current;
    if (!s) return;
    try {
      await s.cancel();
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, []);

  const onData = useCallback((cb: (data: string) => void) => {
    dataSubsRef.current.add(cb);
    return () => {
      dataSubsRef.current.delete(cb);
    };
  }, []);

  return { status, loginId, output, exitInfo, error, start, write, resize, cancel, onData };
}
