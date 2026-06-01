import { useState } from "react";
import { ModelPicker } from "@/components/model-picker.tsx";
import { RoomJoin } from "@/components/room-join.tsx";
import { SessionList } from "@/components/session-list.tsx";
import { SessionView } from "@/components/session-view.tsx";
import { ThemeToggle } from "@/components/theme-toggle.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import { TooltipProvider } from "@/components/ui/tooltip.tsx";
import { ModelProvider } from "@/lib/model-context.tsx";
import { StoreProvider, useRoom } from "@/lib/store-context.tsx";
import { ThemeProvider } from "@/lib/theme-context.tsx";

function Room({ room }: { room: string }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <StoreProvider room={room}>
      <ModelProvider>
        <div className="flex h-screen flex-col">
          <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background px-4">
            <span className="text-base font-semibold tracking-tight">beamhop</span>
            <Badge variant="secondary" data-testid="room-badge" className="font-normal">
              {room}
            </Badge>
            <div className="ml-auto flex items-center gap-2">
              <ModelPicker />
              <Separator orientation="vertical" className="h-6" />
              <ThemeToggle />
            </div>
          </header>
          <div className="flex flex-1 overflow-hidden">
            <SessionList selectedId={selectedId} onSelect={setSelectedId} />
            <SessionView sessionId={selectedId} />
          </div>
        </div>
      </ModelProvider>
    </StoreProvider>
  );
}

export function App() {
  const [room, setRoom] = useRoom();
  return (
    <ThemeProvider>
      <TooltipProvider delayDuration={300}>
        {room ? <Room room={room} /> : <RoomJoin onJoin={setRoom} />}
      </TooltipProvider>
    </ThemeProvider>
  );
}
