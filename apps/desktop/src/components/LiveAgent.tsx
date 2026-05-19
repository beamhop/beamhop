import { useEffect, useRef, useState } from "react";
import { Session, type AcpSession } from "@beamhop/acp-client";
import { encode } from "@beamhop/invite-link";
import type { SessionView } from "../../sidecar/protocol.ts";
import type { ShareInfo } from "../App.tsx";
import type { SidecarApi, SidecarClient } from "../lib/sidecar-client.ts";
import { createSidecarAcpTransport } from "../lib/sidecar-acp-transport.ts";

/**
 * Local agent chat pane. Drives the agent over the sidecar's in-process ACP
 * channel — no P2P required. The share affordance is kept as a collapsible
 * footer so external joiners (browser tabs, mobile) can still join the same
 * session over WebRTC.
 */
export function LiveAgent({
  api,
  client,
  session,
  share,
}: {
  api: SidecarApi;
  client: SidecarClient;
  session: SessionView;
  share: ShareInfo | null;
}) {
  const [status, setStatus] = useState<Status>({ kind: "connecting" });
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [inFlight, setInFlight] = useState(false);
  const sessionRef = useRef<AcpSession | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const abort = new AbortController();
    // Latch the most specific reason we hear about. `fatal` arrives with
    // the gateway's rich error (e.g. `agent_crashed` + stderrTail);
    // `close` arrives right after with only the WS code/reason. Without
    // this, openAndAwaitReady's reject sees only the close-event message
    // and the user gets a useless "socket closed" instead of the actual
    // crash reason.
    let fatalReason: string | null = null;
    void (async () => {
      try {
        const transport = createSidecarAcpTransport(client, api, session.id);
        const acp = new Session(
          {
            agent: (session.agentId ?? "opencode") as never,
            clientInfo: {
              name: "@beamhop/desktop",
              version: "0.0.0",
            },
            handlers: {
              // Permission prompts arrive on agent → client RPCs. We auto-
              // accept once for the desktop owner — they're driving the
              // sandbox themselves. Replace with a real dialog later.
              onPermissionRequest: () => "allow_once" as const,
            },
          },
          transport,
        );
        acp.on("fatal", (err: { code?: string; message?: string; context?: unknown }) => {
          const ctx = err.context as { stderrTail?: string } | undefined;
          const tail = ctx?.stderrTail?.trim();
          fatalReason = [
            err.code ? `[${err.code}] ` : "",
            err.message ?? "fatal",
            tail ? `\n\n--- stderr ---\n${tail}` : "",
          ].join("");
        });
        await acp.openAndAwaitReady();
        if (abort.signal.aborted) {
          await acp.close().catch(() => {});
          return;
        }
        sessionRef.current = acp;
        setStatus({ kind: "ready" });
      } catch (err) {
        // Prefer the fatal frame's detail; fall back to whatever Session
        // threw (typically the bare close-event message).
        setStatus({
          kind: "error",
          message: fatalReason ?? errorMessage(err),
        });
      }
    })();
    return () => {
      abort.abort();
      void sessionRef.current?.close().catch(() => {});
      sessionRef.current = null;
    };
  }, [api, client, session.id, session.agentId]);

  const send = async () => {
    const text = draft.trim();
    if (!text || inFlight) return;
    const acp = sessionRef.current;
    if (!acp) return;

    const userId = randomId();
    const agentMsgId = randomId();
    setMessages((m) => [
      ...m,
      { id: userId, role: "user", text },
      { id: agentMsgId, role: "agent", text: "", pending: true },
    ]);
    setDraft("");
    setInFlight(true);

    try {
      const stream = acp.prompt(text);
      for await (const update of stream) {
        const chunk = extractText(update);
        if (chunk) {
          setMessages((m) =>
            m.map((msg) =>
              msg.id === agentMsgId
                ? { ...msg, text: msg.text + chunk }
                : msg,
            ),
          );
        }
      }
      await stream.result;
    } catch (err) {
      setMessages((m) =>
        m.map((msg) =>
          msg.id === agentMsgId
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
          msg.id === agentMsgId ? { ...msg, pending: false } : msg,
        ),
      );
      setInFlight(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-6 py-5 space-y-4"
        data-testid="agent-transcript"
      >
        {messages.length === 0 && status.kind === "ready" && (
          <EmptyState agentId={session.agentId ?? "agent"} />
        )}
        {status.kind === "connecting" && <ConnectingHint />}
        {status.kind === "error" && <ErrorHint message={status.message} />}
        {messages.map((m) => (
          <MessageRow key={m.id} message={m} agentId={session.agentId ?? "agent"} />
        ))}
      </div>
      <Composer
        draft={draft}
        onChange={setDraft}
        onSend={send}
        disabled={status.kind !== "ready" || inFlight}
        inFlight={inFlight}
      />
      <ShareFooter session={session} share={share} />
    </div>
  );
}

// ---------- pieces ----------

type Status =
  | { kind: "connecting" }
  | { kind: "ready" }
  | { kind: "error"; message: string };

interface Message {
  id: string;
  role: "user" | "agent";
  text: string;
  pending?: boolean;
}

function MessageRow({ message, agentId }: { message: Message; agentId: string }) {
  const isUser = message.role === "user";
  return (
    <div
      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
      data-testid={`msg-${message.role}`}
    >
      <div
        className={
          isUser
            ? "max-w-[80%] bg-[var(--color-paper)] text-[var(--color-ink)] px-4 py-3 rounded-sm rounded-tr-none"
            : "max-w-[85%] bg-[var(--color-paper-deep)] text-[var(--color-paper)] px-4 py-3 rounded-sm rounded-tl-none border border-[var(--color-rust)]/30"
        }
        style={{ fontFamily: "var(--font-body)", fontSize: "0.875rem" }}
      >
        <div
          className="text-[9px] uppercase tracking-[0.3em] mb-1 opacity-60"
          style={{ fontFamily: "var(--font-body)" }}
        >
          {isUser ? "you" : agentId}
          {message.pending ? " · streaming" : ""}
        </div>
        <div className="whitespace-pre-wrap leading-relaxed">
          {message.text}
          {message.pending && (
            <span
              className="ml-1 text-[var(--color-amber)]"
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
    <div className="border-t border-[var(--color-rust)]/40 p-3 bg-[var(--color-ink)]">
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
          className="flex-1 resize-none bg-transparent text-[var(--color-paper)] placeholder:text-[var(--color-paper)]/40 focus:outline-none px-3 py-2 disabled:opacity-50"
          style={{ fontFamily: "var(--font-terminal)", fontSize: "0.875rem" }}
          data-testid="agent-prompt-input"
        />
        <button
          onClick={onSend}
          disabled={disabled || !draft.trim()}
          className="bg-[var(--color-amber)] text-[var(--color-ink)] px-4 py-3 text-xs uppercase tracking-[0.25em] hover:bg-[var(--color-amber-bright)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ fontFamily: "var(--font-body)" }}
          data-testid="agent-send"
        >
          {inFlight ? "…" : "send →"}
        </button>
      </div>
    </div>
  );
}

function EmptyState({ agentId }: { agentId: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-8 py-16">
      <pre
        className="text-[var(--color-amber)] text-[0.6rem] leading-none mb-6 select-none"
        style={{ fontFamily: "var(--font-body)" }}
      >
{` ╔═════════════╗
 ║  ${agentId.padEnd(11, " ")}║
 ╚══════╤══════╝
        │ inside
   ┌────┴────┐
   │ sandbox │
   └─────────┘`}
      </pre>
      <p
        className="text-[var(--color-paper)]/65 max-w-[42ch] text-sm leading-relaxed"
        style={{ fontFamily: "var(--font-body)" }}
      >
        Ask anything. The agent runs inside this sandbox — its filesystem and
        processes are isolated from your machine.
      </p>
    </div>
  );
}

function ConnectingHint() {
  return (
    <p
      className="text-[10px] uppercase tracking-[0.3em] text-[var(--color-amber)]/70"
      style={{ fontFamily: "var(--font-body)" }}
    >
      booting agent…
    </p>
  );
}

function ErrorHint({ message }: { message: string }) {
  return (
    <div
      className="border border-[#dc2626]/40 bg-[#dc2626]/10 text-[#fecaca] px-3 py-2 text-xs whitespace-pre-wrap font-mono leading-relaxed"
      style={{ fontFamily: "var(--font-terminal)" }}
      data-testid="agent-error"
    >
      could not connect to agent: {message}
    </div>
  );
}

function ShareFooter({
  session,
  share,
}: {
  session: SessionView;
  share: ShareInfo | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const url = share
    ? `http://localhost:5174/${encode({
        kind: "agent",
        room: share.roomId,
        token: share.token,
        hostPeerId: share.hostPeerId || undefined,
      })}`
    : null;

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <div className="border-t border-[var(--color-rust)]/30 bg-[var(--color-ink)] text-[10px] uppercase tracking-[0.25em] text-[var(--color-paper)]/50">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left px-4 py-2 hover:text-[var(--color-amber)] flex items-center justify-between"
        style={{ fontFamily: "var(--font-body)" }}
      >
        <span>
          {share ? "shared · open link to join from anywhere" : "share this session"}
        </span>
        <span aria-hidden>{expanded ? "▾" : "▸"}</span>
      </button>
      {expanded && (
        <div className="px-4 pb-3 pt-1 space-y-2">
          {share && url ? (
            <>
              <code
                className="block text-[10px] text-[var(--color-paper)]/50 truncate px-3 py-2 bg-black/30 border border-[var(--color-rust)]/40 rounded-sm normal-case tracking-normal"
                style={{ fontFamily: "var(--font-terminal)" }}
              >
                {url}
              </code>
              <div className="flex gap-2 normal-case tracking-normal">
                <button
                  onClick={copy}
                  className="text-xs px-3 py-1.5 bg-[var(--color-amber)] text-[var(--color-ink)] hover:bg-[var(--color-amber-bright)]"
                  style={{ fontFamily: "var(--font-body)" }}
                >
                  {copied ? "copied!" : "copy link"}
                </button>
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs px-3 py-1.5 border border-[var(--color-amber)] text-[var(--color-amber)] hover:bg-[var(--color-amber)] hover:text-[var(--color-ink)]"
                  style={{ fontFamily: "var(--font-body)" }}
                >
                  open ↗
                </a>
              </div>
            </>
          ) : (
            <p
              className="text-[var(--color-paper)]/45 normal-case tracking-normal text-xs"
              style={{ fontFamily: "var(--font-body)" }}
            >
              toggle &quot;public&quot; in the session list to get a join link
              that browsers and other devices can use over WebRTC. The local
              chat above is unaffected — sharing is additive.
            </p>
          )}
          <span className="hidden">{session.id}</span>
        </div>
      )}
    </div>
  );
}

// ---------- helpers ----------

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Best-effort extraction of streamed text from an ACP session/update payload.
 * Mirrors the web-joiner's extractor — the wire shape varies a bit across
 * agent vendors; for opencode the user-visible text usually lands in
 * `update.content[].text` for an `agent_message_chunk` update.
 */
function extractText(update: unknown): string {
  if (!update || typeof update !== "object") return "";
  const u = update as Record<string, unknown>;
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
