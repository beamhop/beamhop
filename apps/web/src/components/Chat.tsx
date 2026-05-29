import React, { useEffect, useState } from "react";
import type {
  AssistantMessage,
  Message,
  NoticeBlock,
  TextBlock,
  ThinkingBlock,
  ToolCallBlock,
  UserMessage,
} from "../types";
import { Caret, RichText } from "./RichText";

const TOOL_META: Record<string, { c: string; g: string }> = {
  read: { c: "var(--blue)", g: "◰" },
  grep: { c: "var(--blue)", g: "⌕" },
  write: { c: "var(--green)", g: "✎" },
  edit: { c: "var(--green)", g: "↹" },
  bash: { c: "var(--amber)", g: "›_" },
  glob: { c: "var(--blue)", g: "✲" },
  ls: { c: "var(--blue)", g: "▤" },
  fetch: { c: "var(--violet)", g: "⇣" },
  web_search: { c: "var(--violet)", g: "⌕" },
  todo: { c: "var(--green)", g: "☑" },
};

const DEFAULT_TOOL = { c: "var(--accent)", g: "▶" };

/**
 * Short, human-readable summary of a tool's arguments for the header row.
 * Never returns "{}" — falls back to an empty string when args aren't known
 * yet, so the row reads cleanly while the model is still streaming.
 */
function argSummary(name: string, args: Record<string, unknown>, partialArgs?: string): string {
  const empty = !args || Object.keys(args).length === 0;
  if (empty) {
    // While the model is still emitting arg tokens we have a streaming JSON
    // string. Render it directly so the user sees progress instead of "{}".
    return partialArgs ?? "";
  }
  if (name === "bash") return String(args.command ?? "");
  if (name === "grep") {
    const p = String(args.pattern ?? "");
    const path = String(args.path ?? "");
    return path ? `${p}  ·  ${path}` : p;
  }
  if (typeof args.path === "string") return args.path;
  if (typeof args.url === "string") return args.url;
  if (typeof args.command === "string") return String(args.command);
  // Compact key=value summary for unknown tools.
  return Object.entries(args)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" · ");
}

function ThinkingBlockView({ block, testid }: { block: ThinkingBlock; testid: string }) {
  const [open, setOpen] = useState(!block.collapsed);
  useEffect(() => {
    if (block.collapsed) setOpen(false);
  }, [block.collapsed]);
  return (
    <div className="thinkblock" data-testid={testid}>
      <button className="thinkhead" onClick={() => setOpen((o) => !o)}>
        <span className="thinkglyph">✦</span>
        <span className="thinklabel">Thinking</span>
        {block.streaming && (
          <span className="thinkdots">
            <i />
            <i />
            <i />
          </span>
        )}
        <span className="chev" style={{ transform: open ? "rotate(90deg)" : "none" }}>
          ›
        </span>
      </button>
      {open && (
        <div className="thinkbody">
          <RichText text={block.text} />
          {block.streaming && <Caret />}
        </div>
      )}
    </div>
  );
}

function ToolCallView({ block, testid }: { block: ToolCallBlock; testid: string }) {
  const [open, setOpen] = useState(false);
  const meta = TOOL_META[block.name] ?? DEFAULT_TOOL;
  const running = block.status === "running";
  const err = block.status === "error";
  const summary = argSummary(block.name, block.args, block.partialArgs);
  return (
    <div className={"toolcall" + (err ? " err" : "")} data-testid={testid}>
      <button className="toolhead" onClick={() => setOpen((o) => !o)}>
        <span className="toolglyph" style={{ color: meta.c }}>
          {meta.g}
        </span>
        <span className="tooltag mono">tool</span>
        <span className="toolname mono" style={{ color: meta.c }}>
          {block.name || "…"}
        </span>
        {summary && <span className="toolargs mono">{summary}</span>}
        <span className="toolspacer" />
        {block.diff && (
          <span className="diffbadge">
            {block.diff.add > 0 && <span className="add">+{block.diff.add}</span>}
            {block.diff.del > 0 && <span className="del">−{block.diff.del}</span>}
          </span>
        )}
        <span className="toolstatus">
          {running ? (
            <span className="spin" />
          ) : err ? (
            <span className="x">✕</span>
          ) : (
            <span className="ok">✓</span>
          )}
        </span>
        {block.output && (
          <span className="chev" style={{ transform: open ? "rotate(90deg)" : "none" }}>
            ›
          </span>
        )}
      </button>
      {open && block.output && <pre className="tooloutput mono">{block.output}</pre>}
      {running && block.streaming && block.output && (
        <pre className="tooloutput mono live">
          {block.output}
          <Caret />
        </pre>
      )}
    </div>
  );
}

function NoticeView({ block }: { block: NoticeBlock }) {
  return (
    <div className={"notice " + (block.tone === "ok" ? "ok" : "block")}>
      <span className="noticedot" />
      <RichText text={block.text} inline />
    </div>
  );
}

