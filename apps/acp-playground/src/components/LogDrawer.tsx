import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { LogEntry, WireError } from "@beamhop/acp-protocol";
import { cn } from "../lib/cn.js";

const LEVEL_COLOR: Record<string, string> = {
  debug: "text-fog",
  info: "text-bone",
  warn: "text-amber",
  error: "text-rust",
};

export function LogDrawer({
  logs,
  lastError,
}: {
  logs: LogEntry[];
  lastError: WireError | null;
}) {
  const [open, setOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logs.length]);

  return (
    <aside
      className={cn(
        "shrink-0 border-l border-rule bg-ink flex flex-col transition-[width] duration-150 ease-out",
        open ? "w-[360px]" : "w-[44px]",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="h-12 flex items-center justify-between px-3 border-b border-rule hover:bg-ink-1 text-left"
        aria-label={open ? "collapse log" : "expand log"}
      >
        <span
          className={cn(
            "text-[10px] uppercase tracking-[0.22em] text-fog",
            !open && "hidden",
          )}
        >
          telemetry · {logs.length}
        </span>
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 text-fog transition-transform duration-150",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <>
          {lastError && (
            <div className="px-4 py-3 border-b border-rule bg-[color-mix(in_srgb,var(--color-rust)_8%,transparent)]">
              <div className="text-[9px] uppercase tracking-[0.2em] text-rust mb-1">
                last error · {lastError.code}
              </div>
              <div className="text-[11px] text-bone leading-relaxed">
                {lastError.message}
              </div>
              {lastError.hint && (
                <div className="text-[10px] text-fog mt-1.5 italic">
                  hint: {lastError.hint}
                </div>
              )}
            </div>
          )}

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-2 space-y-1.5">
            {logs.length === 0 ? (
              <div className="text-[10px] text-fog italic py-2">
                waiting for telemetry…
              </div>
            ) : (
              logs.map((l, i) => <LogLine key={i} entry={l} />)
            )}
          </div>

          <div className="border-t border-rule px-4 py-2 text-[9px] uppercase tracking-[0.2em] text-fog leading-relaxed">
            server-side log stream
          </div>
        </>
      )}
    </aside>
  );
}

function LogLine({ entry }: { entry: LogEntry }) {
  return (
    <div className="text-[11px] leading-[1.45] font-mono">
      <div className="flex items-baseline gap-2">
        <span className="text-[9px] tabular-nums text-fog w-[52px] shrink-0">
          {new Date(entry.ts).toISOString().slice(11, 19)}
        </span>
        <span
          className={cn(
            "text-[9px] uppercase tracking-[0.18em] w-12 shrink-0",
            LEVEL_COLOR[entry.level] ?? "text-bone",
          )}
        >
          {entry.level}
        </span>
        <span className="text-bone break-words min-w-0">{entry.message}</span>
      </div>
      {entry.context && Object.keys(entry.context).length > 0 && (
        <div className="ml-[78px] text-[10px] text-fog truncate">
          {Object.entries(entry.context)
            .map(([k, v]) => `${k}=${stringify(v)}`)
            .join("  ")}
        </div>
      )}
    </div>
  );
}

function stringify(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
