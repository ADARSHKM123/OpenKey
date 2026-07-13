import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
  type ConverseStreamCommandInput,
  type Message as BedrockMessage,
  type SystemContentBlock,
} from "@aws-sdk/client-bedrock-runtime";
import { z } from "zod";
import type { ChatMessage } from "@openkey/shared";
import type { AdapterRequest, ProviderAdapter, StreamEvent } from "./types.js";
import { UpstreamError } from "./types.js";

// AWS Bedrock via the Converse API. The AWS SDK handles SigV4 and the binary
// eventstream framing; requests go straight from this process to the
// customer's own AWS account — no intermediary, per the BYOK principle.

const BedrockConfigSchema = z.object({
  region: z.string().min(1),
  // Omit the static keys to use the ambient credential chain (IAM role /
  // instance profile) — the recommended setup inside a VPC.
  accessKeyId: z.string().optional(),
  secretAccessKey: z.string().optional(),
  sessionToken: z.string().optional(),
});
export type BedrockConfig = z.infer<typeof BedrockConfigSchema>;

function contentToText(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!content) return "";
  return content
    .map((p) => (p.type === "text" ? p.text : ""))
    .filter(Boolean)
    .join("\n");
}

function toConverseInput(req: AdapterRequest): Omit<ConverseStreamCommandInput, "modelId"> {
  const system: SystemContentBlock[] = [];
  const messages: BedrockMessage[] = [];

  for (const m of req.messages) {
    const text = contentToText(m.content);
    if (m.role === "system") {
      system.push({ text });
      continue;
    }
    const role = m.role === "assistant" ? "assistant" : "user";
    // Converse requires strictly alternating roles; merge consecutive
    // same-role messages instead of failing the request.
    const prev = messages[messages.length - 1];
    if (prev && prev.role === role) {
      prev.content?.push({ text });
    } else {
      messages.push({ role, content: [{ text }] });
    }
  }

  return {
    ...(system.length > 0 ? { system } : {}),
    messages,
    inferenceConfig: {
      maxTokens: req.maxTokens,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.topP !== undefined ? { topP: req.topP } : {}),
      ...(req.stop !== undefined && req.stop.length > 0 ? { stopSequences: req.stop } : {}),
    },
  };
}

function mapStopReason(reason: string | undefined): "stop" | "length" | "content_filter" {
  if (reason === "max_tokens") return "length";
  if (reason === "content_filtered" || reason === "guardrail_intervened") return "content_filter";
  return "stop";
}

export class BedrockAdapter implements ProviderAdapter {
  readonly kind = "bedrock" as const;
  // One SDK client per distinct credential config; connection pools are warm
  // across requests, which matters at hundreds of concurrent streams.
  private readonly clients = new Map<string, BedrockRuntimeClient>();

  private client(config: BedrockConfig): BedrockRuntimeClient {
    const cacheKey = `${config.region}:${config.accessKeyId ?? "ambient"}`;
    let client = this.clients.get(cacheKey);
    if (!client) {
      client = new BedrockRuntimeClient({
        region: config.region,
        ...(config.accessKeyId && config.secretAccessKey
          ? {
              credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
                ...(config.sessionToken ? { sessionToken: config.sessionToken } : {}),
              },
            }
          : {}),
      });
      this.clients.set(cacheKey, client);
    }
    return client;
  }

  async *chat(req: AdapterRequest, rawConfig: unknown, signal: AbortSignal): AsyncIterable<StreamEvent> {
    const parsed = BedrockConfigSchema.safeParse(rawConfig);
    if (!parsed.success) {
      throw new UpstreamError(500, "bedrock provider credential is malformed", false);
    }
    const client = this.client(parsed.data);

    let response;
    try {
      response = await client.send(
        new ConverseStreamCommand({ modelId: req.model, ...toConverseInput(req) }),
        { abortSignal: signal },
      );
    } catch (err) {
      throw translateAwsError(err);
    }

    if (!response.stream) {
      throw new UpstreamError(502, "bedrock returned no stream", true);
    }

    let finish: "stop" | "length" | "content_filter" = "stop";
    try {
      for await (const event of response.stream) {
        if (signal.aborted) return;
        const delta = event.contentBlockDelta?.delta;
        if (delta && "text" in delta && delta.text) {
          yield { type: "delta", text: delta.text };
        }
        if (event.messageStop) {
          finish = mapStopReason(event.messageStop.stopReason);
        }
        const usage = event.metadata?.usage;
        if (usage) {
          yield {
            type: "usage",
            inputTokens: usage.inputTokens ?? 0,
            outputTokens: usage.outputTokens ?? 0,
            cachedTokens: usage.cacheReadInputTokens ?? 0,
          };
        }
        const streamError =
          event.internalServerException ?? event.modelStreamErrorException ?? event.throttlingException;
        if (streamError) {
          throw new UpstreamError(
            event.throttlingException ? 429 : 502,
            streamError.message ?? "bedrock stream error",
            true,
          );
        }
      }
    } catch (err) {
      if (err instanceof UpstreamError) throw err;
      throw translateAwsError(err);
    }
    yield { type: "done", finishReason: finish };
  }
}

function translateAwsError(err: unknown): UpstreamError {
  const e = err as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
  const status = e.$metadata?.httpStatusCode ?? 502;
  const retryable =
    status >= 500 ||
    status === 429 ||
    e.name === "ThrottlingException" ||
    e.name === "ServiceUnavailableException" ||
    e.name === "TimeoutError";
  return new UpstreamError(status, e.message ?? "bedrock request failed", retryable);
}
