import { useEffect, useMemo, useRef, useState } from "react";
import type {
  BuildDetail,
  BuildEvent,
  BuildStatus,
  BuildView,
} from "../../sidecar/protocol.ts";
import type { SidecarApi, SidecarClient } from "../lib/sidecar-client.ts";

interface StepRow {
  index: number;
  label: string;
  status: "pending" | "running" | "succeeded" | "failed";
  startedAt?: number;
  durationMs?: number;
  exitCode?: number;
}

/**
 * Live view of a build: step timeline + log stream. Hydrates from
 * `builds.get(buildId)` and follows `build:event` / `build:state` for
 * live tail. Safe to mount/unmount repeatedly — the sidecar retains state.
 */
export function BuildLogView({
  buildId,
  api,
  client,
  compact = false,
  onClosed,
}: {
  buildId: string;
  api: SidecarApi;
  client: SidecarClient;
  /** Compact mode hides the header (caller renders its own). */
  compact?: boolean;
  /** Invoked when the build has reached a terminal status. */
  onClosed?: (status: BuildStatus) => void;
}) {
  const [view, setView] = useState<BuildView | null>(null);
  const [steps, setSteps] = useState<StepRow[]>([]);
  const [selectedStep, setSelectedStep] = useState<number | "all">("all");
  // Map of stepIndex -> joined stdout/stderr text. Stored separately so the
  // log pane can render the selected step without re-walking every event.
  const [logByStep, setLogByStep] = useState<Record<number, string>>({});
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

  // Apply a BuildEvent to component state. Used both for replay (during
  // initial fetch) and for live tail (subscription).
  const applyEvent = (ev: BuildEvent) => {
    if (ev.kind === "step:start") {
      setSteps((cur) => upsertStep(cur, {
        index: ev.index,
        label: ev.label,
        status: "running",
        startedAt: Date.now(),
      }));
    } else if (ev.kind === "step:end") {
      setSteps((cur) =>
        upsertStep(cur, {
          index: ev.index,
          label: cur.find((s) => s.index === ev.index)?.label ?? `step ${ev.index}`,
          status: ev.exitCode === 0 ? "succeeded" : "failed",
          durationMs: ev.durationMs,
          exitCode: ev.exitCode,
        }),
      );
    } else if (ev.kind === "step:stdout" || ev.kind === "step:stderr") {
      setLogByStep((cur) => ({
        ...cur,
        [ev.index]: (cur[ev.index] ?? "") + ev.text,
      }));
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setSteps([]);
    setLogByStep({});

    (async () => {
      try {
        const detail: BuildDetail = await api.getBuild(buildId);
        if (cancelled) return;
        setView(detail);
        setTruncated(detail.truncated);
        for (const ev of detail.events) applyEvent(ev);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    })();

    const offEvent = client.on("build:event", (data) => {
      if (data.buildId !== buildId) return;
      applyEvent(data.event);
    });
    const offState = client.on("build:state", (data) => {
      if (data.buildId !== buildId) return;
      setView(data);
      if (data.status !== "running") onClosedRef.current?.(data.status);
    });

    return () => {
      cancelled = true;
      offEvent();
      offState();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, client, buildId]);

  const selectedLog = useMemo(() => {
    if (selectedStep === "all") {
      // Concatenate every step's log in index order so the user can read
      // top-to-bottom.
      const indices = Object.keys(logByStep)
        .map(Number)
        .sort((a, b) => a - b);
      return indices.map((i) => logByStep[i]).join("");
    }
    return logByStep[selectedStep] ?? "";
  }, [logByStep, selectedStep]);

  const handleCancel = () => {
    void api.cancelBuild(buildId).catch(() => {});
  };

  if (loading) {
    return (
      <div
        className="px-3 py-6 text-[10px] uppercase tracking-[0.25em] text-[var(--color-ash)]"
        style={{ fontFamily: "var(--font-body)" }}
      >
        loading build {buildId.slice(0, 8)}…
      </div>
    );
  }

  if (loadError) {
    return (
      <div
        className="border border-[#dc2626]/40 bg-[#dc2626]/10 text-[#7f1d1d] px-3 py-2 text-xs"
        style={{ fontFamily: "var(--font-body)" }}
      >
        couldn't load build: {loadError}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 min-h-0" data-testid={`build-${buildId}`}>
      {!compact && view && (
        <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-[var(--color-ink)]/15">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="text-sm truncate"
              style={{ fontFamily: "var(--font-terminal)" }}
            >
              {view.tag}
            </span>
            <BuildStatusChip status={view.status} />
          </div>
          {view.status === "running" && (
            <button
              type="button"
              onClick={handleCancel}
              className="text-[10px] uppercase tracking-[0.25em] px-2 py-1 border border-[#dc2626]/40 text-[#7f1d1d] hover:bg-[#dc2626] hover:text-[var(--color-paper)]"
              style={{ fontFamily: "var(--font-body)" }}
              data-testid="cancel-build"
            >
              cancel
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-[180px_1fr] gap-3 min-h-0 px-3 pb-3">
        <ul
          className="text-[11px] space-y-1 overflow-y-auto max-h-72 border border-[var(--color-ink)]/15 bg-[var(--color-paper-deep)] p-2"
          style={{ fontFamily: "var(--font-body)" }}
        >
          <li>
            <button
              type="button"
              onClick={() => setSelectedStep("all")}
              className={`w-full text-left px-1 py-0.5 ${
                selectedStep === "all" ? "bg-[var(--color-amber)]/30" : "hover:bg-[var(--color-amber)]/10"
              }`}
            >
              all output
            </button>
          </li>
          {steps.map((s) => (
            <li key={s.index}>
              <button
                type="button"
                onClick={() => setSelectedStep(s.index)}
                className={`w-full text-left px-1 py-0.5 flex items-center gap-1 ${
                  selectedStep === s.index ? "bg-[var(--color-amber)]/30" : "hover:bg-[var(--color-amber)]/10"
                }`}
                title={s.label}
              >
                <StepGlyph status={s.status} />
                <span className="truncate">{s.label}</span>
                {s.durationMs !== undefined && (
                  <span className="ml-auto text-[var(--color-ash)] text-[10px]">
                    {formatDuration(s.durationMs)}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
        <div className="flex flex-col min-h-0">
          {truncated && (
            <div
              className="text-[10px] text-[var(--color-ash)] mb-1"
              style={{ fontFamily: "var(--font-body)" }}
            >
              earlier output was trimmed to fit the in-memory cap
            </div>
          )}
          <pre
            className="bg-[var(--color-ink)] text-[var(--color-paper)] p-2 text-[11px] leading-relaxed flex-1 overflow-auto whitespace-pre-wrap break-all max-h-72"
            style={{ fontFamily: "var(--font-terminal)" }}
            data-testid="build-log"
          >
            {selectedLog || (view?.status === "running" ? "waiting for output…" : "(no output)")}
          </pre>
          {view?.error && (
            <div
              className="mt-2 border border-[#dc2626]/40 bg-[#dc2626]/10 text-[#7f1d1d] px-2 py-1 text-[11px] whitespace-pre-wrap"
              style={{ fontFamily: "var(--font-body)" }}
            >
              {view.error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function upsertStep(rows: StepRow[], next: StepRow): StepRow[] {
  const idx = rows.findIndex((r) => r.index === next.index);
  if (idx === -1) return [...rows, next].sort((a, b) => a.index - b.index);
  const out = rows.slice();
  out[idx] = { ...out[idx], ...next };
  return out;
}

function BuildStatusChip({ status }: { status: BuildStatus }) {
  const cls =
    status === "running"
      ? "bg-[var(--color-amber)]/30 text-[var(--color-ink)]"
      : status === "succeeded"
        ? "bg-emerald-500/20 text-emerald-900"
        : status === "cancelled"
          ? "bg-[var(--color-ash)]/20 text-[var(--color-ink)]"
          : "bg-[#dc2626]/20 text-[#7f1d1d]";
  return (
    <span
      className={`text-[9px] uppercase tracking-[0.25em] px-1.5 py-0.5 ${cls}`}
      style={{ fontFamily: "var(--font-body)" }}
    >
      {status}
    </span>
  );
}

function StepGlyph({ status }: { status: StepRow["status"] }) {
  if (status === "running") return <span className="text-[var(--color-amber)]">●</span>;
  if (status === "succeeded") return <span className="text-emerald-700">✓</span>;
  if (status === "failed") return <span className="text-[#dc2626]">✗</span>;
  return <span className="text-[var(--color-ash)]">○</span>;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m${s}s`;
}
