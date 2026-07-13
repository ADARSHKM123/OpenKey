import type { ChatMessage, ProviderKind } from "@openkey/shared";

// Every provider is translated into this one normalized event stream. The
// handler consumes the SAME iterable whether the client asked for streaming
// or not — one hot path, no parallel code branches to drift apart.

export type StreamEvent =
  | { type: "delta"; text: string }
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      cachedTokens: number;
      reasoningTokens?: number;
    }
  | { type: "done"; finishReason: "stop" | "length" | "content_filter" | "budget_exceeded" };

export interface AdapterRequest {
  model: string; // the UPSTREAM model id, already resolved from the alias
  messages: ChatMessage[];
  maxTokens: number;
  temperature?: number | undefined;
  topP?: number | undefined;
  stop?: string[] | undefined;
}

// Thrown by adapters for upstream failures so the router can distinguish
// retryable (5xx/429/timeout) from terminal (4xx) errors.
export class UpstreamError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

export interface ProviderAdapter {
  readonly kind: ProviderKind;
  // `config` is the decrypted provider credential JSON; adapters must
  // zod-validate it — providers change shapes without warning.
  chat(req: AdapterRequest, config: unknown, signal: AbortSignal): AsyncIterable<StreamEvent>;
}
