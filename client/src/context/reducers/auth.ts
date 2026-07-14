// Pure reducer, discriminated-union actions. Async work lives in
// hooks/useAuthActions.ts, never here.

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
  monthlyBudgetUsd: string | null;
  org: { id: string; name: string };
  teams: { id: string; name: string }[];
}

export interface AuthState {
  status: "loading" | "authed" | "anon";
  user: SessionUser | null;
}

export type AuthAction =
  | { type: "resolved"; user: SessionUser }
  | { type: "anon" }
  | { type: "logout" };

export const initialAuthState: AuthState = { status: "loading", user: null };

export function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case "resolved":
      return { status: "authed", user: action.user };
    case "anon":
    case "logout":
      return { status: "anon", user: null };
    default:
      return state;
  }
}
