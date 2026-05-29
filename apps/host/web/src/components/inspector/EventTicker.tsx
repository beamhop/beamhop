import { useEffect, useRef } from "react";
import type { RpcEvent } from "../../types";

/** Per-event-kind dot/name colors for the RPC stream ticker. */
const EVENT_COLOR: Record<string, string> = {
  agent_start: "var(--blue)",
  agent_end: "var(--blue)",
  turn_start: "var(--tx-faint)",
  turn_end: "var(--tx-faint)",
  message_start: "var(--tx-faint)",
  message_update: "var(--violet)",
  tool_execution_start: "var(--amber)",
  tool_execution_update: "var(--amber)",
  tool_execution_end: "var(--green)",
  extension_ui_request: "var(--red)",
  queue_update: "var(--tx-dim)",
  compaction_start: "var(--amber)",
  compaction_end: "var(--green)",
};

/** Auto-scrolling list of recent RPC events. */
export function EventTicker({ events }: { events: RpcEvent[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [events]);
  return (
    <div className="ticker" ref={ref} data-testid="inspector-ticker">
      {events.length === 0 && <div className="tickempty mono">idle · waiting for command</div>}
      {events.map((e, i) => (
        <div className="tickrow mono" key={i}>
          <span className="tickdot" style={{ background: EVENT_COLOR[e.k] || "var(--tx-faint)" }} />
          <span className="tickname" style={{ color: EVENT_COLOR[e.k] || "var(--tx-dim)" }}>
            {e.k}
          </span>
          {e.name && <span className="tickarg">{e.name}</span>}
          {e.d && <span className="tickarg">{e.d}</span>}
          {e.method && <span className="tickarg">{e.method}</span>}
          {e.aborted && (
            <span className="tickarg" style={{ color: "var(--red)" }}>
              aborted
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
