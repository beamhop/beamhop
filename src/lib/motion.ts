import { useEffect, useRef, useState } from "react";

/** Tracks the user's reduced-motion preference, live. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

/**
 * Enables scroll-reveal globally. Content is visible by default; this only
 * arms the pre-reveal state (via the `motion-ready` class) when the user
 * actually wants motion, then reveals elements as they enter the viewport.
 * A safety timer force-reveals anything still hidden so a backgrounded tab
 * or a missed observer never ships a blank section.
 */
export function useScrollReveal(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    const targets = Array.from(
      document.querySelectorAll<HTMLElement>("[data-reveal]"),
    );
    if (!targets.length) return;

    root.classList.add("motion-ready");

    const reveal = (el: Element) => el.classList.add("is-visible");

    if (!("IntersectionObserver" in window)) {
      targets.forEach(reveal);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            reveal(entry.target);
            io.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.12 },
    );
    targets.forEach((t) => io.observe(t));

    // Safety net: nothing stays hidden longer than this.
    const safety = window.setTimeout(() => targets.forEach(reveal), 1600);

    return () => {
      io.disconnect();
      window.clearTimeout(safety);
    };
  }, [enabled]);
}

/**
 * Drives a 0..1 scroll progress value for an element as it crosses the
 * viewport, writing it to a CSS custom property on a target node (no React
 * re-render, so it stays at 60fps). When reduced motion is on, the property is
 * pinned to `staticValue` so the scene shows a readable resolved state.
 */
export function useScrollProgress(
  reduced: boolean,
  options: {
    property?: string;
    staticValue?: number;
    startBias?: number;
    /** Map progress to a sticky/pinned scrub range instead of viewport crossing. */
    pinned?: boolean;
    /** Multiplier so the scrub can resolve before the pin fully releases. */
    gain?: number;
  } = {},
) {
  const {
    property = "--p",
    staticValue = 0.72,
    startBias = 0,
    pinned = false,
    gain = 1,
  } = options;
  const sectionRef = useRef<HTMLElement | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const section = sectionRef.current;
    const target = targetRef.current ?? section;
    if (!section || !target) return;

    if (reduced) {
      target.style.setProperty(property, String(staticValue));
      return;
    }

    let frame = 0;
    let ticking = false;

    const update = () => {
      ticking = false;
      const rect = section.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      let p: number;
      if (pinned) {
        // Pinned scrub: 0 when the track top hits the viewport top,
        // 1 when the track has scrolled its full pin distance.
        const dist = Math.max(1, rect.height - vh);
        p = -rect.top / dist;
      } else {
        // 0 when the section's top reaches the bottom of the viewport,
        // 1 when its bottom reaches the top.
        const total = rect.height + vh;
        p = (vh - rect.top) / total;
      }
      p = Math.min(1, Math.max(0, p * gain + startBias));
      target.style.setProperty(property, p.toFixed(4));
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.cancelAnimationFrame(frame);
    };
  }, [reduced, property, staticValue, startBias, pinned, gain]);

  return { sectionRef, targetRef };
}
