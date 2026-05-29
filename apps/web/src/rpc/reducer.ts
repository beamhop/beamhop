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
  AssistantBlock,
  AssistantMessage,
  DialogReq,
  Message,
  RpcEvent,
  SessionSummary,
  Stats,
} from "../types";
import { uid } from "../util";
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
        usage ? mergeMessageUsageIntoStats(next, usage) : next,
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

const KNOWN_PROVIDERS = new Set(["anthropic", "openai", "google", "openrouter"]);

function parseModel(m: Json): PiModel | null {
  if (!m || typeof m !== "object") return null;
  const id = typeof m.id === "string" ? m.id : null;
  const name = typeof m.name === "string" ? m.name : id;
  if (!id || !name) return null;
  const provider = (typeof m.provider === "string" && KNOWN_PROVIDERS.has(m.provider)
    ? m.provider
    : "openrouter") as PiModel["provider"];
  const cost = (m.cost ?? {}) as Json;
  const input: Array<"text" | "image"> = Array.isArray(m.input)
    ? (m.input.filter((x) => x === "text" || x === "image") as Array<"text" | "image">)
    : ["text"];
  return {
    id,
    name,
    provider,
    api: typeof m.api === "string" ? m.api : "",
    reasoning: Boolean(m.reasoning),
    input,
    contextWindow: Number(m.contextWindow ?? 0),
    maxTokens: Number(m.maxTokens ?? 0),
    cost: {
      input: Number(cost.input ?? 0),
      output: Number(cost.output ?? 0),
      cacheRead: Number(cost.cacheRead ?? 0),
      cacheWrite: Number(cost.cacheWrite ?? 0),
    },
  };
}

function parseCommand(c: Json): PiCommand | null {
  if (!c || typeof c !== "object") return null;
  const name = typeof c.name === "string" ? c.name : null;
  if (!name) return null;
  const source =
    c.source === "extension" || c.source === "prompt" || c.source === "skill"
      ? c.source
      : "extension";
  const loc = c.location === "project" || c.location === "user" ? c.location : "user";
  return {
    name,
    desc: typeof c.description === "string" ? c.description : "",
    source,
    loc,
  };
}

/** Read a numeric field with a fallback for missing/non-numeric values. */
function numericOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

interface ParsedUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: number;
}

/**
 * pi's per-message usage shape:
 *   { input, output, cacheRead, cacheWrite, totalTokens, cost: { total } }
 * Returns null if the envelope is missing entirely.
 */
function parseUsage(raw: unknown): ParsedUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as Json;
  const cost = u.cost && typeof u.cost === "object" ? (u.cost as Json) : {};
  return {
    input: numericOr(u.input, 0),
    output: numericOr(u.output, 0),
    cacheRead: numericOr(u.cacheRead, 0),
    cacheWrite: numericOr(u.cacheWrite, 0),
    totalTokens: numericOr(u.totalTokens, 0),
    cost: numericOr(cost.total, 0),
  };
}

/**
 * Mirror a per-message usage snapshot into `state.stats` for live feedback
 * during streaming. We add the current message's per-message numbers on
 * top of the last authoritative session baseline (captured from the most
 * recent `get_session_stats` response). At `agent_end` we re-fetch session
 * stats and overwrite — so the only role of this function is keeping the
 * meters ticking smoothly during streaming, not bookkeeping the session.
 */
function mergeMessageUsageIntoStats(state: State, usage: ParsedUsage): State {
  const base = state.sessionStatsBaseline;
  return {
    ...state,
    stats: {
      ...state.stats,
      input: base.input + usage.input,
      output: base.output + usage.output,
      cacheRead: base.cacheRead + usage.cacheRead,
      cacheWrite: base.cacheWrite + usage.cacheWrite,
      contextTokens: base.contextTokens + usage.totalTokens,
      cost: base.cost + usage.cost,
    },
  };
}

/**
 * Rebuild the assistant message's blocks from pi's authoritative
 * `assistantMessageEvent.partial.content[]`.
 *
 * - `content[i]` whose index equals `streamingIdx` is considered live and
 *   gets `streaming: true`; others get `streaming: false`.
 * - Tool-execution state (output, terminal status, args) carried by prior
 *   `tool_execution_*` events lives in `prev` and is preserved when the
 *   matching block (by callId) reappears in `content`.
 */
