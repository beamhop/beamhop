import { useEffect, useRef, type ReactNode } from "react";

/**
 * Floating panel that closes on outside-click or Escape. Used by the
 * composer's model/thinking pickers.
 */
export function Popover({
  children,
  onClose,
  className,
  onKeyDown,
}: {
  children: ReactNode;
  onClose: () => void;
  className?: string;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Defer the mousedown listener a tick so the click that opened the popover
    // doesn't immediately close it.
    const t = setTimeout(() => document.addEventListener("mousedown", h), 0);
    document.addEventListener("keydown", k);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", h);
      document.removeEventListener("keydown", k);
    };
  }, [onClose]);
  return (
    <div className={"popover" + (className ? " " + className : "")} ref={ref} onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}
