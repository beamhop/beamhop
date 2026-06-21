import type { ElementType, ReactNode } from "react";

/**
 * Wraps content that should reveal on scroll. Content is fully visible by
 * default; the reveal only engages when `useScrollReveal` has armed motion
 * (see lib/motion.ts), so reduced-motion / no-JS visitors see everything.
 */
export function Reveal({
  children,
  as: Tag = "div",
  delay = 0,
  className,
}: {
  children: ReactNode;
  as?: ElementType;
  delay?: number;
  className?: string;
}) {
  return (
    <Tag
      data-reveal=""
      className={className}
      style={delay ? ({ "--reveal-delay": `${delay}ms` } as React.CSSProperties) : undefined}
    >
      {children}
    </Tag>
  );
}
