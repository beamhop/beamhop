import { useCallback, useEffect, useRef, useState } from "react";
import { Logo } from "../components/icons";
import { useReducedMotion } from "../lib/motion";
import { SLIDES } from "./slides";

/**
 * Beamhop pitch deck — a full-viewport, keyboard-driven 5-slide story that
 * reuses the marketing site's monochrome brand. One dominant idea per slide,
 * cinematic beam transitions, projector-legible chrome.
 */
export default function Deck() {
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(() => slideFromHash());
  const count = SLIDES.length;
  const touchX = useRef<number | null>(null);

  const go = useCallback(
    (next: number) => {
      setIndex((cur) => {
        const clamped = Math.max(0, Math.min(count - 1, next));
        if (clamped !== cur) history.replaceState(null, "", `#${clamped + 1}`);
        return clamped;
      });
    },
    [count],
  );

  // Keyboard: the deck is driven from the keyboard on stage.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
        case "PageDown":
        case " ":
          e.preventDefault();
          go(index + 1);
          break;
        case "ArrowLeft":
        case "ArrowUp":
        case "PageUp":
          e.preventDefault();
          go(index - 1);
          break;
        case "Home":
          e.preventDefault();
          go(0);
          break;
        case "End":
          e.preventDefault();
          go(count - 1);
          break;
        case "f":
        case "F":
          if (document.fullscreenElement) document.exitFullscreen();
          else document.documentElement.requestFullscreen?.();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, count, go]);

  // Deep-link / refresh keeps you on the current slide.
  useEffect(() => {
    const onHash = () => setIndex(slideFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <div
      className={"deck" + (reduced ? " is-reduced" : "")}
      onTouchStart={(e) => (touchX.current = e.touches[0]?.clientX ?? null)}
      onTouchEnd={(e) => {
        const start = touchX.current;
        const end = e.changedTouches[0]?.clientX ?? null;
        if (start == null || end == null) return;
        const dx = end - start;
        if (Math.abs(dx) > 50) go(index + (dx < 0 ? 1 : -1));
        touchX.current = null;
      }}
    >
      <div className="deck-progress" aria-hidden="true">
        <span style={{ width: `${((index + 1) / count) * 100}%` }} />
      </div>

      <header className="deck-top">
        <a className="brand" href="/" aria-label="Beamhop home">
          <Logo aria-hidden="true" />
          beamhop
        </a>
        <span className="deck-context">
          <span className="status-dot" aria-hidden="true" />
          Megathon · Amsterdam finals
        </span>
      </header>

      <main className="deck-stage">
        {SLIDES.map((Slide, i) => {
          const state = i === index ? "active" : i < index ? "before" : "after";
          return (
            <section
              key={i}
              className="slide"
              data-state={state}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              {...({ inert: state === "active" ? undefined : "" } as any)}
              aria-hidden={state !== "active"}
            >
              <Slide active={state === "active"} reduced={reduced} />
            </section>
          );
        })}
      </main>

      <footer className="deck-bottom">
        <nav className="deck-dots" aria-label="Slides">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              type="button"
              className={"deck-dot" + (i === index ? " is-on" : "")}
              aria-label={`Go to slide ${i + 1}`}
              aria-current={i === index}
              onClick={() => go(i)}
            />
          ))}
        </nav>

        <div className="deck-controls">
          <span className="deck-count">
            {String(index + 1).padStart(2, "0")}
            <i> / {String(count).padStart(2, "0")}</i>
          </span>
          <button
            type="button"
            className="deck-arrow"
            aria-label="Previous slide"
            disabled={index === 0}
            onClick={() => go(index - 1)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 12H5M11 18l-6-6 6-6" />
            </svg>
          </button>
          <button
            type="button"
            className="deck-arrow"
            aria-label="Next slide"
            disabled={index === count - 1}
            onClick={() => go(index + 1)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </footer>
    </div>
  );
}

function slideFromHash(): number {
  const n = Number.parseInt(window.location.hash.replace("#", ""), 10);
  return Number.isFinite(n) && n >= 1 ? n - 1 : 0;
}
