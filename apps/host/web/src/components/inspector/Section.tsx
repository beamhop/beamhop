import type { ReactNode } from "react";

/** Titled inspector section with an optional right-aligned header slot. */
export function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="isection">
      <div className="ihdr">
        <span className="eyebrow">{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}
