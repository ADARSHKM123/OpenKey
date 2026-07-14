export interface Conversation {
  id: string;
  title: string;
  aliasId: string;
  archived: boolean;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  requestId?: string | null;
  pending?: boolean;
}

export interface ChatState {
  conversations: Conversation[];
  conversationsLoaded: boolean;
  activeId: string | null;
  messages: ChatMessage[];
  messagesLoading: boolean;
  // The in-flight assistant turn. Deltas are buffered in a ref and flushed
  // here at ~60ms ticks — never one dispatch per token.
  streaming: { text: string } | null;
  error: string | null;
}

export type ChatAction =
  | { type: "conversations_loaded"; conversations: Conversation[] }
  | { type: "conversation_created"; conversation: Conversation }
  | { type: "conversation_updated"; conversation: Conversation }
  | { type: "select"; id: string | null }
  | { type: "messages_loading" }
  | { type: "messages_loaded"; messages: ChatMessage[] }
  | { type: "user_message"; message: ChatMessage }
  | { type: "stream_start" }
  | { type: "stream_flush"; text: string }
  | { type: "stream_done"; message: ChatMessage }
  | { type: "stream_aborted" }
  | { type: "error"; message: string };

export const initialChatState: ChatState = {
  conversations: [],
  conversationsLoaded: false,
  activeId: null,
  messages: [],
  messagesLoading: false,
  streaming: null,
  error: null,
};

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "conversations_loaded":
      return { ...state, conversations: action.conversations, conversationsLoaded: true };
    case "conversation_created":
      return { ...state, conversations: [action.conversation, ...state.conversations], activeId: action.conversation.id, messages: [], error: null };
    case "conversation_updated":
      return {
        ...state,
        conversations: state.conversations
          .map((c) => (c.id === action.conversation.id ? action.conversation : c))
          .filter((c) => !c.archived),
      };
    case "select":
      return { ...state, activeId: action.id, messages: [], streaming: null, error: null };
    case "messages_loading":
      return { ...state, messagesLoading: true };
    case "messages_loaded":
      return { ...state, messages: action.messages, messagesLoading: false };
    case "user_message":
      return { ...state, messages: [...state.messages, action.message], error: null };
    case "stream_start":
      return { ...state, streaming: { text: "" } };
    case "stream_flush":
      return { ...state, streaming: { text: action.text } };
    case "stream_done":
      return { ...state, streaming: null, messages: [...state.messages, action.message] };
    case "stream_aborted":
      return state.streaming?.text
        ? {
            ...state,
            streaming: null,
            messages: [...state.messages, { id: `local-${Date.now()}`, role: "assistant", content: state.streaming.text }],
          }
        : { ...state, streaming: null };
    case "error":
      return { ...state, streaming: null, error: action.message };
    default:
      return state;
  }
}
