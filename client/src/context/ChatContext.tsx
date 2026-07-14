import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from "react";
import { chatReducer, initialChatState, type ChatAction, type ChatState } from "./reducers/chat";

// Deliberately isolated from every other context: a streaming chat turn
// re-renders ONLY chat components, never the admin sidebar.

const ChatStateContext = createContext<ChatState>(initialChatState);
const ChatDispatchContext = createContext<Dispatch<ChatAction>>(() => {});

export function ChatProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  return (
    <ChatDispatchContext.Provider value={dispatch}>
      <ChatStateContext.Provider value={state}>{children}</ChatStateContext.Provider>
    </ChatDispatchContext.Provider>
  );
}

export const useChatState = () => useContext(ChatStateContext);
export const useChatDispatch = () => useContext(ChatDispatchContext);
