/* ============================================================
   inspector.jsx — context/cost dashboard, queue, controls, event ticker
   ============================================================ */
const { useRef: iuseRef, useEffect: iuseEffect } = React;

function Ring({ pct }) {
  const R = 34, C = 2 * Math.PI * R;
  const off = C * (1 - Math.min(pct, 100) / 100);
  const col = pct > 85 ? "var(--red)" : pct > 65 ? "var(--amber)" : "var(--accent)";
  return (
    <svg width="84" height="84" viewBox="0 0 84 84" className="ring">
      <circle cx="42" cy="42" r={R} fill="none" stroke="var(--line)" strokeWidth="7" />
      <circle cx="42" cy="42" r={R} fill="none" stroke={col} strokeWidth="7" strokeLinecap="round"
        strokeDasharray={C} strokeDashoffset={off} transform="rotate(-90 42 42)"
        style={{ transition: "stroke-dashoffset .5s ease, stroke .3s" }} />
      <text x="42" y="39" textAnchor="middle" className="ringpct">{Math.round(pct)}<tspan className="ringpctsign">%</tspan></text>
      <text x="42" y="54" textAnchor="middle" className="ringcap">context</text>
    </svg>
  );
}

function Meter({ label, val, total, color }) {
  return (
    <div className="meter">
      <div className="meterhead">
        <span className="meterlabel mono">{label}</span>
        <span className="meterval mono">{val >= 1000 ? (val / 1000).toFixed(1) + "k" : val}</span>
      </div>
      <div className="metertrack">
        <span className="meterfill" style={{ width: Math.min(100, (val / total) * 100) + "%", background: color }} />
      </div>
    </div>
  );
}

function Toggle({ on, onChange, label, sub }) {
  return (
    <button className="togrow" onClick={() => onChange(!on)}>
      <span className="togcol">
        <span className="toglabel">{label}</span>
        <span className="togsub mono">{sub}</span>
      </span>
      <span className={"toggle" + (on ? " on" : "")}><span className="knob" /></span>
    </button>
  );
}

const EVENT_COLOR = {
  agent_start: "var(--blue)", agent_end: "var(--blue)", turn_start: "var(--tx-faint)", turn_end: "var(--tx-faint)",
  message_start: "var(--tx-faint)", message_update: "var(--violet)",
  tool_execution_start: "var(--amber)", tool_execution_update: "var(--amber)", tool_execution_end: "var(--green)",
  extension_ui_request: "var(--red)", queue_update: "var(--tx-dim)", compaction_start: "var(--amber)", compaction_end: "var(--green)",
};

function EventTicker({ events }) {
  const ref = iuseRef(null);
  iuseEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [events]);
  return (
    <div className="ticker" ref={ref}>
      {events.length === 0 && <div className="tickempty mono">idle · waiting for command</div>}
      {events.map((e, i) => (
        <div className="tickrow mono" key={i}>
          <span className="tickdot" style={{ background: EVENT_COLOR[e.k] || "var(--tx-faint)" }} />
          <span className="tickname" style={{ color: EVENT_COLOR[e.k] || "var(--tx-dim)" }}>{e.k}</span>
          {e.name && <span className="tickarg">{e.name}</span>}
          {e.d && <span className="tickarg">{e.d}</span>}
          {e.method && <span className="tickarg">{e.method}</span>}
          {e.aborted && <span className="tickarg" style={{ color: "var(--red)" }}>aborted</span>}
        </div>
      ))}
    </div>
  );
}

function Section({ title, right, children }) {
  return (
    <div className="isection">
      <div className="ihdr"><span className="eyebrow">{title}</span>{right}</div>
      {children}
    </div>
  );
}

function Inspector(props) {
  const { stats, queue, toggles, onToggle, onCompact, onFork, onClone, onExport, events, streaming } = props;
  const pct = (stats.contextTokens / stats.contextWindow) * 100;
  return (
    <aside className="inspector">
      <Section title="Context window" right={<span className="mono ctxnums">{(stats.contextTokens / 1000).toFixed(0)}k / {(stats.contextWindow / 1000) | 0}k</span>}>
        <div className="ctxrow">
          <Ring pct={pct} />
          <div className="ctxmeters">
            <Meter label="input" val={stats.input} total={stats.contextWindow} color="var(--blue)" />
            <Meter label="output" val={stats.output} total={stats.contextWindow} color="var(--violet)" />
            <Meter label="cache rd" val={stats.cacheRead} total={stats.contextWindow} color="var(--green)" />
          </div>
        </div>
        <button className="compactbtn" onClick={onCompact}>
          ⤵ Compact context now
        </button>
      </Section>

      <Section title="Cost · this session" right={<span className="costbig mono">${stats.cost.toFixed(4)}</span>}>
        <div className="costgrid mono">
          <div><span>{stats.input >= 1000 ? (stats.input / 1000).toFixed(1) + "k" : stats.input}</span><label>input tok</label></div>
          <div><span>{(stats.output / 1000).toFixed(1)}k</span><label>output tok</label></div>
          <div><span>{(stats.cacheRead / 1000).toFixed(0)}k</span><label>cache read</label></div>
          <div><span>{stats.toolCalls}</span><label>tool calls</label></div>
        </div>
      </Section>

      <Section title="Queue" right={
        <span className="mono qcount">{queue.steering.length + queue.followUp.length} pending</span>
      }>
        {queue.steering.length === 0 && queue.followUp.length === 0 && (
          <div className="qempty mono">no queued messages</div>
        )}
        {queue.steering.map((m, i) => (
          <div className="qitem steer" key={"s" + i}><span className="qtag mono">steer</span><span className="qtext">{m}</span></div>
        ))}
        {queue.followUp.map((m, i) => (
          <div className="qitem follow" key={"f" + i}><span className="qtag mono">follow-up</span><span className="qtext">{m}</span></div>
        ))}
      </Section>

      <Section title="Automation">
        <Toggle on={toggles.autoCompact} onChange={(v) => onToggle("autoCompact", v)}
          label="Auto-compaction" sub="summarize at 85% context" />
        <Toggle on={toggles.autoRetry} onChange={(v) => onToggle("autoRetry", v)}
          label="Auto-retry" sub="on 429 · overloaded · 5xx" />
      </Section>

      <Section title="Session">
        <div className="actgrid">
          <button className="actbtn" onClick={onFork}><span className="actglyph">⑂</span>Fork</button>
          <button className="actbtn" onClick={onClone}><span className="actglyph">⧉</span>Clone</button>
          <button className="actbtn" onClick={onExport}><span className="actglyph">↗</span>Export HTML</button>
          <button className="actbtn"><span className="actglyph">⤓</span>Switch</button>
        </div>
      </Section>

      <Section title="RPC event stream" right={<span className={"livedot mono" + (streaming ? " live" : "")}>{streaming ? "● live" : "○ idle"}</span>}>
        <EventTicker events={events} />
      </Section>
    </aside>
  );
}

window.Inspector = Inspector;
