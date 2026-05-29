import { useEffect, useState } from "react";
import type { ThinkingBlock } from "../../types";
import { Caret, RichText } from "../RichText";

/** Collapsible "Thinking" block; auto-collapses when streaming completes. */
export function ThinkingBlockView({ block, testid }: { block: ThinkingBlock; testid: string }) {
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
