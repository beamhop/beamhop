import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ChatTranscript } from "./components/Chat";
import { CommandPalette, type PaletteItem } from "./components/CommandPalette";
import { Composer } from "./components/Composer";
import { ExtDialog } from "./components/Dialog";
import { Sidebar } from "./components/Sidebar";
import { Inspector } from "./components/Inspector";
import { SandboxPrompt } from "./components/SandboxPrompt";
import { TitleBar } from "./components/TitleBar";
import { ToastStack } from "./components/ToastStack";
import { buildPaletteItems } from "./components/palette/buildPaletteItems";
import { type PiCommand } from "./data/commands";
import { type PiModel, type ThinkingLevel } from "./data/models";
import { type RpcStatus } from "./rpc/client";
import { useRpcClient } from "./hooks/useRpcClient";
import { useToast } from "./hooks/useToast";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import {
  SANDBOX_KEY,
  forgetSessionFile,
  loadInitialSandbox,
  rememberSandbox,
  rememberSessionFile,
  storedSessionFile,
} from "./hooks/useSessionPersistence";
import { initialState, reduce } from "./rpc/reducer";
import {
  ACCENTS,
  TWEAK_DEFAULTS,
  type DialogAnswer,
  type QueueState,
  type Toggles,
  type Tweaks,
} from "./types";

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
  // When true, the sandbox picker overlays the running app so the user
  // can switch to a different sandbox. Esc/Cancel dismisses it.
  const [wantSwitch, setWantSwitch] = useState(false);

  const { toasts, toast } = useToast();

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

  // --- RPC client lifecycle ---
  const onMessage = useCallback((msg: Record<string, unknown>) => dispatch({ kind: "rpc", msg }), []);
  const onStatus = useCallback(
    (status: RpcStatus, detail?: string) => dispatch({ kind: "status", status, detail }),
    [],
  );
  const { wsUrl, send, request, getClient } = useRpcClient({ sandbox, onMessage, onStatus });

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
    const client = getClient();
    if (!client) return;
    (async () => {
      client.send({ type: "get_available_models" });
      client.send({ type: "get_commands" });
      const stored = storedSessionFile(sandbox);
      if (stored) {
        const resp = await client.request({ type: "switch_session", sessionPath: stored });
        if (resp.success) {
          client.send({ type: "get_messages" });
        } else {
          // Stored path is gone — discard so we don't try again next reload.
          forgetSessionFile(sandbox);
        }
      }
      client.send({ type: "get_session_stats" });
      client.send({ type: "list_sessions" });
    })();
  }, [state.status, sandbox, getClient]);

  // Persist pi's current session file path so we can auto-resume it on
  // the next page load.
  useEffect(() => {
    if (state.currentSessionFile) {
      rememberSessionFile(sandbox, state.currentSessionFile);
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
    const client = getClient();
    if (!client) return;
    // Forget the persisted session before starting a new one so a refresh
    // mid-fresh-session doesn't re-resume the previous one.
    forgetSessionFile(sandbox);
    dispatch({ kind: "reset" });
    setQueue({ steering: [], followUp: [] });
    await client.request({ type: "new_session" });
    client.send({ type: "get_session_stats" });
    client.send({ type: "list_sessions" });
    toast("New session started", "+");
  }, [sandbox, toast, getClient]);

  // Switch to a previously-saved session from the sidebar.
  const onSwitchSession = useCallback(
    async (path: string) => {
      const client = getClient();
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
    [toast, getClient],
  );

  // Delete every saved session JSONL inside the sandbox, then have pi
  // open a fresh empty session. Persisted sessionFile is dropped so the
  // next refresh doesn't try to switch_session to a path we just nuked.
  const onClearAll = useCallback(async () => {
    const client = getClient();
    if (!client) return;
    const resp = await client.request({ type: "clear_all_sessions" });
    if (!resp.success) {
      toast("Couldn't clear history", "✕", "warn");
      return;
    }
    const removed = (resp.data as { removed?: number } | undefined)?.removed ?? 0;
    forgetSessionFile(sandbox);
    dispatch({ kind: "reset" });
    setQueue({ steering: [], followUp: [] });
    await client.request({ type: "new_session" });
    client.send({ type: "list_sessions" });
    client.send({ type: "get_session_stats" });
    toast(`Cleared ${removed} session${removed === 1 ? "" : "s"}`, "✕", "warn");
  }, [sandbox, toast, getClient]);

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

  // Global keyboard shortcuts: ⌘K toggles the palette, Esc aborts a run.
  useKeyboardShortcuts(
    useMemo(
      () => [
        { key: "k", meta: true, run: () => setPaletteOpen((o) => !o) },
        {
          key: "escape",
          when: () => state.streaming && !state.dialog,
          preventDefault: false,
          run: onAbort,
        },
      ],
      [state.streaming, state.dialog, onAbort],
    ),
  );

  const paletteItems = useMemo<PaletteItem[]>(
    () =>
      buildPaletteItems({
        sessions: state.sessions,
        currentSessionFile: state.currentSessionFile,
        streaming: state.streaming,
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
        setQueueMode,
        onPickModel,
        onSetThinking,
        onCompact,
        onToggle,
        setTweak,
        runSlash,
        toast,
      }),
    [
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
      toast,
    ],
  );

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
            rememberSandbox(name);
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
            rememberSandbox(name);
            if (sandbox) forgetSessionFile(sandbox);
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
