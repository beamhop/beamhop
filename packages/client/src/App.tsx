import { useState } from "react";
import { ModelPicker } from "@/components/model-picker.tsx";
import { RoomJoin } from "@/components/room-join.tsx";
import { SessionList } from "@/components/session-list.tsx";
import { SessionView } from "@/components/session-view.tsx";
import { ModelProvider } from "@/lib/model-context.tsx";
import { StoreProvider, useRoom } from "@/lib/store-context.tsx";

function Room({ room }: { room: string }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <StoreProvider room={room}>
      <ModelProvider>
        <div className="flex h-screen flex-col">
          <header className="flex items-center gap-2 border-b bg-card px-4 py-2.5">
            <span className="font-semibold">beamhop</span>
            <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              room: {room}
            </span>
            <div className="ml-auto">
              <ModelPicker />
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
  if (!room) return <RoomJoin onJoin={setRoom} />;
  return <Room room={room} />;
}
