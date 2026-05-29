/* ============================================================
   app.jsx — orchestration, window chrome, tweaks
   ============================================================ */
const { useState, useRef, useEffect, useCallback, useMemo } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "blue",
  "density": "regular",
  "uiScale": 100,
  "monoEverywhere": false,
  "showEvents": true
}/*EDITMODE-END*/;

const ACCENTS = {
  blue: { a: "oklch(0.70 0.135 258)", bg: "oklch(0.70 0.135 258 / 0.13)" },
  green: { a: "oklch(0.74 0.135 158)", bg: "oklch(0.74 0.135 158 / 0.13)" },
  amber: { a: "oklch(0.78 0.135 78)", bg: "oklch(0.78 0.135 78 / 0.13)" },
  violet: { a: "oklch(0.72 0.135 300)", bg: "oklch(0.72 0.135 300 / 0.13)" },
};

const seedStats = () => ({
  contextTokens: 62400, contextWindow: 200000,
  input: 14730, output: 4292, cacheRead: 65800, cacheWrite: 1200,
  cost: 0.4127, toolCalls: 4,
});

function Toast({ toasts }) {
  return (
    <div className="toaststack">
      {toasts.map((t) => (
        <div className={"toast " + (t.tone || "")} key={t.id}>
          <span className="toastglyph">{t.glyph || "✓"}</span>
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}

function TitleBar({ session, model, stats, onPalette }) {
  const pct = Math.round((stats.contextTokens / stats.contextWindow) * 100);
  return (
    <div className="titlebar">
      <div className="lights">
        <span className="light red" /><span className="light yellow" /><span className="light green" />
      </div>
      <div className="titlecenter">
        <span className="titlecwd mono">{session.cwd}</span>
        <span className="titlesep">›</span>
        <span className="titlename">{session.name}</span>
      </div>
      <div className="titleright">
        <button className="titlek mono" onClick={onPalette} title="Command palette (⌘K)">
          <span className="searchglyph">⌕</span> commands <span className="kbd mono">⌘K</span>
        </button>
        <span className="titlepill mono"><span className="provdot" style={{ background: PROVIDER_DOT[(PI_MODELS.find((m) => m.name === model) || {}).provider] }} />{model}</span>
        <span className="titlepill mono">{pct}% ctx</span>
        <span className="titlepill mono">${stats.cost.toFixed(2)}</span>
      </div>
    </div>
  );
}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [messages, setMessages] = useState(SEED_MESSAGES);
  const [streaming, setStreaming] = useState(false);
  const [model, setModel] = useState("Claude Sonnet 4");
  const [thinking, setThinking] = useState("medium");
  const [queueMode, setQueueMode] = useState("steer");
  const [queue, setQueue] = useState({ steering: [], followUp: [] });
  const [stats, setStats] = useState(seedStats());
  const [toggles, setToggles] = useState({ autoCompact: true, autoRetry: true });
  const [events, setEvents] = useState([]);
  const [sessions, setSessions] = useState(SEED_SESSIONS);
  const [activeId, setActiveId] = useState("s_rate");
  const [tree, setTree] = useState(SEED_TREE);
  const [dialog, setDialog] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const abortRef = useRef(null);
  const runCount = useRef(0);
  const scrollRef = useRef(null);

  // apply tweaks to :root
  useEffect(() => {
    const root = document.documentElement;
    const ac = ACCENTS[t.accent] || ACCENTS.blue;
    root.style.setProperty("--accent", ac.a);
    root.style.setProperty("--accent-bg", ac.bg);
    root.style.setProperty("--ui-scale", (t.uiScale / 100).toString());
    root.dataset.density = t.density;
    root.dataset.mono = t.monoEverywhere ? "1" : "0";
  }, [t.accent, t.density, t.uiScale, t.monoEverywhere]);

  // autoscroll: synchronous (reading scrollHeight forces layout, so this is
  // reliable in both foreground and throttled background tabs). Only pins to
  // bottom when the user is already near it, so manual scroll-up isn't fought.
  const nearBottomRef = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !nearBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);
  const onTranscriptScroll = useCallback((e) => {
    const el = e.currentTarget;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  const toast = useCallback((text, glyph, tone) => {
    const id = uid("t");
    setToasts((p) => [...p, { id, text, glyph, tone }]);
    setTimeout(() => setToasts((p) => p.filter((x) => x.id !== id)), 2600);
  }, []);

  const pushEvent = useCallback((e) => {
    setEvents((prev) => [...prev, e].slice(-80));
    if (e.k === "tool_execution_end") {
      setStats((s) => ({ ...s, toolCalls: s.toolCalls + 1, contextTokens: s.contextTokens + 380 }));
    }
  }, []);

  const buildApi = useCallback((signal) => ({
    model: () => PI_MODELS.find((m) => m.name === model) || PI_MODELS[0],
    pushMsg: (msg) => { setMessages((prev) => [...prev, msg]); return msg.id; },
    update: (id, fn) => setMessages((prev) => prev.map((m) => {
      if (m.id !== id) return m;
      const c = JSON.parse(JSON.stringify(m));
      fn(c);
      return c;
    })),
    bumpUsage: () => setStats((s) => ({
      ...s, output: s.output + 70, contextTokens: Math.min(s.contextWindow, s.contextTokens + 150),
      cost: s.cost + 0.0011, input: s.input + 40,
    })),
    event: pushEvent,
    requestDialog: (req) => new Promise((resolve) => {
      setDialog({ req, resolve: (ans) => { setDialog(null); resolve(ans); } });
    }),
  }), [model, pushEvent]);

  const startRun = useCallback(async (promptText) => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStreaming(true);
    const pick = SCENARIOS[runCount.current % SCENARIOS.length];
    runCount.current += 1;
    const steps = pick(promptText);
    const api = buildApi(ctrl.signal);
    await playScenario(steps, promptText, api, ctrl.signal);
    setStreaming(false);
    abortRef.current = null;
    // bump active session cost + deliver a queued follow-up if present
    setSessions((prev) => prev.map((s) => s.id === activeId ? { ...s, msgs: s.msgs + 2 } : s));
    setQueue((q) => {
      if (q.followUp.length) {
        const [next, ...rest] = q.followUp;
        setTimeout(() => { pushUser(next); startRun(next); }, 500);
        toast("Delivering queued follow-up", "→");
        return { ...q, followUp: rest };
      }
      if (q.steering.length) {
        toast(`${q.steering.length} steering message(s) delivered`, "↻");
        return { ...q, steering: [] };
      }
      return q;
    });
  }, [activeId, buildApi, toast]);

  const pushUser = useCallback((text, images) => {
    setMessages((prev) => [...prev, { id: uid("m"), role: "user", ts: Date.now(), text, images: images || 0 }]);
  }, []);

  const onSend = useCallback((text, mode) => {
    if (mode === "prompt") {
      pushUser(text);
      startRun(text);
    } else if (mode === "steer") {
      setQueue((q) => ({ ...q, steering: [...q.steering, text] }));
      pushEvent({ k: "queue_update" });
      toast("Steering message queued", "↻");
    } else {
      setQueue((q) => ({ ...q, followUp: [...q.followUp, text] }));
      pushEvent({ k: "queue_update" });
      toast("Follow-up queued", "→");
    }
  }, [pushUser, startRun, pushEvent, toast]);

  const onAbort = useCallback(() => {
    if (abortRef.current) { abortRef.current.abort(); pushEvent({ k: "agent_end", aborted: true }); toast("Aborted", "✕", "warn"); }
  }, [pushEvent, toast]);

  // esc to abort
  useEffect(() => {
    const k = (e) => { if (e.key === "Escape" && streaming && !dialog) onAbort(); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [streaming, dialog, onAbort]);

  const onPickModel = useCallback((m) => {
    setModel(m.name);
    setStats((s) => ({ ...s, contextWindow: m.contextWindow }));
    pushEvent({ k: "queue_update", name: "set_model" });
    toast(`Model → ${m.name}`, "⇄");
  }, [pushEvent, toast]);

  const onCompact = useCallback(() => {
    pushEvent({ k: "compaction_start" });
    toast("Compacting context…", "⤵");
    setTimeout(() => {
      setStats((s) => ({ ...s, contextTokens: Math.round(s.contextTokens * 0.28) }));
      pushEvent({ k: "compaction_end" });
      setMessages((prev) => [...prev, { id: uid("m"), role: "assistant", model, stopReason: "stop", ts: Date.now(),
        blocks: [{ type: "notice", tone: "ok", text: "Context compacted — earlier turns summarized, **72%** of context window freed." }], usage: { cost: 0 } }]);
    }, 1100);
  }, [pushEvent, toast, model]);

  const onNew = useCallback(() => {
    const id = uid("s");
    const ns = { id, name: "untitled session", cwd: "~/code/api-gateway", model, provider: (PI_MODELS.find((m) => m.name === model) || {}).provider, updated: "now", cost: 0, msgs: 0 };
    setSessions((p) => [ns, ...p]);
    setActiveId(id);
    setMessages([]);
    setStats(seedStats());
    setStats((s) => ({ contextTokens: 0, contextWindow: s.contextWindow, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, toolCalls: 0 }));
    setEvents([]);
    setQueue({ steering: [], followUp: [] });
    toast("New session started", "+");
  }, [model, toast]);

  const onToggle = useCallback((k, v) => { setToggles((p) => ({ ...p, [k]: v })); toast(`${k} ${v ? "on" : "off"}`); }, [toast]);
  const onFork = useCallback(() => toast("Forked from selected message", "⑂"), [toast]);
  const onClone = useCallback(() => toast("Branch cloned to new session", "⧉"), [toast]);
  const onExport = useCallback(() => toast("Exported session.html", "↗"), [toast]);

  // run a slash command (RPC: send `/name` via prompt; expanded by the agent)
  const runSlash = useCallback((c) => {
    setPaletteOpen(false);
    const n = c.name;
    pushEvent({ k: "message_start", name: "/" + n });
    if (n === "compact") return onCompact();
    if (n === "tree") return toast("Session tree — Ctrl+←/→ between branches", "⑂");
    if (n === "session-name") { pushUser("/session-name"); return toast("Set session name", "✎"); }
    if (n === "plan-mode") { pushUser("/plan-mode"); return toast("Plan mode — read-only exploration", "◔"); }
    if (c.source === "prompt") { pushUser("/" + n); return startRun("/" + n); }
    // skills + remaining extensions: show invocation + brief ack
    pushUser("/" + n);
    setMessages((prev) => [...prev, {
      id: uid("m"), role: "assistant", model, stopReason: "stop", ts: Date.now(),
      blocks: [{ type: "notice", tone: "ok", text: `Invoked \`/${n}\` · ${c.desc}.` }], usage: { cost: 0 },
    }]);
  }, [onCompact, pushUser, startRun, toast, model, pushEvent]);

  // ⌘K / Ctrl+K toggles the command palette
  useEffect(() => {
    const k = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) { e.preventDefault(); setPaletteOpen((o) => !o); }
    };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, []);

  const paletteItems = useMemo(() => {
    const items = [];
    const add = (group, label, run, opts = {}) => items.push({ id: group + ":" + label, group, label, run, ...opts });
    add("Session", "New session", onNew, { kbd: "⌘N", glyph: "+" });
    add("Session", "Fork from a previous message", onFork, { glyph: "⑂" });
    add("Session", "Clone current branch", onClone, { glyph: "⧉" });
    add("Session", "Export session to HTML", onExport, { glyph: "↗" });
    sessions.filter((s) => s.id !== activeId).forEach((s) =>
      add("Switch session", s.name, () => { setActiveId(s.id); toast("Switched session", "⤓"); }, { hint: s.cwd, glyph: "›" }));
    if (streaming) add("Run control", "Abort current run", onAbort, { kbd: "esc", glyph: "✕" });
    add("Run control", "Queue next message as steering", () => { setQueueMode("steer"); toast("Queue mode → steer", "↻"); }, { glyph: "↻" });
    add("Run control", "Queue next message as follow-up", () => { setQueueMode("followUp"); toast("Queue mode → follow-up", "→"); }, { glyph: "→" });
    PI_MODELS.forEach((m) => add("Model", "Use " + m.name, () => onPickModel(m),
      { hint: m.provider + " · " + ((m.contextWindow / 1000) | 0) + "k", glyph: "◆" }));
    THINKING_LEVELS.forEach((lv) => add("Thinking level", "Thinking: " + lv, () => { setThinking(lv); toast("Thinking → " + lv, "✦"); }, { glyph: "✦" }));
    add("Context", "Compact context now", onCompact, { glyph: "⤵" });
    add("Context", (toggles.autoCompact ? "Disable" : "Enable") + " auto-compaction", () => onToggle("autoCompact", !toggles.autoCompact), { glyph: "◑" });
    add("Context", (toggles.autoRetry ? "Disable" : "Enable") + " auto-retry", () => onToggle("autoRetry", !toggles.autoRetry), { glyph: "↺" });
    ["blue", "green", "amber", "violet"].forEach((a) => add("Appearance", "Accent: " + a, () => { setTweak("accent", a); toast("Accent → " + a); }, { glyph: "●" }));
    ["compact", "regular", "comfy"].forEach((d) => add("Appearance", "Density: " + d, () => setTweak("density", d), { glyph: "▤" }));
    add("Appearance", (t.showEvents !== false ? "Hide" : "Show") + " RPC inspector", () => setTweak("showEvents", !(t.showEvents !== false)), { glyph: "▦" });
    add("Appearance", t.monoEverywhere ? "Disable mono-everywhere" : "Enable mono-everywhere", () => setTweak("monoEverywhere", !t.monoEverywhere), { glyph: "M" });
    PI_COMMANDS.forEach((c) => add("Slash command", "/" + c.name, () => runSlash(c), { hint: c.desc, source: c.source }));
    return items;
  }, [sessions, activeId, streaming, toggles, t.showEvents, t.monoEverywhere, onNew, onFork, onClone, onExport,
    onAbort, onPickModel, onCompact, onToggle, runSlash, toast, setTweak]);

  const activeSession = sessions.find((s) => s.id === activeId) || sessions[0];

  return (
    <div className="appshell">
      <TitleBar session={activeSession} model={model} stats={stats} onPalette={() => setPaletteOpen(true)} />
      <div className="body">
        <Sidebar sessions={sessions} activeId={activeId} onSelect={setActiveId} tree={tree} onNew={onNew} />
        <main className="center">
          <ChatTranscript messages={messages} scrollRef={scrollRef} onScroll={onTranscriptScroll} />
          <Composer
            streaming={streaming} model={model} models={PI_MODELS} onPickModel={onPickModel}
            thinking={thinking} onSetThinking={setThinking}
            onSend={onSend} onAbort={onAbort} queueMode={queueMode} setQueueMode={setQueueMode}
            onSlash={runSlash} onOpenPalette={() => setPaletteOpen(true)}
          />
        </main>
        {t.showEvents !== false && (
          <Inspector
            stats={stats} queue={queue} toggles={toggles}
            onToggle={onToggle}
            onCompact={onCompact}
            onFork={onFork}
            onClone={onClone}
            onExport={onExport}
            events={events} streaming={streaming}
          />
        )}
      </div>

      <ExtDialog req={dialog?.req} onResolve={(ans) => dialog.resolve(ans)} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} items={paletteItems} />
      <Toast toasts={toasts} />

      <TweaksPanel>
        <TweakSection label="Accent" />
        <TweakColor label="Accent" value={t.accent === "blue" ? "#5b8cff" : t.accent === "green" ? "#3fb98c" : t.accent === "amber" ? "#d98a4b" : "#b06cf0"}
          options={["#5b8cff", "#3fb98c", "#d98a4b", "#b06cf0"]}
          onChange={(hex) => setTweak("accent", hex === "#5b8cff" ? "blue" : hex === "#3fb98c" ? "green" : hex === "#d98a4b" ? "amber" : "violet")} />
        <TweakSection label="Layout" />
        <TweakRadio label="Density" value={t.density} options={["compact", "regular", "comfy"]} onChange={(v) => setTweak("density", v)} />
        <TweakSlider label="UI scale" value={t.uiScale} min={85} max={120} step={5} unit="%" onChange={(v) => setTweak("uiScale", v)} />
        <TweakToggle label="Show RPC inspector" value={t.showEvents !== false} onChange={(v) => setTweak("showEvents", v)} />
        <TweakToggle label="Mono everywhere" value={t.monoEverywhere} onChange={(v) => setTweak("monoEverywhere", v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
