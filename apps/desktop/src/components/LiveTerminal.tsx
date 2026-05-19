import { useEffect, useRef } from "react";
import { Terminal, useTerminal } from "@wterm/react";
import type {
  SidecarApi,
  SidecarClient,
} from "../lib/sidecar-client.ts";

const RESIZE_DEBOUNCE_MS = 120;

/**
 * Local terminal pane for a sandbox session. Subscribes to the sidecar's
 * terminal stream and forwards keystrokes back via terminal.write RPC.
 */
export function LiveTerminal({
  api,
  client,
  sessionId,
  active,
}: {
  api: SidecarApi;
  client: SidecarClient;
  sessionId: string;
  active: boolean;
}) {
  const term = useTerminal();
  const subIdRef = useRef<string | null>(null);
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentRef = useRef<{ cols: number; rows: number } | null>(null);
  const dimsRef = useRef<{ cols: number; rows: number } | null>(null);
  const subscribedRef = useRef(false);

  // wterm's textarea blurs when the pane container toggles `hidden`. The
  // browser does not refocus it on the way back, so keystrokes would land on
  // the document body until the user clicks. Refocus on every activation;
  // also covers the initial-mount case when this session is active on first
  // render.
  useEffect(() => {
    if (active) term.focus();
  }, [active, term]);

  // Subscribe lazily, once we know the wterm's real dimensions. The guest
  // PTY is spawned with the initial cols/rows we pass here — sending 120×32
  // or some hardcoded guess produces tiny-window rendering for TUIs like
  // opencode that don't track later resizes (microsandbox doesn't expose
  // winsize control post-spawn).
  const ensureSubscribed = (cols: number, rows: number) => {
    if (subscribedRef.current) return;
    subscribedRef.current = true;
    void (async () => {
      try {
        const { subId } = await api.subscribeTerminal(sessionId, cols, rows);
        subIdRef.current = subId;
      } catch (err) {
        console.error("[live-terminal] subscribe failed", err);
        subscribedRef.current = false;
      }
    })();
  };

  useEffect(() => {
    const offData = client.on("terminal:data", (d) => {
      if (d.subId !== subIdRef.current) return;
      const bin = atob(d.bytes);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      term.write(u8);
    });

    return () => {
      offData();
      if (resizeTimerRef.current) {
        clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = null;
      }
      lastSentRef.current = null;
      dimsRef.current = null;
      const id = subIdRef.current;
      subIdRef.current = null;
      subscribedRef.current = false;
      if (id) void api.unsubscribe(id).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Debounce onResize so the WTerm observer's per-frame oscillation doesn't
  // hammer the PTY. Resizing the PTY repaints the shell, which feeds back
  // into layout — leading to a visible blink and lost focus.
  const handleResize = (cols: number, rows: number) => {
    // Hidden panes (the LivePane mounts every session and toggles `hidden`
    // on the inactive ones) measure as 0×0. Resizing the PTY to that would
    // wreck the guest TUI for the user on the active tab and on every other
    // peer. Drop the event entirely until the pane is visible again.
    if (cols < 2 || rows < 2) return;
    dimsRef.current = { cols, rows };
    // First non-zero resize doubles as our "we know the size" trigger.
    ensureSubscribed(cols, rows);
    if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
    resizeTimerRef.current = setTimeout(() => {
      resizeTimerRef.current = null;
      const last = lastSentRef.current;
      if (last && last.cols === cols && last.rows === rows) return;
      lastSentRef.current = { cols, rows };
      void api.terminalResize(sessionId, cols, rows);
    }, RESIZE_DEBOUNCE_MS);
  };

  return (
    <div className="flex-1 min-h-0 min-w-0 grid grid-cols-1 grid-rows-1">
      <Terminal
        ref={term.ref}
        autoResize
        cursorBlink
        onData={(d) => void api.terminalWrite(sessionId, d)}
        onResize={handleResize}
        className="wterm-amber"
        style={{ minHeight: 0, minWidth: 0 }}
      />
    </div>
  );
}
