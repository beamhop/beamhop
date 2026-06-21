import { useEffect, useRef } from "react";
import { useReducedMotion } from "../lib/motion";

/* ------------------------------------------------------------------
   BeamField — a live private-network field.
   Nodes are people and their agents; beams are live work in transit;
   one featured pair runs a continuous handoff (the 5-second aha):
   a person beams a running prototype to a teammate who picks it up.
   Canvas 2D, DPR-aware, pauses off-screen / hidden, 60fps.
------------------------------------------------------------------ */

type Kind = "person" | "agent";
interface Node {
  x: number; // normalized 0..1
  y: number;
  kind: Kind;
  phase: number; // halo phase offset
}

// Deliberate constellation. A (featured source) lower-left,
// B (featured target / teammate) upper-right.
const NODES: Node[] = [
  { x: 0.16, y: 0.62, kind: "person", phase: 0.0 }, // 0 = A (source)
  { x: 0.8, y: 0.26, kind: "person", phase: 1.2 }, // 1 = B (teammate)
  { x: 0.34, y: 0.36, kind: "agent", phase: 2.1 },
  { x: 0.5, y: 0.6, kind: "person", phase: 0.6 },
  { x: 0.64, y: 0.44, kind: "agent", phase: 3.4 },
  { x: 0.26, y: 0.84, kind: "agent", phase: 1.9 },
  { x: 0.46, y: 0.16, kind: "agent", phase: 2.7 },
  { x: 0.7, y: 0.74, kind: "person", phase: 0.9 },
  { x: 0.88, y: 0.56, kind: "agent", phase: 3.9 },
  { x: 0.08, y: 0.3, kind: "agent", phase: 1.4 },
  { x: 0.92, y: 0.82, kind: "agent", phase: 2.3 },
  { x: 0.58, y: 0.86, kind: "agent", phase: 0.3 },
];

const EDGES: [number, number][] = [
  [0, 2],
  [2, 6],
  [2, 3],
  [3, 4],
  [4, 1],
  [4, 8],
  [3, 7],
  [7, 11],
  [0, 5],
  [0, 9],
  [1, 8],
  [8, 10],
  [7, 8],
  [6, 1],
  [3, 5],
];

const FEATURED: [number, number] = [0, 1]; // A -> B handoff path (via the web)
// Visual waypoints for the featured beam so it arcs through the field.
const FEATURED_PATH = [0, 2, 3, 4, 1];

const VIOLET = "100 70 245";
const MAGENTA = "232 70 180";
const AMBER = "250 196 90";

interface Pulse {
  edge: number;
  t: number;
  speed: number;
  hue: string;
}

