/* ============================================================
   chat.jsx — transcript rendering + composer
   ============================================================ */
const { useState: cuseState, useRef: cuseRef, useEffect: cuseEffect } = React;

/* ---- tiny inline markdown: `code`, **bold** ---- */
function RichText({ text }) {
  if (!text) return null;
  const nodes = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0, m, k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("`")) nodes.push(<code key={k++} className="inlinecode">{tok.slice(1, -1)}</code>);
    else nodes.push(<strong key={k++} style={{ color: "var(--tx-hi)", fontWeight: 600 }}>{tok.slice(2, -2)}</strong>);
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return <>{nodes}</>;
}

function Caret() { return <span className="caret" />; }

/* ---- thinking block ---- */
function ThinkingBlock({ block }) {
  const [open, setOpen] = cuseState(!block.collapsed);
  cuseEffect(() => { if (block.collapsed) setOpen(false); }, [block.collapsed]);
  return (
    <div className="thinkblock">
      <button className="thinkhead" onClick={() => setOpen((o) => !o)}>
        <span className="thinkglyph">✦</span>
        <span className="thinklabel">Thinking</span>
        {block.streaming && <span className="thinkdots"><i /><i /><i /></span>}
        <span className="chev" style={{ transform: open ? "rotate(90deg)" : "none" }}>›</span>
      </button>
      {open && (
        <div className="thinkbody">
          <RichText text={block.text} />{block.streaming && <Caret />}
        </div>
      )}
    </div>
  );
}

/* ---- tool call ---- */
const TOOL_META = {
  read: { c: "var(--blue)", g: "◰" }, grep: { c: "var(--blue)", g: "⌕" },
  write: { c: "var(--green)", g: "✎" }, edit: { c: "var(--green)", g: "↹" },
  bash: { c: "var(--amber)", g: "›_" }, glob: { c: "var(--blue)", g: "✲" },
};
function argSummary(name, args) {
  if (!args) return "";
  if (name === "bash") return args.command;
  if (name === "grep") return `${args.pattern}  ·  ${args.path || ""}`;
  return args.path || JSON.stringify(args);
}
function ToolCall({ block }) {
  const [open, setOpen] = cuseState(false);
  const meta = TOOL_META[block.name] || { c: "var(--tx-dim)", g: "•" };
  const running = block.status === "running";
  const err = block.status === "error";
  return (
    <div className={"toolcall" + (err ? " err" : "")}>
      <button className="toolhead" onClick={() => setOpen((o) => !o)}>
        <span className="toolglyph" style={{ color: meta.c }}>{meta.g}</span>
        <span className="toolname mono" style={{ color: meta.c }}>{block.name}</span>
        <span className="toolargs mono">{argSummary(block.name, block.args)}</span>
        <span className="toolspacer" />
        {block.diff && (
          <span className="diffbadge">
            {block.diff.add > 0 && <span className="add">+{block.diff.add}</span>}
            {block.diff.del > 0 && <span className="del">−{block.diff.del}</span>}
          </span>
        )}
        <span className="toolstatus">
          {running ? <span className="spin" /> : err ? <span className="x">✕</span> : <span className="ok">✓</span>}
        </span>
        {block.output && <span className="chev" style={{ transform: open ? "rotate(90deg)" : "none" }}>›</span>}
      </button>
      {open && block.output && (
        <pre className="tooloutput mono">{block.output}</pre>
      )}
      {running && block.streaming && block.output && (
        <pre className="tooloutput mono live">{block.output}<Caret /></pre>
      )}
    </div>
  );
}

/* ---- notice (extension UI outcome) ---- */
function Notice({ block }) {
  return (
    <div className={"notice " + (block.tone === "ok" ? "ok" : "block")}>
      <span className="noticedot" />
      <RichText text={block.text} />
    </div>
  );
}

/* ---- one message ---- */
function MessageRow({ msg }) {
  if (msg.role === "user") {
    return (
      <div className="row user" data-screen-label="user message">
        <div className="ububble">
          <RichText text={msg.text} />
          {msg.images > 0 && <div className="uimg mono">+{msg.images} image</div>}
        </div>
      </div>
    );
  }
  return (
    <div className="row asst">
      <div className="gutter">
        <span className="dot" style={{ background: msg.stopReason === "aborted" ? "var(--red)" : "var(--accent)" }} />
        <span className="rail" />
      </div>
      <div className="asstbody">
        <div className="asstmeta">
          <span className="mono">pi</span>
          <span className="sep">·</span>
          <span>{msg.model}</span>
          {msg.stopReason === "aborted" && <span className="abortedtag">aborted</span>}
        </div>
        {msg.blocks.map((b, i) => {
          if (b.type === "thinking") return <ThinkingBlock key={i} block={b} />;
          if (b.type === "toolCall") return <ToolCall key={i} block={b} />;
          if (b.type === "notice") return <Notice key={i} block={b} />;
          return (
            <p className="asttext" key={i}>
              <RichText text={b.text} />{b.streaming && <Caret />}
            </p>
          );
        })}
        {msg.usage && msg.usage.cost > 0 && !msg.streaming && (
          <div className="turncost mono">
            {(msg.usage.cacheRead / 1000).toFixed(1)}k cached · {msg.usage.output} out · ${msg.usage.cost.toFixed(4)}
          </div>
        )}
      </div>
    </div>
  );
}

function ChatTranscript({ messages, scrollRef, onScroll }) {
  return (
    <div className="transcript" ref={scrollRef} onScroll={onScroll}>
      <div className="transcript-inner">
        {messages.map((m) => <MessageRow key={m.id} msg={m} />)}
        <div style={{ height: 8 }} />
      </div>
    </div>
  );
}

window.ChatTranscript = ChatTranscript;
