import { forwardRef, type InputHTMLAttributes, type LabelHTMLAttributes, type SelectHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-[34px] w-full rounded border border-line-strong bg-surface px-3 text-sm text-zinc-100 placeholder:text-zinc-600 transition-colors focus:border-accent/60",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1.5 block text-xs font-medium text-zinc-400", className)} {...props} />;
}

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "h-[34px] w-full cursor-pointer rounded border border-line-strong bg-surface px-2.5 text-sm text-zinc-100 transition-colors focus:border-accent/60",
        className,
      )}
      {...props}
    />
  ),
);
Select.displayName = "Select";
