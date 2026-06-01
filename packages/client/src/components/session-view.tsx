import { MessagesSquare } from "lucide-react";
import { MessageList } from "@/components/message-list.tsx";
import { PromptComposer } from "@/components/prompt-composer.tsx";
import { useSessionError } from "@/hooks/use-session-error.ts";
import { useSessionMessages } from "@/hooks/use-session-messages.ts";

export function SessionView({ sessionId }: { sessionId: string | null }) {
  const messages = useSessionMessages(sessionId);
  const error = useSessionError(sessionId);

  if (!sessionId) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground"
        data-testid="no-session-selected"
      >
        <MessagesSquare className="size-10 opacity-40" strokeWidth={1.5} />
        <p className="text-sm">Select or create a session to begin.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col" data-testid={`session-view-${sessionId}`}>
      <MessageList messages={messages} error={error} />
      <PromptComposer sessionId={sessionId} />
    </div>
  );
}
