import { useEffect, useRef, useState } from "react";
import type { SessionView } from "../../sidecar/protocol.ts";
import type { SidecarApi, SidecarClient } from "../lib/sidecar-client.ts";
import type { ShareInfo } from "../App.tsx";
import { BuildLogView } from "./BuildLogView.tsx";
import { LiveTerminal } from "./LiveTerminal.tsx";
import { LiveAgent } from "./LiveAgent.tsx";

/**
 * Renders one pane per open session across ALL sandboxes, with only the
 * active session's pane visible. Inactive panes (that have been visited at
 * least once) stay mounted and full-sized via absolute positioning + a
 * visibility toggle, so xterm scrollback, in-flight prompts, drafts, scroll
 * position, and the WS subscription all survive a tab switch — including
 * switching to a different sandbox and back.
 *
 * A session is only mounted once it has been activated for the first time
 * — never-visited tabs sit at 0×0 if we mount them eagerly, and `@wterm/react`
 * doesn't reliably fire `onResize` for an element that's never had a real
 * size, so the PTY would never subscribe and the user couldn't type.
 * Mount-on-first-activate sidesteps that quirk.
 */
export function LivePane({
  api,
  client,
  sessions,
  activeId,
  activeBuildId,
  shares,
}: {
  api: SidecarApi;
  client: SidecarClient;
  sessions: SessionView[];
  activeId: string | null;
  activeBuildId?: string | null;
  shares: Map<string, ShareInfo>;
}) {
  // A build selection short-circuits the session-routing logic entirely.
  // Mounted-tab bookkeeping below is irrelevant while the user is watching
  // build output; once the build graduates, App switches activeBuildId back
  // to null and selects the new sandbox, restoring normal flow.
  if (activeBuildId) {
    return (
      <main
        className="bg-[#15100a] text-[var(--color-paper)] flex flex-col min-h-0"
        data-testid="live-build"
      >
        <header className="border-b border-[var(--color-rust)]/40 px-5 py-3 flex items-center gap-3">
          <span
            className="text-xs uppercase tracking-[0.3em] text-[var(--color-amber)]"
            style={{ fontFamily: "var(--font-body)" }}
          >
            building
          </span>
          <span
            className="text-[10px] text-[var(--color-paper)]/40"
            style={{ fontFamily: "var(--font-body)" }}
          >
            {activeBuildId}
          </span>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto bg-[var(--color-paper)] text-[var(--color-ink)]">
          <BuildLogView buildId={activeBuildId} api={api} client={client} />
        </div>
      </main>
    );
  }

  // Track every session id that has been the active tab at least once. Once
  // present, the entry stays mounted for the life of the session — only its
  // `hidden` flag toggles when the user switches away. Sessions that disappear
  // (closed) drop out so we don't leak old ids.
  const [mounted, setMounted] = useState<Set<string>>(() => new Set());
  const mountedRef = useRef(mounted);
  mountedRef.current = mounted;

  useEffect(() => {
    if (activeId === null) return;
    if (mountedRef.current.has(activeId)) return;
    setMounted((prev) => {
      const next = new Set(prev);
      next.add(activeId);
      return next;
    });
  }, [activeId]);

  useEffect(() => {
    // Drop ids whose sessions no longer exist so closed-and-recreated ids
    // can't collide with stale mounts. Session ids are UUIDs so the practical
    // collision risk is zero — this is just for tidy GC.
    const live = new Set(sessions.map((s) => s.id));
    setMounted((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (live.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [sessions]);

  const active = sessions.find((s) => s.id === activeId) ?? null;
  const activeShare = active ? shares.get(active.id) ?? null : null;
  // Only render panes for sessions that have been visited at least once. The
  // active session is always in this set (the effect above adds it). Sessions
  // from other sandboxes that the user has visited stay mounted here too —
  // their `hidden` flag is true, so they contribute no layout, but their
  // xterm WASM instance and WS subscription survive a sandbox switch.
  const panes = sessions.filter((s) => mounted.has(s.id));

  return (
    <main
      className="bg-[#15100a] text-[var(--color-paper)] flex flex-col min-h-0"
      data-testid={active ? `live-${active.kind}` : "live-empty"}
    >
      {active && <PaneHeader session={active} share={activeShare} />}
      <div className="flex-1 min-h-0 relative">
        {panes.map((s) => {
          const isActive = s.id === activeId;
          // Every pane is absolute-positioned at the container's full size at
          // all times. Toggling `display:none` (the previous approach) caused
          // wterm's ResizeObserver to fire with a 0×0 container, triggering a
          // 1×1 internal resize that corrupted the WASM bridge's grid — so
          // returning to the pane showed garbled characters. With absolute
          // sizing the observer always sees real dimensions and the grid
          // stays intact across switches.
          return (
            <div
              key={s.id}
              className={`absolute inset-0 flex flex-col min-h-0 ${
                isActive ? "visible" : "invisible pointer-events-none"
              }`}
              data-session-id={s.id}
              data-session-active={isActive ? "true" : "false"}
            >
              {s.kind === "terminal" ? (
                <LiveTerminal
                  api={api}
                  client={client}
                  sessionId={s.id}
                  active={isActive}
                />
              ) : (
                <LiveAgent
                  api={api}
                  client={client}
                  session={s}
                  share={shares.get(s.id) ?? null}
                />
              )}
            </div>
          );
        })}
        {!active && <EmptyState />}
      </div>
    </main>
  );
}

function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
      <pre
        className="text-[var(--color-amber)] text-[0.55rem] leading-none mb-8 select-none"
        style={{ fontFamily: "var(--font-body)" }}
      >
{`        ▲
   ╔════════╗
   ║        ║
   ║   ──   ║
   ║        ║
   ╚════════╝`}
      </pre>
      <h1
        className="text-3xl mb-3"
        style={{ fontFamily: "var(--font-display)", fontStyle: "italic" }}
      >
        start a session
      </h1>
      <p
        className="text-[var(--color-paper)]/60 max-w-[36ch] text-sm leading-relaxed"
        style={{ fontFamily: "var(--font-body)" }}
      >
        create or pick a sandbox on the left, then launch a terminal or agent
        to start working
      </p>
    </div>
  );
}

function PaneHeader({
  session,
  share,
}: {
  session: SessionView;
  share: ShareInfo | null;
}) {
  return (
    <header className="border-b border-[var(--color-rust)]/40 px-5 py-3 flex items-center justify-between">
      <div className="flex items-baseline gap-3">
        <span
          className="text-xs uppercase tracking-[0.3em] text-[var(--color-amber)]"
          style={{ fontFamily: "var(--font-body)" }}
        >
          {session.kind}
        </span>
        <span
          className="text-[10px] text-[var(--color-paper)]/40"
          style={{ fontFamily: "var(--font-body)" }}
        >
          {session.id}
        </span>
      </div>
      <div
        className="flex items-center gap-3 text-[10px] uppercase tracking-[0.25em]"
        style={{ fontFamily: "var(--font-body)" }}
      >
        {share ? (
          <>
            <span className="w-2 h-2 rounded-full bg-[#16a34a]" />
            <span className="text-[var(--color-amber-glow)]">
              public · {share.peers.length} peer{share.peers.length === 1 ? "" : "s"}
            </span>
          </>
        ) : (
          <>
            <span className="w-2 h-2 rounded-full bg-[var(--color-ash)]" />
            <span className="text-[var(--color-paper)]/40">private</span>
          </>
        )}
      </div>
    </header>
  );
}
