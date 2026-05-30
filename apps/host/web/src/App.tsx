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
import { RoomBar } from "./components/RoomBar";
import { PeerRoster } from "./components/PeerRoster";
import { buildPaletteItems } from "./components/palette/buildPaletteItems";
import { type PiCommand } from "./data/commands";
import { type PiModel, type ThinkingLevel } from "./data/models";
import { type Json, type RpcStatus } from "./rpc/client";
import { useRpcClient } from "./hooks/useRpcClient";
import { useToast } from "./hooks/useToast";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import {
  forgetSessionFile,
  loadInitialSandbox,
  loadTweaks,
  rememberSandbox,
  rememberSessionFile,
  rememberTweaks,
  storedSessionFile,
} from "./hooks/useSessionPersistence";
import { initialState, reduce } from "./rpc/reducer";
import {
  MultiplayerProvider,
  useMultiplayer,
  useMultiplayerState,
  type RoomBindings,
} from "./multiplayer/store";
import { P2PTransport } from "./multiplayer/P2PTransport";
import { guessHostContext, probeHostContext, rpcUrl, type AppContext } from "./env";
import {
  ACCENTS,
  type DialogAnswer,
  type Message,
  type QueueState,
  type Stats,
  type Toggles,
  type Tweaks,
} from "./types";

/**
 * Root: owns the multiplayer API + host/guest context detection, provides the
 * multiplayer context, then renders the real app. The multiplayer manager's
 * Owner-side hooks (snapshot/inject/describe) and the participant frame sink
 * are supplied via a ref that always points at the live app's state.
 */
