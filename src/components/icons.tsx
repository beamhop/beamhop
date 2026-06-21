/* Geometric, stroke-based console icons. No sketchy fills. */
import type { SVGProps } from "react";

const base = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const BeamIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M4 12h10" />
    <path d="M11 8l5 4-5 4" />
    <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
  </svg>
);

export const ShieldIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M12 3l7 3v5c0 4.2-2.8 7.4-7 9-4.2-1.6-7-4.8-7-9V6z" />
    <path d="M9.5 12l1.8 1.8L15 10" />
  </svg>
);

export const LockIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    <circle cx="12" cy="15.5" r="1.3" fill="currentColor" stroke="none" />
  </svg>
);

export const BoxIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z" />
    <path d="M4 7.5 12 12l8-4.5M12 12v9" />
  </svg>
);

export const ClockIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 8v4l3 2" />
  </svg>
);

export const KeyIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <circle cx="8" cy="12" r="3.5" />
    <path d="M11.5 12H20M17 12v3M14.5 12v2" />
  </svg>
);

export const NetworkIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <circle cx="6" cy="6" r="2" />
    <circle cx="18" cy="7" r="2" />
    <circle cx="12" cy="18" r="2" />
    <path d="M7.6 7.4 10.6 16M16.6 8.6 13 16.4M8 6.5h8" />
  </svg>
);

export const PulseIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}>
    <path d="M3 12h4l2-6 4 14 2-8h6" />
  </svg>
);

export const ArrowIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p} className={"btn-arrow " + (p.className ?? "")}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const Logo = (p: SVGProps<SVGSVGElement>) => (
  <svg
    width={22}
    height={22}
    viewBox="0 0 24 24"
    fill="none"
    {...p}
    className={"brand-mark " + (p.className ?? "")}
  >
    <defs>
      <linearGradient id="bh-g" x1="0" y1="0" x2="24" y2="24">
        <stop offset="0" stopColor="oklch(64% 0.215 292)" />
        <stop offset="1" stopColor="oklch(67% 0.27 350)" />
      </linearGradient>
    </defs>
    <circle cx="5" cy="12" r="2.6" fill="url(#bh-g)" />
    <circle cx="19" cy="12" r="2.6" fill="url(#bh-g)" />
    <path
      d="M7.6 12h6.4M11.6 8.5 15.5 12l-3.9 3.5"
      stroke="url(#bh-g)"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  </svg>
);
