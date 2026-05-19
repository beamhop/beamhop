import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

// Benign Chrome/WebKit notice fired when a ResizeObserver callback resizes
// the observed element — every fit-on-resize terminal triggers it. The
// browser already defers the extra notifications safely; we just keep them
// from reaching window.onerror listeners.
window.addEventListener("error", (e) => {
  if (e.message?.includes("ResizeObserver loop")) {
    e.stopImmediatePropagation();
    e.preventDefault();
  }
});

// Bun's dev HMR overlay intercepts errors before window-level listeners,
// so the addEventListener above doesn't catch them when running under
// `bun --hot`. Wrap ResizeObserver itself: defer the callback into an
// rAF so a layout pass settles between observation rounds, which
// prevents the loop notification from ever firing.
{
  const Native = window.ResizeObserver;
  if (Native) {
    class SafeResizeObserver extends Native {
      constructor(cb: ResizeObserverCallback) {
        let scheduled = false;
        let lastEntries: ResizeObserverEntry[] = [];
        let lastObserver: ResizeObserver | null = null;
        super((entries, observer) => {
          lastEntries = entries;
          lastObserver = observer;
          if (scheduled) return;
          scheduled = true;
          requestAnimationFrame(() => {
            scheduled = false;
            try {
              cb(lastEntries, lastObserver!);
            } catch (err) {
              if (
                err instanceof Error &&
                err.message.includes("ResizeObserver loop")
              ) {
                return;
              }
              throw err;
            }
          });
        });
      }
    }
    window.ResizeObserver = SafeResizeObserver;
  }
}

const container = document.getElementById("root");
if (!container) throw new Error("root element not found");
createRoot(container).render(<App />);
