/**
 * Maps pi-mono RPC events to the transcript state the design renders.
 *
 * The pi protocol uses an `assistantMessageEvent` envelope under
 * `message_update` that carries deltas (text_delta, thinking_delta,
 * toolcall_delta, …). We translate those into the design's block
 * structure (text/thinking/toolCall blocks with `streaming` flags).
 *
 * Stats updates land here when pi emits them (via dedicated stat events
 * or piggy-backed onto turn_end); until that's wired we leave them alone.
 */
import type { PiCommand } from "../data/commands";
import type { PiModel } from "../data/models";
import type {
  AssistantMessage,
  DialogReq,
  Message,
  RpcEvent,
  SessionSummary,
  Stats,
} from "../types";
import { uid } from "../util";
import { parseCommand, parseModel } from "../data/parsers";
import { mergeUsageIntoStats, numericOr, parseUsage } from "../utils/stats";
import {
  extractResultText,
  hydrateMessages,
  rebuildBlocks,
  upsertToolCall,
} from "../utils/piMessages";
import type { Json } from "./client";

export interface State {
  status: "idle" | "connecting" | "open" | "closed" | "error";
  statusDetail?: string;
  messages: Message[];
  streaming: boolean;
  stats: Stats;
  events: RpcEvent[];
  dialog: { id: string; req: DialogReq } | null;
  /** pi-reported catalog. null until get_available_models responds. */
  models: PiModel[] | null;
  /** pi-reported slash commands. null until get_commands responds. */
  commands: PiCommand[] | null;
  /** Whichever model pi reports as currently selected. */
  currentModelId: string | null;
  /**
   * Absolute path of the pi session JSONL file currently bound to the
   * RPC connection (e.g. `/.pi/agent/sessions/<cwd>/<ts>_<uuid>.jsonl`).
   * Populated from every `get_session_stats` response. This is the id
   * `switch_session` / `new_session` accept and what we persist in
   * localStorage to auto-resume across refreshes.
   */
  currentSessionFile: string | null;
  /** Session UUID (informational; switch_session uses the path, not this). */
  currentSessionId: string | null;
  /** Sessions discovered from the sandbox FS. null until first list_sessions. */
  sessions: SessionSummary[] | null;
  /**
   * The currently-open turn's id (stamped on each new assistant message
   * inside this turn so the renderer can group them under one header).
   * Set on `agent_start`, cleared on `agent_end`.
   */
  currentTurnId: string | null;
  /**
   * The last authoritative session-wide totals from `get_session_stats`.
   * During streaming we render `baseline + currentMessageUsage` so the
   * meters tick smoothly without losing accumulated session totals.
   */
  sessionStatsBaseline: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    contextTokens: number;
    cost: number;
  };
}

export const initialState = (): State => ({
  status: "idle",
  messages: [],
  streaming: false,
  stats: {
    contextTokens: 0,
    contextWindow: 200000,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    toolCalls: 0,
  },
  events: [],
  dialog: null,
  models: null,
  commands: null,
  currentModelId: null,
  currentSessionFile: null,
  currentSessionId: null,
  sessions: null,
  currentTurnId: null,
  sessionStatsBaseline: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    contextTokens: 0,
    cost: 0,
  },
});

export type Action =
  | { kind: "status"; status: State["status"]; detail?: string }
  | { kind: "pushUser"; text: string; images?: number }
  | { kind: "rpc"; msg: Json }
  | { kind: "dialogAnswered"; id: string }
  | { kind: "setStats"; patch: Partial<Stats> }
  | { kind: "reset" };

/** Update the last assistant message in the transcript immutably. */
function updateAssistant(
  state: State,
  fn: (msg: AssistantMessage) => AssistantMessage,
): State {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const m = state.messages[i];
    if (m.role !== "assistant") continue;
    const updated = fn(m);
    if (updated === m) return state;
    const next = state.messages.slice();
    next[i] = updated;
    return { ...state, messages: next };
  }
  return state;
}

function pushEvent(state: State, ev: RpcEvent): State {
  return { ...state, events: [...state.events, ev].slice(-200) };
}

export function reduce(state: State, action: Action): State {
  switch (action.kind) {
    case "status":
      return { ...state, status: action.status, statusDetail: action.detail };

    case "reset":
      // Wipe the *transcript* and per-turn live state. Preserve everything
      // bound to the WebSocket connection itself (sessions list, catalogs,
      // status). Used when switching sessions or starting a new one — the
      // sidebar / model picker / status pill must not blink to "loading".
      return {
        ...state,
        messages: [],
        streaming: false,
        events: [],
        dialog: null,
        currentTurnId: null,
        currentSessionFile: null,
        currentSessionId: null,
        sessionStatsBaseline: initialState().sessionStatsBaseline,
        stats: { ...initialState().stats, contextWindow: state.stats.contextWindow },
      };

    case "pushUser": {
      const m: Message = {
        id: uid("m"),
        role: "user",
        ts: Date.now(),
        text: action.text,
        images: action.images,
      };
      return { ...state, messages: [...state.messages, m] };
    }

    case "setStats":
      return { ...state, stats: { ...state.stats, ...action.patch } };

    case "dialogAnswered":
      if (state.dialog?.id !== action.id) return state;
      return { ...state, dialog: null };

    case "rpc":
      return reduceRpc(state, action.msg);
  }
}

