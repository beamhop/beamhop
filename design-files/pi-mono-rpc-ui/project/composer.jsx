/* ============================================================
   composer.jsx — prompt input, model & thinking pickers,
   steer / follow-up / abort controls
   ============================================================ */
const { useState: kuseState, useRef: kuseRef, useEffect: kuseEffect } = React;

function Popover({ children, onClose }) {
  const ref = kuseRef(null);
  kuseEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const k = (e) => { if (e.key === "Escape") onClose(); };
    setTimeout(() => document.addEventListener("mousedown", h), 0);
    document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
  }, []);
  return <div className="popover" ref={ref}>{children}</div>;
}

function ModelPicker({ models, current, onPick, onClose }) {
  return (
    <Popover onClose={onClose}>
      <div className="pop-title eyebrow">Model · {models.length} configured</div>
      <div className="pop-list">
        {models.map((m) => (
          <button key={m.id} className={"pop-row" + (m.name === current ? " on" : "")}
            onClick={() => { onPick(m); onClose(); }}>
            <span className="provdot" style={{ background: PROVIDER_DOT[m.provider] }} />
            <span className="pop-name">{m.name}</span>
            <span className="pop-sub mono">{(m.contextWindow / 1000) | 0}k · ${m.cost.input}/${m.cost.output}</span>
            {m.reasoning && <span className="reasonpip mono" title="supports reasoning">✦</span>}
            {m.name === current && <span className="pop-check">✓</span>}
          </button>
        ))}
      </div>
      <div className="pop-foot mono">cycle_model · ⌘M</div>
    </Popover>
  );
}

function ThinkingPicker({ levels, current, onPick, onClose }) {
  return (
    <Popover onClose={onClose}>
      <div className="pop-title eyebrow">Thinking level</div>
      <div className="thinkscale">
        {levels.map((lv) => (
          <button key={lv} className={"thinkstep" + (lv === current ? " on" : "")}
            onClick={() => { onPick(lv); onClose(); }}>
            <span className="thinkbar" style={{
              height: 6 + levels.indexOf(lv) * 4,
              background: lv === current ? "var(--violet)" : "var(--line-strong)",
            }} />
            <span className="thinklv mono">{lv}</span>
          </button>
        ))}
      </div>
      <div className="pop-foot mono">xhigh · codex-max only</div>
    </Popover>
  );
}

