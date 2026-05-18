import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import type { AgentDescriptor, AgentId } from "@beamhop/acp-protocol";
import { AGENT_BLURBS } from "../lib/connection.js";
import { cn } from "../lib/cn.js";

export function AgentRegistry({
  agents,
  current,
  switching,
  onPick,
  onAuth,
}: {
  agents: AgentDescriptor[];
  current: AgentId | null;
  switching: boolean;
  onPick: (id: AgentId) => void;
  onAuth: (descriptor: AgentDescriptor) => void;
}) {
  return (
    <aside className="w-[280px] shrink-0 border-r border-rule bg-ink flex flex-col">
      <div className="px-5 pt-5 pb-3 border-b border-rule-soft">
        <div className="text-[9px] uppercase tracking-[0.22em] text-fog">registry</div>
        <div className="font-display text-[19px] leading-tight mt-1">agents</div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-fog mt-1">
          {agents.length} · acp v1
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {agents.map((a, i) => (
          <AgentRow
            key={String(a.id)}
            index={i}
            descriptor={a}
            blurb={AGENT_BLURBS[String(a.id)] ?? "registered agent"}
            active={current === a.id}
            switching={switching && current === a.id}
            disabled={switching}
            onClick={() => onPick(a.id)}
            onAuth={() => onAuth(a)}
          />
        ))}
      </div>

      <div className="border-t border-rule px-5 py-3 text-[10px] uppercase tracking-[0.18em] text-fog leading-relaxed">
        one process per session
        <br />
        switch ↦ kill + respawn
      </div>
    </aside>
  );
}

function AgentRow({
  descriptor,
  blurb,
  active,
  switching,
  disabled,
  index,
  onClick,
  onAuth,
}: {
  descriptor: AgentDescriptor;
  blurb: string;
  active: boolean;
  switching: boolean;
  disabled: boolean;
  index: number;
  onClick: () => void;
  onAuth: () => void;
}) {
  const canAuth = descriptor.login === "acp_native" || descriptor.login === "tty";
  const uptime = useUptime(active && !switching);
  return (
    <div
      className={cn(
        "group block w-full px-5 py-3 border-b border-rule-soft relative",
        "transition-colors duration-100 ease-out",
        active ? "bg-ink-2" : "hover:bg-ink-1",
        disabled && !active && "opacity-40",
      )}
    >
      {active && (
        <span className="absolute left-0 top-0 bottom-0 w-[2px] bg-amber" aria-hidden />
      )}

      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        data-agent-id={String(descriptor.id)}
        data-agent-active={active ? "true" : "false"}
        className="block w-full text-left"
      >
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="text-[9px] tabular-nums text-fog">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span
              className={cn(
                "text-[13px] truncate",
                active ? "text-paper" : "text-bone group-hover:text-paper",
              )}
            >
              {descriptor.label}
            </span>
          </div>
          {active && (
            <span
              className={cn(
                "text-[9px] uppercase tracking-[0.2em]",
                switching ? "text-amber" : "text-moss",
              )}
            >
              {switching ? "switching" : "live"}
            </span>
          )}
        </div>

        <div className="text-[10px] text-fog mt-0.5 truncate">{blurb}</div>
      </button>

      <div className="mt-2 flex items-center justify-between gap-3">
        {active && !switching ? (
          <div className="flex items-center gap-4 text-[9px] tabular-nums text-fog">
            <span>
              up <span className="text-bone">{uptime}</span>
            </span>
            <span>
              id <span className="text-bone">{String(descriptor.id)}</span>
            </span>
          </div>
        ) : (
          <span className="text-[9px] uppercase tracking-[0.18em] text-fog">
            {descriptor.login ?? "none"}
          </span>
        )}
        {canAuth && (
          <button
            type="button"
            onClick={onAuth}
            className="inline-flex items-center gap-1 text-[9px] uppercase tracking-[0.18em] text-fog hover:text-amber"
          >
            <KeyRound className="h-2.5 w-2.5" />
            auth
          </button>
        )}
      </div>
    </div>
  );
}

function useUptime(running: boolean): string {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  if (!running) return "—";
  const s = Math.floor((now - start) / 1000);
  const m = Math.floor(s / 60);
  const sec = String(s % 60).padStart(2, "0");
  return `${m}:${sec}`;
}
