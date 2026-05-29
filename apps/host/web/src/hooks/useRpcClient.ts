import { useCallback, useEffect, useMemo, useRef } from "react";
import { RpcClient, type Json, type RpcStatus } from "../rpc/client";

export interface UseRpcClientOptions {
  /** Running sandbox to attach to. Empty string means "don't connect yet". */
  sandbox: string;
  onMessage: (msg: Json) => void;
  onStatus: (status: RpcStatus, detail?: string) => void;
}

/**
 * Owns the single WebSocket {@link RpcClient}: derives the connect URL,
 * (re)connects whenever the sandbox changes, and tears down on unmount.
 *
 * Returns `send`/`request` bound to the live client plus `getClient()` for
 * the few call sites that need to sequence several calls against one client
 * instance (e.g. switch_session → get_messages).
 */
export function useRpcClient({ sandbox, onMessage, onStatus }: UseRpcClientOptions) {
  // The single Bun host serves both this page and the /rpc WebSocket, so a
  // relative URL against the current origin works wherever it's served over
  // http(s). The Tauri webview serves from tauri://localhost (no host:port),
  // so there we connect directly to the sidecar host on its known port.
  const wsUrl = useMemo(() => {
    const proto = window.location.protocol;
    if (proto === "http:" || proto === "https:") {
      return (proto === "https:" ? "wss://" : "ws://") + window.location.host + "/rpc";
    }
    return "ws://127.0.0.1:5179/rpc";
  }, []);

  const clientRef = useRef<RpcClient | null>(null);
  // Keep the callbacks in refs so reconnects are driven purely by `sandbox`,
  // not by callback identity churning on every render.
  const onMessageRef = useRef(onMessage);
  const onStatusRef = useRef(onStatus);
  onMessageRef.current = onMessage;
  onStatusRef.current = onStatus;

  useEffect(() => {
    if (!sandbox) return;
    const client = new RpcClient({
      url: wsUrl,
      sandbox,
      onMessage: (msg) => onMessageRef.current(msg),
      onStatus: (status, detail) => onStatusRef.current(status, detail),
    });
    clientRef.current = client;
    client.connect();
    return () => {
      client.close();
      clientRef.current = null;
    };
  }, [sandbox, wsUrl]);

  const send = useCallback((msg: Json) => {
    clientRef.current?.send(msg);
  }, []);

  const request = useCallback((msg: Json) => {
    const client = clientRef.current;
    if (!client) return Promise.resolve<Json>({ type: "response", command: String(msg.type), success: false, error: "no client" });
    return client.request(msg);
  }, []);

  const getClient = useCallback(() => clientRef.current, []);

  return { wsUrl, send, request, getClient };
}
