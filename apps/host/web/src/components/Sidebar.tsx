import { useEffect, useMemo, useState } from "react";
import type { SharedSessionMeta } from "@beamhop/protocol";
import type { SessionSummary } from "../types";
import { useMultiplayer } from "../multiplayer/store";

function timeAgo(ts: number | null): string {
  if (ts == null) return "";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d`;
  return new Date(ts).toISOString().slice(0, 10);
}

/** Per-session share control shown next to a local session when in a room. */
function ShareControl({
  shareMode,
  onShare,
  onUnshare,
  onCycleMode,
  slug,
}: {
  shareMode: "readonly" | "collab" | null;
  onShare: () => void;
  onUnshare: () => void;
  onCycleMode: () => void;
  slug: string;
}) {
  if (!shareMode) {
    return (
      <span
        className="sharepill"
        role="button"
        tabIndex={0}
        title="Share this session into the room"
        onClick={(e) => {
          e.stopPropagation();
          onShare();
        }}
        data-testid={`share-toggle-${slug}`}
      >
        share
      </span>
    );
  }
  return (
    <span className="sharepill on" data-testid={`share-toggle-${slug}`}>
      <span
        role="button"
        tabIndex={0}
        title="Toggle read-only / collaborative"
        onClick={(e) => {
          e.stopPropagation();
          onCycleMode();
        }}
        data-testid={`share-mode-${slug}`}
      >
        {shareMode === "collab" ? "collab" : "view-only"}
      </span>
      <span
        role="button"
        tabIndex={0}
        title="Stop sharing"
        onClick={(e) => {
          e.stopPropagation();
          onUnshare();
        }}
        data-testid={`share-unshare-${slug}`}
        style={{ marginLeft: 6 }}
      >
        ✕
      </span>
    </span>
  );
}

function SessionItem({
  s,
  active,
  onClick,
  share,
}: {
  s: SessionSummary;
  active: boolean;
  onClick: () => void;
  /** Share control props, present only when the user is in a room (Host). */
  share?: {
    mode: "readonly" | "collab" | null;
    onShare: () => void;
    onUnshare: () => void;
    onCycleMode: () => void;
  };
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
      {share ? (
        <ShareControl
          shareMode={share.mode}
          onShare={share.onShare}
          onUnshare={share.onUnshare}
          onCycleMode={share.onCycleMode}
          slug={slug}
        />
      ) : (
        <span className="sesstime mono">{timeAgo(s.updatedAt)}</span>
      )}
    </button>
  );
}

/** A shared session from the room catalog (owned by some Host in the room). */
function RoomSessionItem({
  m,
  active,
  onOpen,
}: {
  m: SharedSessionMeta;
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      className={"sessitem" + (active ? " active" : "")}
      onClick={onOpen}
      title={`${m.title} — ${m.ownerName}`}
      data-testid={`shared-session-${m.sessionKey}`}
    >
      <span
        className="provdot"
        style={{ background: active ? "var(--accent)" : "var(--tx-faint)" }}
      />
      <span className="sesscol">
        <span className="sessname">{m.title || "(untitled)"}</span>
        <span className="sessmeta mono">
          {m.ownerName} · {m.mode === "collab" ? "collab" : "view-only"}
        </span>
      </span>
      <span className="sesstime mono">{timeAgo(m.updatedAt)}</span>
    </button>
  );
}

export interface SidebarProps {
  sessions: SessionSummary[] | null;
  activePath: string | null;
  onSelect: (path: string) => void;
  onNew: () => void;
  onClearAll: () => void;
  /** True when running as a Host (can run + share local sessions). */
  isHost: boolean;
}

export function Sidebar({ sessions, activePath, onSelect, onNew, onClearAll, isHost }: SidebarProps) {
  const mp = useMultiplayer();
  const inRoom = mp.room != null;
  // Owner's currently-shared sessions, keyed by sessionFile, for the toggle UI.
  const myShares = useMemo(() => {
    const map = new Map<string, "readonly" | "collab">();
    if (!mp.room) return map;
    for (const m of mp.room.catalog) {
      if (m.ownerId === mp.room.selfId) map.set(m.sessionFile, m.mode);
    }
    return map;
  }, [mp.room]);
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
                  share={
                    isHost && inRoom
                      ? {
                          mode: myShares.get(s.path) ?? null,
                          onShare: () => mp.shareSession(s.path, "collab"),
                          onUnshare: () => mp.unshareSession(s.path),
                          onCycleMode: () =>
                            mp.setSessionMode(
                              s.path,
                              myShares.get(s.path) === "collab" ? "readonly" : "collab",
                            ),
                        }
                      : undefined
                  }
                />
              ))}
            </div>
          ))}
      </div>

      {inRoom && (
        <div className="roomsessions" data-testid="room-sessions">
          <div className="grouphdr mono">room sessions</div>
          {mp.room!.catalog.filter((m) => m.ownerId !== mp.room!.selfId).length === 0 && (
            <div className="emptyq mono">no shared sessions yet</div>
          )}
          {(() => {
            // Group the combined catalog by owner; hide our own (we see those
            // in the local list above with share toggles).
            const others = mp.room!.catalog.filter((m) => m.ownerId !== mp.room!.selfId);
            const byOwner = new Map<string, SharedSessionMeta[]>();
            for (const m of others) {
              const arr = byOwner.get(m.ownerName);
              if (arr) arr.push(m);
              else byOwner.set(m.ownerName, [m]);
            }
            return [...byOwner.entries()].map(([owner, metas]) => (
              <div className="sessgroup" key={owner}>
                <div className="grouphdr mono">{owner}</div>
                {metas.map((m) => (
                  <RoomSessionItem
                    key={m.sessionKey}
                    m={m}
                    active={m.sessionKey === mp.room!.openSessionKey}
                    onOpen={() => mp.openShared(m.sessionKey)}
                  />
                ))}
              </div>
            ));
          })()}
        </div>
      )}

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
