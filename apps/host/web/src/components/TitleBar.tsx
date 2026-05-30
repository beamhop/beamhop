import type { ReactNode } from "react";
import { PROVIDER_DOT, type PiModel } from "../data/models";
import type { RpcStatus } from "../rpc/client";
import type { State } from "../rpc/reducer";
import type { SessionSummary } from "../types";

export interface TitleBarProps {
  session: SessionSummary | null;
  model: string;
  models: PiModel[];
  stats: State["stats"];
  status: RpcStatus;
  sandbox: string;
  onPalette: () => void;
  onSwitchSandbox: () => void;
  /** Multiplayer controls (roster + room join/leave) rendered on the right. */
  roomSlot?: ReactNode;
}

export function TitleBar({
  session,
  model,
  models,
  stats,
  status,
  sandbox,
  onPalette,
  onSwitchSandbox,
  roomSlot,
}: TitleBarProps) {
  const pct = Math.round((stats.contextTokens / Math.max(1, stats.contextWindow)) * 100);
  const piModel = models.find((m) => m.name === model || m.id === model) ?? models[0];
  return (
    <div className="titlebar" data-testid="titlebar">
      <div className="lights">
        <span className="light red" />
        <span className="light yellow" />
        <span className="light green" />
      </div>
      <div className="titlecenter">
        <span className="titlecwd mono">{session?.cwd ?? ""}</span>
        <span className="titlesep">›</span>
        <span className="titlename">{session?.title ?? "untitled session"}</span>
      </div>
      <div className="titleright">
        {roomSlot}
        <button
          className="titlepill mono"
          onClick={onSwitchSandbox}
          title="Switch sandbox"
          data-testid="titlebar-switch-sandbox"
          style={{ cursor: "pointer" }}
        >
          ⤺ {sandbox}
        </button>
        <button
          className="titlek mono"
          onClick={onPalette}
          title="Command palette (⌘K)"
          data-testid="titlebar-palette-btn"
        >
          <span className="searchglyph">⌕</span> commands{" "}
          <span className="kbd mono">⌘K</span>
        </button>
        <span className="titlepill mono">
          <span
            className="provdot"
            style={{
              background: PROVIDER_DOT[piModel?.provider ?? "openrouter"],
            }}
          />
          {model || "—"}
        </span>
        <span className="titlepill mono">{pct}% ctx</span>
        <span className="titlepill mono">${stats.cost.toFixed(2)}</span>
        <span
          className="titlepill mono"
          style={{
            color:
              status === "open"
                ? "var(--green)"
                : status === "error"
                  ? "var(--red)"
                  : "var(--tx-faint)",
          }}
          data-testid="titlebar-status"
        >
          {status}
        </span>
      </div>
    </div>
  );
}
