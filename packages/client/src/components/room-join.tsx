import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { Input } from "@/components/ui/input.tsx";
import { RELAY_URL } from "@/lib/store-context.tsx";

export function RoomJoin({ onJoin }: { onJoin: (room: string) => void }) {
  const [room, setRoom] = useState("demo");

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader>
          <CardTitle className="text-2xl tracking-tight">beamhop</CardTitle>
          <CardDescription>
            Join a room to collaboratively drive an agent.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
          <p className="mt-4 text-xs text-muted-foreground">Relay: {RELAY_URL}</p>
        </CardContent>
      </Card>
    </div>
  );
}
