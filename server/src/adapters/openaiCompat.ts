import { z } from "zod";
import type { ProviderKind } from "@openkey/shared";
import type { AdapterRequest, ProviderAdapter, StreamEvent } from "./types.js";
import { UpstreamError } from "./types.js";
import { parseSse } from "../lib/sse-parse.js";

// One adapter serves every OpenAI-wire-compatible upstream: OpenAI itself,
// Azure OpenAI (different URL scheme + auth header), and Ollama (no auth).
// Always streams upstream — the handler aggregates when the client didn't
// ask for a stream, keeping a single code path.

const OpenAIConfigSchema = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.string().url().default("https://api.openai.com/v1"),
});

const AzureConfigSchema = z.object({
  endpoint: z.string().url(), // https://myresource.openai.azure.com
  apiKey: z.string().min(1),
  apiVersion: z.string().default("2024-10-21"),
});

const OllamaConfigSchema = z.object({
  baseUrl: z.string().url(), // http://ollama:11434
});

interface WireTarget {
  url: string;
  headers: Record<string, string>;
}

function target(kind: ProviderKind, rawConfig: unknown, model: string): WireTarget {
  switch (kind) {
    case "openai": {
      const cfg = parseConfig(OpenAIConfigSchema, rawConfig, kind);
      return {
        url: `${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`,
        headers: { authorization: `Bearer ${cfg.apiKey}` },
      };
    }
    case "azure_openai": {
      const cfg = parseConfig(AzureConfigSchema, rawConfig, kind);
      // In Azure the "model" is the deployment name in the path.
      return {
        url: `${cfg.endpoint.replace(/\/$/, "")}/openai/deployments/${encodeURIComponent(model)}/chat/completions?api-version=${encodeURIComponent(cfg.apiVersion)}`,
        headers: { "api-key": cfg.apiKey },
      };
    }
    case "ollama": {
      const cfg = parseConfig(OllamaConfigSchema, rawConfig, kind);
      return { url: `${cfg.baseUrl.replace(/\/$/, "")}/v1/chat/completions`, headers: {} };
    }
    default:
      throw new UpstreamError(500, `openaiCompat cannot serve provider '${kind}'`, false);
  }
}

function parseConfig<S extends z.ZodTypeAny>(schema: S, raw: unknown, kind: string): z.output<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new UpstreamError(500, `${kind} provider credential is malformed`, false);
  }
  return parsed.data;
}

// Zod-validate what the provider sends back — shapes change without warning.
const ChunkSchema = z
  .object({
    choices: z
      .array(
        z
          .object({
            delta: z.object({ content: z.string().nullish() }).passthrough().nullish(),
            finish_reason: z.string().nullish(),
          })
          .passthrough(),
      )
      .default([]),
    usage: z
      .object({
        prompt_tokens: z.number().default(0),
        completion_tokens: z.number().default(0),
        prompt_tokens_details: z.object({ cached_tokens: z.number().default(0) }).passthrough().nullish(),
        completion_tokens_details: z.object({ reasoning_tokens: z.number().default(0) }).passthrough().nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

function mapFinish(reason: string | null | undefined): "stop" | "length" | "content_filter" {
  if (reason === "length") return "length";
  if (reason === "content_filter") return "content_filter";
  return "stop";
}

export class OpenAICompatAdapter implements ProviderAdapter {
  constructor(readonly kind: ProviderKind) {}

  async *chat(req: AdapterRequest, rawConfig: unknown, signal: AbortSignal): AsyncIterable<StreamEvent> {
    const { url, headers } = target(this.kind, rawConfig, req.model);

    const body = {
      model: req.model,
      messages: req.messages,
      max_tokens: req.maxTokens,
      stream: true,
      stream_options: { include_usage: true },
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.topP !== undefined ? { top_p: req.topP } : {}),
      ...(req.stop !== undefined && req.stop.length > 0 ? { stop: req.stop } : {}),
    };

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (signal.aborted) return;
      throw new UpstreamError(502, `${this.kind} request failed: ${(err as Error).message}`, true);
    }

    if (!res.ok) {
      const detail = await safeErrorMessage(res);
      throw new UpstreamError(res.status, `${this.kind}: ${detail}`, res.status === 429 || res.status >= 500);
    }
    if (!res.body) throw new UpstreamError(502, `${this.kind} returned no body`, true);

    let finish: "stop" | "length" | "content_filter" = "stop";
    for await (const evt of parseSse(res.body)) {
      if (signal.aborted) return;
      if (evt.data === "[DONE]") break;
      let json: unknown;
      try {
        json = JSON.parse(evt.data);
      } catch {
        continue; // tolerate provider noise between events
      }
      const chunk = ChunkSchema.safeParse(json);
      if (!chunk.success) continue;

      const choice = chunk.data.choices[0];
      if (choice?.delta?.content) yield { type: "delta", text: choice.delta.content };
      if (choice?.finish_reason) finish = mapFinish(choice.finish_reason);
      if (chunk.data.usage) {
        yield {
          type: "usage",
          inputTokens: chunk.data.usage.prompt_tokens,
          outputTokens: chunk.data.usage.completion_tokens,
          cachedTokens: chunk.data.usage.prompt_tokens_details?.cached_tokens ?? 0,
          reasoningTokens: chunk.data.usage.completion_tokens_details?.reasoning_tokens ?? 0,
        };
      }
    }
    yield { type: "done", finishReason: finish };
  }
}

async function safeErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body.error?.message ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}