export default function BeamField() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let dpr = 1;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    // map normalized node -> pixels, with inner padding
    const px = (n: Node) => ({
      x: 0.06 * w + n.x * 0.88 * w,
      y: 0.08 * h + n.y * 0.84 * h,
    });

    const drawNode = (n: Node, t: number, featured: boolean) => {
      const { x, y } = px(n);
      const isAgent = n.kind === "agent";
      const base = isAgent ? MAGENTA : VIOLET;
      const halo = 0.5 + 0.5 * Math.sin(t * 0.0016 + n.phase);

      // soft halo
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const haloR = (isAgent ? 14 : 18) + halo * 6 + (featured ? 8 : 0);
      const g = ctx.createRadialGradient(x, y, 0, x, y, haloR);
      g.addColorStop(0, `rgba(${base} / ${0.32 + halo * 0.18})`);
      g.addColorStop(1, `rgba(${base} / 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, haloR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // core
      if (isAgent) {
        // hollow ring + inner dot = "agent"
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = `rgba(${base} / 0.9)`;
        ctx.beginPath();
        ctx.arc(x, y, 5.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = `rgba(${base} / 0.95)`;
        ctx.beginPath();
        ctx.arc(x, y, 1.8, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // filled disc = "person"
        ctx.fillStyle = `rgba(${base} / 0.96)`;
        ctx.beginPath();
        ctx.arc(x, y, 4.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = `rgba(235 230 255 / 0.5)`;
        ctx.beginPath();
        ctx.arc(x, y, 7.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    };

    const drawEdge = (a: Node, b: Node, alpha: number) => {
      const pa = px(a);
      const pb = px(b);
      ctx.strokeStyle = `rgba(150 120 230 / ${alpha})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    };

    const drawPulse = (a: Node, b: Node, t: number, hue: string, size: number) => {
      const pa = px(a);
      const pb = px(b);
      const x = pa.x + (pb.x - pa.x) * t;
      const y = pa.y + (pb.y - pa.y) * t;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const r = size;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${hue} / 0.95)`);
      g.addColorStop(0.4, `rgba(${hue} / 0.5)`);
      g.addColorStop(1, `rgba(${hue} / 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      // bright core
      ctx.fillStyle = `rgba(255 255 255 / 0.85)`;
      ctx.beginPath();
      ctx.arc(x, y, 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return { x, y };
    };

    // animated "lock acquired" brackets around the featured target
    const drawLock = (n: Node, strength: number) => {
      if (strength <= 0) return;
      const { x, y } = px(n);
      const s = 16 + (1 - strength) * 10; // contracts as it locks
      const len = 6;
      ctx.save();
      ctx.strokeStyle = `rgba(${AMBER} / ${0.35 + strength * 0.55})`;
      ctx.lineWidth = 1.6;
      const corner = (dx: number, dy: number) => {
        ctx.beginPath();
        ctx.moveTo(x + dx * s, y + dy * s - dy * len);
        ctx.lineTo(x + dx * s, y + dy * s);
        ctx.lineTo(x + dx * s - dx * len, y + dy * s);
        ctx.stroke();
      };
      corner(-1, -1);
      corner(1, -1);
      corner(-1, 1);
      corner(1, 1);
      ctx.restore();
    };

    // ambient pulses on random edges
    const pulses: Pulse[] = [];
    const spawnPulse = () => {
      const edge = Math.floor(Math.random() * EDGES.length);
      pulses.push({
        edge,
        t: 0,
        speed: 0.0035 + Math.random() * 0.004,
        hue: Math.random() > 0.5 ? VIOLET : MAGENTA,
      });
    };

    // featured handoff loop state
    let featuredSeg = 0; // which segment of FEATURED_PATH
    let featuredT = 0;
    let lockStrength = 0;
    let dwell = 0; // pause at B (powering up) before repeating

    const renderStatic = () => {
      ctx.clearRect(0, 0, w, h);
      EDGES.forEach(([i, j]) => drawEdge(NODES[i], NODES[j], 0.14));
      // featured path lit
      for (let k = 0; k < FEATURED_PATH.length - 1; k++) {
        drawEdge(NODES[FEATURED_PATH[k]], NODES[FEATURED_PATH[k + 1]], 0.4);
      }
      // a resolved packet sitting at midpoint of the featured path
      const midA = NODES[FEATURED_PATH[1]];
      const midB = NODES[FEATURED_PATH[2]];
      drawPulse(midA, midB, 0.5, VIOLET, 9);
      NODES.forEach((n, idx) => drawNode(n, 0, idx === FEATURED[1] || idx === FEATURED[0]));
      drawLock(NODES[FEATURED[1]], 1);
    };

    let raf = 0;
    let running = true;
    let lastSpawn = 0;

    const frame = (t: number) => {
      if (!running) return;
      ctx.clearRect(0, 0, w, h);

      // edges
      EDGES.forEach(([i, j]) => drawEdge(NODES[i], NODES[j], 0.12));
      for (let k = 0; k < FEATURED_PATH.length - 1; k++) {
        drawEdge(NODES[FEATURED_PATH[k]], NODES[FEATURED_PATH[k + 1]], 0.26);
      }

      // ambient pulses
      if (t - lastSpawn > 520 && pulses.length < 7) {
        spawnPulse();
        lastSpawn = t;
      }
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i];
        p.t += p.speed * 16;
        if (p.t >= 1) {
          pulses.splice(i, 1);
          continue;
        }
        const [ai, bi] = EDGES[p.edge];
        drawPulse(NODES[ai], NODES[bi], p.t, p.hue, 6.5);
      }

      // featured handoff (the live prototype beaming A -> B)
      if (dwell > 0) {
        dwell -= 16;
        lockStrength = Math.min(1, lockStrength + 0.04);
        if (dwell <= 0) {
          featuredSeg = 0;
          featuredT = 0;
          lockStrength = 0;
        }
      } else {
        featuredT += 0.011;
        if (featuredT >= 1) {
          featuredT = 0;
          featuredSeg++;
          if (featuredSeg >= FEATURED_PATH.length - 1) {
            // arrived at B: lock + power up
            dwell = 900;
            featuredSeg = FEATURED_PATH.length - 2;
            featuredT = 1;
          }
        }
        const a = NODES[FEATURED_PATH[featuredSeg]];
        const b = NODES[FEATURED_PATH[featuredSeg + 1]];
        // a larger, brighter packet = the live prototype in transit
        drawPulse(a, b, featuredT, MAGENTA, 11);
      }

      drawLock(NODES[FEATURED[1]], lockStrength);

      // nodes on top
      NODES.forEach((n, idx) =>
        drawNode(n, t, idx === FEATURED[0] || idx === FEATURED[1]),
      );

      raf = requestAnimationFrame(frame);
    };

    const start = () => {
      if (reduced) {
        renderStatic();
        return;
      }
      if (raf) cancelAnimationFrame(raf);
      running = true;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
    };

    // pause when off-screen or tab hidden (kind to the CPU)
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries[0]?.isIntersecting;
        if (visible && !reduced) start();
        else stop();
        if (visible && reduced) renderStatic();
      },
      { threshold: 0.01 },
    );
    io.observe(canvas);

    const onVisibility = () => {
      if (document.hidden) stop();
      else if (!reduced) start();
    };
    document.addEventListener("visibilitychange", onVisibility);

    const onResize = () => {
      resize();
      if (reduced) renderStatic();
    };
    window.addEventListener("resize", onResize);

    start();

    return () => {
      stop();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
    };
  }, [reduced]);

  return (
    <canvas
      ref={canvasRef}
      className="beamfield"
      aria-hidden="true"
    />
  );
}
