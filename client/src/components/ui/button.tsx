import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "../../lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40 cursor-pointer select-none",
  {
    variants: {
      variant: {
        // The one place the accent shows up by default.
        primary: "bg-accent-strong text-zinc-950 hover:bg-accent",
        secondary: "border border-line-strong bg-surface-2 text-zinc-200 hover:bg-surface-3",
        ghost: "text-zinc-400 hover:text-zinc-100 hover:bg-surface-2",
        danger: "border border-red-900/60 bg-red-950/40 text-red-300 hover:bg-red-900/40",
      },
      size: {
        sm: "h-7 px-2.5 text-xs",
        md: "h-8.5 h-[34px] px-3.5 text-sm",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {children}
    </button>
  ),
);
Button.displayName = "Button";
