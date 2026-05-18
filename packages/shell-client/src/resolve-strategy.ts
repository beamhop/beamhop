import type { Room } from "@trystero-p2p/core";
import type { StrategyOptions } from "@beamhop/shell-protocol";

const FALLBACK_APP_ID = "use-my-shell";

const installHint = (name: string) =>
  `optional dep '@trystero-p2p/${name}' is not installed — run: bun add @trystero-p2p/${name}`;

async function importStrategy(
  pkg: string,
  pretty: string,
): Promise<{ joinRoom: (config: unknown, roomId: string) => Room }> {
  try {
    return (await import(pkg)) as {
      joinRoom: (config: unknown, roomId: string) => Room;
    };
  } catch {
    throw new Error(installHint(pretty));
  }
}

/**
 * Browser-side Trystero room join. Picks the right strategy package by
 * `opts.strategy` and loads it via dynamic import so the WebSocket-only
 * code path stays small.
 */
export async function joinStrategyRoom(
  opts: StrategyOptions & { roomId: string },
): Promise<Room> {
  const appId = opts.appId ?? FALLBACK_APP_ID;
  const password = opts.password;

  switch (opts.strategy) {
    case "ws-relay": {
      const { joinRoom } = await importStrategy(
        "@trystero-p2p/ws-relay",
        "ws-relay",
      );
      return joinRoom(
        { appId, password, relayConfig: { urls: opts.relayUrls } },
        opts.roomId,
      );
    }
    case "nostr":
    case "mqtt":
    case "torrent": {
      const { joinRoom } = await importStrategy(
        `@trystero-p2p/${opts.strategy}`,
        opts.strategy,
      );
      return joinRoom(
        {
          appId,
          password,
          relayConfig:
            opts.relayUrls || opts.redundancy
              ? { urls: opts.relayUrls, redundancy: opts.redundancy }
              : undefined,
        },
        opts.roomId,
      );
    }
    case "supabase": {
      const { joinRoom } = await importStrategy(
        "@trystero-p2p/supabase",
        "supabase",
      );
      return joinRoom(
        {
          appId: opts.supabaseUrl,
          password,
          relayConfig: { supabaseKey: opts.supabaseKey },
        },
        opts.roomId,
      );
    }
    case "firebase": {
      const { joinRoom } = await importStrategy(
        "@trystero-p2p/firebase",
        "firebase",
      );
      return joinRoom(
        {
          appId: opts.databaseURL ?? appId,
          password,
          relayConfig:
            opts.firebaseApp || opts.firebasePath
              ? {
                  firebaseApp: opts.firebaseApp as never,
                  firebasePath: opts.firebasePath,
                }
              : undefined,
        },
        opts.roomId,
      );
    }
    case "ipfs": {
      const { joinRoom } = await importStrategy("@trystero-p2p/ipfs", "ipfs");
      return joinRoom({ appId, password }, opts.roomId);
    }
    case "custom": {
      return opts.joinRoom(
        { appId, password, ...(opts.config as object | undefined) },
        opts.roomId,
      ) as Room;
    }
    default: {
      const exhaustive: never = opts;
      throw new Error(`unknown strategy: ${JSON.stringify(exhaustive)}`);
    }
  }
}
