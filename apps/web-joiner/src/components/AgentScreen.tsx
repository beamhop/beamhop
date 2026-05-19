import { useEffect, useMemo, useRef, useState } from "react";
import type { Invite } from "@beamhop/invite-link";
import { connectAcpP2P, type AcpP2PSession } from "@beamhop/acp-p2p/peer";
import { joinRoom as joinNostrRoom } from "@trystero-p2p/nostr";
import { joinRoom as joinWsRelayRoom } from "@trystero-p2p/ws-relay";

type Status =
  | { kind: "dialing" }
  | { kind: "connected"; sessionId: string }
  | { kind: "closed"; code: string; message: string };

interface Message {
  id: string;
  role: "user" | "agent";
  text: string;
  /** Set on the agent message while a prompt is streaming. */
  pending?: boolean;
}

export interface AgentScreenProps {
  invite: Invite;
}

export function AgentScreen({ invite }: AgentScreenProps) {
  const [status, setStatus] = useState<Status>({ kind: "dialing" });
  const [messages, setMessages] = useState<Message[]>([]);
  const [inFlight, setInFlight] = useState(false);
  const [draft, setDraft] = useState("");
  const sessionRef = useRef<AcpP2PSession | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      try {
        const useRelay = Boolean(
          invite.relayUrls && invite.relayUrls.length > 0,
        );
        const joinRoom = useRelay
          ? (joinWsRelayRoom as unknown as Parameters<
              typeof connectAcpP2P
            >[0]["joinRoom"])
          : (joinNostrRoom as unknown as Parameters<
              typeof connectAcpP2P
            >[0]["joinRoom"]);
        const session = await connectAcpP2P({
          joinRoom,
          appId: "beamhop",
          roomId: invite.room,
          password: invite.password,
          agent: "opencode",
          clientInfo: {
            name: "@beamhop/web-joiner",
            version: "0.0.0",
          },
          // As an observer peer we don't act on agent→client RPCs (the host
          // handles those). Auto-reject permission prompts so the agent gets
          // an answer fast if it ever tries to ask this peer directly.
          handlers: {
            onPermissionRequest: () => "reject_once" as const,
          },
          role: "observer",
          readyTimeoutMs: 60_000,
        });
        if (abort.signal.aborted) {
          await session.close().catch(() => {});
          return;
        }
        sessionRef.current = session;
        setStatus({
          kind: "connected",
          sessionId: session.sessionId ?? "",
        });
      } catch (err) {
        setStatus({
          kind: "closed",
          code: "connect_failed",
          message: errorMessage(err),
        });
      }
    })();
    return () => {
      abort.abort();
      void sessionRef.current?.close().catch(() => {});
      sessionRef.current = null;
    };
  }, [invite]);

  const send = async () => {
    const text = draft.trim();
    if (!text || inFlight) return;
    const session = sessionRef.current;
    if (!session) return;

    const userId = randomId();
    const agentId = randomId();
    setMessages((m) => [
      ...m,
      { id: userId, role: "user", text },
      { id: agentId, role: "agent", text: "", pending: true },
    ]);
    setDraft("");
    setInFlight(true);

    try {
      const stream = session.prompt(text);
      for await (const update of stream) {
        const chunkText = extractText(update);
        if (chunkText) {
          setMessages((m) =>
            m.map((msg) =>
              msg.id === agentId
                ? { ...msg, text: msg.text + chunkText }
                : msg,
            ),
          );
        }
      }
      await stream.result;
    } catch (err) {
      setMessages((m) =>
        m.map((msg) =>
          msg.id === agentId
            ? {
                ...msg,
                text: msg.text || `[error: ${errorMessage(err)}]`,
                pending: false,
              }
            : msg,
        ),
      );
    } finally {
      setMessages((m) =>
        m.map((msg) =>
          msg.id === agentId ? { ...msg, pending: false } : msg,
        ),
      );
      setInFlight(false);
    }
  };

  return (
    <main className="min-h-full flex flex-col px-4 sm:px-8 py-6 max-w-[68rem] mx-auto h-screen">
      <Chrome status={status} invite={invite} />

      <div className="ascii-frame flex-1 mt-4 relative rounded-sm border border-[var(--color-rust)]/40 bg-[var(--color-paper-deep)] shadow-[0_30px_90px_-50px_rgba(146,64,14,0.7)] overflow-hidden flex flex-col">
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-6 py-6 space-y-4"
          data-testid="agent-transcript"
        >
          {messages.length === 0 && status.kind === "connected" && (
            <EmptyState />
          )}
          {messages.map((m) => (
            <MessageRow key={m.id} message={m} />
          ))}
        </div>
        <Composer
          draft={draft}
          onChange={setDraft}
          onSend={send}
          disabled={status.kind !== "connected" || inFlight}
          inFlight={inFlight}
        />
        {status.kind === "dialing" && <DialingOverlay invite={invite} />}
      </div>

      <Footer status={status} />
    </main>
  );
}

