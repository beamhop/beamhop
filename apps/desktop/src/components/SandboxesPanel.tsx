import { useEffect, useMemo, useState } from "react";
import type {
  BuildView,
  SandboxStatus,
  SandboxView,
} from "../../sidecar/protocol.ts";
import type { SidecarApi, SidecarClient } from "../lib/sidecar-client.ts";
import { BuildLogView } from "./BuildLogView.tsx";
import { NewSandboxDialog } from "./NewSandboxDialog.tsx";

// activeId in App.tsx is either a sandbox id or `build:<buildId>`.
const BUILD_PREFIX = "build:";

export function SandboxesPanel({
  api,
  client,
  sandboxes,
  activeId,
  onSelect,
}: {
  api: SidecarApi;
  client: SidecarClient;
  sandboxes: SandboxView[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  // Builds the sidecar is tracking — running + recently completed. Driven by
  // the initial list call plus `build:state` broadcasts. `viewerBuildId`
  // controls the standalone log viewer overlay (for completed builds).
  const [builds, setBuilds] = useState<BuildView[]>([]);
  const [viewerBuildId, setViewerBuildId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await api.listBuilds();
        if (!cancelled) setBuilds(list);
      } catch {
        // Sidecar may be too old to know about builds.list — ignore.
      }
    })();
    const off = client.on("build:state", (state) => {
      setBuilds((cur) => {
        const idx = cur.findIndex((b) => b.buildId === state.buildId);
        if (idx === -1) return [state, ...cur];
        const out = cur.slice();
        out[idx] = state;
        return out;
      });
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [api, client]);

  // Active builds are rendered as rows in the main list — until the autoBoot
  // sandbox actually appears in `sandboxes` (graduation), at which point the
  // real SandboxRow takes over and we drop the building row.
  const sandboxIdSet = useMemo(
    () => new Set(sandboxes.map((s) => s.id)),
    [sandboxes],
  );
  const activeBuilds = useMemo(
    () =>
      builds.filter(
        (b) =>
          b.status === "running" &&
          !(b.sandboxId && sandboxIdSet.has(b.sandboxId)),
      ),
    [builds, sandboxIdSet],
  );
  const recentBuilds = useMemo(
    () =>
      builds
        .filter((b) => b.status !== "running")
        .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
        .slice(0, 3),
    [builds],
  );

  // If the active selection is a building row that just graduated (the
  // autoBoot sandbox appeared), promote the selection to the real sandbox.
  useEffect(() => {
    if (!activeId?.startsWith(BUILD_PREFIX)) return;
    const buildId = activeId.slice(BUILD_PREFIX.length);
    const build = builds.find((b) => b.buildId === buildId);
    if (build?.sandboxId && sandboxIdSet.has(build.sandboxId)) {
      onSelect(build.sandboxId);
    }
  }, [activeId, builds, sandboxIdSet, onSelect]);

  const counts = useMemo(() => {
    const c: Record<SandboxStatus, number> = {
      running: 0,
      stopped: 0,
      crashed: 0,
      draining: 0,
    };
    for (const s of sandboxes) c[s.status]++;
    return c;
  }, [sandboxes]);

  const stoppedOrCrashed = useMemo(
    () => sandboxes.filter((s) => s.status === "stopped" || s.status === "crashed"),
    [sandboxes],
  );

  const liveSelected = useMemo(() => {
    const live = new Set(sandboxes.map((s) => s.id));
    return [...selected].filter((id) => live.has(id));
  }, [selected, sandboxes]);

  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const clearSelection = () => setSelected(new Set());

  const surfaceRemoveError = (err: unknown) => {
    setRemoveError(err instanceof Error ? err.message : String(err));
  };

  const handlePurge = () => {
    if (stoppedOrCrashed.length === 0) return;
    setRemoveError(null);
    api
      .removeManySandboxes(stoppedOrCrashed.map((s) => s.id), false)
      .catch(surfaceRemoveError);
  };

  const handleRemoveSelected = () => {
    if (liveSelected.length === 0) return;
    const items = sandboxes.filter((s) => selected.has(s.id));
    const running = items.filter(
      (s) => s.status === "running" || s.status === "draining",
    );
    let force = false;
    if (running.length > 0) {
      // eslint-disable-next-line no-alert
      const ok = window.confirm(
        `Stop and remove ${running.length} running sandbox(es)?`,
      );
      if (!ok) {
        // User declined: still remove non-running ones from the selection.
        const rest = items
          .filter((s) => s.status !== "running" && s.status !== "draining")
          .map((s) => s.id);
        if (rest.length > 0) {
          setRemoveError(null);
          api.removeManySandboxes(rest, false).catch(surfaceRemoveError);
        }
        clearSelection();
        return;
      }
      force = true;
    }
    setRemoveError(null);
    api.removeManySandboxes(liveSelected, force).catch(surfaceRemoveError);
    clearSelection();
  };

  const handleRemoveAll = () => {
    if (sandboxes.length === 0) return;
    // eslint-disable-next-line no-alert
    const ok = window.confirm(
      `Stop and remove ALL ${sandboxes.length} sandboxes?`,
    );
    if (!ok) return;
    setRemoveError(null);
    api
      .removeManySandboxes(sandboxes.map((s) => s.id), true)
      .catch(surfaceRemoveError);
    clearSelection();
  };

  const handleRemoveOne = (s: SandboxView) => {
    if (s.status === "running" || s.status === "draining") {
      // eslint-disable-next-line no-alert
      const ok = window.confirm("Stop and remove this running sandbox?");
      if (!ok) return;
    }
    setRemoveError(null);
    api.removeSandbox(s.id).catch(surfaceRemoveError);
    setSelected((cur) => {
      if (!cur.has(s.id)) return cur;
      const next = new Set(cur);
      next.delete(s.id);
      return next;
    });
  };

  const countParts: string[] = [];
  if (counts.running) countParts.push(`${counts.running} running`);
  if (counts.stopped) countParts.push(`${counts.stopped} stopped`);
  if (counts.crashed) countParts.push(`${counts.crashed} crashed`);
  if (counts.draining) countParts.push(`${counts.draining} draining`);
  const countLine = countParts.length > 0 ? countParts.join(" · ") : "empty";

  const listEmpty = sandboxes.length === 0 && activeBuilds.length === 0;

  return (
    <aside className="border-r border-[var(--color-ink)]/15 bg-[var(--color-paper-deep)] flex flex-col min-h-0">
      <SectionHeader
        title="sandboxes"
        action={
          <button
            onClick={() => setDialogOpen(true)}
            className="text-[10px] uppercase tracking-[0.25em] px-2 py-1 bg-[var(--color-ink)] text-[var(--color-paper)] hover:bg-[var(--color-amber)] hover:text-[var(--color-ink)] transition-colors"
            style={{ fontFamily: "var(--font-body)" }}
            data-testid="new-sandbox"
          >
            + new
          </button>
        }
      />

      {sandboxes.length > 0 && (
        <div
          className="px-3 py-2 border-b border-[var(--color-ink)]/10 text-[10px] uppercase tracking-[0.18em] text-[var(--color-ash)]"
          style={{ fontFamily: "var(--font-body)" }}
        >
          <div>{countLine}</div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {stoppedOrCrashed.length > 0 && (
              <button
                type="button"
                onClick={handlePurge}
                className="hover:text-[var(--color-amber)]"
                data-testid="purge-stopped"
              >
                purge stopped
              </button>
            )}
            {liveSelected.length > 0 && (
              <button
                type="button"
                onClick={handleRemoveSelected}
                className="hover:text-[#dc2626]"
                data-testid="remove-selected"
              >
                remove selected ({liveSelected.length})
              </button>
            )}
            <button
              type="button"
              onClick={handleRemoveAll}
              className="hover:text-[#dc2626] ml-auto"
              data-testid="remove-all"
            >
              remove all
            </button>
          </div>
        </div>
      )}

      {removeError && (
        <div
          className="mx-3 mt-2 px-2 py-1.5 border border-[#dc2626]/40 bg-[#dc2626]/10 text-[#7f1d1d] text-[10px] flex items-start gap-2"
          style={{ fontFamily: "var(--font-body)" }}
          data-testid="remove-error"
        >
          <span className="flex-1 break-words">{removeError}</span>
          <button
            type="button"
            onClick={() => setRemoveError(null)}
            className="shrink-0 text-[#7f1d1d] hover:text-[#dc2626]"
            aria-label="dismiss"
          >
            ×
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {listEmpty && (
          <div
            className="px-3 py-8 text-center text-[var(--color-ash)] text-xs"
            style={{ fontFamily: "var(--font-body)" }}
          >
            no sandboxes. press <b>+ new</b> to build or boot one.
          </div>
        )}
        {activeBuilds.map((b) => {
          const id = BUILD_PREFIX + b.buildId;
          return (
            <BuildRow
              key={b.buildId}
              build={b}
              active={activeId === id}
              onSelect={() => onSelect(id)}
            />
          );
        })}
        {sandboxes.map((s) => (
          <SandboxRow
            key={s.id}
            sandbox={s}
            active={s.id === activeId}
            checked={selected.has(s.id)}
            onSelect={() => onSelect(s.id)}
            onToggle={() => toggle(s.id)}
            onRemove={() => handleRemoveOne(s)}
          />
        ))}
      </div>

      {recentBuilds.length > 0 && (
        <div
          className="px-3 py-2 border-t border-[var(--color-ink)]/10 space-y-1"
          data-testid="builds-strip"
        >
          <div
            className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-ash)]"
            style={{ fontFamily: "var(--font-body)" }}
          >
            recent builds
          </div>
          {recentBuilds.map((b) => (
            <RecentBuildChip
              key={b.buildId}
              build={b}
              onClick={() => setViewerBuildId(b.buildId)}
            />
          ))}
        </div>
      )}

      {dialogOpen && (
        <NewSandboxDialog
          api={api}
          onClose={() => setDialogOpen(false)}
          onBuildStarted={(buildId) => onSelect(BUILD_PREFIX + buildId)}
        />
      )}
      {viewerBuildId && (
        <BuildLogOverlay
          buildId={viewerBuildId}
          api={api}
          client={client}
          onClose={() => setViewerBuildId(null)}
        />
      )}
    </aside>
  );
}

function BuildRow({
  build,
  active,
  onSelect,
}: {
  build: BuildView;
  active: boolean;
  onSelect: () => void;
}) {
  // Pull the latest step label from the event stream if we have one in the
  // view — we don't (BuildView is summary-only) — so show the tag and a
  // pulsing "building" marker. The right pane carries the full log.
  return (
    <div
      className={`px-3 py-2 cursor-pointer group border ${
        active
          ? "border-[var(--color-amber)] bg-[var(--color-amber)]/20"
          : "border-[var(--color-amber)]/60 bg-[var(--color-amber)]/10 hover:bg-[var(--color-amber)]/15"
      }`}
      onClick={onSelect}
      data-testid={`build-row-${build.buildId}`}
    >
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="text-xs font-medium truncate"
              style={{ fontFamily: "var(--font-body)" }}
            >
              {build.tag}
            </span>
            <span
              className="shrink-0 inline-flex items-center gap-1 text-[9px] uppercase tracking-[0.18em] text-[var(--color-rust)]"
              style={{ fontFamily: "var(--font-body)" }}
            >
              <span aria-hidden className="animate-pulse">
                ●
              </span>
              building
            </span>
          </div>
          <div
            className="text-[10px] truncate text-[var(--color-ash)]"
            style={{ fontFamily: "var(--font-body)" }}
          >
            {build.buildId}
          </div>
        </div>
      </div>
    </div>
  );
}

function RecentBuildChip({
  build,
  onClick,
}: {
  build: BuildView;
  onClick: () => void;
}) {
  const cls =
    build.status === "succeeded"
      ? "border-emerald-600/40 bg-emerald-500/10"
      : build.status === "cancelled"
        ? "border-[var(--color-ink)]/30 bg-[var(--color-paper)]"
        : "border-[#dc2626]/40 bg-[#dc2626]/10";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-2 py-1.5 border ${cls} text-[10px] flex items-center gap-2`}
      style={{ fontFamily: "var(--font-body)" }}
      data-testid={`build-chip-${build.buildId}`}
    >
      <span className="uppercase tracking-[0.18em] shrink-0">
        {build.status}
      </span>
      <span
        className="truncate font-medium normal-case tracking-normal"
        style={{ fontFamily: "var(--font-terminal)" }}
      >
        {build.tag}
      </span>
      <span className="ml-auto text-[var(--color-ash)] uppercase tracking-[0.15em]">
        logs →
      </span>
    </button>
  );
}

function BuildLogOverlay({
  buildId,
  api,
  client,
  onClose,
}: {
  buildId: string;
  api: SidecarApi;
  client: SidecarClient;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm flex items-center justify-center px-4"
      onClick={onClose}
    >
      <div
        className="bg-[var(--color-paper)] border-2 border-[var(--color-ink)] max-w-2xl w-full max-h-[85vh] flex flex-col shadow-[0_30px_60px_-20px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="border-b-2 border-[var(--color-ink)] px-6 py-4 flex items-center justify-between">
          <h2
            className="text-2xl"
            style={{ fontFamily: "var(--font-display)", fontStyle: "italic" }}
          >
            build log
          </h2>
          <button
            onClick={onClose}
            className="text-[var(--color-ash)] hover:text-[var(--color-ink)] text-xl leading-none"
            aria-label="close"
          >
            ×
          </button>
        </header>
        <div className="flex-1 overflow-y-auto">
          <BuildLogView buildId={buildId} api={api} client={client} />
        </div>
      </div>
    </div>
  );
}

function SandboxRow({
  sandbox,
  active,
  checked,
  onSelect,
  onToggle,
  onRemove,
}: {
  sandbox: SandboxView;
  active: boolean;
  checked: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      className={`px-3 py-2 cursor-pointer group ${
        active
          ? "bg-[var(--color-ink)] text-[var(--color-paper)]"
          : "hover:bg-[var(--color-paper)]"
      }`}
      onClick={onSelect}
      data-testid={`sandbox-${sandbox.id}`}
      data-sandbox-status={sandbox.status}
    >
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          onClick={(e) => e.stopPropagation()}
          aria-label={`select ${sandbox.id}`}
          className="h-3 w-3 shrink-0 accent-[var(--color-amber)]"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="text-xs font-medium truncate"
              style={{ fontFamily: "var(--font-body)" }}
            >
              {sandbox.imageTag}
            </span>
            <StatusChip status={sandbox.status} active={active} />
            {sandbox.external && (
              <span
                className={`text-[9px] uppercase tracking-[0.18em] ${
                  active ? "text-[var(--color-paper)]/60" : "text-[var(--color-ash)]"
                }`}
                style={{ fontFamily: "var(--font-body)" }}
                title="not created in this session"
              >
                ext
              </span>
            )}
          </div>
          <div
            className={`text-[10px] truncate ${
              active ? "text-[var(--color-paper)]/60" : "text-[var(--color-ash)]"
            }`}
            style={{ fontFamily: "var(--font-body)" }}
          >
            {sandbox.id}
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className={`opacity-0 group-hover:opacity-100 text-[10px] uppercase tracking-wider px-1.5 py-0.5 shrink-0 ${
            active
              ? "text-[var(--color-paper)] hover:text-[#ef4444]"
              : "text-[var(--color-ash)] hover:text-[#dc2626]"
          }`}
          title="stop and remove this sandbox"
        >
          ×
        </button>
      </div>
    </div>
  );
}

function StatusChip({ status, active }: { status: SandboxStatus; active: boolean }) {
  const palette: Record<SandboxStatus, { color: string; glyph: string }> = active
    ? {
        running: { color: "text-[#86efac]", glyph: "●" },
        stopped: { color: "text-[var(--color-paper)]/60", glyph: "■" },
        crashed: { color: "text-[#fca5a5]", glyph: "⚠" },
        draining: { color: "text-[#fcd34d]", glyph: "…" },
      }
    : {
        running: { color: "text-[#16a34a]", glyph: "●" },
        stopped: { color: "text-[var(--color-ash)]", glyph: "■" },
        crashed: { color: "text-[#dc2626]", glyph: "⚠" },
        draining: { color: "text-[#d97706]", glyph: "…" },
      };
  const { color, glyph } = palette[status];
  return (
    <span
      className={`shrink-0 inline-flex items-center gap-1 text-[9px] uppercase tracking-[0.18em] ${color}`}
      style={{ fontFamily: "var(--font-body)" }}
    >
      <span aria-hidden>{glyph}</span>
      {status}
    </span>
  );
}

function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="px-4 py-3 border-b border-[var(--color-ink)]/15 flex items-center justify-between">
      <span
        className="text-[10px] uppercase tracking-[0.3em] text-[var(--color-rust)]"
        style={{ fontFamily: "var(--font-body)" }}
      >
        {title}
      </span>
      {action}
    </div>
  );
}
