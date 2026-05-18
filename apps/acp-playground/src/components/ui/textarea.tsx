import * as React from "react";
import { cn } from "@/lib/cn.js";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "w-full resize-none bg-transparent font-mono text-sm text-[var(--color-paper)] placeholder:text-[var(--color-fog)]",
      "outline-none focus-visible:outline-none border-none p-0",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
