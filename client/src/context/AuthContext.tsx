import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from "react";
import { authReducer, initialAuthState, type AuthAction, type AuthState } from "./reducers/auth";

// Two providers per context (state + dispatch) — components that only
// dispatch subscribe to the dispatch context and never re-render on state
// change. Applied to every context in the app.

const AuthStateContext = createContext<AuthState>(initialAuthState);
const AuthDispatchContext = createContext<Dispatch<AuthAction>>(() => {});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, initialAuthState);
  return (
    <AuthDispatchContext.Provider value={dispatch}>
      <AuthStateContext.Provider value={state}>{children}</AuthStateContext.Provider>
    </AuthDispatchContext.Provider>
  );
}

export const useAuthState = () => useContext(AuthStateContext);
export const useAuthDispatch = () => useContext(AuthDispatchContext);
