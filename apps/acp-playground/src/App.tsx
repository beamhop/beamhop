import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AcpSession } from "@beamhop/acp-client";
import { AcpProvider, useAcp, useAcpSession, usePermissionPrompts } from "@beamhop/acp-ui";
import type { AgentDescriptor, AgentId } from "@beamhop/acp-protocol";
import { openSession } from "./lib/connection.js";
import { HeaderBar } from "./components/HeaderBar.js";
import { AgentRegistry } from "./components/AgentRegistry.js";
import { ChatPanel } from "./components/ChatPanel.js";
import { LogDrawer } from "./components/LogDrawer.js";
import { PermissionDialog } from "./components/PermissionDialog.js";
import { AuthDialog } from "./components/AuthDialog.js";

export function App() {
  const [agent, setAgent] = useState<AgentId>("claude-code" as AgentId);
  const [session, setSession] = useState<AcpSession | null>(null);
  const [switching, setSwitching] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const permPrompts = usePermissionPrompts();
  const sessionRef = useRef<AcpSession | null>(null);

  // Open the initial session.
  // IMPORTANT under React 19 StrictMode: the effect runs → cleanup → effect runs
  // again. We must close ONLY the session that *this* effect run opened, not
  // whatever the shared ref last pointed to (that's how we ended up holding a
  // stale session whose `availableCommands` was never populated).
  useEffect(() => {
    let cancelled = false;
    let owned: AcpSession | null = null;
    void (async () => {
      try {
        const s = await openSession({
          agent,
          onPermissionRequest: permPrompts.install,
        });
        if (cancelled) {
          await s.close();
          return;
        }
        owned = s;
        sessionRef.current = s;
        setSession(s);
      } catch (err) {
        setFatalError((err as Error).message ?? String(err));
      }
    })();
    return () => {
      cancelled = true;
      // Close only the session this effect run owns.
      if (owned) {
        void owned.close();
        if (sessionRef.current === owned) sessionRef.current = null;
      }
    };
    // initial open only — switching is handled via session.switchAgent below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePick = useCallback(
    async (id: AgentId) => {
      if (!session || id === agent || switching) return;
      setSwitching(true);
      setAgent(id);
      try {
        await session.switchAgent(id);
      } catch (err) {
        setFatalError((err as Error).message ?? String(err));
      } finally {
        setSwitching(false);
      }
    },
    [session, agent, switching],
  );

  if (!session) {
    return <BootScreen error={fatalError} />;
  }

  return (
    <AcpProvider session={session}>
      <Shell
        agent={agent}
        switching={switching}
        onPick={handlePick}
        permPrompts={permPrompts}
      />
    </AcpProvider>
  );
}

function Shell({
  agent,
  switching,
  onPick,
  permPrompts,
}: {
  agent: AgentId;
  switching: boolean;
  onPick: (id: AgentId) => void;
  permPrompts: ReturnType<typeof usePermissionPrompts>;
}) {
  // After the provider mounts these read from context.
  const session = useAcp();
  const state = useAcpSession({ maxLogs: 500 });
  const [authTarget, setAuthTarget] = useState<AgentDescriptor | null>(null);

  // Open the auth dialog automatically when the agent rejects a call with
  // auth_required — saves the user a manual click. Only if there isn't one
  // open already (don't clobber an in-flight TTY login).
  useEffect(() => {
    const off = session.on("auth_required", () => {
      if (authTarget) return;
      const current = state.availableAgents.find((a) => a.id === agent);
      if (current) setAuthTarget(current);
    });
    return off;
  }, [session, agent, state.availableAgents, authTarget]);

  // Derive the active agent's label from the server-supplied list so the UI
  // always agrees with the gateway's registry.
  const agentLabel = useMemo(() => {
    const match = state.availableAgents.find((a) => a.id === agent);
    return match?.label ?? String(agent);
  }, [state.availableAgents, agent]);

  return (
    <div className="h-screen w-screen flex flex-col bg-ink text-paper">
      <HeaderBar
        status={state.status}
        sessionId={state.sessionId}
        agentId={agentLabel}
        latencyMs={null}
      />

      <div className="flex-1 flex min-h-0">
        <AgentRegistry
          agents={state.availableAgents}
          current={agent}
          switching={switching}
          onPick={onPick}
          onAuth={(descriptor) => setAuthTarget(descriptor)}
        />
        <ChatPanel session={session} agentLabel={agentLabel} />
        <LogDrawer logs={state.logs} lastError={state.lastError} />
      </div>

      <PermissionDialog
        pending={permPrompts.pending}
        respond={permPrompts.respond}
      />
      <AuthDialog
        open={authTarget !== null}
        agent={authTarget}
        onClose={() => setAuthTarget(null)}
      />
    </div>
  );
}

function BootScreen({ error }: { error: string | null }) {
  return (
    <div className="h-screen w-screen grid place-items-center bg-ink text-paper">
      <div className="text-center space-y-3 max-w-[56ch]">
        <div className="font-display text-[28px] leading-tight">
          {error ? "boot failed." : "establishing telemetry…"}
        </div>
        {error ? (
          <div className="text-[12px] text-rust leading-relaxed">{error}</div>
        ) : (
          <div className="flex items-center justify-center gap-2 text-amber">
            <span className="dot dot-pulse" />
            <span className="text-[10px] uppercase tracking-[0.2em]">opening websocket</span>
          </div>
        )}
      </div>
    </div>
  );
}
