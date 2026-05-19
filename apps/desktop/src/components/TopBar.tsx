export function TopBar({
  sandboxCount,
  sessionCount,
  shareCount,
  connected,
}: {
  sandboxCount: number;
  sessionCount: number;
  shareCount: number;
  connected: boolean;
}) {
  return (
    <header className="border-b-2 border-[var(--color-ink)] bg-[var(--color-paper-deep)] px-5 py-3 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3">
          <span
            className="text-[var(--color-amber)] text-xl font-bold leading-none"
            style={{ fontFamily: "var(--font-body)" }}
          >
            ▲
          </span>
          <span
            className="text-xs uppercase tracking-[0.3em]"
            style={{ fontFamily: "var(--font-body)" }}
          >
            beamhop / host
          </span>
        </div>
        <div className="h-4 w-px bg-[var(--color-ink)]/30" />
        <div
          className="flex items-center gap-4 text-[10px] uppercase tracking-[0.25em] text-[var(--color-ash)]"
          style={{ fontFamily: "var(--font-body)" }}
        >
          <span>
            <span className="text-[var(--color-ink)] font-medium tabular-nums">
              {sandboxCount}
            </span>{" "}
            sandboxes
          </span>
          <span>
            <span className="text-[var(--color-ink)] font-medium tabular-nums">
              {sessionCount}
            </span>{" "}
            sessions
          </span>
          <span>
            <span className="text-[var(--color-ink)] font-medium tabular-nums">
              {shareCount}
            </span>{" "}
            shared
          </span>
        </div>
      </div>
      <div
        className="flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-[var(--color-ash)]"
        style={{ fontFamily: "var(--font-body)" }}
      >
        <span
          className={`w-2 h-2 rounded-full ${connected ? "bg-[#16a34a]" : "bg-[var(--color-amber)] pulse-amber"}`}
        />
        <span>{connected ? "sidecar · live" : "sidecar · connecting"}</span>
      </div>
    </header>
  );
}
