import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

// Data-dense table primitives. Every table in the product gets an empty
// state, a loading skeleton, and an error state — see TableState below.

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full border-collapse text-sm", className)} {...props} />
    </div>
  );
}

export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "border-b border-line px-3 py-2 text-left text-2xs font-medium uppercase tracking-wide text-zinc-500",
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("border-b border-line/60 px-3 py-2 align-middle text-zinc-300", className)} {...props} />;
}

export function TableState({
  loading,
  error,
  empty,
  emptyMessage,
  colSpan,
  onRetry,
}: {
  loading: boolean;
  error: Error | null;
  empty: boolean;
  emptyMessage: string;
  colSpan: number;
  onRetry?: () => void;
}) {
  if (loading) {
    return (
      <>
        {[0, 1, 2, 3, 4].map((i) => (
          <tr key={i}>
            <td colSpan={colSpan} className="border-b border-line/60 px-3 py-2.5">
              <div className="h-4 animate-pulse rounded bg-surface-3" style={{ width: `${85 - i * 12}%` }} />
            </td>
          </tr>
        ))}
      </>
    );
  }
  if (error) {
    return (
      <tr>
        <td colSpan={colSpan} className="px-3 py-10 text-center">
          <p className="text-sm text-red-400">{error.message}</p>
          {onRetry && (
            <button onClick={onRetry} className="mt-2 text-xs text-zinc-400 underline hover:text-zinc-200">
              Retry
            </button>
          )}
        </td>
      </tr>
    );
  }
  if (empty) {
    return (
      <tr>
        <td colSpan={colSpan} className="px-3 py-10 text-center text-sm text-zinc-500">
          {emptyMessage}
        </td>
      </tr>
    );
  }
  return null;
}
