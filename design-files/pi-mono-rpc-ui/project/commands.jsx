/* ============================================================
   commands.jsx — slash command catalog (RPC get_commands) +
   global ⌘K command palette
   ============================================================ */
const { useState: cmdUseState, useRef: cmdUseRef, useEffect: cmdUseEffect, useMemo: cmdUseMemo } = React;

/* ---- catalog returned by get_commands (extension / prompt / skill) ---- */
const PI_COMMANDS = [
  { name: "session-name", desc: "Set or clear the session display name", source: "extension", loc: "user" },
  { name: "compact", desc: "Compact conversation context now", source: "extension", loc: "user" },
  { name: "tree", desc: "Navigate the session history tree", source: "extension", loc: "user" },
  { name: "oracle", desc: "Second opinion from an alternate model", source: "extension", loc: "user" },
  { name: "plan-mode", desc: "Read-only exploration mode (no writes)", source: "extension", loc: "user" },
  { name: "handoff", desc: "Transfer context to a new focused session", source: "extension", loc: "user" },
  { name: "memory", desc: "Save instructions to AGENTS.md", source: "extension", loc: "project" },
  { name: "fix-tests", desc: "Find and fix failing tests", source: "prompt", loc: "project" },
  { name: "review", desc: "Review the current diff for issues", source: "prompt", loc: "project" },
  { name: "commit", desc: "Stage changes & write a conventional commit", source: "prompt", loc: "user" },
  { name: "cl", desc: "Audit & update CHANGELOG entries", source: "prompt", loc: "project" },
  { name: "skill:brave-search", desc: "Web search via the Brave API", source: "skill", loc: "user" },
  { name: "skill:web-browser", desc: "Fetch and read web pages", source: "skill", loc: "user" },
  { name: "skill:changelog", desc: "Generate changelog from git history", source: "skill", loc: "project" },
];

const CMD_SOURCE = {
  extension: { c: "var(--blue)", label: "ext", glyph: "⚙" },
  prompt: { c: "var(--green)", label: "prompt", glyph: "❯" },
  skill: { c: "var(--violet)", label: "skill", glyph: "✦" },
};

/* ============================================================
   Command palette (⌘K)
   items: [{ id, group, label, hint, kbd, source, run }]
   ============================================================ */
function CommandPalette({ open, onClose, items }) {
  const [q, setQ] = cmdUseState("");
  const [sel, setSel] = cmdUseState(0);
  const inputRef = cmdUseRef(null);
  const listRef = cmdUseRef(null);

  cmdUseEffect(() => {
    if (open) { setQ(""); setSel(0); setTimeout(() => inputRef.current && inputRef.current.focus(), 30); }
  }, [open]);

  const filtered = cmdUseMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((it) => {
      const hay = (it.label + " " + (it.hint || "") + " " + it.group + " " + (it.keywords || "")).toLowerCase();
      // loose subsequence/substring match
      if (hay.includes(needle)) return true;
      let i = 0;
      for (const ch of hay) { if (ch === needle[i]) i++; if (i === needle.length) return true; }
      return false;
    });
  }, [q, items]);

  cmdUseEffect(() => { setSel(0); }, [q]);
  cmdUseEffect(() => {
    const el = listRef.current && listRef.current.querySelector(".cp-row.sel");
    if (el) el.scrollIntoViewIfNeeded ? el.scrollIntoViewIfNeeded() : el.scrollIntoView({ block: "nearest" });
  }, [sel]);

  if (!open) return null;

  const run = (it) => { onClose(); if (it && it.run) setTimeout(it.run, 0); };
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(filtered.length - 1, s + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); run(filtered[sel]); }
  };

  // group while preserving order
  const groups = [];
  const gmap = {};
  filtered.forEach((it, idx) => {
    if (!gmap[it.group]) { gmap[it.group] = { name: it.group, rows: [] }; groups.push(gmap[it.group]); }
    gmap[it.group].rows.push({ it, idx });
  });

  return (
    <div className="cp-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cp" onKeyDown={onKey}>
        <div className="cp-inputwrap">
          <span className="cp-prompt mono">⌘K</span>
          <input ref={inputRef} className="cp-input" placeholder="Search actions, models, sessions, slash commands…"
            value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="cp-esc mono">esc</span>
        </div>
        <div className="cp-list" ref={listRef}>
          {filtered.length === 0 && <div className="cp-empty mono">No matches for “{q}”</div>}
          {groups.map((g) => (
            <div className="cp-group" key={g.name}>
              <div className="cp-ghdr eyebrow">{g.name}</div>
              {g.rows.map(({ it, idx }) => {
                const src = it.source ? CMD_SOURCE[it.source] : null;
                return (
                  <button key={it.id || it.label} className={"cp-row" + (idx === sel ? " sel" : "")}
                    onMouseEnter={() => setSel(idx)} onClick={() => run(it)}>
                    <span className="cp-glyph" style={{ color: src ? src.c : "var(--tx-faint)" }}>
                      {src ? src.glyph : it.glyph || "›"}
                    </span>
                    <span className="cp-label">{it.label}</span>
                    {it.hint && <span className="cp-hint">{it.hint}</span>}
                    {src && <span className="cp-srctag mono" style={{ color: src.c }}>{src.label}</span>}
                    {it.kbd && <span className="cp-kbd mono">{it.kbd}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="cp-foot mono">
          <span><b>↑↓</b> navigate</span><span><b>⏎</b> run</span><span><b>esc</b> close</span>
          <span className="cp-foot-r">{filtered.length} result{filtered.length === 1 ? "" : "s"}</span>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { PI_COMMANDS, CMD_SOURCE, CommandPalette });
