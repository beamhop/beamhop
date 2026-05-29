import { useState } from "react";
import type { ToolCallBlock } from "../../types";
import { Caret } from "../RichText";

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

/** A tool invocation with collapsible output and running/error/done status. */
export function ToolCallView({ block, testid }: { block: ToolCallBlock; testid: string }) {
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
