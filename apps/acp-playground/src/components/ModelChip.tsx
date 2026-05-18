import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useModelChooser } from "@beamhop/acp-ui";
import { cn } from "../lib/cn.js";

/**
 * Header-bar model picker. Pure rendering on top of `useModelChooser`. When
 * the agent doesn't expose models, renders a disabled "model: —" stub so
 * users can see the field exists but nothing's available.
 */
export function ModelChip() {
  const { catalog, supported, switching, lastError, setModel } = useModelChooser();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const current = catalog?.models.find((m) => m.id === catalog.currentModelId);
  const label = current?.name ?? "—";

  if (!supported) {
    return (
      <div
        className="flex items-baseline gap-1.5 leading-none opacity-40 cursor-not-allowed"
        data-testid="model-chip"
        data-model-supported="false"
        title="this agent does not expose model selection over ACP"
      >
        <span className="text-[9px] uppercase tracking-[0.2em] text-fog">model</span>
        <span className="text-[11px] tabular-nums text-bone">—</span>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className="relative leading-none"
      data-testid="model-chip"
      data-model-supported="true"
      data-current-model={catalog?.currentModelId ?? ""}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={switching}
        className={cn(
          "flex items-baseline gap-1.5 px-1 py-0.5 border border-transparent hover:border-rule transition-colors",
          open && "border-amber",
          switching && "opacity-50 cursor-wait",
        )}
        data-testid="model-chip-trigger"
      >
        <span className="text-[9px] uppercase tracking-[0.2em] text-fog">model</span>
        <span className="text-[11px] tabular-nums text-bone max-w-[180px] truncate">
          {switching ? "switching…" : label}
        </span>
        <ChevronDown
          className={cn("h-3 w-3 text-fog transition-transform", open && "rotate-180")}
        />
      </button>

      {open && catalog && (
        <ul
          role="listbox"
          className="absolute right-0 top-[calc(100%+4px)] z-50 w-[280px] max-h-[360px] overflow-y-auto bg-ink-2 border border-rule divide-y divide-[var(--color-rule-soft)]"
          data-testid="model-menu"
        >
          {catalog.models.map((m) => {
            const active = m.id === catalog.currentModelId;
            return (
              <li
                key={m.id}
                role="option"
                aria-selected={active}
                data-testid="model-item"
                data-model-id={m.id}
                onMouseDown={async (e) => {
                  e.preventDefault();
                  setOpen(false);
                  if (!active) await setModel(m.id);
                }}
                className={cn(
                  "px-3 py-2 cursor-pointer text-left",
                  active ? "bg-ink-3" : "hover:bg-ink-3",
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className={cn(
                      "text-[12px] truncate",
                      active ? "text-amber" : "text-bone",
                    )}
                  >
                    {m.name}
                  </span>
                  {active && (
                    <span className="text-[9px] uppercase tracking-[0.2em] text-amber shrink-0">
                      current
                    </span>
                  )}
                </div>
                {m.description && (
                  <div className="text-[10px] text-fog mt-0.5 truncate">{m.description}</div>
                )}
                <div className="text-[9px] text-fog mt-0.5 truncate font-mono">{m.id}</div>
              </li>
            );
          })}
          {lastError && (
            <li className="px-3 py-2 bg-[color-mix(in_srgb,var(--color-rust)_10%,transparent)]">
              <div className="text-[9px] uppercase tracking-[0.2em] text-rust">
                last rejection · {lastError.code}
              </div>
              <div className="text-[11px] text-bone mt-0.5">{lastError.message}</div>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
