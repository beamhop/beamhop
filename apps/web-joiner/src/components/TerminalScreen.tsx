import { useEffect, useMemo, useRef, useState } from "react";
import type { Invite } from "@beamhop/invite-link";
import { connectP2P } from "@beamhop/shell-client/p2p";
import type {
  HolderState,
  P2PConnectOptions,
  ShellConnection,
} from "@beamhop/shell-client";
import { joinRoom as joinNostrRoom } from "@trystero-p2p/nostr";
import { joinRoom as joinWsRelayRoom } from "@trystero-p2p/ws-relay";
import { Terminal, useTerminal } from "@wterm/react";

type Status =
  | { kind: "dialing" }
  | { kind: "connected"; sessionId: string }
  | { kind: "closed"; code: string; message: string };

interface HolderUiState {
  holder: HolderState;
  /** When the latest holder change arrived (monotonic). */
  changedAt: number;
}

const INITIAL_COLS = 100;
const INITIAL_ROWS = 32;

export interface TerminalScreenProps {
  invite: Invite;
}

export function TerminalScreen({ invite }: TerminalScreenProps) {
  const [status, setStatus] = useState<Status>({ kind: "dialing" });
  const [elapsed, setElapsed] = useState(0);
  const [selfPeerId, setSelfPeerId] = useState("");
  const [holderUi, setHolderUi] = useState<HolderUiState>({
    holder: { peerId: null, ttlMs: 0 },
    changedAt: 0,
  });
  const term = useTerminal();
  const connRef = useRef<ShellConnection | null>(null);

  // Elapsed timer
  useEffect(() => {
    if (status.kind !== "connected") return;
    const start = Date.now();
    const t = setInterval(() => setElapsed(Date.now() - start), 1000);
    return () => clearInterval(t);
  }, [status.kind]);

  // Dial the peer + wire input/output once the invite is resolved.
  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      try {
        const useRelay = Boolean(
          invite.relayUrls && invite.relayUrls.length > 0,
        );
        const joinRoom = useRelay
          ? (joinWsRelayRoom as unknown as P2PCustomJoinRoom)
          : (joinNostrRoom as unknown as P2PCustomJoinRoom);
        const config = useRelay
          ? { relayConfig: { urls: invite.relayUrls! } }
          : {};
        const opts: P2PConnectOptions = {
          transport: "p2p",
          strategy: "custom",
          joinRoom,
          config,
          roomId: invite.room,
          token: invite.token,
          hostPeerId: invite.hostPeerId,
          cols: INITIAL_COLS,
          rows: INITIAL_ROWS,
          signal: abort.signal,
          waitForHostMs: 30000,
        };
        const conn = await connectP2P(opts);
        connRef.current = conn;
        setStatus({ kind: "connected", sessionId: conn.sessionId });
        setSelfPeerId(conn.selfPeerId);
        // Seed UI with whatever holder state the connection saw on first
        // sync (the host sends a holder frame right after `ready`).
        setHolderUi({ holder: { ...conn.holder }, changedAt: Date.now() });
        conn.onData((bytes) => term.write(bytes));
        conn.onHolder((next) =>
          setHolderUi({ holder: next, changedAt: Date.now() }),
        );
        conn.onClose((reason) => {
          setStatus({
            kind: "closed",
            code: reason?.code ?? "closed",
            message: reason?.message ?? "connection closed",
          });
          term.write("\r\n\x1b[33m[connection closed]\x1b[0m\r\n");
        });
        // Focus the terminal so keystrokes go to it immediately.
        term.focus();
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
      connRef.current?.close();
      connRef.current = null;
    };
    // `term` from useTerminal is stable across renders; including it isn't needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invite]);

  const onTerminalData = (data: string) => connRef.current?.write(data);
  const onTerminalResize = (cols: number, rows: number) =>
    connRef.current?.resize(cols, rows);

  return (
    <main className="min-h-full flex flex-col px-4 sm:px-8 py-6 max-w-[80rem] mx-auto">
      <Chrome invite={invite} status={status} elapsed={elapsed} />

      {status.kind === "connected" && (
        <HolderBadge holder={holderUi} selfPeerId={selfPeerId} />
      )}

      <div className="ascii-frame flex-1 mt-4 relative rounded-sm border border-[var(--color-rust)]/40 bg-[#15100a] shadow-[0_30px_90px_-50px_rgba(146,64,14,0.7)] overflow-hidden">
        <div className="scanlines absolute inset-0 z-[1] pointer-events-none" />
        <div className="scan-sweep" />
        <Terminal
          ref={term.ref}
          cols={INITIAL_COLS}
          rows={INITIAL_ROWS}
          autoResize
          cursorBlink
          onData={onTerminalData}
          onResize={onTerminalResize}
          className="wterm-amber absolute inset-0"
          style={{ zIndex: 1 }}
        />
        {status.kind === "dialing" && <DialingOverlay invite={invite} />}
      </div>

      <Footer status={status} />
    </main>
  );
}

