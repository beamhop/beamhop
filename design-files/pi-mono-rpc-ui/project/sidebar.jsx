/* ============================================================
   sidebar.jsx — sessions rail + branch tree
   ============================================================ */
const { useState: suseState } = React;

function SessionItem({ s, active, onClick }) {
  return (
    <button className={"sessitem" + (active ? " active" : "")} onClick={onClick}>
      <span className="provdot" style={{ background: PROVIDER_DOT[s.provider] }} />
      <span className="sesscol">
        <span className="sessname">{s.name}</span>
        <span className="sessmeta mono">{s.msgs} msgs · ${s.cost.toFixed(s.cost < 1 ? 3 : 2)}</span>
      </span>
      <span className="sesstime mono">{s.updated}</span>
    </button>
  );
}

function BranchTree({ tree }) {
  return (
    <div className="branchtree">
      <div className="eyebrow treetitle">Session tree</div>
      {tree.map((n) => (
        <div key={n.id} className={"treenode" + (n.current ? " current" : "") + (n.future ? " future" : "")}
          style={{ paddingLeft: 10 + n.depth * 16 }}>
          <span className={"treeglyph " + n.kind}>
            {n.kind === "fork" ? "⑂" : n.current ? "●" : n.future ? "○" : "•"}
          </span>
          <span className="treelabel">{n.label}</span>
          {n.branch && <span className="branchtag mono">branch</span>}
          {n.current && <span className="hereTag mono">here</span>}
        </div>
      ))}
      <div className="treehint mono">Shift+L to bookmark · Ctrl+←/→ between branches</div>
    </div>
  );
}

function Sidebar({ sessions, activeId, onSelect, tree, onNew }) {
  const [q, setQ] = suseState("");
  const groups = {};
  sessions.filter((s) => s.name.toLowerCase().includes(q.toLowerCase())).forEach((s) => {
    (groups[s.cwd] = groups[s.cwd] || []).push(s);
  });
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="logo mono">π</span>
        <span className="brandname">pi<span className="brandsub">control</span></span>
        <span className="ver mono">rpc · 0.75</span>
      </div>

      <button className="newbtn" onClick={onNew}>
        <span className="plus">+</span> New session <span className="kbd mono">⌘N</span>
      </button>

      <div className="searchwrap">
        <span className="searchglyph">⌕</span>
        <input className="search" placeholder="Search sessions…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="sesslist">
        {Object.entries(groups).map(([cwd, list]) => (
          <div className="sessgroup" key={cwd}>
            <div className="grouphdr mono">{cwd}</div>
            {list.map((s) => (
              <SessionItem key={s.id} s={s} active={s.id === activeId} onClick={() => onSelect(s.id)} />
            ))}
          </div>
        ))}
        {Object.keys(groups).length === 0 && <div className="emptyq mono">no sessions match “{q}”</div>}
      </div>

      <BranchTree tree={tree} />
    </aside>
  );
}

window.Sidebar = Sidebar;
