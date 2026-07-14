import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] data-[state=open]:animate-fade-up" />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-[12vh] z-50 w-full -translate-x-1/2 rounded-lg border border-line-strong bg-surface-2 shadow-2xl shadow-black/50 focus:outline-none data-[state=open]:animate-fade-up",
            wide ? "max-w-2xl" : "max-w-md",
          )}
        >
          <div className="flex items-start justify-between border-b border-line px-5 py-4">
            <div>
              <DialogPrimitive.Title className="text-sm font-semibold text-zinc-100">{title}</DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description className="mt-1 text-xs text-zinc-500">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close aria-label="Close" className="rounded p-1 text-zinc-500 hover:bg-surface-3 hover:text-zinc-200">
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>
          <div className="px-5 py-4">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
