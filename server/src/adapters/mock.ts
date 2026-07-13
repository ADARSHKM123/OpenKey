import type { AdapterRequest, ProviderAdapter, StreamEvent } from "./types.js";
import { UpstreamError } from "./types.js";
import { countText, estimateInputTokens } from "../lib/tokenizer.js";

// Zero-cost provider for development and load testing. Deterministic, fast,
// and steerable via magic prompts so every hot-path behavior — including the
// mid-stream kill-switch and fallback — can be exercised without credentials:
//
//   "mock:tokens=500"   → generate ~500 output tokens
//   "mock:delay=50"     → 50ms pause between chunks
//   "mock:fail"         → immediate retryable 503 (circuit breaker / fallback tests)
//   "mock:fail-mid"     → fail after the first chunk (stream corruption honesty test)

const SENTENCE = "The quick brown fox jumps over the lazy dog. ";

function lastUserText(req: AdapterRequest): string {
  for (let i = req.messages.length - 1; i >= 0; i--) {
    const m = req.messages[i];
    if (m?.role === "user" && typeof m.content === "string") return m.content;
  }
  return "";
}

function directive(text: string, name: string): string | undefined {
  const match = text.match(new RegExp(`mock:${name}(?:=(\\S+))?`));
  return match ? (match[1] ?? "") : undefined;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class MockAdapter implements ProviderAdapter {
  readonly kind = "mock" as const;

  async *chat(req: AdapterRequest, _config: unknown, signal: AbortSignal): AsyncIterable<StreamEvent> {
    const prompt = lastUserText(req);
    if (directive(prompt, "fail") !== undefined && directive(prompt, "fail-mid") === undefined) {
      throw new UpstreamError(503, "mock provider was asked to fail", true);
    }

    const wantTokens = Math.min(Number(directive(prompt, "tokens") ?? 60), req.maxTokens);
    const delayMs = Number(directive(prompt, "delay") ?? 5);
    const failMid = directive(prompt, "fail-mid") !== undefined;

    let text = "";
    let emitted = 0;
    let chunkIndex = 0;
    while (emitted < wantTokens) {
      if (signal.aborted) return;
      let chunk = SENTENCE;
      let chunkTokens = countText(chunk);
      // Real providers never exceed max_tokens; neither may the mock — the
      // kill-switch tests depend on reservations being an upper bound.
      while (emitted + chunkTokens > wantTokens && chunk.includes(" ")) {
        chunk = chunk.slice(0, chunk.lastIndexOf(" "));
        chunkTokens = countText(chunk);
      }
      if (chunk.length === 0) break;
      text += chunk;
      emitted += chunkTokens;
      yield { type: "delta", text: chunk };
      chunkIndex++;
      if (failMid && chunkIndex === 1) {
        throw new UpstreamError(503, "mock provider failed mid-stream", true);
      }
      if (delayMs > 0) await sleep(delayMs);
    }

    yield {
      type: "usage",
      inputTokens: estimateInputTokens(req.messages, "mock-small").tokens,
      outputTokens: countText(text),
      cachedTokens: 0,
    };
    yield { type: "done", finishReason: emitted >= req.maxTokens ? "length" : "stop" };
  }
}
