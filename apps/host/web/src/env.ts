/**
 * Host-vs-Guest runtime detection.
 *
 * The same web bundle runs in two very different contexts:
 *
 *   - **Host**: served by the Bun host (`server.ts`) over http(s), or inside
 *     the Tauri webview talking to the local sidecar. A `/rpc` WebSocket to a
 *     local pi/sandbox is reachable → the full single-player + sharing UI.
 *   - **Guest**: the static SPA build (`dist-spa`) deployed to any static host.
 *     There is no local host process and no `/rpc` endpoint → join-only UI.
 *
 * We can't know for sure without trying, so we probe the `/rpc` WebSocket once
 * on load. `guessHostContext()` gives a synchronous first-paint guess from the
 * URL; `probeHostContext()` resolves the authoritative answer.
 */
import type { Json, RpcStatus } from "./rpc/client";

export type AppContext = "host" | "guest";

/**
 * Derive the /rpc WebSocket URL from the current origin. Served over http(s)
 * the Bun host owns both the page and /rpc, so a same-origin relative URL is
 * correct. The Tauri webview serves from `tauri://localhost` (no host:port),
 * so there we hit the known sidecar port. Returns null when there is no
 * plausible local host to reach (used to short-circuit Guest detection).
 */
export function rpcUrl(): string | null {
  const proto = window.location.protocol;
  if (proto === "http:" || proto === "https:") {
    return (proto === "https:" ? "wss://" : "ws://") + window.location.host + "/rpc";
  }
  if (proto === "tauri:") {
    // Tauri webview → local sidecar host on its known port.
    return "ws://127.0.0.1:5179/rpc";
  }
  // file:// or anything else: no local host to talk to → Guest.
  return null;
}

/**
 * Synchronous first-paint guess. A `tauri:` origin is always a Host. Otherwise
 * we don't know until the probe completes, so we optimistically guess Host for
 * http(s) (the dev/desktop case) and Guest only when there's no rpc URL at all.
 * The async probe corrects this.
 */
export function guessHostContext(): AppContext {
  return rpcUrl() ? "host" : "guest";
}

/**
 * Authoritative probe: try to open the /rpc WebSocket. If it opens we're a
 * Host; if it errors/times out/closes (or there's no URL), we're a Guest. The
 * probe socket is closed immediately — the app opens its own once a sandbox is
 * chosen.
 */
export function probeHostContext(timeoutMs = 2500): Promise<AppContext> {
  const url = rpcUrl();
  if (!url) return Promise.resolve("guest");
  return new Promise<AppContext>((resolve) => {
    let settled = false;
    let ws: WebSocket;
    const done = (ctx: AppContext) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.onopen = ws.onerror = ws.onclose = null;
        ws.close();
      } catch {
        /* ignore */
      }
      resolve(ctx);
    };
    const timer = setTimeout(() => done("guest"), timeoutMs);
    try {
      ws = new WebSocket(url);
    } catch {
      done("guest");
      return;
    }
    ws.onopen = () => done("host");
    ws.onerror = () => done("guest");
    ws.onclose = () => done("guest");
  });
}

// Re-export so callers importing from a single place stay consistent.
export type { Json, RpcStatus };
