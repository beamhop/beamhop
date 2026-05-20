import { useState } from "react";
import { encode } from "@beamhop/invite-link";
import type {
  AgentView,
  BuildView,
  SandboxView,
  SessionView,
} from "../../sidecar/protocol.ts";
import type { SidecarApi } from "../lib/sidecar-client.ts";
import type { ShareInfo } from "../App.tsx";

export function SessionsPanel({
  api,
  agents,
  sandbox,
  building,
  sessions,
  activeId,
  shares,
  onSelect,
}: {
  api: SidecarApi;
  agents: AgentView[];
  sandbox: SandboxView | null;
  building?: BuildView | null;
  sessions: SessionView[];
  activeId: string | null;
  shares: Map<string, ShareInfo>;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className="border-r border-[var(--color-ink)]/15 bg-[var(--color-paper)] flex flex-col min-h-0">
      <Header>sessions</Header>
      {building ? (
        <BuildingState build={building} />
      ) : !sandbox ? (
        <Empty
          title="no sandbox selected"
          detail="pick a sandbox on the left to manage its sessions"
        />
      ) : (
        <>
          <div className="px-4 py-3 border-b border-[var(--color-ink)]/10 bg-[var(--color-paper-deep)]">
            <div
              className="text-[10px] uppercase tracking-[0.3em] text-[var(--color-rust)]"
              style={{ fontFamily: "var(--font-body)" }}
            >
              active
            </div>
            <div
              className="text-sm truncate"
              style={{ fontFamily: "var(--font-body)" }}
            >
              {sandbox.imageTag}
            </div>
            <div
              className="text-[10px] text-[var(--color-ash)]"
              style={{ fontFamily: "var(--font-body)" }}
            >
              {sandbox.id}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {sessions.length === 0 && (
              <div
                className="px-3 py-6 text-center text-[var(--color-ash)] text-xs"
                style={{ fontFamily: "var(--font-body)" }}
              >
                no sessions in this sandbox yet
              </div>
            )}
            {sessions.map((s) => (
              <SessionRow
                key={s.id}
                api={api}
                session={s}
                active={s.id === activeId}
                share={shares.get(s.id) ?? null}
                onSelect={() => onSelect(s.id)}
              />
            ))}
          </div>
          <div className="border-t border-[var(--color-ink)]/15 p-3 space-y-2 bg-[var(--color-paper-deep)]">
            <button
              onClick={() => void api.startTerminal(sandbox.id)}
              className="w-full text-xs uppercase tracking-[0.25em] px-3 py-2 bg-[var(--color-ink)] text-[var(--color-paper)] hover:bg-[var(--color-amber)] hover:text-[var(--color-ink)] transition-colors"
              style={{ fontFamily: "var(--font-body)" }}
              data-testid="start-terminal"
            >
              + terminal
            </button>
            <AgentLauncher api={api} sandboxId={sandbox.id} agents={agents} />
          </div>
        </>
      )}
    </aside>
  );
}

function SessionRow({
  api,
  session,
  active,
  share,
  onSelect,
}: {
  api: SidecarApi;
  session: SessionView;
  active: boolean;
  share: ShareInfo | null;
  onSelect: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const toggleShare = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await api.toggleShare(session.id, !share);
  };

  const closeSession = async (e: React.MouseEvent) => {
    e.stopPropagation();
    // closeSession handles unshare + PTY kill server-side and emits
    // session:closed, which App.tsx listens to. No optimistic UI needed.
    await api.closeSession(session.id);
  };

  const copyLink = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!share) return;
    const fragment = encode({
      kind: share.kind,
      room: share.roomId,
      token: share.token,
      hostPeerId: share.hostPeerId || undefined,
    });
    // Default to the local joiner during dev — production rewrites this.
    const url = `http://localhost:5174/${fragment}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked — fall back to a temporary textarea
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } finally {
        document.body.removeChild(ta);
      }
    }
  };

  return (
    <div
      className={`px-3 py-2 cursor-pointer ${
        active
          ? "bg-[var(--color-ink)] text-[var(--color-paper)]"
          : "hover:bg-[var(--color-paper-deep)]"
      }`}
      onClick={onSelect}
      data-testid={`session-${session.id}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`text-[9px] uppercase tracking-[0.2em] px-1.5 py-0.5 ${
                session.kind === "terminal"
                  ? "bg-[var(--color-moss)]/30 text-[var(--color-moss)]"
                  : "bg-[var(--color-amber)]/30 text-[var(--color-rust)]"
              } ${active ? "ring-1 ring-[var(--color-paper)]/30" : ""}`}
              style={{ fontFamily: "var(--font-body)" }}
            >
              {session.kind}
              {session.kind === "agent" && session.agentId ? ` · ${session.agentId}` : ""}
            </span>
          </div>
          <div
            className={`text-[10px] mt-1 truncate ${
              active ? "text-[var(--color-paper)]/60" : "text-[var(--color-ash)]"
            }`}
            style={{ fontFamily: "var(--font-body)" }}
          >
            {session.id}
          </div>
        </div>
        <button
          type="button"
          onClick={closeSession}
          aria-label={`close session ${session.id}`}
          title="close session"
          className={`shrink-0 w-6 h-6 leading-none text-base flex items-center justify-center ${
            active
              ? "text-[var(--color-paper)]/60 hover:text-[#fecaca]"
              : "text-[var(--color-ash)] hover:text-[#7f1d1d]"
          }`}
          style={{ fontFamily: "var(--font-body)" }}
          data-testid="close-session"
        >
          ×
        </button>
      </div>

      <div className="flex items-center gap-2 mt-2">
        <ToggleSwitch on={Boolean(share)} onClick={toggleShare} />
        <span
          className={`text-[9px] uppercase tracking-[0.2em] flex-1 ${
            active ? "text-[var(--color-paper)]/70" : "text-[var(--color-ash)]"
          }`}
          style={{ fontFamily: "var(--font-body)" }}
        >
          {share ? `public · ${share.peers.length} peer(s)` : "private"}
        </span>
        {share && (
          <button
            onClick={copyLink}
            className={`text-[9px] uppercase tracking-[0.25em] px-2 py-1 ${
              active
                ? "bg-[var(--color-amber)] text-[var(--color-ink)]"
                : "bg-[var(--color-amber)] text-[var(--color-ink)] hover:bg-[var(--color-amber-bright)]"
            }`}
            style={{ fontFamily: "var(--font-body)" }}
            data-testid="copy-link"
          >
            {copied ? "copied!" : "copy link"}
          </button>
        )}
      </div>
    </div>
  );
}

