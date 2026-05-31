import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { RELAY_URL } from "@/lib/store-context.tsx";

export function RoomJoin({ onJoin }: { onJoin: (room: string) => void }) {
  const [room, setRoom] = useState("demo");

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-lg">
        <h1 className="mb-1 text-2xl font-semibold">beamhop</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Join a room to collaboratively drive an agent. Relay: {RELAY_URL}
        </p>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (room.trim()) onJoin(room.trim());
          }}
        >
          <Input
            data-testid="room-name-input"
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            placeholder="room name"
            autoFocus
          />
          <Button data-testid="join-room-button" type="submit">
            Join
          </Button>
        </form>
      </div>
    </div>
  );
}
