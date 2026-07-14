import { memo, useEffect, useRef, useState, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark-dimmed.css";
import { Archive, Check, Copy, Pencil, Plus, Send, Square } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Select } from "../../components/ui/input";
import { useChatState } from "../../context/ChatContext";
import { useChatActions } from "../../hooks/useChatActions";
import { useQuery } from "../../hooks/useQuery";
import { useToast } from "../../context/ToastContext";
import { cn } from "../../lib/cn";
import type { ChatMessage } from "../../context/reducers/chat";

interface AliasOption {
  id: string;
  alias: string;
  displayName: string;
}

export function ChatPage() {
  const state = useChatState();
  const { loadConversations, createConversation, updateConversation, select, send, stop } = useChatActions();
  const { data: aliases } = useQuery<AliasOption[]>("/api/aliases");
  const toast = useToast();
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!state.conversationsLoaded) void loadConversations();
  }, [state.conversationsLoaded, loadConversations]);

  // Keep the thread pinned to the bottom while streaming.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [state.messages.length, state.streaming?.text]);

  const active = state.conversations.find((c) => c.id === state.activeId) ?? null;

  const newChat = async () => {
    const firstAlias = aliases?.[0];
    if (!firstAlias) {
      toast("info", "No models are published yet — ask your admin.");
      return;
    }
    await createConversation(firstAlias.id);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const content = draft.trim();
    if (!content || state.streaming) return;
    setDraft("");
    let conversationId = state.activeId;
    if (!conversationId) {
      const firstAlias = aliases?.[0];
      if (!firstAlias) {
        toast("info", "No models are published yet — ask your admin.");
        return;
      }
      const conv = await createConversation(firstAlias.id);
      conversationId = conv.id;
    }
    await send(conversationId, content);
    void loadConversations(); // pick up auto-title
  };

  return (
    <div className="flex h-full">
      {/* Conversation sidebar */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-[#0c0c0e]">
        <div className="p-3">
          <Button className="w-full" size="sm" onClick={() => void newChat()}>
            <Plus className="h-3.5 w-3.5" /> New chat
          </Button>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 pb-3">
          {state.conversations.map((c) => (
            <div
              key={c.id}
              className={cn(
                "group mb-0.5 flex items-center gap-1 rounded px-2 py-1.5 text-[13px]",
                state.activeId === c.id ? "bg-surface-2 text-zinc-100" : "text-zinc-500 hover:bg-surface-2/60 hover:text-zinc-300",
              )}
            >
              <button className="min-w-0 flex-1 truncate text-left" onClick={() => void select(c.id)}>
                {c.title}
              </button>
              <button
                aria-label="Rename"
                className="hidden rounded p-0.5 text-zinc-600 hover:text-zinc-300 group-hover:block"
                onClick={() => {
                  const title = window.prompt("Rename conversation", c.title);
                  if (title) void updateConversation(c.id, { title });
                }}
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                aria-label="Archive"
                className="hidden rounded p-0.5 text-zinc-600 hover:text-zinc-300 group-hover:block"
                onClick={() => void updateConversation(c.id, { archived: true })}
              >
                <Archive className="h-3 w-3" />
              </button>
            </div>
          ))}
          {state.conversationsLoaded && state.conversations.length === 0 && (
            <p className="px-2 py-6 text-center text-2xs text-zinc-600">No conversations yet.</p>
          )}
        </nav>
      </aside>

      {/* Thread */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <p className="truncate text-sm font-medium text-zinc-200">{active?.title ?? "Chat"}</p>
          {active && aliases && (
            <Select
              className="h-8 w-56"
              value={active.aliasId}
              onChange={(e) => void updateConversation(active.id, { aliasId: e.target.value })}
              aria-label="Model"
            >
              {aliases.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.displayName}
                </option>
              ))}
            </Select>
          )}
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-4 py-6">
            {!active && !state.streaming && (
              <div className="flex h-[50vh] flex-col items-center justify-center text-center">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-accent-faint font-mono text-lg font-bold text-accent">
                  K
                </div>
                <p className="text-sm font-medium text-zinc-300">Ask anything</p>
                <p className="mt-1 max-w-xs text-xs text-zinc-600">
                  Same models, same budget as your API key — IT sees one number, not two.
                </p>
              </div>
            )}
            {state.messagesLoading && <div className="h-24 animate-pulse rounded bg-surface-2" />}
            {state.messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
            {state.streaming && (
              <MessageBubble
                message={{ id: "streaming", role: "assistant", content: state.streaming.text || "…" }}
                streaming
              />
            )}
            {state.error && (
              <p role="alert" className="mt-4 rounded border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">
                {state.error}
              </p>
            )}
          </div>
        </div>

        {/* Composer */}
        <form onSubmit={submit} className="border-t border-line p-3">
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submit(e);
                }
              }}
              rows={Math.min(draft.split("\n").length, 6)}
              placeholder="Message… (Enter to send, Shift+Enter for a new line)"
              aria-label="Message"
              className="max-h-40 min-h-[42px] w-full resize-none rounded border border-line-strong bg-surface px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-accent/60"
            />
            {state.streaming ? (
              <Button type="button" variant="danger" size="icon" aria-label="Stop generating" onClick={stop}>
                <Square className="h-4 w-4" />
              </Button>
            ) : (
              <Button type="submit" variant="primary" size="icon" aria-label="Send" disabled={!draft.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

// memo: streaming re-renders only the last bubble, not the whole thread.
const MessageBubble = memo(function MessageBubble({
  message,
  streaming,
}: {
  message: ChatMessage;
  streaming?: boolean;
}) {
  return (
    <div className={cn("mb-5 flex", message.role === "user" ? "justify-end" : "justify-start")}>
      {message.role === "user" ? (
        <div className="max-w-[80%] whitespace-pre-wrap rounded-lg bg-surface-3 px-3.5 py-2.5 text-sm text-zinc-100">
          {message.content}
        </div>
      ) : (
        <div className="markdown max-w-full text-sm leading-relaxed text-zinc-200">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={{
              pre: (props) => <CodeBlock {...props} />,
              a: (props) => <a {...props} className="text-accent underline underline-offset-2" target="_blank" rel="noreferrer" />,
              ul: (props) => <ul {...props} className="my-2 list-disc pl-5" />,
              ol: (props) => <ol {...props} className="my-2 list-decimal pl-5" />,
              h1: (props) => <h2 {...props} className="mb-2 mt-4 text-base font-semibold text-zinc-100" />,
              h2: (props) => <h3 {...props} className="mb-2 mt-4 text-[15px] font-semibold text-zinc-100" />,
              h3: (props) => <h4 {...props} className="mb-1 mt-3 text-sm font-semibold text-zinc-100" />,
              p: (props) => <p {...props} className="my-2" />,
              table: (props) => (
                <div className="my-2 overflow-x-auto">
                  <table {...props} className="w-full border-collapse text-xs [&_td]:border [&_td]:border-line [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-line [&_th]:bg-surface-2 [&_th]:px-2 [&_th]:py-1" />
                </div>
              ),
              code: ({ className, children, ...props }) => {
                const inline = !className && typeof children === "string" && !String(children).includes("\n");
                return inline ? (
                  <code className="rounded bg-surface-3 px-1 py-0.5 font-mono text-[12px] text-accent" {...props}>
                    {children}
                  </code>
                ) : (
                  <code className={cn(className, "font-mono text-[12px]")} {...props}>
                    {children}
                  </code>
                );
              },
            }}
          >
            {message.content}
          </ReactMarkdown>
          {streaming && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-accent align-text-bottom" />}
        </div>
      )}
    </div>
  );
});

function CodeBlock(props: { children?: React.ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    const text = ref.current?.innerText ?? "";
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="group relative my-2">
      <pre ref={ref} className="overflow-x-auto rounded-lg border border-line bg-[#0c0c0e] p-3">
        {props.children}
      </pre>
      <button
        onClick={copy}
        aria-label="Copy code"
        className="absolute right-2 top-2 rounded border border-line-strong bg-surface-2 p-1 text-zinc-500 opacity-0 transition-opacity hover:text-zinc-200 group-hover:opacity-100"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-accent" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}
