import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn.js";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.14em] transition-[background,color,border-color] duration-100 ease-out focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-amber)] disabled:pointer-events-none disabled:opacity-40 select-none",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--color-amber)] text-[var(--color-ink)] hover:bg-[color-mix(in_srgb,var(--color-amber)_85%,white)] active:bg-[var(--color-amber-soft)]",
        ghost:
          "bg-transparent text-[var(--color-bone)] hover:text-[var(--color-paper)] hover:bg-[var(--color-ink-2)]",
        outline:
          "bg-transparent text-[var(--color-paper)] border border-[var(--color-rule)] hover:border-[var(--color-amber)] hover:text-[var(--color-amber)]",
        danger:
          "bg-transparent text-[var(--color-rust)] border border-[color-mix(in_srgb,var(--color-rust)_60%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-rust)_15%,transparent)]",
      },
      size: {
        sm: "h-7 px-2.5",
        md: "h-8 px-3.5",
        lg: "h-10 px-5",
        icon: "h-7 w-7 px-0",
      },
    },
    defaultVariants: { variant: "ghost", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
    );
  },
);
Button.displayName = "Button";