export default function App() {
  // Owner/participant hooks the RoomManager calls into; filled by AppInner.
  const bindingsRef = useRef<RoomBindings>({
    buildSnapshot: () => null,
    injectInput: () => {},
    describeSession: () => ({ title: "", cwd: "", updatedAt: null, messageCount: 0 }),
    onRemoteFrame: () => {},
  });
  const mp = useMultiplayerState(bindingsRef);

  // Host vs Guest: optimistic guess for first paint, corrected by a probe.
  const [ctx, setCtx] = useState<AppContext>(guessHostContext);
  useEffect(() => {
    let alive = true;
    probeHostContext().then((c) => {
      if (alive) setCtx(c);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <MultiplayerProvider value={mp}>
      <AppInner ctx={ctx} bindingsRef={bindingsRef} />
    </MultiplayerProvider>
  );
}

function AppInner({
  ctx,
  bindingsRef,
}: {
  ctx: AppContext;
  bindingsRef: React.MutableRefObject<RoomBindings>;
}) {
  const isHost = ctx === "host";
  const mp = useMultiplayer();

  // --- persistent settings ---
  // A Guest never attaches to a local sandbox.
  const [sandbox, setSandbox] = useState<string>(() => (isHost ? loadInitialSandbox() : ""));

  // --- tweaks (UI chrome) — persisted so accent/density/developer-mode stick ---
  const [tweaks, setTweaks] = useState<Tweaks>(loadTweaks);
  const setTweak = useCallback(
    <K extends keyof Tweaks>(k: K, v: Tweaks[K]) => setTweaks((p) => ({ ...p, [k]: v })),
    [],
  );
  useEffect(() => {
    rememberTweaks(tweaks);
  }, [tweaks]);
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
  const [model, setModel] = useState<string>("");
  const [thinking, setThinking] = useState<ThinkingLevel>("medium");
  const [queueMode, setQueueMode] = useState<"steer" | "followUp">("steer");
  const [queue, setQueue] = useState<QueueState>({ steering: [], followUp: [] });
  const [toggles, setToggles] = useState<Toggles>({ autoCompact: true, autoRetry: true });
  const [paletteOpen, setPaletteOpen] = useState(false);
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

  // Are we currently viewing someone else's shared session (Participant view)?
  const viewingShared = mp.room?.openSessionKey ?? null;
  const sharedMeta = useMemo(
    () => mp.room?.catalog.find((m) => m.sessionKey === viewingShared) ?? null,
    [mp.room, viewingShared],
  );

  // --- RPC client lifecycle (Host only) ---
  const onMessage = useCallback((msg: Json) => dispatch({ kind: "rpc", msg }), []);
  const onStatus = useCallback(
    (status: RpcStatus, detail?: string) => dispatch({ kind: "status", status, detail }),
    [],
  );

  // The session file currently bound to the local pi connection — what we tap
  // and fan out to room peers when it's shared.
  const currentSessionFileRef = useRef<string | null>(null);
  currentSessionFileRef.current = state.currentSessionFile;
  const onFrameTap = useCallback(
    (frame: Json) => {
      const f = currentSessionFileRef.current;
      if (f) mp.onLocalFrame(f, frame);
    },
    [mp],
  );

  const { send, request, getClient } = useRpcClient({
    sandbox: isHost ? sandbox : "",
    onMessage,
    onStatus,
    onFrameTap,
  });

  // --- Participant transport (when viewing a shared session) ---
  const p2pRef = useRef<P2PTransport | null>(null);
  // Route the manager's remote frames into the live P2P transport.
  useEffect(() => {
    bindingsRef.current.onRemoteFrame = (_key, frame) => {
      p2pRef.current?.deliver(frame);
    };
  }, [bindingsRef]);

  // Open/close the P2P transport as the participant opens/closes a shared session.
  useEffect(() => {
    if (!viewingShared) {
      p2pRef.current?.close();
      p2pRef.current = null;
      return;
    }
    dispatch({ kind: "reset" });
    const t = new P2PTransport({
      api: mp,
      sessionKey: viewingShared,
      onMessage: (msg) => dispatch({ kind: "rpc", msg }),
      onSnapshot: (snap) =>
        dispatch({
          kind: "snapshot",
          messages: snap.messages as Message[],
          stats: snap.stats as Partial<Stats>,
          currentModelId: snap.currentModelId,
        }),
      onStatus,
    });
    p2pRef.current = t;
    t.connect();
    return () => {
      t.close();
      p2pRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewingShared]);

  // Live catalogs from pi.
  const models: PiModel[] = state.models ?? [];
  const commands: PiCommand[] = state.commands ?? [];

  // --- Owner-side multiplayer bindings (kept fresh every render) ---
  bindingsRef.current.buildSnapshot = (sessionFile: string) => {
    // We can only snapshot the session currently loaded in our single reducer.
    if (sessionFile !== state.currentSessionFile) return null;
    return {
      messages: state.messages as unknown[],
      stats: state.stats as unknown as Record<string, unknown>,
      currentModelId: state.currentModelId,
    };
  };
  bindingsRef.current.injectInput = (sessionFile, kind, message) => {
    // Only inject if the relayed input targets the session we have loaded.
    if (sessionFile !== state.currentSessionFile) return;
    if (kind === "prompt") {
      dispatch({ kind: "pushUser", text: message });
      send({ type: "prompt", message });
    } else {
      send({ type: "steer", message });
    }
  };
  bindingsRef.current.describeSession = (sessionFile: string) => {
    const s = (state.sessions ?? []).find((x) => x.path === sessionFile);
    return {
      title: s?.title ?? "",
      cwd: s?.cwd ?? "",
      updatedAt: s?.updatedAt ?? null,
      messageCount: s?.messageCount ?? 0,
    };
  };

  // Once pi confirms open, ask for catalogs + resume the stored session.
  useEffect(() => {
    if (!isHost) return;
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
          forgetSessionFile(sandbox);
        }
      }
      client.send({ type: "get_session_stats" });
      client.send({ type: "list_sessions" });
    })();
  }, [isHost, state.status, sandbox, getClient]);

  useEffect(() => {
    if (!isHost) return;
    if (state.currentSessionFile) rememberSessionFile(sandbox, state.currentSessionFile);
  }, [isHost, state.currentSessionFile, sandbox]);

  const wasStreamingRef = useRef(false);
  useEffect(() => {
    if (!isHost) return;
    if (wasStreamingRef.current && !state.streaming) {
      send({ type: "get_session_stats" });
      send({ type: "list_sessions" });
    }
    wasStreamingRef.current = state.streaming;
  }, [isHost, state.streaming, send]);

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

  // onSend routes to the right transport: the local pi (own session) or the
  // remote Owner (participant collab view).
  const onSend = useCallback(
    (text: string, mode: "prompt" | "steer" | "followUp") => {
      if (viewingShared) {
        // Participant: only prompt/steer are meaningful; both relay to Owner.
        dispatch({ kind: "pushUser", text });
        p2pRef.current?.send({ type: mode === "followUp" ? "prompt" : mode, message: text });
        return;
      }
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
    [viewingShared, send, toast],
  );

  const onAbort = useCallback(() => {
    if (viewingShared) return; // can't abort a remote agent
    send({ type: "abort" });
    toast("Aborted", "✕", "warn");
  }, [viewingShared, send, toast]);

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
    forgetSessionFile(sandbox);
    dispatch({ kind: "reset" });
    setQueue({ steering: [], followUp: [] });
    await client.request({ type: "new_session" });
    client.send({ type: "get_session_stats" });
    client.send({ type: "list_sessions" });
    toast("New session started", "+");
  }, [sandbox, toast, getClient]);

  const onSwitchSession = useCallback(
    async (path: string) => {
      // Leaving a participant view if one is open.
      if (viewingShared) mp.closeShared();
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
    [viewingShared, mp, toast, getClient],
  );

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
      dispatch({ kind: "pushUser", text: `/${c.name}` });
      send({ type: "prompt", message: `/${c.name}` });
    },
    [onCompact, send],
  );

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
      if (state.status === "open") {
        send({ type: "extension_ui_response", id: state.dialog.id, ...ans });
      }
      dispatch({ kind: "dialogAnswered", id: state.dialog.id });
    },
    [state.dialog, state.status, send],
  );

  useEffect(() => {
    if (state.dialog && state.status !== "open") {
      dispatch({ kind: "dialogAnswered", id: state.dialog.id });
      toast("Connection lost — dialog dismissed", "⚠", "warn");
    }
  }, [state.status, state.dialog, toast]);

  // The session shown in the title bar: a local one, or the shared one we view.
  const activeSession = viewingShared
    ? sharedMeta
      ? { path: sharedMeta.sessionFile, sessionId: null, title: sharedMeta.title, cwd: sharedMeta.cwd, updatedAt: sharedMeta.updatedAt, messageCount: sharedMeta.messageCount, sizeBytes: 0 }
      : null
    : (state.sessions ?? []).find((s) => s.path === state.currentSessionFile) ?? null;

  // Composer state: read-only when viewing a view-only shared session.
  const composerDisabledReason =
    viewingShared && sharedMeta?.mode !== "collab"
      ? "Viewing a read-only shared session"
      : null;

  // --- Gating: Guest with no room yet → join screen; Host with no sandbox → picker ---
  if (!isHost && !mp.room) {
    return (
      <div className="appshell guest" data-testid="app-shell">
        <div className="guest-join" data-testid="guest-join-screen">
          <div className="guest-join-card">
            <div className="brand">
              <span className="logo mono">π</span>
              <span className="brandname">
                pi<span className="brandsub">control</span>
              </span>
            </div>
            <p className="guest-join-blurb">
              Join a room to view and collaborate on shared agentic sessions. You're a
              browser guest — you can't run a local agent, only join hosts' rooms.
            </p>
            <RoomBar />
          </div>
        </div>
        <ToastStack toasts={toasts} />
      </div>
    );
  }

  if (isHost && !sandbox) {
    return (
      <div className="appshell" data-testid="app-shell">
        <SandboxPrompt
          wsUrl={rpcUrl() ?? ""}
          onSubmit={(name) => {
            rememberSandbox(name);
            setSandbox(name);
          }}
        />
        <ToastStack toasts={toasts} />
      </div>
    );
  }

  return (
    <div className="appshell" data-testid="app-shell">
      {isHost && wantSwitch && (
        <SandboxPrompt
          wsUrl={rpcUrl() ?? ""}
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
        sandbox={isHost ? sandbox : "guest"}
        devMode={tweaks.developerMode}
        onPalette={() => setPaletteOpen(true)}
        onSwitchSandbox={() => isHost && setWantSwitch(true)}
        roomSlot={
          <>
            <PeerRoster />
            <RoomBar />
          </>
        }
      />
      <div className="body">
        <Sidebar
          sessions={isHost ? state.sessions : []}
          activePath={viewingShared ?? state.currentSessionFile}
          onSelect={onSwitchSession}
          onNew={onNew}
          onClearAll={onClearAll}
          isHost={isHost}
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
            disabledReason={composerDisabledReason}
          />
        </main>
        {tweaks.developerMode && tweaks.showEvents && (
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
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} items={paletteItems} />
      <ToastStack toasts={toasts} />
    </div>
  );
}
