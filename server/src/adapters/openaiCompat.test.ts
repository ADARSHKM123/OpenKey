import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OpenAICompatAdapter } from "./openaiCompat.js";
import { AnthropicAdapter } from "./anthropic.js";
import { UpstreamError, type StreamEvent } from "./types.js";

// Wire-format tests against a local fake upstream: prove the adapters parse
// real SSE framing (including usage extraction) without any cloud credentials.

let server: Server;
let baseUrl: string;

const OPENAI_SSE = [
  `data: {"choices":[{"delta":{"role":"assistant","content":""},"finish_reason":null}]}`,
  `data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}`,
  `data: {"choices":[{"delta":{"content":" world"},"finish_reason":null}]}`,
  `data: {"choices":[{"delta":{},"finish_reason":"stop"}]}`,
  `data: {"choices":[],"usage":{"prompt_tokens":9,"completion_tokens":2,"prompt_tokens_details":{"cached_tokens":4}}}`,
  `data: [DONE]`,
].join("\n\n");

const ANTHROPIC_SSE = [
  `event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10,"cache_read_input_tokens":6}}}`,
  `event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}`,
  `event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":" there"}}`,
  `event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"max_tokens"},"usage":{"output_tokens":2}}`,
  `event: message_stop\ndata: {"type":"message_stop"}`,
].join("\n\n");

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url?.includes("fail")) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "boom" } }));
      return;
    }
    const isAnthropic = req.url?.startsWith("/v1/messages");
    res.writeHead(200, { "content-type": "text/event-stream" });
    // Write in awkward chunks to prove boundary handling.
    const payload = (isAnthropic ? ANTHROPIC_SSE : OPENAI_SSE) + "\n\n";
    const mid = Math.floor(payload.length / 2) + 3;
    res.write(payload.slice(0, mid));
    setTimeout(() => res.end(payload.slice(mid)), 10);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (addr === null || typeof addr === "string") throw new Error("no port");
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => server.close());

async function collect(iter: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const e of iter) events.push(e);
  return events;
}

describe("OpenAICompatAdapter", () => {
  const req = { model: "gpt-4o", messages: [{ role: "user" as const, content: "hi" }], maxTokens: 50 };

  it("parses deltas, finish_reason, and usage (incl. cached tokens)", async () => {
    const adapter = new OpenAICompatAdapter("openai");
    const events = await collect(adapter.chat(req, { apiKey: "k", baseUrl }, new AbortController().signal));
    const text = events.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text).join("");
    expect(text).toBe("Hello world");
    const usage = events.find((e) => e.type === "usage");
    expect(usage).toMatchObject({ inputTokens: 9, outputTokens: 2, cachedTokens: 4 });
    expect(events.at(-1)).toEqual({ type: "done", finishReason: "stop" });
  });

  it("maps upstream 5xx to a retryable UpstreamError with the provider message", async () => {
    const adapter = new OpenAICompatAdapter("openai");
    await expect(
      collect(adapter.chat(req, { apiKey: "k", baseUrl: `${baseUrl}/fail` }, new AbortController().signal)),
    ).rejects.toSatisfy((e: unknown) => e instanceof UpstreamError && e.retryable && /boom/.test(e.message));
  });

  it("rejects malformed credentials without calling upstream", async () => {
    const adapter = new OpenAICompatAdapter("azure_openai");
    await expect(collect(adapter.chat(req, { nope: true }, new AbortController().signal))).rejects.toSatisfy(
      (e: unknown) => e instanceof UpstreamError && !e.retryable,
    );
  });
});

describe("AnthropicAdapter", () => {
  it("parses event stream, cache reads, and stop_reason mapping", async () => {
    const adapter = new AnthropicAdapter();
    const events = await collect(
      adapter.chat(
        {
          model: "claude-sonnet-4-5",
          messages: [
            { role: "system", content: "be brief" },
            { role: "user", content: "hi" },
          ],
          maxTokens: 50,
        },
        { apiKey: "k", baseUrl },
        new AbortController().signal,
      ),
    );
    const text = events.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text).join("");
    expect(text).toBe("Hi there");
    // input_tokens excludes cache reads upstream; adapter reports the total.
    const usage = events.find((e) => e.type === "usage");
    expect(usage).toMatchObject({ inputTokens: 16, outputTokens: 2, cachedTokens: 6 });
    expect(events.at(-1)).toEqual({ type: "done", finishReason: "length" });
  });
});
