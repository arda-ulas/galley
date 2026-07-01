import { Slot } from "@radix-ui/react-slot";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean;
};

export function Button({ asChild, className, ...props }: ButtonProps) {
  const Component = asChild ? Slot : "button";

  return (
    <Component
      className={cn(
        "inline-flex h-8 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--panel-strong)] px-3 text-sm text-[var(--text)] transition hover:border-[var(--accent)] disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
