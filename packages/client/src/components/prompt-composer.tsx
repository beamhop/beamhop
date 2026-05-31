import { Send, Square } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
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
    <div className="border-t p-3">
      <div className="flex items-end gap-2">
        <textarea
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
          className="flex-1 resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        />
        {busy ? (
          <Button
            data-testid="stop-prompt-button"
            size="icon"
            variant="destructive"
            onClick={stop}
            title="Stop"
          >
            <Square className="h-4 w-4" />
          </Button>
        ) : (
          <Button data-testid="send-prompt-button" size="icon" onClick={send} title="Send">
            <Send className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
