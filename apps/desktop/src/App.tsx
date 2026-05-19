import { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  createSidecarClient,
  discoverPort,
  type SidecarApi,
  type SidecarClient,
  type SidecarEvent,
} from "./lib/sidecar-client.ts";
import type {
  AgentView,
  SandboxView,
  SessionView,
} from "../sidecar/protocol.ts";
import { SandboxesPanel } from "./components/SandboxesPanel.tsx";
import { SessionsPanel } from "./components/SessionsPanel.tsx";
import { LivePane } from "./components/LivePane.tsx";
import { BootScreen } from "./components/BootScreen.tsx";
import { TopBar } from "./components/TopBar.tsx";

type SidecarState =
  | { kind: "discovering" }
  | { kind: "no-port"; hint: string }
  | { kind: "connecting"; port: number; client: SidecarClient; api: SidecarApi }
  | { kind: "ready"; port: number; client: SidecarClient; api: SidecarApi }
  | { kind: "failed"; error: string };

export function App() {
  const [sidecar, setSidecar] = useState<SidecarState>({ kind: "discovering" });
  const [sandboxes, setSandboxes] = useState<SandboxView[]>([]);
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [agents, setAgents] = useState<AgentView[]>([]);
  const [shares, setShares] = useState<Map<string, ShareInfo>>(new Map());
  const [activeSandboxId, setActiveSandboxId] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // -- bootstrap connection --
  useEffect(() => {
    const port = discoverPort();
    if (!port) {
      setSidecar({
        kind: "no-port",
        hint: "no sidecar port in window or query. Start `bun run dev:sidecar` and pass ?sidecarPort=N, or run inside Tauri.",
      });
      return;
    }
    const client = createSidecarClient(port);
    const a = api(client);
    setSidecar({ kind: "connecting", port, client, api: a });

    const refresh = async () => {
      try {
        const [sb, ss, ag] = await Promise.all([
          a.listSandboxes(),
          a.listSessions(),
          a.listAgents(),
        ]);
        setSandboxes(sb);
        setSessions(ss);
        setAgents(ag);
        setSidecar({ kind: "ready", port, client, api: a });
      } catch (err) {
        setSidecar({
          kind: "failed",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };
    void refresh();

    // External sandboxes (created by `msb run`, prior sidecar runs, etc.) do
    // not emit sandbox:created/closed. Poll every 3s so the panel reflects
    // disk reality even when nothing happens on the event channel. Status
    // transitions (running → crashed) also flow through here.
    const pollId = setInterval(async () => {
      try {
        const sb = await a.listSandboxes();
        setSandboxes(sb);
      } catch {
        // Ignore transient list failures; the next tick will retry. If the
        // sidecar is truly gone, the WS handler surfaces it.
      }
    }, 3000);

    const offs = [
      client.on("sandbox:created", (s) =>
        setSandboxes((cur) => upsert(cur, s, (x) => x.id)),
      ),
      client.on("sandbox:closed", (s) =>
        setSandboxes((cur) => cur.filter((x) => x.id !== s.id)),
      ),
      client.on("session:created", (s) => {
        setSessions((cur) => upsert(cur, s, (x) => x.id));
        // Auto-focus the just-created session. Without this, a user who
        // clicks "+ terminal" stares at a blank pane and has to know to
        // click the new row in the sidebar before they can type — which
        // confused at least one user enough to file it as a typing bug.
        setActiveSessionId(s.id);
      }),
      client.on("session:closed", (s) =>
        setSessions((cur) => cur.filter((x) => x.id !== s.id)),
      ),
      client.on("share:state-changed", (d) => {
        setShares((cur) => {
          const next = new Map(cur);
          if ("shared" in d && d.shared === false) {
            next.delete(d.sessionId);
          } else if ("roomId" in d) {
            next.set(d.sessionId, {
              roomId: d.roomId,
              token: d.token,
              hostPeerId: d.hostPeerId,
              kind: d.kind,
              peers: d.peers,
            });
          }
          return next;
        });
      }),
    ];
    return () => {
      clearInterval(pollId);
      offs.forEach((off) => off());
      client.close();
    };
  }, []);

  // -- auto-select first sandbox/session as they arrive --
  useEffect(() => {
    if (!activeSandboxId && sandboxes[0]) setActiveSandboxId(sandboxes[0].id);
    if (
      activeSandboxId &&
      !sandboxes.find((s) => s.id === activeSandboxId)
    ) {
      setActiveSandboxId(sandboxes[0]?.id ?? null);
    }
  }, [sandboxes, activeSandboxId]);

  useEffect(() => {
    const inActive = sessions.filter((s) => s.sandboxId === activeSandboxId);
    if (!activeSessionId && inActive[0]) setActiveSessionId(inActive[0].id);
    if (
      activeSessionId &&
      !inActive.find((s) => s.id === activeSessionId)
    ) {
      setActiveSessionId(inActive[0]?.id ?? null);
    }
  }, [sessions, activeSandboxId, activeSessionId]);

  if (sidecar.kind !== "ready" && sidecar.kind !== "connecting") {
    return <BootScreen state={sidecar} />;
  }

  const activeSandbox = sandboxes.find((s) => s.id === activeSandboxId) ?? null;
  const sessionsInSandbox = sessions.filter(
    (s) => s.sandboxId === activeSandboxId,
  );

  return (
    <div className="h-screen flex flex-col">
      <TopBar
        sandboxCount={sandboxes.length}
        sessionCount={sessions.length}
        shareCount={shares.size}
        connected={sidecar.kind === "ready"}
      />
      <div className="flex-1 grid grid-cols-[18rem_18rem_1fr] min-h-0">
        <SandboxesPanel
          api={sidecar.api}
          client={sidecar.client}
          sandboxes={sandboxes}
          activeId={activeSandboxId}
          onSelect={setActiveSandboxId}
        />
        <SessionsPanel
          api={sidecar.api}
          agents={agents}
          sandbox={activeSandbox}
          sessions={sessionsInSandbox}
          activeId={activeSessionId}
          shares={shares}
          onSelect={setActiveSessionId}
        />
        <LivePane
          api={sidecar.api}
          client={sidecar.client}
          sessions={sessions}
          activeId={activeSessionId}
          shares={shares}
        />
      </div>
    </div>
  );
}

export interface ShareInfo {
  roomId: string;
  token: string;
  hostPeerId: string;
  kind: "terminal" | "agent";
  peers: string[];
}

function upsert<T>(list: T[], item: T, key: (x: T) => string): T[] {
  const id = key(item);
  const idx = list.findIndex((x) => key(x) === id);
  if (idx < 0) return [...list, item];
  const next = list.slice();
  next[idx] = item;
  return next;
}

// Re-exports used by panels — kept here so the App owns the SidecarEvent
// surface and panels stay decoupled from the lib module.
export type { SidecarEvent };