function ToggleSwitch({
  on,
  onClick,
}: {
  on: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative h-4 w-7 rounded-full transition-colors ${
        on ? "bg-[#16a34a]" : "bg-[var(--color-ink)]/30"
      }`}
      role="switch"
      aria-checked={on}
      data-testid="share-toggle"
    >
      <span
        className={`absolute top-0.5 h-3 w-3 rounded-full bg-[var(--color-paper)] transition-transform ${
          on ? "translate-x-3.5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function AgentLauncher({
  api,
  sandboxId,
  agents,
}: {
  api: SidecarApi;
  sandboxId: string;
  agents: AgentView[];
}) {
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  if (agents.length === 0) {
    return (
      <div
        className="text-[10px] text-[var(--color-ash)] text-center"
        style={{ fontFamily: "var(--font-body)" }}
      >
        no agents registered
      </div>
    );
  }
  return (
    <div className="flex gap-2">
      <select
        value={agentId}
        onChange={(e) => setAgentId(e.target.value)}
        className="flex-1 bg-[var(--color-paper)] border border-[var(--color-ink)]/30 px-2 text-xs"
        style={{ fontFamily: "var(--font-body)" }}
        data-testid="agent-picker"
      >
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
          </option>
        ))}
      </select>
      <button
        onClick={() => agentId && void api.startAgent(sandboxId, agentId)}
        disabled={!agentId}
        className="text-xs uppercase tracking-[0.25em] px-3 py-2 bg-[var(--color-ink)] text-[var(--color-paper)] hover:bg-[var(--color-amber)] hover:text-[var(--color-ink)] disabled:opacity-50 transition-colors"
        style={{ fontFamily: "var(--font-body)" }}
        data-testid="start-agent"
      >
        + agent
      </button>
    </div>
  );
}

function Header({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 py-3 border-b border-[var(--color-ink)]/15">
      <span
        className="text-[10px] uppercase tracking-[0.3em] text-[var(--color-rust)]"
        style={{ fontFamily: "var(--font-body)" }}
      >
        {children}
      </span>
    </div>
  );
}

function BuildingState({ build }: { build: BuildView }) {
  return (
    <>
      <div className="px-4 py-3 border-b border-[var(--color-ink)]/10 bg-[var(--color-paper-deep)]">
        <div
          className="text-[10px] uppercase tracking-[0.3em] text-[var(--color-rust)] flex items-center gap-2"
          style={{ fontFamily: "var(--font-body)" }}
        >
          <span aria-hidden className="animate-pulse">
            ●
          </span>
          building
        </div>
        <div
          className="text-sm truncate"
          style={{ fontFamily: "var(--font-body)" }}
        >
          {build.tag}
        </div>
        <div
          className="text-[10px] text-[var(--color-ash)]"
          style={{ fontFamily: "var(--font-body)" }}
        >
          {build.buildId}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        <div
          className="px-3 py-6 text-center text-[var(--color-ash)] text-xs"
          style={{ fontFamily: "var(--font-body)" }}
        >
          no sessions until build finishes — watch progress on the right
        </div>
      </div>
      <div className="border-t border-[var(--color-ink)]/15 p-3 space-y-2 bg-[var(--color-paper-deep)]">
        <button
          disabled
          className="w-full text-xs uppercase tracking-[0.25em] px-3 py-2 bg-[var(--color-ink)]/30 text-[var(--color-paper)]/70 cursor-not-allowed"
          style={{ fontFamily: "var(--font-body)" }}
          title="waiting for build to finish"
        >
          + terminal
        </button>
        <button
          disabled
          className="w-full text-xs uppercase tracking-[0.25em] px-3 py-2 bg-[var(--color-ink)]/30 text-[var(--color-paper)]/70 cursor-not-allowed"
          style={{ fontFamily: "var(--font-body)" }}
          title="waiting for build to finish"
        >
          + agent
        </button>
      </div>
    </>
  );
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
      <h3
        className="text-lg mb-2"
        style={{ fontFamily: "var(--font-display)", fontStyle: "italic" }}
      >
        {title}
      </h3>
      <p
        className="text-xs text-[var(--color-ash)] max-w-[28ch]"
        style={{ fontFamily: "var(--font-body)" }}
      >
        {detail}
      </p>
    </div>
  );
}
