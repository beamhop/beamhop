import { AlertCircle } from "lucide-react";
import { useEffect, useRef } from "react";
import type { MessageWithParts } from "@/hooks/use-session-messages.ts";
import { PartRenderer } from "@/components/part-renderer.tsx";
import { cn } from "@/lib/utils.ts";

export function MessageList({
  messages,
  error = null,
}: {
  messages: MessageWithParts[];
  /** The session's last turn failed — surface it and don't fake a streaming cursor. */
  error?: string | null;
}) {
  const errored = error != null;
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the latest content as parts stream in.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex-1 space-y-5 overflow-y-auto p-4" data-testid="message-list">
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
              "max-w-[80%] space-y-2 rounded-2xl px-4 py-2.5",
              m.role === "user"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-foreground",
            )}
          >
            {m.parts.map((p) => (
              <PartRenderer key={p.id} part={p} />
            ))}
            {m.role === "assistant" && !m.completed && m.parts.length === 0 && (
              <span className="text-xs text-muted-foreground italic">
                {errored ? "no response" : "thinking…"}
              </span>
            )}
            {/* Streaming cursor only while the turn is genuinely live (not errored). */}
            {m.role === "assistant" && !m.completed && !errored && (
              <span
                data-testid={`message-streaming-${m.id}`}
                className="inline-block h-4 w-1.5 animate-pulse rounded-full bg-muted-foreground/70 align-middle"
              />
            )}
          </div>
        </div>
      ))}
      {errored && (
        <div
          className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          data-testid="session-error"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>
            The agent hit an error: {error}. Try again or pick another model.
          </span>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
