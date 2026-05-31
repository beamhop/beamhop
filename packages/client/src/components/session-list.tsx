import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { useSessions } from "@/hooks/use-sessions.ts";
import { useStore } from "@/lib/store-context.tsx";
import { cn } from "@/lib/utils.ts";

interface Props {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function SessionList({ selectedId, onSelect }: Props) {
  const sessions = useSessions();
  const { store } = useStore();

  const createSession = () => {
    store.commands.enqueue({ kind: "create-session", payload: { title: "New session" } });
  };

  const deleteSession = (id: string) => {
    store.commands.enqueue({ kind: "delete-session", sessionId: id, payload: {} });
  };

  return (
    <div className="flex h-full w-72 flex-col border-r bg-card">
      <div className="flex items-center justify-between border-b p-3">
        <span className="text-sm font-semibold">Sessions</span>
        <Button
          data-testid="create-session-button"
          size="icon"
          variant="ghost"
          onClick={createSession}
          title="New session"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {sessions.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground" data-testid="sessions-empty">
            No sessions yet.
          </p>
        )}
        {sessions.map((s) => (
          <div
            key={s.id}
            data-testid={`session-list-item-${s.id}`}
            onClick={() => onSelect(s.id)}
            className={cn(
              "group flex cursor-pointer items-center justify-between gap-2 border-b px-3 py-2.5 text-sm hover:bg-accent",
              selectedId === s.id && "bg-accent",
            )}
          >
            <div className="flex min-w-0 items-center gap-2">
              {s.status === "busy" && (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
              )}
              <span className="truncate">{s.title}</span>
            </div>
            <Button
              data-testid={`delete-session-button-${s.id}`}
              size="icon"
              variant="ghost"
              className="h-6 w-6 opacity-0 group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                deleteSession(s.id);
              }}
              title="Delete session"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
