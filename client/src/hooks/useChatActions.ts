import { useCallback, useRef } from "react";
import { api } from "../lib/api";
import { useChatDispatch } from "../context/ChatContext";
import type { ChatMessage, Conversation } from "../context/reducers/chat";

// All async chat work. Token deltas accumulate in a ref and flush to the
// reducer on a ~60ms requestAnimationFrame tick — dispatching 50 times a
// second would melt the UI (SPEC §7 rule 4).

export function useChatActions() {
  const dispatch = useChatDispatch();
  const abortRef = useRef<AbortController | null>(null);

  const loadConversations = useCallback(async () => {
    const conversations = await api<Conversation[]>("/api/chat/conversations");
    dispatch({ type: "conversations_loaded", conversations });
    return conversations;
  }, [dispatch]);

  const createConversation = useCallback(
    async (aliasId: string) => {
      const conversation = await api<Conversation>("/api/chat/conversations", { method: "POST", body: { aliasId } });
      dispatch({ type: "conversation_created", conversation });
      return conversation;
    },
    [dispatch],
  );

  const updateConversation = useCallback(
    async (id: string, patch: { title?: string; archived?: boolean; aliasId?: string }) => {
      const conversation = await api<Conversation>(`/api/chat/conversations/${id}`, { method: "PATCH", body: patch });
      dispatch({ type: "conversation_updated", conversation });
    },
    [dispatch],
  );

  const select = useCallback(
    async (id: string | null) => {
      abortRef.current?.abort();
      dispatch({ type: "select", id });
      if (!id) return;
      dispatch({ type: "messages_loading" });
      const messages = await api<ChatMessage[]>(`/api/chat/conversations/${id}/messages`);
      dispatch({ type: "messages_loaded", messages });
    },
    [dispatch],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const send = useCallback(
    async (conversationId: string, content: string | null, opts: { regenerate?: boolean } = {}) => {
      if (content) {
        dispatch({
          type: "user_message",
          message: { id: `local-${Date.now()}`, role: "user", content },
        });
      }
      dispatch({ type: "stream_start" });

      const abort = new AbortController();
      abortRef.current = abort;

      // Buffered flush machinery.
      let buffer = "";
      let raf: number | null = null;
      const flush = () => {
        raf = null;
        dispatch({ type: "stream_flush", text: buffer });
      };
      const scheduleFlush = () => {
        raf ??= window.setTimeout(() => window.requestAnimationFrame(flush), 60);
      };

      try {
        const res = await fetch(`/api/chat/conversations/${conversationId}/messages`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(content ? { content } : { regenerate: true, ...opts }),
          signal: abort.signal,
        });
        if (!res.ok || !res.body) {
          const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
          throw new Error(err?.error?.message ?? `Chat failed (${res.status})`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let pending = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          pending += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = pending.indexOf("\n\n")) !== -1) {
            const frame = pending.slice(0, idx);
            pending = pending.slice(idx + 2);
            const data = frame
              .split("\n")
              .filter((l) => l.startsWith("data:"))
              .map((l) => l.slice(5).trimStart())
              .join("\n");
            if (!data) continue;
            const evt = JSON.parse(data) as
              | { type: "delta"; text: string }
              | { type: "done"; messageId: string; requestId: string | null }
              | { type: "error"; message: string };
            if (evt.type === "delta") {
              buffer += evt.text;
              scheduleFlush();
            } else if (evt.type === "done") {
              if (raf !== null) window.clearTimeout(raf);
              dispatch({
                type: "stream_done",
                message: { id: evt.messageId, role: "assistant", content: buffer, requestId: evt.requestId },
              });
            } else {
              throw new Error(evt.message);
            }
          }
        }
      } catch (err) {
        if (raf !== null) window.clearTimeout(raf);
        if (abort.signal.aborted) {
          dispatch({ type: "stream_aborted" });
        } else {
          dispatch({ type: "error", message: (err as Error).message });
        }
      } finally {
        if (abortRef.current === abort) abortRef.current = null;
      }
    },
    [dispatch],
  );

  return { loadConversations, createConversation, updateConversation, select, send, stop };
}
