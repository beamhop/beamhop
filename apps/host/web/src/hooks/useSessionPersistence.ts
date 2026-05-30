/**
 * localStorage-backed persistence for the picked sandbox and the pi session
 * file the user was last in. On reconnect we ask pi to `switch_session` back
 * to the stored path so the transcript survives a page refresh.
 */
import { TWEAK_DEFAULTS, type Tweaks } from "../types";

export const SANDBOX_KEY = "pi-rpc:sandbox";
const LEGACY_SNAPSHOT_KEY = "pi-rpc:snapshot";

/** Per-sandbox key holding the absolute path of pi's last-open session file. */
export const sessionFileKey = (sandbox: string) => `pi-rpc:sessionFile:${sandbox}`;

/** Initial sandbox name to seed `useState` with — empty triggers the picker. */
export function loadInitialSandbox(): string {
  const v = localStorage.getItem(SANDBOX_KEY);
  if (v) return v;
  // The earlier build stored a snapshot name under a different key. The
  // semantics changed (we now attach instead of spawn), so don't silently
  // adopt it as a sandbox name — clear it so the prompt re-runs.
  if (localStorage.getItem(LEGACY_SNAPSHOT_KEY)) {
    localStorage.removeItem(LEGACY_SNAPSHOT_KEY);
  }
  return "";
}

export function rememberSandbox(name: string) {
  localStorage.setItem(SANDBOX_KEY, name);
}

export function storedSessionFile(sandbox: string): string | null {
  return localStorage.getItem(sessionFileKey(sandbox));
}

export function rememberSessionFile(sandbox: string, path: string) {
  localStorage.setItem(sessionFileKey(sandbox), path);
}

export function forgetSessionFile(sandbox: string) {
  localStorage.removeItem(sessionFileKey(sandbox));
}

/** UI tweaks (accent, density, developer mode, …) — survive page refreshes. */
export const TWEAKS_KEY = "pi-rpc:tweaks";

/** Load persisted tweaks, merged over defaults so new fields fill in cleanly. */
export function loadTweaks(): Tweaks {
  try {
    const raw = localStorage.getItem(TWEAKS_KEY);
    if (raw) return { ...TWEAK_DEFAULTS, ...(JSON.parse(raw) as Partial<Tweaks>) };
  } catch {
    // malformed/blocked storage — fall back to defaults
  }
  return TWEAK_DEFAULTS;
}

export function rememberTweaks(tweaks: Tweaks) {
  try {
    localStorage.setItem(TWEAKS_KEY, JSON.stringify(tweaks));
  } catch {
    // quota / private-mode failures are non-fatal
  }
}
