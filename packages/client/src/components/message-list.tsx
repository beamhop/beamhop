import { useEffect, useRef } from "react";
import type { MessageWithParts } from "@/hooks/use-session-messages.ts";
import { PartRenderer } from "@/components/part-renderer.tsx";
import { cn } from "@/lib/utils.ts";

export function MessageList({ messages }: { messages: MessageWithParts[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the latest content as parts stream in.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex-1 space-y-4 overflow-y-auto p-4" data-testid="message-list">
      {messages.length === 0 && (
        <p className="text-sm text-muted-foreground" data-testid="messages-empty">
          No messages yet. Send a prompt to start.
        </p>
      )}
      {messages.map((m) => (
        <div
          key={m.id}
          data-testid={`message-${m.id}`}
          className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
        >
          <div
            className={cn(
              "max-w-[80%] space-y-2 rounded-lg px-3.5 py-2.5",
              m.role === "user" ? "bg-primary text-primary-foreground" : "bg-card border",
            )}
          >
            {m.parts.map((p) => (
              <PartRenderer key={p.id} part={p} />
            ))}
            {m.role === "assistant" && !m.completed && (
              <span
                data-testid={`message-streaming-${m.id}`}
                className="inline-block h-3 w-1.5 animate-pulse bg-muted-foreground align-middle"
              />
            )}
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