function Composer(props) {
  const { streaming, model, models, onPickModel, thinking, onSetThinking,
    onSend, onAbort, queueMode, setQueueMode, onSlash, onOpenPalette } = props;
  const [text, setText] = kuseState("");
  const [showModel, setShowModel] = kuseState(false);
  const [showThink, setShowThink] = kuseState(false);
  const ta = kuseRef(null);

  kuseEffect(() => {
    if (ta.current) { ta.current.style.height = "auto"; ta.current.style.height = Math.min(ta.current.scrollHeight, 200) + "px"; }
  }, [text]);

  // ---- slash command autocomplete ----
  const [slashSel, setSlashSel] = kuseState(0);
  const slashOpen = text.startsWith("/") && !text.slice(1).includes(" ");
  const slashQuery = slashOpen ? text.slice(1).toLowerCase() : "";
  const slashMatches = slashOpen
    ? PI_COMMANDS.filter((c) => c.name.toLowerCase().includes(slashQuery)).slice(0, 7)
    : [];
  kuseEffect(() => { setSlashSel(0); }, [text]);

  const pickSlash = (c) => { if (!c) return; setText(""); onSlash(c); };

  const submit = () => {
    const v = text.trim();
    if (!v) return;
    if (slashOpen && slashMatches.length) { pickSlash(slashMatches[Math.min(slashSel, slashMatches.length - 1)]); return; }
    onSend(v, streaming ? queueMode : "prompt");
    setText("");
  };
  const onKey = (e) => {
    if (slashOpen && slashMatches.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSlashSel((s) => Math.min(slashMatches.length - 1, s + 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSlashSel((s) => Math.max(0, s - 1)); return; }
      if (e.key === "Tab") { e.preventDefault(); pickSlash(slashMatches[Math.min(slashSel, slashMatches.length - 1)]); return; }
      if (e.key === "Escape") { e.preventDefault(); setText(""); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  const sendLabel = streaming ? (queueMode === "steer" ? "Steer" : "Follow-up") : "Send";

  return (
    <div className="composer">
      {streaming && (
        <div className="runbar">
          <span className="runpulse" />
          <span className="runtext mono">agent streaming</span>
          <div className="queuetoggle">
            <button className={queueMode === "steer" ? "on" : ""} onClick={() => setQueueMode("steer")}>steer</button>
            <button className={queueMode === "followUp" ? "on" : ""} onClick={() => setQueueMode("followUp")}>follow-up</button>
          </div>
          <span className="runspacer" />
          <button className="abortbtn" onClick={onAbort}>✕ Abort <span className="kbd mono">esc</span></button>
        </div>
      )}
      <div className={"inputwrap" + (streaming ? " streaming" : "")}>
        {slashOpen && slashMatches.length > 0 && (
          <div className="slashmenu">
            <div className="slashhdr eyebrow">Commands · prefix with /</div>
            {slashMatches.map((c, i) => {
              const src = CMD_SOURCE[c.source];
              return (
                <button key={c.name} className={"slashrow" + (i === slashSel ? " sel" : "")}
                  onMouseEnter={() => setSlashSel(i)} onMouseDown={(e) => { e.preventDefault(); pickSlash(c); }}>
                  <span className="slashglyph" style={{ color: src.c }}>{src.glyph}</span>
                  <span className="slashname mono">/{c.name}</span>
                  <span className="slashdesc">{c.desc}</span>
                  <span className="slashsrc mono" style={{ color: src.c }}>{src.label}</span>
                  {c.loc && <span className="slashloc mono">{c.loc}</span>}
                </button>
              );
            })}
            <div className="slashfoot mono">↑↓ select · ⏎ run · esc dismiss</div>
          </div>
        )}
        <textarea
          ref={ta} className="prompt mono" rows={1} value={text}
          placeholder={streaming ? "Queue a message while pi runs…" : "Message pi —  ⏎ to send,  ⇧⏎ for newline,  / for commands"}
          onChange={(e) => setText(e.target.value)} onKeyDown={onKey}
        />
        <div className="inputbar">
          <div className="chiprow">
            <div className="chipwrap">
              <button className="chip" onClick={() => setShowModel((s) => !s)}>
                <span className="provdot" style={{ background: PROVIDER_DOT[(models.find((m) => m.name === model) || {}).provider] }} />
                {model}
                <span className="chevdown">▾</span>
              </button>
              {showModel && <ModelPicker models={models} current={model} onPick={onPickModel} onClose={() => setShowModel(false)} />}
            </div>
            <div className="chipwrap">
              <button className="chip" onClick={() => setShowThink((s) => !s)}>
                <span className="thinkglyph" style={{ color: "var(--violet)" }}>✦</span>
                {thinking}
                <span className="chevdown">▾</span>
              </button>
              {showThink && <ThinkingPicker levels={THINKING_LEVELS} current={thinking} onPick={onSetThinking} onClose={() => setShowThink(false)} />}
            </div>
            <button className="chip ghost" title="Attach image">＋ image</button>
            <button className="chip ghost" title="Slash commands"
              onClick={() => { setText("/"); if (ta.current) ta.current.focus(); }}>/ commands</button>
            <button className="chip ghost" title="Command palette" onClick={onOpenPalette}>
              <span className="mono">⌘K</span> palette
            </button>
          </div>
          <button className={"sendbtn" + (streaming ? " queue" : "")} onClick={submit} disabled={!text.trim()}>
            {sendLabel} <span className="kbd mono">⏎</span>
          </button>
        </div>
      </div>
    </div>
  );
}

window.Composer = Composer;