function MessageRow({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div
      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
      data-testid={`msg-${message.role}`}
    >
      <div
        className={
          isUser
            ? "max-w-[80%] bg-[var(--color-ink)] text-[var(--color-paper)] px-4 py-3 rounded-sm rounded-tr-none"
            : "max-w-[85%] bg-[var(--color-paper)] text-[var(--color-ink)] px-4 py-3 rounded-sm rounded-tl-none border border-[var(--color-rust)]/30"
        }
        style={{ fontFamily: "var(--font-body)", fontSize: "0.875rem" }}
      >
        <div
          className="text-[9px] uppercase tracking-[0.3em] mb-1 opacity-60"
          style={{ fontFamily: "var(--font-body)" }}
        >
          {isUser ? "you" : "opencode"}
          {message.pending ? " · streaming" : ""}
        </div>
        <div className="whitespace-pre-wrap leading-relaxed">
          {message.text}
          {message.pending && (
            <span
              className="cursor-blink ml-1 text-[var(--color-amber)]"
              aria-hidden="true"
            >
              ▌
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Composer({
  draft,
  onChange,
  onSend,
  disabled,
  inFlight,
}: {
  draft: string;
  onChange: (s: string) => void;
  onSend: () => void;
  disabled: boolean;
  inFlight: boolean;
}) {
  return (
    <div className="border-t border-[var(--color-ink)]/20 p-3 bg-[var(--color-paper)]">
      <div className="flex items-start gap-2">
        <textarea
          value={draft}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder={
            disabled && !inFlight
              ? "connecting…"
              : inFlight
                ? "agent is responding…"
                : "ask the agent. Enter to send · Shift+Enter for newline"
          }
          disabled={disabled && !inFlight}
          rows={2}
          className="flex-1 resize-none bg-transparent text-[var(--color-ink)] placeholder:text-[var(--color-ash)] focus:outline-none px-3 py-2 disabled:opacity-50"
          style={{ fontFamily: "var(--font-terminal)", fontSize: "0.875rem" }}
          data-testid="agent-prompt-input"
        />
        <button
          onClick={onSend}
          disabled={disabled || !draft.trim()}
          className="bg-[var(--color-ink)] text-[var(--color-paper)] px-4 py-3 text-xs uppercase tracking-[0.25em] hover:bg-[var(--color-amber)] hover:text-[var(--color-ink)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ fontFamily: "var(--font-body)" }}
          data-testid="agent-send"
        >
          {inFlight ? "…" : "send →"}
        </button>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-8 py-16">
      <pre
        className="text-[var(--color-amber)] text-[0.6rem] leading-none mb-6 select-none"
        style={{ fontFamily: "var(--font-body)" }}
      >
{` ╔═══════════╗
 ║  opencode ║
 ╚═════╤═════╝
       │ inside
   ┌───┴───┐
   │ guest │
   └───────┘`}
      </pre>
      <p
        className="text-[var(--color-ink-soft)] text-base max-w-[42ch]"
        style={{ fontFamily: "var(--font-body)" }}
      >
        Ask anything. The agent runs in the host&apos;s microVM — its filesystem
        and processes are isolated from your machine.
      </p>
    </div>
  );
}

function Chrome({ status, invite }: { status: Status; invite: Invite }) {
  const dotColor =
    status.kind === "connected"
      ? "bg-[#16a34a]"
      : status.kind === "dialing"
        ? "bg-[var(--color-amber)] pulse-amber"
        : "bg-[#dc2626]";
  const statusLabel =
    status.kind === "connected"
      ? "live"
      : status.kind === "dialing"
        ? "dialing peer"
        : "closed";
  return (
    <header className="border-b-2 border-[var(--color-ink)] pb-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3">
          <span
            className="text-[var(--color-amber)] text-xl font-bold leading-none"
            style={{ fontFamily: "var(--font-body)" }}
          >
            ▲
          </span>
          <span
            className="text-xs uppercase tracking-[0.3em]"
            style={{ fontFamily: "var(--font-body)" }}
          >
            beamhop / agent
          </span>
        </div>
        <div className="h-4 w-px bg-[var(--color-ink)]/40" />
        <div
          className="flex items-baseline gap-2 text-sm"
          style={{ fontFamily: "var(--font-body)" }}
        >
          <span className="text-[var(--color-ash)]">room</span>
          <span className="text-[var(--color-ink)] font-medium">
            {invite.room.slice(0, 12)}
            {invite.room.length > 12 ? "…" : ""}
          </span>
        </div>
      </div>
      <div
        className="flex items-center gap-3 text-[11px] uppercase tracking-[0.25em]"
        style={{ fontFamily: "var(--font-body)" }}
      >
        <span className={`w-2 h-2 rounded-full ${dotColor}`} />
        <span>{statusLabel}</span>
      </div>
    </header>
  );
}

function DialingOverlay({ invite }: { invite: Invite }) {
  const signal = invite.relayUrls?.length ? "ws-relay" : "nostr";
  const steps = useMemo(
    () => [
      "resolving signaling strategy",
      `joining trystero room · ${signal}`,
      "awaiting agent gateway",
      "negotiating ACP handshake",
    ],
    [signal],
  );
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--color-paper-deep)]/95 pointer-events-none">
      <div className="text-center max-w-md px-8">
        <div
          className="text-[10px] uppercase tracking-[0.5em] text-[var(--color-rust)] mb-6 flicker"
          style={{ fontFamily: "var(--font-body)" }}
        >
          establishing peer link
        </div>
        <ul
          className="text-left text-[var(--color-ink-soft)] text-xs space-y-1.5"
          style={{ fontFamily: "var(--font-terminal)" }}
        >
          {steps.map((s, i) => (
            <li key={s} className="flex items-center gap-2">
              <span className="text-[var(--color-amber)]">›</span>
              <span
                style={{ animationDelay: `${0.1 + i * 0.15}s` }}
                className="fade-up"
              >
                {s}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Footer({ status }: { status: Status }) {
  let body = "";
  if (status.kind === "connected") {
    body =
      "agent runs inside the host's sandbox · prompts go p2p, no server in the middle";
  } else if (status.kind === "dialing") {
    body =
      "up to 60 seconds on first connect — webrtc handshake, nostr discovery, agent boot";
  } else {
    body = `${status.code} · ${status.message} — reload to retry`;
  }
  return (
    <footer
      className="mt-4 pt-3 border-t border-[var(--color-ink)]/30 text-[10px] uppercase tracking-[0.3em] text-[var(--color-ash)] flex flex-wrap items-center gap-x-4"
      style={{ fontFamily: "var(--font-body)" }}
    >
      <span>{body}</span>
    </footer>
  );
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Best-effort extraction of streamed text from an ACP session/update payload.
 * The wire shape varies a bit across agent vendors; for opencode the user-
 * visible text usually lands in `update.content[].text` for an
 * `agent_message_chunk` update.
 */
function extractText(update: unknown): string {
  if (!update || typeof update !== "object") return "";
  const u = update as Record<string, unknown>;
  // ACP notification: { method: "session/update", params: { update: {...} } }
  const params = (u.params as Record<string, unknown> | undefined) ?? u;
  const inner = (params?.update as Record<string, unknown> | undefined) ?? params;
  if (!inner) return "";
  const kind = inner.sessionUpdate as string | undefined;
  if (
    kind === "agent_message_chunk" ||
    kind === "agent_thought_chunk" ||
    kind === "user_message_chunk"
  ) {
    const content = inner.content as
      | { type?: string; text?: string }
      | { type?: string; text?: string }[]
      | undefined;
    if (Array.isArray(content)) {
      return content
        .map((c) => (c.type === "text" ? (c.text ?? "") : ""))
        .join("");
    }
    if (content && typeof content === "object") {
      const ct = content as { type?: string; text?: string };
      return ct.type === "text" ? (ct.text ?? "") : "";
    }
  }
  return "";
}
