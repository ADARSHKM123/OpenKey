import { createContext, useCallback, useContext, useMemo, useReducer, type ReactNode } from "react";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { cn } from "../lib/cn";

// Toasts: state and dispatch are separate contexts so a component that only
// pushes toasts never re-renders when the toast list changes.

export interface Toast {
  id: number;
  kind: "success" | "error" | "info";
  message: string;
}

type Action = { type: "push"; toast: Toast } | { type: "dismiss"; id: number };

function reducer(state: Toast[], action: Action): Toast[] {
  switch (action.type) {
    case "push":
      return [...state.slice(-3), action.toast];
    case "dismiss":
      return state.filter((t) => t.id !== action.id);
  }
}

const StateCtx = createContext<Toast[]>([]);
const PushCtx = createContext<(kind: Toast["kind"], message: string) => void>(() => {});

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, dispatch] = useReducer(reducer, []);

  const push = useCallback((kind: Toast["kind"], message: string) => {
    const id = nextId++;
    dispatch({ type: "push", toast: { id, kind, message } });
    setTimeout(() => dispatch({ type: "dismiss", id }), 4000);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <PushCtx.Provider value={value}>
      <StateCtx.Provider value={toasts}>
        {children}
        <ToastViewport toasts={toasts} onDismiss={(id) => dispatch({ type: "dismiss", id })} />
      </StateCtx.Provider>
    </PushCtx.Provider>
  );
}

export function useToast() {
  return useContext(PushCtx);
}

const icons = {
  success: <CheckCircle2 className="h-4 w-4 text-accent" />,
  error: <XCircle className="h-4 w-4 text-red-400" />,
  info: <AlertTriangle className="h-4 w-4 text-amber-400" />,
};

function ToastViewport({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => onDismiss(t.id)}
          className={cn(
            "pointer-events-auto flex max-w-sm items-center gap-2.5 rounded border border-line-strong bg-surface-2 px-3.5 py-2.5 text-left text-sm text-zinc-200 shadow-lg shadow-black/40 animate-fade-up",
          )}
        >
          {icons[t.kind]}
          <span>{t.message}</span>
        </button>
      ))}
    </div>
  );
}
