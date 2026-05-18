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
 * Joins a Trystero room using the requested strategy. Server-side: pass
 * `rtcPolyfill` (e.g. werift's RTCPeerConnection) since Node has no native
 * WebRTC. Returns the Trystero Room object.
 */
export async function joinStrategyRoom(
  opts: StrategyOptions & { roomId: string; rtcPolyfill?: unknown },
): Promise<Room> {
  const appId = opts.appId ?? FALLBACK_APP_ID;
  const password = opts.password;
  const rtcPolyfill = opts.rtcPolyfill;

  switch (opts.strategy) {
    case "ws-relay": {
      const { joinRoom } = await importStrategy(
        "@trystero-p2p/ws-relay",
        "ws-relay",
      );
      return joinRoom(
        {
          appId,
          password,
          rtcPolyfill,
          relayConfig: { urls: opts.relayUrls },
        },
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
          rtcPolyfill,
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
      // Trystero convention: the Supabase project URL goes in `appId`.
      return joinRoom(
        {
          appId: opts.supabaseUrl,
          password,
          rtcPolyfill,
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
          rtcPolyfill,
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
      return joinRoom({ appId, password, rtcPolyfill }, opts.roomId);
    }
    case "custom": {
      return opts.joinRoom(
        { appId, password, rtcPolyfill, ...(opts.config as object | undefined) },
        opts.roomId,
      ) as Room;
    }
    default: {
      const exhaustive: never = opts;
      throw new Error(`unknown strategy: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * Returns the strategy's `selfId` (host peer id) without forcing a join.
 * Trystero exports `selfId` from every strategy package — they share the
 * same one via @trystero-p2p/core.
 */
export async function readSelfId(strategy: StrategyOptions["strategy"]): Promise<string> {
  const pkg =
    strategy === "ws-relay"
      ? "@trystero-p2p/ws-relay"
      : `@trystero-p2p/${strategy === "custom" ? "ws-relay" : strategy}`;
  try {
    const mod = (await import(pkg)) as { selfId: string };
    return mod.selfId;
  } catch {
    // Caller will fall back to a stub id; not critical.
    return "";
  }
}
