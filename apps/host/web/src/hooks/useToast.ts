import { useCallback, useState } from "react";
import { uid } from "../util";

export interface Toast {
  id: string;
  text: string;
  glyph?: string;
  tone?: "warn" | "ok";
}

/** How long a toast stays on screen before it auto-dismisses (ms). */
const TOAST_TTL = 2600;

/**
 * Transient notification stack. `toast(text, glyph?, tone?)` pushes a toast
 * that auto-dismisses after {@link TOAST_TTL}; `toasts` is the live list to
 * render (see {@link "../components/ToastStack"}).
 */
export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((text: string, glyph?: string, tone?: Toast["tone"]) => {
    const id = uid("t");
    setToasts((p) => [...p, { id, text, glyph, tone }]);
    setTimeout(() => setToasts((p) => p.filter((x) => x.id !== id)), TOAST_TTL);
  }, []);

  return { toasts, toast };
}
