import type { GunRef } from "./gun-ref.ts";
import { subscribeCollection } from "./collection.ts";
import { clock, ulid } from "./ids.ts";
import { commandRef, commandsRef, isNode, toCommandNode } from "./schema.ts";
import type { CommandKind, CommandNode, Unsubscribe } from "./types.ts";

export interface EnqueueArgs {
  kind: CommandKind;
  sessionId?: string | null;
  payload?: unknown;
}

export function makeCommands(gun: GunRef, room: string, selfId: string) {
  return {
    // ---- guest side: enqueue an intent ----

    /** Write a pending command and return its (client-generated) id. */
    enqueue(args: EnqueueArgs): string {
      const id = ulid();
      const node: CommandNode = {
        id,
        kind: args.kind,
        sessionId: args.sessionId ?? null,
        payload: JSON.stringify(args.payload ?? {}),
        issuedBy: selfId,
        issuedAt: clock(),
        claimedBy: null,
        claimedAt: null,
        status: "pending",
        resultRef: null,
        error: null,
      };
      commandRef(gun, room, id).put(node as unknown as Record<string, unknown>);
      return id;
    },

    /** Watch a single command's lifecycle (for optimistic UI / error surfacing). */
    watch(commandId: string, cb: (command: CommandNode) => void): Unsubscribe {
      const chain = commandRef(gun, room, commandId).on((data: unknown) => {
        if (isNode(data)) cb(toCommandNode(data as Record<string, unknown>));
      });
      return () => chain.off();
    },

    // ---- host/bridge side: consume the queue ----

    subscribe(cb: (commands: CommandNode[]) => void): Unsubscribe {
      return subscribeCollection(commandsRef(gun, room), toCommandNode, cb);
    },

    claim(commandId: string, hostId: string): void {
      commandRef(gun, room, commandId).put({
        id: commandId,
        status: "claimed",
        claimedBy: hostId,
        claimedAt: clock(),
      });
    },

    ack(commandId: string, result: { resultRef?: string; error?: string }): void {
      commandRef(gun, room, commandId).put({
        id: commandId,
        status: result.error ? "error" : "done",
        resultRef: result.resultRef ?? null,
        error: result.error ?? null,
      });
    },

    /** Remove a single command node (e.g. a malformed/stale one). */
    tombstone(commandId: string): void {
      commandRef(gun, room, commandId).put(null);
    },

    /** Tombstone done/errored commands older than `olderThanMs`. */
    gc(olderThanMs: number): void {
      const cutoff = clock() - olderThanMs * 1000;
      commandsRef(gun, room)
        .map()
        .once((data: unknown, key: string) => {
          if (!isNode(data)) return;
          const c = toCommandNode(data as Record<string, unknown>);
          if ((c.status === "done" || c.status === "error") && c.issuedAt < cutoff) {
            commandRef(gun, room, key).put(null);
          }
        });
    },
  };
}

export type CommandsApi = ReturnType<typeof makeCommands>;
