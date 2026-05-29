import { useEffect, useMemo, useState } from "react";
import type { SessionSummary } from "../types";

function timeAgo(ts: number | null): string {
  if (ts == null) return "";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d`;
  return new Date(ts).toISOString().slice(0, 10);
}

function SessionItem({
  s,
  active,
  onClick,
}: {
  s: SessionSummary;
  active: boolean;
  onClick: () => void;
}) {
  const slug = s.sessionId ?? s.path;
  return (
    <button
      className={"sessitem" + (active ? " active" : "")}
      onClick={onClick}
      title={s.title}
      data-testid={`sidebar-session-${slug}`}
    >
      <span
        className="provdot"
        style={{
          background: active ? "var(--accent)" : "var(--tx-faint)",
        }}
      />
      <span className="sesscol">
        <span className="sessname">{s.title || "(untitled)"}</span>
        <span className="sessmeta mono">{s.messageCount} msgs</span>
      </span>
      <span className="sesstime mono">{timeAgo(s.updatedAt)}</span>
    </button>
  );
}

export interface SidebarProps {
  sessions: SessionSummary[] | null;
  activePath: string | null;
  onSelect: (path: string) => void;
  onNew: () => void;
  onClearAll: () => void;
}

export function Sidebar({ sessions, activePath, onSelect, onNew, onClearAll }: SidebarProps) {
  const [q, setQ] = useState("");
  // Two-step confirm so a misclick doesn't nuke history. Auto-revert
  // after a few seconds so the button doesn't stay in a scary state.
  const [confirmClear, setConfirmClear] = useState(false);
  useEffect(() => {
    if (!confirmClear) return;
    const t = setTimeout(() => setConfirmClear(false), 4000);
    return () => clearTimeout(t);
  }, [confirmClear]);

  const groups = useMemo(() => {
    if (!sessions) return null;
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? sessions.filter(
          (s) =>
            s.title.toLowerCase().includes(needle) ||
            s.cwd.toLowerCase().includes(needle),
        )
      : sessions;
    const map = new Map<string, SessionSummary[]>();
    for (const s of filtered) {
      const k = s.cwd || "(no cwd)";
      const arr = map.get(k);
      if (arr) arr.push(s);
      else map.set(k, [s]);
    }
    return map;
  }, [sessions, q]);

  return (
    <aside className="sidebar" data-testid="sidebar">
      <div className="brand">
        <span className="logo mono">π</span>
        <span className="brandname">
          pi<span className="brandsub">control</span>
        </span>
        <span className="ver mono">rpc · 0.75</span>
      </div>

      <button className="newbtn" onClick={onNew} data-testid="sidebar-new">
        <span className="plus">+</span> New session <span className="kbd mono">⌘N</span>
      </button>

      <div className="searchwrap">
        <span className="searchglyph">⌕</span>
        <input
          className="search"
          placeholder="Search sessions…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          data-testid="sidebar-search"
        />
      </div>

      <div className="sesslist">
        {!groups && <div className="emptyq mono">loading sessions…</div>}
        {groups && groups.size === 0 && (
          <div className="emptyq mono">
            {q ? `no sessions match "${q}"` : "no prior sessions"}
          </div>
        )}
        {groups &&
          [...groups.entries()].map(([cwd, list]) => (
            <div className="sessgroup" key={cwd}>
              <div className="grouphdr mono">{cwd}</div>
              {list.map((s) => (
                <SessionItem
                  key={s.path}
                  s={s}
                  active={s.path === activePath}
                  onClick={() => onSelect(s.path)}
                />
              ))}
            </div>
          ))}
      </div>

      {sessions && sessions.length > 0 && (
        <div className="sideclear">
          <button
            className={"clearbtn mono" + (confirmClear ? " danger" : "")}
            onClick={() => {
              if (confirmClear) {
                setConfirmClear(false);
                onClearAll();
              } else {
                setConfirmClear(true);
              }
            }}
            data-testid="sidebar-clear-all"
          >
            {confirmClear
              ? `Click again to delete ${sessions.length} sessions`
              : "Clear all history"}
          </button>
        </div>
      )}
    </aside>
  );
}
