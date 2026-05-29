import { useEffect } from "react";

export interface Shortcut {
  /** Lowercased `KeyboardEvent.key` to match (e.g. "k", "escape"). */
  key: string;
  /** Require ⌘ (mac) or Ctrl. Default false. */
  meta?: boolean;
  /** Optional gate — the shortcut only fires when this returns true. */
  when?: () => boolean;
  /** `preventDefault()` before running. Default true. */
  preventDefault?: boolean;
  run: () => void;
}

/**
 * Bind a declarative list of global keyboard shortcuts to `document`.
 * Re-subscribes when `shortcuts` changes, so pass a memoized/stable array
 * (or accept that handlers capture fresh closures each render — fine for
 * the small set here).
 */
export function useKeyboardShortcuts(shortcuts: Shortcut[]) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      for (const s of shortcuts) {
        if (s.key !== key) continue;
        if (s.meta && !(e.metaKey || e.ctrlKey)) continue;
        if (s.when && !s.when()) continue;
        if (s.preventDefault !== false) e.preventDefault();
        s.run();
        return;
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [shortcuts]);
}
