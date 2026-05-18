import { useCallback, useEffect, useRef, useState } from "react";
import { CornerDownLeft, Square } from "lucide-react";
import type { AcpSession } from "@beamhop/acp-client";
import { useSlashCommands } from "@beamhop/acp-ui";
import { Button } from "./ui/button.js";
import { Textarea } from "./ui/textarea.js";
import {
  SlashCommandMenu,
  insertCommand,
  useSlashSelection,
} from "./SlashCommandMenu.js";
import { cn } from "../lib/cn.js";

interface ChatTurn {
  id: string;
  role: "user" | "agent";
  /** For agent turns this grows as `session/update` chunks arrive. */
  text: string;
  /** Tool calls / plans rendered inline. */
  events: Array<{ id: string; kind: string; label: string; status?: string }>;
  /** True while the prompt is still streaming. */
  live: boolean;
  /** Final stopReason for agent turns. */
  stopReason?: string;
}

export function ChatPanel({
  session,
  agentLabel,
}: {
  session: AcpSession | null;
  agentLabel: string;
}) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const turnsRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<(() => void) | null>(null);

  // Auto-scroll on new chunks.
  useEffect(() => {
    const el = turnsRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [turns]);

  const send = useCallback(async () => {
    if (!session || !input.trim() || busy) return;
    const userTurn: ChatTurn = {
      id: crypto.randomUUID(),
      role: "user",
      text: input.trim(),
      events: [],
      live: false,
    };
    const agentTurn: ChatTurn = {
      id: crypto.randomUUID(),
      role: "agent",
      text: "",
      events: [],
      live: true,
    };
    setTurns((t) => [...t, userTurn, agentTurn]);
    setInput("");
    setBusy(true);

    const stream = session.prompt(userTurn.text);
    cancelRef.current = () => void stream.cancel();

    try {
      for await (const update of stream) {
        applyUpdate(agentTurn.id, update, setTurns);
      }
      const result = (await stream.result) as { stopReason?: string } | undefined;
      setTurns((t) =>
        t.map((x) =>
          x.id === agentTurn.id ? { ...x, live: false, stopReason: result?.stopReason } : x,
        ),
      );
    } catch (err) {
      setTurns((t) =>
        t.map((x) =>
          x.id === agentTurn.id
            ? {
                ...x,
                live: false,
                stopReason: "error",
                text: x.text + `\n\n[error] ${(err as Error).message ?? String(err)}`,
              }
            : x,
        ),
      );
    } finally {
      setBusy(false);
      cancelRef.current = null;
    }
  }, [session, input, busy]);

  // Slash-command menu: SDK gives us the matched list, we render + steer it.
  const slash = useSlashCommands();
  const matched = slash.match(input); // null when not in slash mode
  const menuOpen = matched !== null;
  const { selectedIndex, move } = useSlashSelection(matched?.length ?? 0);

  const pickCommand = useCallback(
    (cmd: { name: string }) => {
      setInput((prev) => insertCommand(prev, cmd.name));
    },
    [],
  );

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Menu navigation takes priority over the default Enter-to-send.
    if (menuOpen && matched && matched.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        move(1);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        move(-1);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.metaKey && !e.ctrlKey)) {
        e.preventDefault();
        const cmd = matched[selectedIndex];
        if (cmd) pickCommand(cmd);
        return;
      }
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-ink">
      <div className="px-8 py-3 border-b border-rule-soft flex items-baseline justify-between">
        <div className="font-display text-[15px]">conversation</div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-fog">
          {agentLabel} · turn {Math.ceil(turns.length / 2) || 0}
        </div>
      </div>

      <div ref={turnsRef} className="flex-1 overflow-y-auto px-8 py-6">
        {turns.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="max-w-[68ch] mx-auto space-y-8">
            {turns.map((t) => (
              <Turn key={t.id} turn={t} />
            ))}
          </div>
        )}
      </div>

      <Composer
        value={input}
        onChange={setInput}
        onSubmit={send}
        onCancel={() => cancelRef.current?.()}
        busy={busy}
        disabled={!session}
        onKeyDown={onKey}
        menu={
          menuOpen ? (
            <SlashCommandMenu
              commands={matched ?? []}
              selectedIndex={selectedIndex}
              onPick={pickCommand}
              onClose={() => setInput("")}
            />
          ) : null
        }
      />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="h-full grid place-items-center">
      <div className="max-w-[48ch] text-center space-y-4">
        <div className="font-display text-[28px] leading-tight">
          ready when you are.
        </div>
        <div className="text-[12px] text-fog leading-relaxed">
          this is a thin bridge between your browser and an acp coding agent
          running as a subprocess on this host. pick an agent on the left, send
          a prompt — the agent will request permission before touching your
          files.
        </div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-fog mt-6">
          ⌘ + ↩ to send
        </div>
      </div>
    </div>
  );
}

