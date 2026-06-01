import type { PartNode } from "@beamhop/store";
import { ChevronRight, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge.tsx";

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
      <Badge
        variant="secondary"
        data-testid={`part-tool-${part.id}`}
        className="max-w-full gap-1.5 rounded-md py-1 font-normal"
      >
        <Wrench className="size-3.5 shrink-0" />
        <span className="font-medium">{toolName}</span>
        {part.status && (
          <>
            <ChevronRight className="size-3 shrink-0 opacity-60" />
            <span>{part.status}</span>
          </>
        )}
        {part.text && <span className="truncate">— {part.text}</span>}
      </Badge>
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
