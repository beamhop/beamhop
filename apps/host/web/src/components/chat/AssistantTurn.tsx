import type {
  AssistantMessage,
  NoticeBlock,
  TextBlock,
  ThinkingBlock,
  ToolCallBlock,
} from "../../types";
import { Caret, RichText } from "../RichText";
import { ThinkingBlockView } from "./ThinkingBlock";
import { ToolCallView } from "./ToolCallBlock";
import { NoticeView } from "./NoticeBlock";

/**
 * Render N assistant messages from a single agent turn as one card — one
 * "pi · model" header, all blocks concatenated in order. The header uses the
 * first message's model and the last message's stop reason / streaming flag.
 * Per-message usage rolls up.
 */
export function AssistantTurn({ messages }: { messages: AssistantMessage[] }) {
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
        <span className="dot" style={{ background: aborted ? "var(--red)" : "var(--accent)" }} />
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