function HolderBadge({
  holder,
  selfPeerId,
}: {
  holder: HolderUiState;
  selfPeerId: string;
}) {
  // Drive a smooth countdown bar from the last change.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      setTick(Date.now());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const { peerId, ttlMs } = holder.holder;
  const elapsed = tick - holder.changedAt;
  const remaining = peerId === null ? 0 : Math.max(0, ttlMs - elapsed);
  const progress = peerId === null ? 0 : remaining / ttlMs;

  const isSelf = peerId !== null && peerId === selfPeerId;
  const isOther = peerId !== null && !isSelf;
  const label =
    peerId === null
      ? "keyboard free"
      : isSelf
        ? "you have the keyboard"
        : `${shortPeer(peerId)} is typing`;
  const tone = isOther
    ? "text-[var(--color-rust)]"
    : isSelf
      ? "text-[var(--color-amber)]"
      : "text-[var(--color-ash)]";

  return (
    <div
      className="mt-3 flex items-center gap-3"
      style={{ fontFamily: "var(--font-body)" }}
      data-testid="holder-badge"
      data-self-peer-id={selfPeerId}
      data-holder-peer={peerId ?? ""}
      data-holder-self={isSelf ? "1" : "0"}
    >
      <span className={`text-[11px] uppercase tracking-[0.3em] ${tone}`}>
        {label}
      </span>
      <div className="flex-1 h-px bg-[var(--color-ink)]/15 relative overflow-hidden">
        <div
          className={`absolute inset-y-0 left-0 ${
            isOther ? "bg-[var(--color-rust)]" : "bg-[var(--color-amber)]"
          }`}
          style={{
            width: `${progress * 100}%`,
            transition: "width 120ms linear",
            opacity: peerId === null ? 0 : 0.85,
          }}
        />
      </div>
      <span className="text-[10px] uppercase tracking-[0.3em] text-[var(--color-ash)] tabular-nums">
        {peerId === null ? "—" : `${Math.ceil(remaining)}ms`}
      </span>
    </div>
  );
}

function shortPeer(peerId: string): string {
  return peerId.length <= 6 ? peerId : `${peerId.slice(0, 6)}…`;
}

type P2PCustomJoinRoom = (config: unknown, roomId: string) => unknown;

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function Chrome({
  invite,
  status,
  elapsed,
}: {
  invite: Invite;
  status: Status;
  elapsed: number;
}) {
  const dotColor =
    status.kind === "connected"
      ? "bg-[#16a34a]"
      : status.kind === "dialing"
        ? "bg-[var(--color-amber)] pulse-amber"
        : "bg-[#dc2626]";
  const statusLabel =
    status.kind === "connected"
      ? `live · ${formatElapsed(elapsed)}`
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
            beamhop / live
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
      "awaiting host peer",
      "sending auth token",
    ],
    [signal],
  );
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#15100a]/95 pointer-events-none">
      <div className="text-center max-w-md px-8">
        <div
          className="text-[10px] uppercase tracking-[0.5em] text-[var(--color-amber-glow)] mb-6 flicker"
          style={{ fontFamily: "var(--font-body)" }}
        >
          establishing peer link
        </div>
        <pre
          className="text-[var(--color-amber)] text-[0.6rem] leading-none mb-8 select-none"
          style={{ fontFamily: "var(--font-body)" }}
        >
{`     /\\
    /  \\        you
   /────\\
  ▲      ▲
   \\    /
    \\  /
     \\/        host`}
        </pre>
        <ul
          className="text-left text-[var(--color-paper)]/70 text-xs space-y-1.5"
          style={{ fontFamily: "var(--font-terminal)" }}
        >
          {steps.map((s, i) => (
            <li key={s} className="flex items-center gap-2">
              <span className="text-[var(--color-amber)]">›</span>
              <span style={{ animationDelay: `${0.1 + i * 0.15}s` }} className="fade-up">{s}</span>
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
    body = `session ${status.sessionId.slice(0, 8)} · type to send · peers connect direct, no server in the middle`;
  } else if (status.kind === "dialing") {
    body = "this can take up to 30 seconds on first connect — webrtc handshake + nostr discovery";
  } else {
    body = `${status.code} · ${status.message} — reload the page to retry`;
  }
  return (
    <footer
      className="mt-4 pt-3 border-t border-[var(--color-ink)]/30 text-[10px] uppercase tracking-[0.3em] text-[var(--color-ash)] flex flex-wrap items-center gap-x-4 gap-y-1"
      style={{ fontFamily: "var(--font-body)" }}
    >
      <span>{body}</span>
    </footer>
  );
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const s = String(totalSec % 60).padStart(2, "0");
  return `${m}:${s}`;
}
