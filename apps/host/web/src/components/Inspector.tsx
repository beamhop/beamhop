import type { QueueState, RpcEvent, Stats, Toggles } from "../types";
import { Ring } from "./inspector/Ring";
import { Meter } from "./inspector/Meter";
import { Toggle } from "./inspector/Toggle";
import { Section } from "./inspector/Section";
import { EventTicker } from "./inspector/EventTicker";

export interface InspectorProps {
  stats: Stats;
  queue: QueueState;
  toggles: Toggles;
  onToggle: (k: keyof Toggles, v: boolean) => void;
  onCompact: () => void;
  onFork: () => void;
  onClone: () => void;
  onExport: () => void;
  events: RpcEvent[];
  streaming: boolean;
}

export function Inspector({
  stats,
  queue,
  toggles,
  onToggle,
  onCompact,
  onFork,
  onClone,
  onExport,
  events,
  streaming,
}: InspectorProps) {
  const pct = (stats.contextTokens / Math.max(1, stats.contextWindow)) * 100;
  return (
    <aside className="inspector" data-testid="inspector">
      <Section
        title="Context window"
        right={
          <span className="mono ctxnums">
            {(stats.contextTokens / 1000).toFixed(0)}k / {(stats.contextWindow / 1000) | 0}k
          </span>
        }
      >
        <div className="ctxrow">
          <Ring pct={pct} />
          <div className="ctxmeters">
            <Meter label="input" val={stats.input} total={stats.contextWindow} color="var(--blue)" />
            <Meter label="output" val={stats.output} total={stats.contextWindow} color="var(--violet)" />
            <Meter label="cache rd" val={stats.cacheRead} total={stats.contextWindow} color="var(--green)" />
          </div>
        </div>
        <button className="compactbtn" onClick={onCompact} data-testid="inspector-compact">
          ⤵ Compact context now
        </button>
      </Section>

      <Section
        title="Cost · this session"
        right={<span className="costbig mono">${stats.cost.toFixed(4)}</span>}
      >
        <div className="costgrid mono">
          <div>
            <span>{stats.input >= 1000 ? (stats.input / 1000).toFixed(1) + "k" : stats.input}</span>
            <label>input tok</label>
          </div>
          <div>
            <span>{(stats.output / 1000).toFixed(1)}k</span>
            <label>output tok</label>
          </div>
          <div>
            <span>{(stats.cacheRead / 1000).toFixed(0)}k</span>
            <label>cache read</label>
          </div>
          <div>
            <span>{stats.toolCalls}</span>
            <label>tool calls</label>
          </div>
        </div>
      </Section>

      <Section
        title="Queue"
        right={
          <span className="mono qcount">
            {queue.steering.length + queue.followUp.length} pending
          </span>
        }
      >
        {queue.steering.length === 0 && queue.followUp.length === 0 && (
          <div className="qempty mono">no queued messages</div>
        )}
        {queue.steering.map((m, i) => (
          <div className="qitem steer" key={"s" + i}>
            <span className="qtag mono">steer</span>
            <span className="qtext">{m}</span>
          </div>
        ))}
        {queue.followUp.map((m, i) => (
          <div className="qitem follow" key={"f" + i}>
            <span className="qtag mono">follow-up</span>
            <span className="qtext">{m}</span>
          </div>
        ))}
      </Section>

      <Section title="Automation">
        <Toggle
          on={toggles.autoCompact}
          onChange={(v) => onToggle("autoCompact", v)}
          label="Auto-compaction"
          sub="summarize at 85% context"
          testid="inspector-toggle-autoCompact"
        />
        <Toggle
          on={toggles.autoRetry}
          onChange={(v) => onToggle("autoRetry", v)}
          label="Auto-retry"
          sub="on 429 · overloaded · 5xx"
          testid="inspector-toggle-autoRetry"
        />
      </Section>

      <Section title="Session">
        <div className="actgrid">
          <button className="actbtn" onClick={onFork} data-testid="inspector-fork">
            <span className="actglyph">⑂</span>Fork
          </button>
          <button className="actbtn" onClick={onClone} data-testid="inspector-clone">
            <span className="actglyph">⧉</span>Clone
          </button>
          <button className="actbtn" onClick={onExport} data-testid="inspector-export">
            <span className="actglyph">↗</span>Export HTML
          </button>
          <button className="actbtn" data-testid="inspector-switch">
            <span className="actglyph">⤓</span>Switch
          </button>
        </div>
      </Section>

      <Section
        title="RPC event stream"
        right={
          <span className={"livedot mono" + (streaming ? " live" : "")}>
            {streaming ? "● live" : "○ idle"}
          </span>
        }
      >
        <EventTicker events={events} />
      </Section>
    </aside>
  );
}
