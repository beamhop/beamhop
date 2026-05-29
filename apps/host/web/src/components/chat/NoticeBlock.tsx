import type { NoticeBlock } from "../../types";
import { RichText } from "../RichText";

/** Inline ok/block notice line within an assistant turn. */
export function NoticeView({ block }: { block: NoticeBlock }) {
  return (
    <div className={"notice " + (block.tone === "ok" ? "ok" : "block")}>
      <span className="noticedot" />
      <RichText text={block.text} inline />
    </div>
  );
}
