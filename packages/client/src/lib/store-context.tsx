import { createStore, type Store, ulid } from "@beamhop/store";
import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

const RELAY_URL = import.meta.env.VITE_RELAY_URL ?? "http://localhost:8765/gun";

/** Stable per-tab guest id (persisted so reloads keep identity). */
function guestId(): string {
  const KEY = "beamhop-guest-id";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = `guest-${ulid()}`;
    localStorage.setItem(KEY, id);
  }
  return id;
}

interface StoreContextValue {
  store: Store;
  room: string;
  selfId: string;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreProvider({ room, children }: { room: string; children: ReactNode }) {
  const selfId = useMemo(guestId, []);
  // One store per room; recreated only when the room changes.
  const store = useMemo(() => {
    // NOTE: do NOT enable Gun's localStorage here — with `localStorage: true`
    // the browser build stops syncing writes to WebSocket peers (state goes
    // local-only and never reaches the relay/host). Guests are relay-backed, so
    // we rely on the relay for state and keep the in-memory graph only.
    const s = createStore({ peers: [RELAY_URL], room, selfId });
    if (typeof window !== "undefined") (window as any).__beamhopStore = s;
    return s;
  }, [room, selfId]);
  const value = useMemo(() => ({ store, room, selfId }), [store, room, selfId]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within a StoreProvider");
  return ctx;
}

/** Parse the room from the location hash, or null if not in a room. */
function roomFromHash(): string | null {
  const m = window.location.hash.match(/^#\/?room\/(.+)$/);
  return m ? decodeURIComponent(m[1]!).trim() || null : null;
}

/**
 * Tracks the joined room in the URL hash so tabs can deep-link / reload.
 * Subscribes to `hashchange` (via useSyncExternalStore) so the room is always
 * derived from the *current* hash — robust to deep links, reloads, and
 * StrictMode double-mounts where a one-shot initializer could miss the hash.
 */
export function useRoom(): [string | null, (room: string) => void] {
  const room = useSyncExternalStore(
    (onChange) => {
      window.addEventListener("hashchange", onChange);
      return () => window.removeEventListener("hashchange", onChange);
    },
    roomFromHash,
    () => null,
  );
  const setRoom = (r: string) => {
    window.location.hash = `/room/${encodeURIComponent(r)}`;
    // hashchange fires asynchronously; dispatch to update immediately too.
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  };
  return [room, setRoom];
}

export { RELAY_URL };
