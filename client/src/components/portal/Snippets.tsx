import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "../../lib/cn";

// The "one line of code" moment: copy-paste-ready snippets pre-filled with
// this deployment's live base URL. The key placeholder is swapped for the
// real key only in the moment after creation, while it exists client-side.

const TABS = ["cURL", "Python", "Node", "LangChain", "Claude Code", "Cursor"] as const;
type Tab = (typeof TABS)[number];

function snippets(baseUrl: string, key: string): Record<Tab, string> {
  return {
    cURL: `curl ${baseUrl}/v1/chat/completions \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "mock-fast",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`,
    Python: `from openai import OpenAI

client = OpenAI(
    base_url="${baseUrl}/v1",
    api_key="${key}",
)

response = client.chat.completions.create(
    model="mock-fast",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(response.choices[0].message.content)`,
    Node: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${baseUrl}/v1",
  apiKey: "${key}",
});

const response = await client.chat.completions.create({
  model: "mock-fast",
  messages: [{ role: "user", content: "Hello!" }],
});
console.log(response.choices[0].message.content);`,
    LangChain: `from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    base_url="${baseUrl}/v1",
    api_key="${key}",
    model="mock-fast",
)
print(llm.invoke("Hello!").content)`,
    "Claude Code": `# Point Claude Code at OpenKey (OpenAI-compatible endpoint)
export ANTHROPIC_BASE_URL="${baseUrl}"
export ANTHROPIC_AUTH_TOKEN="${key}"
claude`,
    Cursor: `1. Cursor Settings → Models → "Override OpenAI Base URL"
2. Base URL:  ${baseUrl}/v1
3. API key:   ${key}
4. Add a custom model named e.g. "mock-fast"`,
  };
}

export function Snippets({ apiKey }: { apiKey: string }) {
  const [tab, setTab] = useState<Tab>("cURL");
  const [copied, setCopied] = useState(false);
  const baseUrl = window.location.origin;
  const code = snippets(baseUrl, apiKey)[tab];

  const copy = () => {
    void navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-[#0c0c0e]">
      <div className="flex items-center justify-between border-b border-line px-2">
        <div className="flex overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "whitespace-nowrap border-b-2 px-3 py-2 text-xs font-medium transition-colors",
                tab === t ? "border-accent text-zinc-100" : "border-transparent text-zinc-500 hover:text-zinc-300",
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <button
          onClick={copy}
          aria-label="Copy snippet"
          className="mr-1 flex items-center gap-1 rounded px-2 py-1 text-2xs text-zinc-500 hover:bg-surface-2 hover:text-zinc-200"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-accent" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-zinc-300">{code}</pre>
    </div>
  );
}
