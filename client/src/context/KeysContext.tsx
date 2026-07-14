import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from "react";
import { initialKeysState, keysReducer, type KeysAction, type KeysState } from "./reducers/keys";

const KeysStateContext = createContext<KeysState>(initialKeysState);
const KeysDispatchContext = createContext<Dispatch<KeysAction>>(() => {});

export function KeysProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(keysReducer, initialKeysState);
  return (
    <KeysDispatchContext.Provider value={dispatch}>
      <KeysStateContext.Provider value={state}>{children}</KeysStateContext.Provider>
    </KeysDispatchContext.Provider>
  );
}

export const useKeysState = () => useContext(KeysStateContext);
export const useKeysDispatch = () => useContext(KeysDispatchContext);
