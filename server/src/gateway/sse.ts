import type { FastifyReply } from "fastify";

// OpenAI-wire-format SSE writer. The shapes here are parsed by every OpenAI
// SDK in existence — do not get creative with them.

export interface UsagePayload {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export function sseHeaders(reply: FastifyReply): void {
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no", // tells nginx not to buffer the stream
  });
}

export function chunkEnvelope(requestId: string, model: string, created: number) {
  return {
    id: `chatcmpl-${requestId}`,
    object: "chat.completion.chunk" as const,
    created,
    model,
  };
}

export function writeChunk(
  reply: FastifyReply,
  envelope: ReturnType<typeof chunkEnvelope>,
  delta: Record<string, unknown>,
  finishReason: string | null,
  usage?: UsagePayload,
): void {
  const body = {
    ...envelope,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...(usage ? { usage } : {}),
  };
  reply.raw.write(`data: ${JSON.stringify(body)}\n\n`);
}

export function writeDone(reply: FastifyReply): void {
  reply.raw.write("data: [DONE]\n\n");
  reply.raw.end();
}

export function completionBody(opts: {
  requestId: string;
  model: string;
  created: number;
  text: string;
  finishReason: string;
  usage: UsagePayload;
}) {
  return {
    id: `chatcmpl-${opts.requestId}`,
    object: "chat.completion" as const,
    created: opts.created,
    model: opts.model,
    choices: [
      {
        index: 0,
        message: { role: "assistant" as const, content: opts.text },
        finish_reason: opts.finishReason,
      },
    ],
    usage: opts.usage,
  };
}
