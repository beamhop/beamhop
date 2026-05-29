import { useEffect, type RefObject } from "react";

/**
 * Grow a textarea to fit its content (up to `maxPx`) whenever `value`
 * changes. Pass the textarea ref and the controlled value.
 */
export function useTextAreaAutoResize(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  maxPx = 200,
) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, maxPx) + "px";
  }, [ref, value, maxPx]);
}
