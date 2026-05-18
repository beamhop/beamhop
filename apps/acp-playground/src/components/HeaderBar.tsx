import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import type { AcpStatus } from "@beamhop/acp-ui";
import { Button } from "./ui/button.js";
import { ModelChip } from "./ModelChip.js";

export function HeaderBar({
  status,
  sessionId,
  agentId,
  latencyMs,
}: {
  status: AcpStatus;
  sessionId: string | null;
  agentId: string;
  latencyMs: number | null;
}) {
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    document.documentElement.classList.contains("light") ? "light" : "dark",
  );

  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  return (
    <header className="h-12 flex items-center justify-between px-6 border-b border-rule bg-ink">
      <div className="flex items-center gap-5">
        <div className="font-display text-[15px] tracking-tight leading-none">
          beamhop<span className="text-amber">/</span>acp
        </div>
        <span className="text-fog text-[10px] tracking-[0.2em] uppercase">
          agent client protocol · bridge v0
        </span>
      </div>

      <div className="flex items-center gap-6">
        <Telemetry label="session" value={sessionId ? sessionId.slice(0, 8) : "—"} />
        <Telemetry label="agent" value={agentId} />
        <ModelChip />
        <Telemetry label="rtt" value={latencyMs == null ? "—" : `${latencyMs}ms`} />
        <StatusIndicator status={status} />
        <Button
          variant="ghost"
          size="icon"
          aria-label="toggle theme"
          onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        >
          {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </header>
  );
}

function Telemetry({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5 leading-none">
      <span className="text-[9px] uppercase tracking-[0.2em] text-fog">{label}</span>
      <span className="text-[11px] tabular-nums text-bone">{value}</span>
    </div>
  );
}

function StatusIndicator({ status }: { status: AcpStatus }) {
  const cfg: Record<AcpStatus, { label: string; cls: string; pulse: boolean }> = {
    connecting: { label: "connecting", cls: "text-amber", pulse: true },
    ready: { label: "ready", cls: "text-moss", pulse: false },
    reconnecting: { label: "reconnecting", cls: "text-amber", pulse: true },
    closed: { label: "offline", cls: "text-fog", pulse: false },
    error: { label: "error", cls: "text-rust", pulse: true },
  };
  const c = cfg[status];
  return (
    <div className={`flex items-center gap-1.5 leading-none ${c.cls}`}>
      <span className={`dot ${c.pulse ? "dot-pulse" : ""}`} />
      <span className="text-[10px] uppercase tracking-[0.2em]">{c.label}</span>
    </div>
  );
}
