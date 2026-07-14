import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs font-medium leading-4",
  {
    variants: {
      tone: {
        neutral: "bg-surface-3 text-zinc-400",
        accent: "bg-accent-faint text-accent",
        amber: "bg-amber-500/10 text-amber-400",
        red: "bg-red-500/10 text-red-400",
        blue: "bg-sky-500/10 text-sky-400",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