function UserRow({ msg }: { msg: UserMessage }) {
  return (
    <div className="row user" data-testid={`msg-${msg.id}`}>
      <div className="ububble">
        <RichText text={msg.text} inline />
        {msg.images && msg.images > 0 ? (
          <div className="uimg mono">+{msg.images} image</div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Render N assistant messages from a single agent turn as one card —
 * one "pi · model" header, all blocks concatenated in order. The header
 * uses the first message's model and the last message's stop reason /
 * streaming flag. Per-message usage rolls up.
 */
function AssistantTurn({ messages }: { messages: AssistantMessage[] }) {
  if (messages.length === 0) return null;
  const first = messages[0];
  const last = messages[messages.length - 1];
  const streaming = messages.some((m) => m.streaming);
  const aborted = last.stopReason === "aborted";
  const totalCost = messages.reduce((s, m) => s + (m.usage?.cost ?? 0), 0);
  const totalOutput = messages.reduce((s, m) => s + (m.usage?.output ?? 0), 0);
  const totalCacheRead = messages.reduce((s, m) => s + (m.usage?.cacheRead ?? 0), 0);
  return (
    <div className="row asst" data-testid={`turn-${first.turnId}`}>
      <div className="gutter">
        <span
          className="dot"
          style={{ background: aborted ? "var(--red)" : "var(--accent)" }}
        />
        <span className="rail" />
      </div>
      <div className="asstbody">
        <div className="asstmeta">
          <span className="mono">pi</span>
          <span className="sep">·</span>
          <span>{first.model || last.model}</span>
          {aborted && <span className="abortedtag">aborted</span>}
        </div>
        {messages.flatMap((m) =>
          m.blocks.map((b, i) => {
            const key = `${m.id}-${i}`;
            if (b.type === "thinking")
              return <ThinkingBlockView key={key} block={b as ThinkingBlock} testid={`msg-${m.id}-thinking-${i}`} />;
            if (b.type === "toolCall")
              return <ToolCallView key={key} block={b as ToolCallBlock} testid={`msg-${m.id}-tool-${i}`} />;
            if (b.type === "notice") return <NoticeView key={key} block={b as NoticeBlock} />;
            const t = b as TextBlock;
            return (
              <div className="asttext" key={key}>
                <RichText text={t.text} />
                {t.streaming && <Caret />}
              </div>
            );
          }),
        )}
        {totalCost > 0 && !streaming && (
          <div className="turncost mono">
            {(totalCacheRead / 1000).toFixed(1)}k cached · {totalOutput} out · $
            {totalCost.toFixed(4)}
          </div>
        )}
      </div>
    </div>
  );
}

export interface ChatTranscriptProps {
  messages: Message[];
  scrollRef: React.RefObject<HTMLDivElement>;
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void;
}

/**
 * pi emits structural `message_start`/`message_end` pairs that sometimes
 * carry no content (interstitial bookkeeping between substantive messages
 * in one turn). Skip those at render time so the transcript stays clean.
 */
function isRenderable(m: Message): boolean {
  if (m.role === "user") return true;
  if (m.streaming) return true;
  return m.blocks.length > 0;
}

type RenderItem =
  | { kind: "user"; msg: UserMessage }
  | { kind: "turn"; turnId: string; messages: AssistantMessage[] };

/**
 * Walk the message list and coalesce consecutive assistant messages that
 * share a `turnId` into one `RenderItem`. User messages always break the
 * run. Empty/structural assistant messages are filtered first.
 */
function groupForRender(messages: Message[]): RenderItem[] {
  const out: RenderItem[] = [];
  let current: { kind: "turn"; turnId: string; messages: AssistantMessage[] } | null = null;
  for (const m of messages) {
    if (!isRenderable(m)) continue;
    if (m.role === "user") {
      if (current) {
        out.push(current);
        current = null;
      }
      out.push({ kind: "user", msg: m });
      continue;
    }
    const a = m as AssistantMessage;
    if (current && current.turnId === a.turnId) {
      current.messages.push(a);
    } else {
      if (current) out.push(current);
      current = { kind: "turn", turnId: a.turnId, messages: [a] };
    }
  }
  if (current) out.push(current);
  return out;
}

export function ChatTranscript({ messages, scrollRef, onScroll }: ChatTranscriptProps) {
  const items = groupForRender(messages);
  return (
    <div className="transcript" ref={scrollRef} onScroll={onScroll} data-testid="transcript">
      <div className="transcript-inner">
        {items.map((item) =>
          item.kind === "user" ? (
            <UserRow key={item.msg.id} msg={item.msg} />
          ) : (
            <AssistantTurn key={item.turnId} messages={item.messages} />
          ),
        )}
        <div style={{ height: 8 }} />
      </div>
    </div>
  );
}