function reduceRpc(state: State, msg: Json): State {
  const type = String(msg.type ?? "");
  // Host-synthesized control envelopes
  if (type === "ready" || type === "error" || type === "host_stderr" || type === "host_parse_error" || type === "bridge_closed" || type === "host_child_exited") {
    return pushEvent(state, { k: type, name: String(msg.message ?? msg.line ?? msg.reason ?? "") });
  }

  // Replies to client commands arrive as a single envelope:
  //   { type:"response", command:"<orig>", success, data:{...} }
  if (type === "response") {
    return reduceResponse(state, msg);
  }

  switch (type) {
    case "agent_start":
      // Open a new turn. Every `message_start` between here and `agent_end`
      // stamps this turnId so the renderer can group them as one card.
      return pushEvent(
        { ...state, streaming: true, currentTurnId: uid("turn") },
        { k: "agent_start" },
      );

    case "turn_start":
      return pushEvent(state, { k: "turn_start" });

    case "message_start": {
      // Each `message_start` begins a new assistant turn message. The model
      // may produce several within one `agent_start`/`agent_end` (e.g. one
      // for thinking+toolcall, another for the post-tool response). They
      // share a `turnId` so the UI groups them under a single header.
      const turnId = state.currentTurnId ?? uid("turn");
      const assistant: AssistantMessage = {
        id: uid("m"),
        role: "assistant",
        ts: Date.now(),
        model: String(msg.model ?? ""),
        stopReason: null,
        streaming: true,
        blocks: [],
        turnId,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
      };
      return pushEvent(
        {
          ...state,
          messages: [...state.messages, assistant],
          currentTurnId: turnId,
        },
        { k: "message_start" },
      );
    }

    case "message_update": {
      // pi sends the model's full current message as `partial.content[]` on
      // every delta. We rebuild blocks from that instead of accumulating
      // deltas ourselves — eliminates whole categories of duplication bugs.
      const env = (msg.assistantMessageEvent ?? {}) as Json;
      const dType = String(env.type ?? "");
      const partial = (env.partial ?? {}) as Json;
      const content = Array.isArray(partial.content) ? (partial.content as Json[]) : [];
      const streamingIdx = dType.endsWith("_end") ? -1 : Number(env.contentIndex ?? -1);
      const usage = parseUsage(partial.usage);
      const next = updateAssistant(state, (m) => ({
        ...m,
        blocks: rebuildBlocks(content, streamingIdx, m.blocks),
        usage: usage ?? m.usage,
      }));
      // Mirror the live per-message usage into the global stats so the
      // sidebar's cost / token meters tick during streaming. The context
      // ring still waits for the authoritative `get_session_stats` snapshot
      // that the app requests after `agent_end`.
      return pushEvent(
        usage
          ? { ...next, stats: mergeUsageIntoStats(next.stats, next.sessionStatsBaseline, usage) }
          : next,
        { k: "message_update", d: dType },
      );
    }

    case "message_end":
      return pushEvent(
        updateAssistant(state, (m) => ({
          ...m,
          streaming: false,
          blocks: m.blocks.map((b) => {
            if (b.type === "thinking") return { ...b, streaming: false, collapsed: true };
            if (b.type === "text") return { ...b, streaming: false };
            return b;
          }),
        })),
        { k: "message_end" },
      );

    case "tool_execution_start": {
      // pi's wire fields are `toolCallId`, `toolName`, `args`. There's
      // already a `toolCall` block in the assistant's `partial.content[]`
      // from the model side; we want to attach execution state to that
      // same block (matched by callId).
      const toolCallId = String(msg.toolCallId ?? "");
      const toolName = String(msg.toolName ?? "");
      const args = (msg.args ?? {}) as Record<string, unknown>;
      const next = updateAssistant(state, (m) =>
        upsertToolCall(m, toolCallId, toolName, { args, status: "running" }),
      );
      return pushEvent(next, { k: "tool_execution_start", name: toolName });
    }

    case "tool_execution_update": {
      const toolCallId = String(msg.toolCallId ?? "");
      // `partialResult` is ACCUMULATED (not a delta) — overwrite, don't append.
      const output = extractResultText(msg.partialResult);
      const next = updateAssistant(state, (m) =>
        upsertToolCall(m, toolCallId, String(msg.toolName ?? ""), { output }),
      );
      return pushEvent(next, { k: "tool_execution_update" });
    }

    case "tool_execution_end": {
      const toolCallId = String(msg.toolCallId ?? "");
      const isError = Boolean(msg.isError);
      const output = extractResultText(msg.result);
      const next = updateAssistant(state, (m) =>
        upsertToolCall(m, toolCallId, String(msg.toolName ?? ""), {
          output,
          status: isError ? "error" : "done",
        }),
      );
      return pushEvent(
        { ...next, stats: { ...next.stats, toolCalls: next.stats.toolCalls + 1 } },
        { k: "tool_execution_end", name: String(msg.toolName ?? "") },
      );
    }

    case "extension_ui_request": {
      const req: DialogReq = {
        method: (String(msg.method ?? "confirm") as DialogReq["method"]),
        title: msg.title as string | undefined,
        message: msg.message as string | undefined,
        options: msg.options as string[] | undefined,
        cmd: msg.cmd as string | undefined,
        placeholder: msg.placeholder as string | undefined,
      };
      return pushEvent(
        { ...state, dialog: { id: String(msg.id ?? uid("dlg")), req } },
        { k: "extension_ui_request", method: req.method },
      );
    }

    case "turn_end":
      return pushEvent(state, { k: "turn_end" });

    case "agent_end": {
      const aborted = Boolean(msg.aborted);
      const next = updateAssistant(state, (m) => ({
        ...m,
        streaming: false,
        stopReason: aborted ? "aborted" : "stop",
      }));
      return pushEvent(
        { ...next, streaming: false, currentTurnId: null },
        { k: "agent_end", aborted },
      );
    }

    case "compaction_start":
      return pushEvent(state, { k: "compaction_start" });

    case "compaction_end":
      return pushEvent(
        {
          ...state,
          stats: { ...state.stats, contextTokens: Math.round(state.stats.contextTokens * 0.28) },
        },
        { k: "compaction_end" },
      );

    case "queue_update":
      return pushEvent(state, { k: "queue_update" });
  }

  return pushEvent(state, { k: type || "unknown" });
}