function Turn({ turn }: { turn: ChatTurn }) {
  if (turn.role === "user") {
    return (
      <div className="space-y-1.5">
        <div className="text-[9px] uppercase tracking-[0.22em] text-fog">you</div>
        <div className="text-[13.5px] leading-relaxed whitespace-pre-wrap">{turn.text}</div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2">
        <div className="text-[9px] uppercase tracking-[0.22em] text-amber">agent</div>
        {turn.live && (
          <div className="flex items-center gap-1.5 text-amber">
            <span className="dot dot-pulse" />
            <span className="text-[9px] uppercase tracking-[0.2em]">streaming</span>
          </div>
        )}
        {!turn.live && turn.stopReason && (
          <div
            className={cn(
              "text-[9px] uppercase tracking-[0.2em]",
              turn.stopReason === "error" ? "text-rust" : "text-fog",
            )}
          >
            {turn.stopReason}
          </div>
        )}
      </div>
      <div
        className={cn(
          "text-[13.5px] leading-relaxed whitespace-pre-wrap text-paper",
          turn.live && turn.text && "caret-amber",
        )}
      >
        {turn.text || (turn.live ? <span className="text-fog italic">thinking…</span> : null)}
      </div>
      {turn.events.length > 0 && (
        <div className="mt-3 border-l-2 border-rule pl-4 space-y-1.5">
          {turn.events.map((e) => (
            <div key={e.id} className="flex items-baseline gap-2 text-[11px]">
              <span className="text-[9px] uppercase tracking-[0.2em] text-fog w-16 shrink-0">
                {e.kind}
              </span>
              <span className="text-bone truncate">{e.label}</span>
              {e.status && (
                <span
                  className={cn(
                    "ml-auto text-[9px] uppercase tracking-[0.2em]",
                    e.status === "completed" ? "text-moss" : "text-amber",
                  )}
                >
                  {e.status}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Composer({
  value,
  onChange,
  onSubmit,
  onCancel,
  busy,
  disabled,
  onKeyDown,
  menu,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  busy: boolean;
  disabled: boolean;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  /** Optional menu rendered directly above the input (e.g. slash commands). */
  menu?: React.ReactNode;
}) {
  return (
    <div className="border-t border-rule bg-ink-1 px-8 py-4">
      <div className="max-w-[68ch] mx-auto">
        {menu && <div className="mb-2">{menu}</div>}
        <div className="border border-rule bg-ink-2 focus-within:border-amber transition-colors">
          <Textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              disabled ? "connecting…" : "ask the agent to do something. ⌘↩ to send."
            }
            rows={3}
            disabled={disabled}
            className="px-4 py-3 leading-relaxed"
          />
          <div className="flex items-center justify-between px-3 py-2 border-t border-rule-soft">
            <span className="text-[10px] uppercase tracking-[0.2em] text-fog">
              {value.length} chars
            </span>
            {busy ? (
              <Button variant="danger" size="sm" onClick={onCancel}>
                <Square className="h-3 w-3" /> cancel
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={onSubmit}
                disabled={disabled || !value.trim()}
              >
                send <CornerDownLeft className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function applyUpdate(
  agentTurnId: string,
  rawUpdate: unknown,
  setTurns: React.Dispatch<React.SetStateAction<ChatTurn[]>>,
) {
  // ACP `session/update` notification body has the shape
  //   { sessionId, update: { sessionUpdate: <kind>, ... } }
  const body = rawUpdate as { update?: Record<string, unknown> } | null;
  const u = body?.update;
  if (!u) return;
  const kind = u.sessionUpdate as string | undefined;
  setTurns((turns) =>
    turns.map((t) => {
      if (t.id !== agentTurnId) return t;
      switch (kind) {
        case "agent_message_chunk":
        case "agent_thought_chunk": {
          const content = u.content as { type?: string; text?: string } | undefined;
          const text = content?.text ?? "";
          return { ...t, text: t.text + text };
        }
        case "tool_call":
        case "tool_call_update": {
          // ACP `tool_call` / `tool_call_update` notifications carry their fields
          // directly on the update object — toolCallId, title, status, etc.
          const tc = u as {
            toolCallId?: string;
            title?: string;
            status?: string;
            kind?: string;
          };
          const id = String(tc.toolCallId ?? Math.random());
          const status = tc.status;
          const existing = t.events.find((e) => e.id === id);
          if (existing) {
            // Only overwrite fields the update actually carries — title can be
            // absent on a tool_call_update.
            return {
              ...t,
              events: t.events.map((e) =>
                e.id === id
                  ? {
                      ...e,
                      label: tc.title ?? e.label,
                      status: status ?? e.status,
                    }
                  : e,
              ),
            };
          }
          return {
            ...t,
            events: [
              ...t.events,
              {
                id,
                kind: "tool",
                label: tc.title ?? tc.kind ?? "tool call",
                status,
              },
            ],
          };
        }
        case "plan": {
          const entries = (u.entries as Array<{ content?: string; status?: string }>) ?? [];
          return {
            ...t,
            events: [
              ...t.events,
              ...entries.map((p, i) => ({
                id: `plan-${i}-${Date.now()}`,
                kind: "plan",
                label: p.content ?? "plan step",
                status: p.status,
              })),
            ],
          };
        }
        default:
          return t;
      }
    }),
  );
}
