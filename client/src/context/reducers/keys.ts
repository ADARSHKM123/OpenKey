export interface VirtualKey {
  id: string;
  name: string;
  keyPrefix: string;
  teamId: string | null;
  allowedModels: string[];
  monthlyBudgetUsd: string | null;
  rpmLimit: number | null;
  tpmLimit: number | null;
  ipAllowlist: string[];
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface KeysState {
  status: "idle" | "loading" | "ready" | "error";
  keys: VirtualKey[];
  error: string | null;
}

export type KeysAction =
  | { type: "loading" }
  | { type: "loaded"; keys: VirtualKey[] }
  | { type: "failed"; error: string }
  | { type: "created"; key: VirtualKey }
  | { type: "updated"; key: VirtualKey }
  | { type: "revoked"; id: string };

export const initialKeysState: KeysState = { status: "idle", keys: [], error: null };

export function keysReducer(state: KeysState, action: KeysAction): KeysState {
  switch (action.type) {
    case "loading":
      return { ...state, status: "loading", error: null };
    case "loaded":
      return { status: "ready", keys: action.keys, error: null };
    case "failed":
      return { ...state, status: "error", error: action.error };
    case "created":
      return { ...state, keys: [action.key, ...state.keys] };
    case "updated":
      return { ...state, keys: state.keys.map((k) => (k.id === action.key.id ? action.key : k)) };
    case "revoked":
      return {
        ...state,
        keys: state.keys.map((k) => (k.id === action.id ? { ...k, revokedAt: new Date().toISOString() } : k)),
      };
    default:
      return state;
  }
}
