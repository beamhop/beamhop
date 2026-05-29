import { useEffect, useMemo, useRef, useState } from "react";
import {
  SandboxPickerMachine,
  type PickerState,
  type SandboxInfo,
} from "./sandboxPicker";

export type { SandboxInfo };

export interface SandboxPromptProps {
  /** WebSocket URL the picker uses to ask the host for `list_sandboxes`. */
  wsUrl: string;
  /** Hint shown in the manual-entry field. */
  initial?: string;
  onSubmit: (name: string) => void;
  /** Optional: dismiss when this is a "switch" prompt rather than first-run. */
  onCancel?: () => void;
}

export function SandboxPrompt({
  wsUrl,
  initial = "",
  onSubmit,
  onCancel,
}: SandboxPromptProps) {
  const [state, setState] = useState<PickerState>({ kind: "loading" });
  const [manual, setManual] = useState(initial);
  const wsRef = useRef<WebSocket | null>(null);

  // Open a short-lived WS just to ask for the sandbox list. The main app
  // will open its own connection once the user picks one — we deliberately
  // don't share the socket because the main client expects `hello` early.
  useEffect(() => {
    let cancelled = false;
    // The machine owns the success/error/close ordering (and the "first
    // resolution wins" latch). The `close` we issue ourselves after a
    // successful response is a no-op there, so it can't clobber the result.
    const machine = new SandboxPickerMachine();
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    const apply = ({ state: next, close }: ReturnType<SandboxPickerMachine["onMessage"]>) => {
      if (!cancelled && next) setState(next);
      if (close) ws.close();
    };

    ws.addEventListener("open", () => {
      ws.send(SandboxPickerMachine.LIST_REQUEST);
    });
    ws.addEventListener("message", (e) => apply(machine.onMessage(e.data)));
    ws.addEventListener("error", () => apply(machine.onError()));
    ws.addEventListener("close", (e) => apply(machine.onClose(e.reason)));

    return () => {
      cancelled = true;
      ws.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsUrl]);

  const sorted = useMemo(() => {
    if (state.kind !== "ready") return [];
    // Running first, then stopped, then everything else; stable name sort within.
    const rank = (s: string) =>
      s === "running" ? 0 : s === "stopped" ? 1 : s === "draining" ? 2 : 3;
    return [...state.sandboxes].sort(
      (a, b) => rank(a.status) - rank(b.status) || a.name.localeCompare(b.name),
    );
  }, [state]);

  const pick = (name: string) => {
    const v = name.trim();
    if (!v) return;
    onSubmit(v);
  };

  return (
    <div className="dialogscrim" data-testid="sandbox-prompt">
      <div className="dialog" style={{ animation: "fadeup .2s ease both" }}>
        <div className="dialoghdr">
          <span
            className="extbadge mono"
            style={{ color: "var(--accent)", background: "var(--accent-bg)" }}
          >
            sandbox picker
          </span>
          <span className="dialogmethod mono">microsandbox</span>
        </div>
        <div className="dialogtitle">Pick a running sandbox</div>
        <div className="dialogmsg mono">
          beamhop attaches to an existing microsandbox and runs{" "}
          <code>pi --mode rpc</code> inside it. It will not start or stop
          the sandbox itself.
        </div>

        {state.kind === "loading" && (
          <div
            className="dialogmsg mono"
            style={{ opacity: 0.7 }}
            data-testid="sandbox-list-loading"
          >
            Loading…
          </div>
        )}

        {state.kind === "error" && (
          <div
            className="dialogmsg mono"
            style={{ color: "var(--danger, #d33)" }}
            data-testid="sandbox-list-error"
          >
            Could not list sandboxes: {state.message}
          </div>
        )}

        {state.kind === "ready" && sorted.length === 0 && (
          <div
            className="dialogmsg mono"
            style={{ opacity: 0.7 }}
            data-testid="sandbox-list-empty"
          >
            No sandboxes found. Start one with{" "}
            <code>msb sandbox start &lt;name&gt;</code>, then pick it below.
          </div>
        )}

        {state.kind === "ready" && sorted.length > 0 && (
          <div
            className="sandboxlist"
            data-testid="sandbox-list"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              maxHeight: 240,
              overflow: "auto",
              padding: "4px 0",
            }}
          >
            {sorted.map((s) => {
              const isRunning = s.status === "running";
              return (
                <button
                  key={s.name}
                  className="dlgbtn"
                  onClick={() => pick(s.name)}
                  disabled={!isRunning}
                  data-testid={`sandbox-option-${s.name}`}
                  title={isRunning ? `Attach to "${s.name}"` : `Sandbox is ${s.status}`}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    width: "100%",
                    opacity: isRunning ? 1 : 0.55,
                    cursor: isRunning ? "pointer" : "not-allowed",
                  }}
                >
                  <span className="mono">{s.name}</span>
                  <span
                    className="mono extbadge"
                    style={{
                      fontSize: 11,
                      background: isRunning
                        ? "var(--accent-bg, #234)"
                        : "var(--muted-bg, #333)",
                      color: isRunning ? "var(--accent, #6cf)" : "var(--muted, #aaa)",
                    }}
                  >
                    {s.status}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div
          className="dialoginput"
          style={{ marginTop: 12, flexDirection: "column", gap: 6, alignItems: "stretch" }}
        >
          <span className="mono" style={{ fontSize: 11, opacity: 0.6 }}>
            …or attach by name
          </span>
          <div className="dialoginput" style={{ marginTop: 0 }}>
            <input
              className="dlgfield mono"
              placeholder="e.g. my-dev-box"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") pick(manual);
              }}
              data-testid="sandbox-input"
            />
            <button
              className="dlgbtn primary"
              onClick={() => pick(manual)}
              disabled={!manual.trim()}
              data-testid="sandbox-submit"
            >
              Attach <span className="kbd mono">⏎</span>
            </button>
          </div>
        </div>

        {onCancel && (
          <div style={{ marginTop: 10, textAlign: "right" }}>
            <button
              className="dlgbtn"
              onClick={onCancel}
              data-testid="sandbox-cancel"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