function rebuildBlocks(
  content: Json[],
  streamingIdx: number,
  prev: AssistantBlock[],
): AssistantBlock[] {
  const out: AssistantBlock[] = [];
  // Index prior tool-call execution state by callId so we can keep
  // accumulated output / final status across rebuilds.
  const prevByCallId: Record<string, AssistantBlock & { type: "toolCall" }> = {};
  for (const b of prev) {
    if (b.type === "toolCall" && b.callId) prevByCallId[b.callId] = b;
  }

  content.forEach((c, i) => {
    const t = String(c.type ?? "");
    const streaming = i === streamingIdx;
    if (t === "thinking") {
      out.push({
        type: "thinking",
        text: String(c.thinking ?? ""),
        streaming,
        collapsed: !streaming,
      });
    } else if (t === "text") {
      out.push({ type: "text", text: String(c.text ?? ""), streaming });
    } else if (t === "toolCall") {
      const callId = String(c.id ?? "");
      const merged = prevByCallId[callId];
      const args = (c.arguments ?? merged?.args ?? {}) as Record<string, unknown>;
      out.push({
        type: "toolCall",
        callId,
        name: String(c.name ?? merged?.name ?? ""),
        args,
        partialArgs: typeof c.partialArgs === "string" ? c.partialArgs : undefined,
        status: merged?.status ?? "running",
        output: merged?.output ?? "",
        streaming,
      });
    }
    // Unknown content-block types are ignored.
  });

  return out;
}

/**
 * Build our `Message[]` from pi's `get_messages` response. Each saved
 * `content[]` already uses the same shape as `partial.content[]` so we
 * can lean on `rebuildBlocks`. Each assistant message gets its own
 * `turnId` — we can't recover the original turn groupings since pi
 * doesn't record them, so prior assistant messages render as their own
 * cards rather than re-grouped.
 */
function hydrateMessages(raw: Json[]): Message[] {
  const out: Message[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const role = String(m.role ?? "");
    if (role === "user") {
      const content = Array.isArray(m.content) ? (m.content as Json[]) : [];
      const text = content
        .map((c) => (c && typeof c === "object" && "text" in c ? String((c as Json).text ?? "") : ""))
        .filter(Boolean)
        .join("\n");
      out.push({
        id: uid("m"),
        role: "user",
        ts: numericOr(m.timestamp, Date.now()),
        text,
      });
    } else if (role === "assistant") {
      const content = Array.isArray(m.content) ? (m.content as Json[]) : [];
      const blocks = rebuildBlocks(content, -1, []);
      const usage = parseUsage(m.usage);
      out.push({
        id: uid("m"),
        role: "assistant",
        ts: numericOr(m.timestamp, Date.now()),
        model: typeof m.model === "string" ? m.model : "",
        stopReason: (typeof m.stopReason === "string" ? m.stopReason : "stop") as
          | "stop"
          | "toolUse"
          | "aborted",
        streaming: false,
        blocks,
        turnId: uid("turn"),
        usage: usage
          ? {
              input: usage.input,
              output: usage.output,
              cacheRead: usage.cacheRead,
              cacheWrite: usage.cacheWrite,
              cost: usage.cost,
            }
          : undefined,
      });
    }
    // `tool` role and others are ignored — their content already lives
    // inside the preceding assistant message's toolCall block.
  }
  return out;
}

/**
 * Find or create a `toolCall` block on the assistant by callId and merge
 * the given partial state into it. Used by `tool_execution_*` handlers.
 */
function upsertToolCall(
  m: AssistantMessage,
  callId: string,
  name: string,
  patch: Partial<AssistantBlock & { type: "toolCall" }>,
): AssistantMessage {
  if (!callId) return m;
  let found = false;
  const blocks = m.blocks.map((b) => {
    if (!found && b.type === "toolCall" && b.callId === callId) {
      found = true;
      return { ...b, ...patch };
    }
    return b;
  });
  if (!found) {
    blocks.push({
      type: "toolCall",
      callId,
      name,
      args: (patch.args ?? {}) as Record<string, unknown>,
      status: patch.status ?? "running",
      output: patch.output ?? "",
      streaming: false,
      ...patch,
    });
  }
  return { ...m, blocks };
}

/**
 * pi's tool result envelopes look like `{ content: [{ type:"text", text }, ...] }`.
 * Collect the text segments into one string. Defensively handles the shape
 * varying (sometimes `result` is a plain string in older builds).
 */
function extractResultText(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "object") {
    const r = raw as Json;
    const content = r.content;
    if (Array.isArray(content)) {
      return content
        .map((c) => {
          if (c && typeof c === "object" && "text" in c) return String((c as Json).text ?? "");
          return "";
        })
        .join("");
    }
    if (typeof r.text === "string") return r.text;
  }
  return "";
}
