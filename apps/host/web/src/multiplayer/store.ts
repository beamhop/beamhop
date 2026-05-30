/**
 * React binding for {@link RoomManager}. Holds the live manager in a ref and
 * mirrors its imperative {@link RoomState} into React state so components can
 * render the roster, catalog, and share controls.
 *
 * The app (App.tsx) supplies the Owner-side hooks the manager needs — building
 * snapshots from the reducer, injecting relayed inputs into the local pi,
 * describing a session for the catalog, and delivering remote frames to the
 * P2P transport — via {@link RoomBindings} kept in a ref so they always see
 * fresh state without re-creating the manager.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { SharedSessionMeta } from "@beamhop/protocol";
import type { Json } from "../rpc/client";
import { loadUsername, rememberUsername } from "./username";
import { RoomManager, type RoomManagerHooks, type RoomState } from "./RoomManager";

/** App-supplied callbacks the manager calls into (kept current via a ref). */
export interface RoomBindings {
  buildSnapshot: (
    sessionFile: string,
  ) => { messages: unknown[]; stats: Record<string, unknown>; currentModelId: string | null } | null;
  injectInput: (sessionFile: string, kind: "prompt" | "steer", message: string) => void;
  describeSession: (sessionFile: string) => Omit<
    SharedSessionMeta,
    "sessionKey" | "ownerId" | "ownerName" | "sessionFile" | "mode"
  >;
  onRemoteFrame: (sessionKey: string, frame: Json) => void;
}

export interface MultiplayerApi {
  /** Live room state, or null when not in a room. */
  room: RoomState | null;
  username: string;
  setUsername: (name: string) => void;
  joinRoom: (opts: { name: string; password?: string }) => void;
  leaveRoom: () => void;
  // Owner controls
  shareSession: (sessionFile: string, mode: "readonly" | "collab") => void;
  unshareSession: (sessionFile: string) => void;
  setSessionMode: (sessionFile: string, mode: "readonly" | "collab") => void;
  // Participant controls
  openShared: (sessionKey: string) => void;
  closeShared: () => void;
  sendInput: (kind: "prompt" | "steer", message: string) => boolean;
  /** Owner-side frame tap (called by App for every local pi frame). */
  onLocalFrame: (sessionFile: string, frame: Json) => void;
  /** Imperative access for the P2P transport. */
  manager: () => RoomManager | null;
}

/**
 * Construct the multiplayer API. `bindingsRef` lets the app keep the
 * manager's hooks pointing at fresh reducer state on every render.
 */
export function useMultiplayerState(bindingsRef: React.MutableRefObject<RoomBindings>): MultiplayerApi {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [username, setUsernameState] = useState<string>(loadUsername);
  const managerRef = useRef<RoomManager | null>(null);
  const usernameRef = useRef(username);
  usernameRef.current = username;

  const setUsername = useCallback((name: string) => {
    const v = name.trim();
    if (!v) return;
    rememberUsername(v);
    setUsernameState(v);
    usernameRef.current = v;
    // selfName is read live via a getter; nudge a rebroadcast so peers already
    // in the room see the new name immediately.
    managerRef.current?.refreshIdentity();
  }, []);

  const joinRoom = useCallback(
    (opts: { name: string; password?: string }) => {
      managerRef.current?.leave();
      const hooks: RoomManagerHooks = {
        // selfName read live so renames take effect without rebuilding the manager.
        get selfName() {
          return usernameRef.current;
        },
        buildSnapshot: (f) => bindingsRef.current.buildSnapshot(f),
        injectInput: (f, k, m) => bindingsRef.current.injectInput(f, k, m),
        describeSession: (f) => bindingsRef.current.describeSession(f),
        onRemoteFrame: (k, fr) => bindingsRef.current.onRemoteFrame(k, fr),
        onState: (s) => setRoom(s),
      };
      managerRef.current = new RoomManager({ name: opts.name, password: opts.password, hooks });
    },
    [bindingsRef],
  );

  const leaveRoom = useCallback(() => {
    managerRef.current?.leave();
    managerRef.current = null;
    setRoom(null);
  }, []);

  const shareSession = useCallback(
    (f: string, mode: "readonly" | "collab") => managerRef.current?.shareSession(f, mode),
    [],
  );
  const unshareSession = useCallback((f: string) => managerRef.current?.unshareSession(f), []);
  const setSessionMode = useCallback(
    (f: string, mode: "readonly" | "collab") => managerRef.current?.setSessionMode(f, mode),
    [],
  );
  const openShared = useCallback((k: string) => managerRef.current?.openShared(k), []);
  const closeShared = useCallback(() => managerRef.current?.closeShared(), []);
  const sendInput = useCallback(
    (kind: "prompt" | "steer", message: string) =>
      managerRef.current?.sendInput(kind, message) ?? false,
    [],
  );
  const onLocalFrame = useCallback(
    (f: string, frame: Json) => managerRef.current?.onLocalFrame(f, frame),
    [],
  );
  const manager = useCallback(() => managerRef.current, []);

  return useMemo(
    () => ({
      room,
      username,
      setUsername,
      joinRoom,
      leaveRoom,
      shareSession,
      unshareSession,
      setSessionMode,
      openShared,
      closeShared,
      sendInput,
      onLocalFrame,
      manager,
    }),
    [
      room,
      username,
      setUsername,
      joinRoom,
      leaveRoom,
      shareSession,
      unshareSession,
      setSessionMode,
      openShared,
      closeShared,
      sendInput,
      onLocalFrame,
      manager,
    ],
  );
}

const MultiplayerContext = createContext<MultiplayerApi | null>(null);
export const MultiplayerProvider = MultiplayerContext.Provider;

export function useMultiplayer(): MultiplayerApi {
  const ctx = useContext(MultiplayerContext);
  if (!ctx) throw new Error("useMultiplayer must be used within MultiplayerProvider");
  return ctx;
}
