import { useEffect, useMemo, useRef } from "react";
import { KeyRound, Terminal as TerminalIcon } from "lucide-react";
import type { AgentDescriptor, AgentId } from "@beamhop/acp-protocol";
import { useAcp, useAgentLogin, useAuthMethods } from "@beamhop/acp-ui";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog.js";
import { Button } from "./ui/button.js";

export function AuthDialog({
  open,
  agent,
  onClose,
}: {
  open: boolean;
  agent: AgentDescriptor | null;
  onClose: () => void;
}) {
  if (!open || !agent) return null;
  const kind = agent.login ?? "none";
  return (
    <Dialog open={open}>
      <DialogContent>
        <div className="p-5">
          <div className="flex items-baseline gap-2">
            {kind === "tty" ? (
              <TerminalIcon className="h-3.5 w-3.5 text-amber translate-y-0.5" />
            ) : (
              <KeyRound className="h-3.5 w-3.5 text-amber translate-y-0.5" />
            )}
            <DialogTitle>authenticate · {agent.label}</DialogTitle>
          </div>
          {kind === "acp_native" ? (
            <NativeAuthPanel agentId={agent.id} onClose={onClose} />
          ) : kind === "tty" ? (
            <TtyAuthPanel agentId={agent.id} onClose={onClose} />
          ) : (
            <NoAuthPanel onClose={onClose} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NativeAuthPanel({ agentId, onClose }: { agentId: AgentId; onClose: () => void }) {
  const session = useAcp();
  const { methods, isAuthenticating, error, selectMethod } = useAuthMethods();
  const hasMethods = methods.length > 0;

  const handlePick = async (methodId: string) => {
    try {
      await selectMethod(methodId);
      // Re-spawn so the agent picks up the new credentials from disk.
      await session.switchAgent(agentId);
      onClose();
    } catch {
      // error state is already surfaced by the hook
    }
  };

  return (
    <>
      <DialogDescription className="mt-4">
        the agent advertised{" "}
        <span className="text-paper">{methods.length}</span> auth method
        {methods.length === 1 ? "" : "s"} via ACP. pick one to authenticate.
      </DialogDescription>
      {!hasMethods && (
        <div className="mt-4 text-[11px] text-fog leading-relaxed">
          no methods advertised. the agent may already be authenticated, or it
          may require out-of-band setup.
        </div>
      )}
      <div className="mt-4 flex flex-col gap-2">
        {methods.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => handlePick(m.id)}
            disabled={isAuthenticating}
            className="text-left px-3 py-2 border border-rule-soft bg-ink-2 hover:bg-ink-1 disabled:opacity-50"
          >
            <div className="text-[12px] text-paper">{m.name}</div>
            {m.description && (
              <div className="text-[10px] text-fog mt-0.5">{m.description}</div>
            )}
            <div className="text-[9px] uppercase tracking-[0.18em] text-fog mt-1">
              id · {m.id}
            </div>
          </button>
        ))}
      </div>
      {error && (
        <div className="mt-4 text-[11px] text-rust leading-relaxed">
          {error.message}
        </div>
      )}
      <div className="mt-5 flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          close
        </Button>
      </div>
    </>
  );
}

function TtyAuthPanel({ agentId, onClose }: { agentId: AgentId; onClose: () => void }) {
  const login = useAgentLogin();
  const inputRef = useRef<HTMLInputElement>(null);
  const outRef = useRef<HTMLPreElement>(null);

  // Start the PTY login on mount; cancel on unmount happens automatically.
  useEffect(() => {
    void login.start(agentId).catch(() => void 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  // Autoscroll the output pane as new data arrives.
  useEffect(() => {
    const el = outRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [login.output]);

  const submit = () => {
    const el = inputRef.current;
    if (!el) return;
    login.write(el.value + "\n");
    el.value = "";
  };

  const statusLabel = useMemo(() => {
    if (login.status === "starting") return "starting…";
    if (login.status === "open") return "live · type and hit enter";
    if (login.status === "closed")
      return `closed · ${login.exitInfo?.reason ?? "exit"}`;
    return "idle";
  }, [login.status, login.exitInfo]);

  return (
    <>
      <DialogDescription className="mt-4">
        this agent's login runs as a separate process. complete the flow below
        and the agent will pick up the credentials on its next spawn.
      </DialogDescription>
      <pre
        ref={outRef}
        className="mt-4 px-3 py-2 bg-ink-2 border border-rule-soft text-[11px] text-bone leading-relaxed overflow-auto h-[280px] whitespace-pre-wrap"
      >
        {login.output || (login.status === "starting" ? "starting…\n" : "")}
      </pre>
      <div className="mt-3 flex items-center gap-2">
        <span className="text-[9px] uppercase tracking-[0.18em] text-fog whitespace-nowrap">
          {statusLabel}
        </span>
        <input
          ref={inputRef}
          type="text"
          disabled={login.status !== "open"}
          placeholder={login.status === "open" ? "type and press enter" : ""}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          className="flex-1 bg-ink border border-rule-soft px-2 py-1 text-[11px] text-paper outline-none focus:border-amber disabled:opacity-50"
        />
      </div>
      {login.error && (
        <div className="mt-3 text-[11px] text-rust leading-relaxed">
          {login.error.message}
        </div>
      )}
      <div className="mt-5 flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void login.cancel().then(onClose)}
        >
          {login.status === "closed" ? "close" : "cancel"}
        </Button>
      </div>
    </>
  );
}

function NoAuthPanel({ onClose }: { onClose: () => void }) {
  return (
    <>
      <DialogDescription className="mt-4">
        this agent doesn't expose a browser-driven login. it expects
        credentials to be provided out-of-band (env var, API key file, etc.).
      </DialogDescription>
      <div className="mt-5 flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          close
        </Button>
      </div>
    </>
  );
}
