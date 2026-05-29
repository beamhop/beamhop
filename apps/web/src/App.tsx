import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { ChatTranscript } from "./components/Chat";
import { CommandPalette, type PaletteItem } from "./components/CommandPalette";
import { Composer } from "./components/Composer";
import { ExtDialog } from "./components/Dialog";
import { Sidebar } from "./components/Sidebar";
import { Inspector } from "./components/Inspector";
import { SandboxPrompt } from "./components/SandboxPrompt";
import { type PiCommand } from "./data/commands";
import {
  PROVIDER_DOT,
  THINKING_LEVELS,
  type PiModel,
  type ThinkingLevel,
} from "./data/models";
import { RpcClient, type RpcStatus } from "./rpc/client";
import { initialState, reduce, type State } from "./rpc/reducer";
import {
  ACCENTS,
  TWEAK_DEFAULTS,
  type DialogAnswer,
  type QueueState,
  type SessionSummary,
  type Toggles,
  type Tweaks,
} from "./types";
import { uid } from "./util";

const SANDBOX_KEY = "pi-rpc:sandbox";
const LEGACY_SNAPSHOT_KEY = "pi-rpc:snapshot";
/**
 * Per-sandbox key holding the absolute path of the pi session file the
 * user was last in. On reconnect we ask pi to `switch_session` to this
 * path so the transcript survives a page refresh.
 */
const sessionFileKey = (sandbox: string) => `pi-rpc:sessionFile:${sandbox}`;

function loadInitialSandbox(): string {
  const v = localStorage.getItem(SANDBOX_KEY);
  if (v) return v;
  // The earlier build stored a snapshot name under a different key. The
  // semantics changed (we now attach instead of spawn), so don't silently
  // adopt it as a sandbox name — clear it so the prompt re-runs.
  if (localStorage.getItem(LEGACY_SNAPSHOT_KEY)) {
    localStorage.removeItem(LEGACY_SNAPSHOT_KEY);
  }
  return "";
}

function TitleBar({
  session,
  model,
  models,
  stats,
  status,
  sandbox,
  onPalette,
  onSwitchSandbox,
}: {
  session: SessionSummary | null;
  model: string;
  models: PiModel[];
  stats: State["stats"];
  status: RpcStatus;
  sandbox: string;
  onPalette: () => void;
  onSwitchSandbox: () => void;
}) {
  const pct = Math.round((stats.contextTokens / Math.max(1, stats.contextWindow)) * 100);
  const piModel =
    models.find((m) => m.name === model || m.id === model) ?? models[0];
  return (
    <div className="titlebar" data-testid="titlebar">
      <div className="lights">
        <span className="light red" />
        <span className="light yellow" />
        <span className="light green" />
      </div>
      <div className="titlecenter">
        <span className="titlecwd mono">{session?.cwd ?? ""}</span>
        <span className="titlesep">›</span>
        <span className="titlename">{session?.title ?? "untitled session"}</span>
      </div>
      <div className="titleright">
        <button
          className="titlepill mono"
          onClick={onSwitchSandbox}
          title="Switch sandbox"
          data-testid="titlebar-switch-sandbox"
          style={{ cursor: "pointer" }}
        >
          ⤺ {sandbox}
        </button>
        <button
          className="titlek mono"
          onClick={onPalette}
          title="Command palette (⌘K)"
          data-testid="titlebar-palette-btn"
        >
          <span className="searchglyph">⌕</span> commands{" "}
          <span className="kbd mono">⌘K</span>
        </button>
        <span className="titlepill mono">
          <span
            className="provdot"
            style={{
              background: PROVIDER_DOT[piModel?.provider ?? "openrouter"],
            }}
          />
          {model || "—"}
        </span>
        <span className="titlepill mono">{pct}% ctx</span>
        <span className="titlepill mono">${stats.cost.toFixed(2)}</span>
        <span
          className="titlepill mono"
          style={{ color: status === "open" ? "var(--green)" : status === "error" ? "var(--red)" : "var(--tx-faint)" }}
          data-testid="titlebar-status"
        >
          {status}
        </span>
      </div>
    </div>
  );
}

interface Toast {
  id: string;
  text: string;
  glyph?: string;
  tone?: "warn" | "ok";
}

