import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.tsx";
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
    <div className="flex h-full w-72 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex items-center justify-between px-3 py-3">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Sessions
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              data-testid="create-session-button"
              size="icon-sm"
              variant="ghost"
              onClick={createSession}
              aria-label="New session"
              className="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New session</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {sessions.length === 0 && (
          <p
            className="px-2 py-8 text-center text-sm text-muted-foreground"
            data-testid="sessions-empty"
          >
            No sessions yet.
          </p>
        )}
        {sessions.map((s) => (
          <div
            key={s.id}
            data-testid={`session-list-item-${s.id}`}
            onClick={() => onSelect(s.id)}
            className={cn(
              "group flex cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              selectedId === s.id && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
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
              className="size-6 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              onClick={(e) => {
                e.stopPropagation();
                deleteSession(s.id);
              }}
              aria-label="Delete session"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