function reduceResponse(state: State, msg: Json): State {
  const command = String(msg.command ?? "");
  const success = msg.success !== false;
  const data = (msg.data ?? {}) as Json;
  const next = pushEvent(state, { k: "response", name: command });
  if (!success) return next;

  if (command === "get_available_models") {
    const raw = Array.isArray(data.models) ? (data.models as Json[]) : [];
    const models: PiModel[] = raw.map(parseModel).filter(Boolean) as PiModel[];
    return { ...next, models };
  }

  if (command === "get_commands") {
    const raw = Array.isArray(data.commands) ? (data.commands as Json[]) : [];
    const commands: PiCommand[] = raw.map(parseCommand).filter(Boolean) as PiCommand[];
    return { ...next, commands };
  }

  if (command === "set_model" || command === "cycle_model") {
    const id = data.modelId ?? data.id;
    if (typeof id === "string") return { ...next, currentModelId: id };
  }

  if (command === "get_session_stats") {
    // Authoritative snapshot of the whole session. Overwrites both the
    // live-running stats AND the baseline used to extrapolate during the
    // next streaming turn.
    const tokens = (data.tokens ?? {}) as Json;
    const ctx = (data.contextUsage ?? {}) as Json;
    const baseline = {
      input: numericOr(tokens.input, 0),
      output: numericOr(tokens.output, 0),
      cacheRead: numericOr(tokens.cacheRead, 0),
      cacheWrite: numericOr(tokens.cacheWrite, 0),
      contextTokens: numericOr(ctx.tokens, 0),
      cost: numericOr(data.cost, 0),
    };
    const tcCount =
      typeof data.toolCalls === "number" ? data.toolCalls : next.stats.toolCalls;
    return {
      ...next,
      sessionStatsBaseline: baseline,
      currentSessionFile:
        typeof data.sessionFile === "string" ? data.sessionFile : next.currentSessionFile,
      currentSessionId:
        typeof data.sessionId === "string" ? data.sessionId : next.currentSessionId,
      stats: {
        ...next.stats,
        ...baseline,
        contextWindow: numericOr(ctx.contextWindow, next.stats.contextWindow),
        toolCalls: tcCount,
      },
    };
  }

  if (command === "get_messages") {
    // Hydrate the transcript from a switched-into session. Wipes the live
    // streaming state — anything in-flight is discarded by definition when
    // we switch.
    const raw = Array.isArray(data.messages) ? (data.messages as Json[]) : [];
    const hydrated = hydrateMessages(raw);
    return {
      ...next,
      messages: hydrated,
      streaming: false,
      currentTurnId: null,
    };
  }

  if (command === "list_sessions") {
    // Host-synthesized: walks the sandbox's pi sessions dir and returns
    // one summary per file (filtering out empty fresh-on-connect files).
    const raw = Array.isArray(data.sessions) ? (data.sessions as unknown[]) : [];
    const sessions: SessionSummary[] = raw
      .filter((s): s is SessionSummary => !!s && typeof s === "object" && "path" in s);
    return { ...next, sessions };
  }

  return next;
}
