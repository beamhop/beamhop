/**
 * Tiny friendly robot avatar for agent nodes — neutral grayscale so it sits in
 * the monochrome (Vercel-style) palette. `id` keeps each instance's gradient ids
 * unique so multiple robots can't collide in the document.
 */
export type RobotAvatarProps = {
  /** Stable id suffix so multiple gradients don't collide in the document. */
  id: string;
  size?: number;
};

export default function RobotAvatar({ id, size = 38 }: RobotAvatarProps) {
  const shell = `robo-shell-${id}`;
  const eye = `robo-eye-${id}`;
  const top = "oklch(86% 0 0)";
  const bottom = "oklch(56% 0 0)";
  const glow = "oklch(99% 0 0)";

  return (
    <svg
      className="robot"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={shell} x1="0" y1="0" x2="0" y2="48">
          <stop offset="0" stopColor={top} />
          <stop offset="1" stopColor={bottom} />
        </linearGradient>
        <radialGradient id={eye} cx="50%" cy="45%" r="65%">
          <stop offset="0" stopColor={glow} />
          <stop offset="1" stopColor={top} />
        </radialGradient>
      </defs>

      {/* antenna */}
      <line x1="24" y1="4" x2="24" y2="10" stroke={top} strokeWidth="2" strokeLinecap="round" />
      <circle cx="24" cy="4" r="2.4" fill={glow} />

      {/* head shell + subtle top sheen */}
      <rect x="7" y="10" width="34" height="28" rx="11" fill={`url(#${shell})`} />
      <rect x="7" y="10" width="34" height="13" rx="11" fill="oklch(100% 0 0 / 0.14)" />

      {/* dark screen face */}
      <rect x="12" y="16" width="24" height="16" rx="8" fill="oklch(12% 0 0)" />

      {/* glowing eyes + a tiny smile */}
      <circle cx="19" cy="24" r="3" fill={`url(#${eye})`} />
      <circle cx="29" cy="24" r="3" fill={`url(#${eye})`} />
      <path
        d="M20 29q4 2.6 8 0"
        stroke={glow}
        strokeWidth="1.4"
        strokeLinecap="round"
        fill="none"
        opacity="0.6"
      />

      {/* ear nubs */}
      <rect x="3" y="20" width="4" height="8" rx="2" fill={bottom} />
      <rect x="41" y="20" width="4" height="8" rx="2" fill={bottom} />
    </svg>
  );
}
