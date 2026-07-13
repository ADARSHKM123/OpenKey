import { z } from "zod";
import type { ChatMessage } from "@openkey/shared";
import type { AdapterRequest, ProviderAdapter, StreamEvent } from "./types.js";
import { UpstreamError } from "./types.js";
import { parseSse } from "../lib/sse-parse.js";

// Anthropic Messages API, direct. Prompt-cache reads surface as
// cache_read_input_tokens and are billed at the cached rate — this is where
// the dashboard's "money saved by caching" number comes from.

const AnthropicConfigSchema = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.string().url().default("https://api.anthropic.com"),
});

const ANTHROPIC_VERSION = "2023-06-01";

function splitMessages(messages: ChatMessage[]): { system: string; turns: { role: "user" | "assistant"; content: string }[] } {
  const systemParts: string[] = [];
  const turns: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of messages) {
    const text =
      typeof m.content === "string"
        ? m.content
        : (m.content ?? []).map((p) => (p.type === "text" ? p.text : "")).join("\n");
    if (m.role === "system") {
      systemParts.push(text);
      continue;
    }
    const role = m.role === "assistant" ? "assistant" : "user";
    const prev = turns[turns.length - 1];
    // Messages API requires alternating roles; merge rather than reject.
    if (prev && prev.role === role) prev.content += `\n${text}`;
    else turns.push({ role, content: text });
  }
  return { system: systemParts.join("\n"), turns };
}

const EventSchema = z
  .object({
    type: z.string(),
    message: z
      .object({
        usage: z
          .object({
            input_tokens: z.number().default(0),
            cache_read_input_tokens: z.number().nullish(),
          })
          .passthrough(),
      })
      .passthrough()
      .nullish(),
    delta: z
      .object({
        type: z.string().nullish(),
        text: z.string().nullish(),
        stop_reason: z.string().nullish(),
      })
      .passthrough()
      .nullish(),
    usage: z.object({ output_tokens: z.number().default(0) }).passthrough().nullish(),
    error: z.object({ message: z.string() }).passthrough().nullish(),
  })
  .passthrough();

function mapStop(reason: string | null | undefined): "stop" | "length" | "content_filter" {
  if (reason === "max_tokens") return "length";
  if (reason === "refusal") return "content_filter";
  return "stop";
}

export class AnthropicAdapter implements ProviderAdapter {
  readonly kind = "anthropic" as const;

  async *chat(req: AdapterRequest, rawConfig: unknown, signal: AbortSignal): AsyncIterable<StreamEvent> {
    const parsed = AnthropicConfigSchema.safeParse(rawConfig);
    if (!parsed.success) throw new UpstreamError(500, "anthropic provider credential is malformed", false);
    const cfg = parsed.data;

    const { system, turns } = splitMessages(req.messages);
    const body = {
      model: req.model,
      max_tokens: req.maxTokens,
      messages: turns,
      stream: true,
      ...(system ? { system } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.topP !== undefined ? { top_p: req.topP } : {}),
      ...(req.stop !== undefined && req.stop.length > 0 ? { stop_sequences: req.stop } : {}),
    };

    let res: Response;
    try {
      res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": cfg.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (signal.aborted) return;
      throw new UpstreamError(502, `anthropic request failed: ${(err as Error).message}`, true);
    }

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const errBody = (await res.json()) as { error?: { message?: string } };
        detail = errBody.error?.message ?? detail;
      } catch {
        /* keep default */
      }
      throw new UpstreamError(res.status, `anthropic: ${detail}`, res.status === 429 || res.status >= 500);
    }
    if (!res.body) throw new UpstreamError(502, "anthropic returned no body", true);

    let inputTokens = 0;
    let cachedTokens = 0;
    let outputTokens = 0;
    let finish: "stop" | "length" | "content_filter" = "stop";

    for await (const evt of parseSse(res.body)) {
      if (signal.aborted) return;
      let json: unknown;
      try {
        json = JSON.parse(evt.data);
      } catch {
        continue;
      }
      const event = EventSchema.safeParse(json);
      if (!event.success) continue;
      const e = event.data;

      switch (e.type) {
        case "message_start":
          inputTokens = e.message?.usage.input_tokens ?? 0;
          cachedTokens = e.message?.usage.cache_read_input_tokens ?? 0;
          break;
        case "content_block_delta":
          if (e.delta?.type === "text_delta" && e.delta.text) {
            yield { type: "delta", text: e.delta.text };
          }
          break;
        case "message_delta":
          if (e.usage) outputTokens = e.usage.output_tokens;
          if (e.delta?.stop_reason) finish = mapStop(e.delta.stop_reason);
          break;
        case "error":
          throw new UpstreamError(529, `anthropic stream error: ${e.error?.message ?? "unknown"}`, true);
        default:
          break; // ping, content_block_start/stop, message_stop
      }
    }

    yield {
      type: "usage",
      // input_tokens excludes cache reads; the gateway's cost model wants the
      // TOTAL prompt size with the cached share priced separately.
      inputTokens: inputTokens + cachedTokens,
      outputTokens,
      cachedTokens,
    };
    yield { type: "done", finishReason: finish };
  }
}
