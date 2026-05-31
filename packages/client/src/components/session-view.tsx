import { MessageList } from "@/components/message-list.tsx";
import { PromptComposer } from "@/components/prompt-composer.tsx";
import { useSessionMessages } from "@/hooks/use-session-messages.ts";

export function SessionView({ sessionId }: { sessionId: string | null }) {
  const messages = useSessionMessages(sessionId);

  if (!sessionId) {
    return (
      <div
        className="flex flex-1 items-center justify-center text-sm text-muted-foreground"
        data-testid="no-session-selected"
      >
        Select or create a session to begin.
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col" data-testid={`session-view-${sessionId}`}>
      <MessageList messages={messages} />
      <PromptComposer sessionId={sessionId} />
    </div>
  );
}
