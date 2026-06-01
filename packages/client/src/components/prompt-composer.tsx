import { Send, Square } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.tsx";
import { useSessionStatus } from "@/hooks/use-session-status.ts";
import { useSelectedModel } from "@/lib/model-context.tsx";
import { useStore } from "@/lib/store-context.tsx";

export function PromptComposer({ sessionId }: { sessionId: string }) {
  const { store } = useStore();
  const { selected } = useSelectedModel();
  const status = useSessionStatus(sessionId);
  const [text, setText] = useState("");

  const busy = status === "busy";

  const send = () => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    store.commands.enqueue({
      kind: "send-prompt",
      sessionId,
      payload: {
        text: trimmed,
        // Use the model chosen in the picker; omitted -> OpenCode's default.
        ...(selected
          ? { model: { providerID: selected.providerID, modelID: selected.modelID } }
          : {}),
      },
    });
    setText("");
  };

  const stop = () => {
    store.commands.enqueue({ kind: "abort-session", sessionId, payload: {} });
  };

  return (
    <div className="border-t bg-background p-3">
      <div className="flex items-end gap-2">
        <Textarea
          data-testid="prompt-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
          disabled={busy}
          placeholder={
            busy ? "Agent is responding…" : "Message the agent…  (Enter to send, Shift+Enter for newline)"
          }
          className="max-h-40 min-h-[2.75rem] flex-1 resize-none"
        />
        {busy ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="stop-prompt-button"
                size="icon"
                variant="destructive"
                onClick={stop}
                aria-label="Stop"
              >
                <Square className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Stop</TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button data-testid="send-prompt-button" size="icon" onClick={send} aria-label="Send">
                <Send className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Send</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