function ToastStack({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toaststack" data-testid="toaststack">
      {toasts.map((t) => (
        <div className={"toast " + (t.tone || "")} key={t.id}>
          <span className="toastglyph">{t.glyph || "✓"}</span>
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  // --- persistent settings ---
  const [sandbox, setSandbox] = useState<string>(loadInitialSandbox);

  // --- tweaks (UI chrome) ---
  const [tweaks, setTweaks] = useState<Tweaks>(TWEAK_DEFAULTS);
  const setTweak = useCallback(
    <K extends keyof Tweaks>(k: K, v: Tweaks[K]) => setTweaks((p) => ({ ...p, [k]: v })),
    [],
  );
  useEffect(() => {
    const root = document.documentElement;
    const ac = ACCENTS[tweaks.accent] ?? ACCENTS.blue;
    root.style.setProperty("--accent", ac.a);
    root.style.setProperty("--accent-bg", ac.bg);
    root.style.setProperty("--ui-scale", String(tweaks.uiScale / 100));
    root.dataset.density = tweaks.density;
    root.dataset.mono = tweaks.monoEverywhere ? "1" : "0";
  }, [tweaks]);

  // sessions come live from `list_sessions` (state.sessions). No seed state.

  // --- rpc state from reducer ---
  const [state, dispatch] = useReducer(reduce, undefined, initialState);

  // --- composer + control state ---
  // Initial value is "" — once pi responds to get_available_models we adopt
  // whatever it reports as the active model. The picker shows a loading
  // placeholder until then.
  const [model, setModel] = useState<string>("");
  const [thinking, setThinking] = useState<ThinkingLevel>("medium");
  const [queueMode, setQueueMode] = useState<"steer" | "followUp">("steer");
  const [queue, setQueue] = useState<QueueState>({ steering: [], followUp: [] });
  const [toggles, setToggles] = useState<Toggles>({ autoCompact: true, autoRetry: true });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  // When true, the sandbox picker overlays the running app so the user
  // can switch to a different sandbox. Esc/Cancel dismisses it.
  const [wantSwitch, setWantSwitch] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !nearBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [state.messages]);
  const onTranscriptScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  const toast = useCallback((text: string, glyph?: string, tone?: Toast["tone"]) => {
    const id = uid("t");
    setToasts((p) => [...p, { id, text, glyph, tone }]);
    setTimeout(() => setToasts((p) => p.filter((x) => x.id !== id)), 2600);
  }, []);

  // In the Tauri webview the page is served from tauri://localhost (no
  // Vite proxy), so a relative /rpc URL goes nowhere. Detect that and
  // connect directly to the sidecar host on its known port.
  const wsUrl = useMemo(() => {
    const isViteDev =
      window.location.protocol === "http:" || window.location.protocol === "https:";
    return isViteDev
      ? (window.location.protocol === "https:" ? "wss://" : "ws://") +
          window.location.host +
          "/rpc"
      : "ws://127.0.0.1:5179/rpc";
  }, []);

  // --- RPC client lifecycle ---
  const clientRef = useRef<RpcClient | null>(null);
  useEffect(() => {
    if (!sandbox) return;
    const client = new RpcClient({
      url: wsUrl,
      sandbox,
      onMessage: (msg) => dispatch({ kind: "rpc", msg }),
      onStatus: (status, detail) => dispatch({ kind: "status", status, detail }),
    });
    clientRef.current = client;
    client.connect();
    return () => {
      client.close();
      clientRef.current = null;
    };
  }, [sandbox]);

  // --- commands sent to host ---
  const send = useCallback((msg: Record<string, unknown>) => {
    clientRef.current?.send(msg);
  }, []);

  // Live catalogs come from pi via `response` envelopes. Until they arrive
  // the pickers render an empty/loading state — no hardcoded fallback list.
  const models: PiModel[] = state.models ?? [];
  const commands: PiCommand[] = state.commands ?? [];

  // Once pi confirms its connection is open, ask for its real catalogs +
  // the initial session stats snapshot. If we have a persisted session
  // path for this sandbox, switch into it FIRST (awaiting the response)
  // before asking for messages — otherwise pi answers get_messages from
  // the fresh-on-connect session, not the resumed one.
  useEffect(() => {
    if (state.status !== "open") return;
    const client = clientRef.current;
    if (!client) return;
    (async () => {
      client.send({ type: "get_available_models" });
      client.send({ type: "get_commands" });
      const stored = localStorage.getItem(sessionFileKey(sandbox));
      if (stored) {
        const resp = await client.request({ type: "switch_session", sessionPath: stored });
        if (resp.success) {
          client.send({ type: "get_messages" });
        } else {
          // Stored path is gone — discard so we don't try again next reload.
          localStorage.removeItem(sessionFileKey(sandbox));
        }
      }
      client.send({ type: "get_session_stats" });
      client.send({ type: "list_sessions" });
    })();
  }, [state.status, sandbox]);

  // Persist pi's current session file path so we can auto-resume it on
  // the next page load.
  useEffect(() => {
    if (state.currentSessionFile) {
      localStorage.setItem(sessionFileKey(sandbox), state.currentSessionFile);
    }
  }, [state.currentSessionFile, sandbox]);

  // Refresh authoritative session stats + the sessions list every time
  // a turn ends — that's when pi has just locked in fresh tokens/cost/
  // context-percent AND when the session file just gained a user prompt
  // (so newly-created sessions become visible in the sidebar).
  const wasStreamingRef = useRef(false);
  useEffect(() => {
    if (wasStreamingRef.current && !state.streaming) {
      send({ type: "get_session_stats" });
      send({ type: "list_sessions" });
    }
    wasStreamingRef.current = state.streaming;
  }, [state.streaming, send]);

  // Adopt pi's reported current model when the catalog first lands, so the
  // picker isn't stuck on an empty string.
  useEffect(() => {
    if (model) return;
    if (state.currentModelId) {
      const m = models.find((x) => x.id === state.currentModelId);
      if (m) {
        setModel(m.name);
        dispatch({ kind: "setStats", patch: { contextWindow: m.contextWindow } });
        return;
      }
    }
    if (models.length > 0) {
      setModel(models[0].name);
      dispatch({ kind: "setStats", patch: { contextWindow: models[0].contextWindow } });
    }
  }, [model, models, state.currentModelId]);

  const onSend = useCallback(
    (text: string, mode: "prompt" | "steer" | "followUp") => {
      if (mode === "prompt") {
        dispatch({ kind: "pushUser", text });
        send({ type: "prompt", message: text });
      } else if (mode === "steer") {
        setQueue((q) => ({ ...q, steering: [...q.steering, text] }));
        send({ type: "steer", message: text });
        toast("Steering message queued", "↻");
      } else {
        setQueue((q) => ({ ...q, followUp: [...q.followUp, text] }));
        send({ type: "follow_up", message: text });
        toast("Follow-up queued", "→");
      }
    },
    [send, toast],
  );

  const onAbort = useCallback(() => {
    send({ type: "abort" });
    toast("Aborted", "✕", "warn");
  }, [send, toast]);

  // esc to abort
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape" && state.streaming && !state.dialog) onAbort();
    };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [state.streaming, state.dialog, onAbort]);

  const onPickModel = useCallback(
    (m: PiModel) => {
      setModel(m.name);
      dispatch({ kind: "setStats", patch: { contextWindow: m.contextWindow } });
      send({ type: "set_model", model: m.id });
      toast(`Model → ${m.name}`, "⇄");
    },
    [send, toast],
  );

  const onSetThinking = useCallback(
    (lv: ThinkingLevel) => {
      setThinking(lv);
      send({ type: "set_thinking_level", level: lv });
      toast(`Thinking → ${lv}`, "✦");
    },
    [send, toast],
  );

  const onCompact = useCallback(() => {
    send({ type: "compact" });
    toast("Compacting context…", "⤵");
  }, [send, toast]);

  const onNew = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    // Forget the persisted session before starting a new one so a refresh
    // mid-fresh-session doesn't re-resume the previous one.
    localStorage.removeItem(sessionFileKey(sandbox));
    dispatch({ kind: "reset" });
    setQueue({ steering: [], followUp: [] });
    await client.request({ type: "new_session" });
    client.send({ type: "get_session_stats" });
    client.send({ type: "list_sessions" });
    toast("New session started", "+");
  }, [sandbox, toast]);

  // Switch to a previously-saved session from the sidebar.
  const onSwitchSession = useCallback(
    async (path: string) => {
      const client = clientRef.current;
      if (!client) return;
      dispatch({ kind: "reset" });
      setQueue({ steering: [], followUp: [] });
      const resp = await client.request({ type: "switch_session", sessionPath: path });
      if (resp.success) {
        client.send({ type: "get_messages" });
        client.send({ type: "get_session_stats" });
        toast("Switched session", "⤓");
      } else {
        toast("Couldn't switch session", "✕", "warn");
      }
    },
    [toast],
  );

  // Delete every saved session JSONL inside the sandbox, then have pi
  // open a fresh empty session. Persisted sessionFile is dropped so the
  // next refresh doesn't try to switch_session to a path we just nuked.
  const onClearAll = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    const resp = await client.request({ type: "clear_all_sessions" });
    if (!resp.success) {
      toast("Couldn't clear history", "✕", "warn");
      return;
    }
    const removed = (resp.data as { removed?: number } | undefined)?.removed ?? 0;
    localStorage.removeItem(sessionFileKey(sandbox));
    dispatch({ kind: "reset" });
    setQueue({ steering: [], followUp: [] });
    await client.request({ type: "new_session" });
    client.send({ type: "list_sessions" });
    client.send({ type: "get_session_stats" });
    toast(`Cleared ${removed} session${removed === 1 ? "" : "s"}`, "✕", "warn");
  }, [sandbox, toast]);

  const onToggle = useCallback(
    (k: keyof Toggles, v: boolean) => {
      setToggles((p) => ({ ...p, [k]: v }));
      if (k === "autoCompact") send({ type: "set_auto_compaction", enabled: v });
      else if (k === "autoRetry") send({ type: "set_auto_retry", enabled: v });
      toast(`${k} ${v ? "on" : "off"}`);
    },
    [send, toast],
  );

  const onFork = useCallback(() => {
    send({ type: "fork" });
    toast("Forked from selected message", "⑂");
  }, [send, toast]);
  const onClone = useCallback(() => {
    send({ type: "clone" });
    toast("Branch cloned to new session", "⧉");
  }, [send, toast]);
  const onExport = useCallback(() => {
    send({ type: "export_html" });
    toast("Exporting session.html", "↗");
  }, [send, toast]);

  const runSlash = useCallback(
    (c: PiCommand) => {
      setPaletteOpen(false);
      if (c.name === "compact") return onCompact();
      // For all other commands, forward as a prompt — pi expands /commands at
      // its end. The host's protocol mapper rewrites short alias names where
      // needed (e.g. session-name → set_session_name).
      dispatch({ kind: "pushUser", text: `/${c.name}` });
      send({ type: "prompt", message: `/${c.name}` });
    },
    [onCompact, send],
  );

  // ⌘K palette
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, []);

  const paletteItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = [];
    const add = (
      group: string,
      label: string,
      run: () => void,
      opts: Partial<PaletteItem> = {},
    ) => items.push({ id: group + ":" + label, group, label, run, ...opts });
    add("Session", "New session", onNew, { kbd: "⌘N", glyph: "+" });
    add("Session", "Fork from a previous message", onFork, { glyph: "⑂" });
    add("Session", "Clone current branch", onClone, { glyph: "⧉" });
    add("Session", "Export session to HTML", onExport, { glyph: "↗" });
    (state.sessions ?? [])
      .filter((s) => s.path !== state.currentSessionFile)
      .slice(0, 20)
      .forEach((s) =>
        add(
          "Switch session",
          s.title || "(untitled)",
          () => onSwitchSession(s.path),
          { hint: s.cwd, glyph: "›" },
        ),
      );
    if (state.streaming) add("Run control", "Abort current run", onAbort, { kbd: "esc", glyph: "✕" });
    add(
      "Run control",
      "Queue next message as steering",
      () => {
        setQueueMode("steer");
        toast("Queue mode → steer", "↻");
      },
      { glyph: "↻" },
    );
    add(
      "Run control",
      "Queue next message as follow-up",
      () => {
        setQueueMode("followUp");
        toast("Queue mode → follow-up", "→");
      },
      { glyph: "→" },
    );
    models.forEach((m) =>
      add("Model", "Use " + m.name, () => onPickModel(m), {
        hint: m.provider + " · " + ((m.contextWindow / 1000) | 0) + "k",
        glyph: "◆",
      }),
    );
    THINKING_LEVELS.forEach((lv) =>
      add(
        "Thinking level",
        "Thinking: " + lv,
        () => onSetThinking(lv),
        { glyph: "✦" },
      ),
    );
    add("Context", "Compact context now", onCompact, { glyph: "⤵" });
    add(
      "Context",
      (toggles.autoCompact ? "Disable" : "Enable") + " auto-compaction",
      () => onToggle("autoCompact", !toggles.autoCompact),
      { glyph: "◑" },
    );
    add(
      "Context",
      (toggles.autoRetry ? "Disable" : "Enable") + " auto-retry",
      () => onToggle("autoRetry", !toggles.autoRetry),
      { glyph: "↺" },
    );
    (["blue", "green", "amber", "violet"] as const).forEach((a) =>
      add(
        "Appearance",
        "Accent: " + a,
        () => {
          setTweak("accent", a);
          toast("Accent → " + a);
        },
        { glyph: "●" },
      ),
    );
    (["compact", "regular", "comfy"] as const).forEach((d) =>
      add("Appearance", "Density: " + d, () => setTweak("density", d), { glyph: "▤" }),
    );
    add(
      "Appearance",
      (tweaks.showEvents ? "Hide" : "Show") + " RPC inspector",
      () => setTweak("showEvents", !tweaks.showEvents),
      { glyph: "▦" },
    );
    add(
      "Appearance",
      tweaks.monoEverywhere ? "Disable mono-everywhere" : "Enable mono-everywhere",
      () => setTweak("monoEverywhere", !tweaks.monoEverywhere),
      { glyph: "M" },
    );
    commands.forEach((c) =>
      add("Slash command", "/" + c.name, () => runSlash(c), {
        hint: c.desc,
        source: c.source,
      }),
    );
    return items;
  }, [
    state.sessions,
    state.currentSessionFile,
    state.streaming,
    toggles,
    tweaks,
    models,
    commands,
    onNew,
    onFork,
    onClone,
    onExport,
    onSwitchSession,
    onAbort,
    onPickModel,
    onSetThinking,
    onCompact,
    onToggle,
    runSlash,
    setTweak,
    send,
    toast,
  ]);

  const onDialogResolve = useCallback(
    (ans: DialogAnswer) => {
      if (!state.dialog) return;
      // Only forward the answer if the socket is actually open. If the
      // connection dropped while the dialog was up, the answer would be
      // queued in the client outbox and flushed on reconnect — but pi on the
      // other side has a *fresh* RPC session that never asked the question,
      // so the stale answer would desync the two. Drop it instead.
      if (state.status === "open") {
        send({ type: "extension_ui_response", id: state.dialog.id, ...ans });
      }
      dispatch({ kind: "dialogAnswered", id: state.dialog.id });
    },
    [state.dialog, state.status, send],
  );

  // If the connection drops while an extension dialog is open, auto-dismiss
  // it: pi's pending request died with the connection, so leaving the dialog
  // up would invite the user to answer a question nobody is listening for.
  useEffect(() => {
    if (state.dialog && state.status !== "open") {
      dispatch({ kind: "dialogAnswered", id: state.dialog.id });
      toast("Connection lost — dialog dismissed", "⚠", "warn");
    }
  }, [state.status, state.dialog, toast]);

  const activeSession =
    (state.sessions ?? []).find((s) => s.path === state.currentSessionFile) ?? null;

  // Sandbox-prompt gate: until set, show only the prompt + an empty shell.
  if (!sandbox) {
    return (
      <div className="appshell" data-testid="app-shell">
        <SandboxPrompt
          wsUrl={wsUrl}
          onSubmit={(name) => {
            localStorage.setItem(SANDBOX_KEY, name);
            setSandbox(name);
          }}
        />
      </div>
    );
  }

  return (
    <div className="appshell" data-testid="app-shell">
      {wantSwitch && (
        <SandboxPrompt
          wsUrl={wsUrl}
          initial={sandbox}
          onCancel={() => setWantSwitch(false)}
          onSubmit={(name) => {
            if (name === sandbox) {
              setWantSwitch(false);
              return;
            }
            setWantSwitch(false);
            localStorage.setItem(SANDBOX_KEY, name);
            if (sandbox) localStorage.removeItem(sessionFileKey(sandbox));
            setSandbox(name);
          }}
        />
      )}
      <TitleBar
        session={activeSession}
        model={model}
        models={models}
        stats={state.stats}
        status={state.status}
        sandbox={sandbox}
        onPalette={() => setPaletteOpen(true)}
        onSwitchSandbox={() => setWantSwitch(true)}
      />
      <div className="body">
        <Sidebar
          sessions={state.sessions}
          activePath={state.currentSessionFile}
          onSelect={onSwitchSession}
          onNew={onNew}
          onClearAll={onClearAll}
        />
        <main className="center">
          <ChatTranscript
            messages={state.messages}
            scrollRef={scrollRef}
            onScroll={onTranscriptScroll}
          />
          <Composer
            streaming={state.streaming}
            models={models}
            commands={commands}
            model={model}
            onPickModel={onPickModel}
            thinking={thinking}
            onSetThinking={onSetThinking}
            onSend={onSend}
            onAbort={onAbort}
            queueMode={queueMode}
            setQueueMode={setQueueMode}
            onSlash={runSlash}
            onOpenPalette={() => setPaletteOpen(true)}
          />
        </main>
        {tweaks.showEvents && (
          <Inspector
            stats={state.stats}
            queue={queue}
            toggles={toggles}
            onToggle={onToggle}
            onCompact={onCompact}
            onFork={onFork}
            onClone={onClone}
            onExport={onExport}
            events={state.events}
            streaming={state.streaming}
          />
        )}
      </div>

      <ExtDialog req={state.dialog?.req ?? null} onResolve={onDialogResolve} />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        items={paletteItems}
      />
      <ToastStack toasts={toasts} />
    </div>
  );
}
