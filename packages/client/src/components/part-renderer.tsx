import type { PartNode } from "@beamhop/store";
import { ChevronRight, Wrench } from "lucide-react";

/** Renders a single message part by type: text, tool call, or a generic fallback. */
export function PartRenderer({ part }: { part: PartNode }) {
  if (part.type === "text" || part.type === "reasoning") {
    if (!part.text) return null;
    return (
      <div
        data-testid={`part-text-${part.id}`}
        className="whitespace-pre-wrap break-words text-sm leading-relaxed"
      >
        {part.text}
      </div>
    );
  }

  if (part.type === "tool") {
    let toolName = "tool";
    try {
      toolName = JSON.parse(part.meta || "{}").tool ?? "tool";
    } catch {
      /* ignore */
    }
    return (
      <div
        data-testid={`part-tool-${part.id}`}
        className="flex items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground"
      >
        <Wrench className="h-3.5 w-3.5" />
        <span className="font-medium">{toolName}</span>
        {part.status && (
          <>
            <ChevronRight className="h-3 w-3" />
            <span>{part.status}</span>
          </>
        )}
        {part.text && <span className="truncate">— {part.text}</span>}
      </div>
    );
  }

  // Generic fallback (file, step-*, etc.)
  if (!part.text) return null;
  return (
    <div data-testid={`part-other-${part.id}`} className="text-xs text-muted-foreground">
      [{part.type}] {part.text}
    </div>
  );
}
