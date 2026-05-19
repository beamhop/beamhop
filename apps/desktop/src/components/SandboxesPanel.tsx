import { useMemo, useState } from "react";
import type { SandboxStatus, SandboxView } from "../../sidecar/protocol.ts";
import type { SidecarApi, SidecarClient } from "../lib/sidecar-client.ts";
import { NewSandboxDialog } from "./NewSandboxDialog.tsx";

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

  const handlePurge = () => {
    if (stoppedOrCrashed.length === 0) return;
    void api.removeManySandboxes(
      stoppedOrCrashed.map((s) => s.id),
      false,
    );
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
        if (rest.length > 0) void api.removeManySandboxes(rest, false);
        clearSelection();
        return;
      }
      force = true;
    }
    void api.removeManySandboxes(liveSelected, force);
    clearSelection();
  };

  const handleRemoveAll = () => {
    if (sandboxes.length === 0) return;
    // eslint-disable-next-line no-alert
    const ok = window.confirm(
      `Stop and remove ALL ${sandboxes.length} sandboxes?`,
    );
    if (!ok) return;
    void api.removeManySandboxes(
      sandboxes.map((s) => s.id),
      true,
    );
    clearSelection();
  };

  const handleRemoveOne = (s: SandboxView) => {
    if (s.status === "running" || s.status === "draining") {
      // eslint-disable-next-line no-alert
      const ok = window.confirm("Stop and remove this running sandbox?");
      if (!ok) return;
    }
    void api.removeSandbox(s.id);
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

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {sandboxes.length === 0 && (
          <div
            className="px-3 py-8 text-center text-[var(--color-ash)] text-xs"
            style={{ fontFamily: "var(--font-body)" }}
          >
            no sandboxes. press <b>+ new</b> to build or boot one.
          </div>
        )}
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
      {dialogOpen && (
        <NewSandboxDialog
          api={api}
          client={client}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </aside>
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
