import { Tiktoken } from "js-tiktoken/lite";
import cl100k from "js-tiktoken/ranks/cl100k_base";
import type { ChatMessage } from "@openkey/shared";

// Pre-flight estimates feed budget reservations, so `length / 4` is banned:
// under-estimating breaks enforcement, over-estimating blocks real requests.
//
// cl100k_base is exact for GPT-4-era OpenAI/Azure models. For Claude and
// everything else it is an approximation, so estimates carry `approximate`
// and the request log records it — admins can see which numbers are soft.
// (Anthropic's official count-tokens endpoint lands as a cached refinement
// in M7; their published tokenizer package predates Claude 3 and is *less*
// accurate than cl100k in practice.)

const encoder = new Tiktoken(cl100k);

export interface TokenEstimate {
  tokens: number;
  approximate: boolean;
}

export function countText(text: string): number {
  return encoder.encode(text).length;
}

// Matches OpenAI's documented per-message overhead (role framing tokens).
const PER_MESSAGE_OVERHEAD = 4;
const REPLY_PRIMER = 3;

export function estimateInputTokens(messages: ChatMessage[], upstreamModel: string): TokenEstimate {
  let tokens = REPLY_PRIMER;
  for (const m of messages) {
    tokens += PER_MESSAGE_OVERHEAD;
    if (typeof m.content === "string") {
      tokens += countText(m.content);
    } else if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (part.type === "text") tokens += countText(part.text);
        // Vision inputs: charge a conservative flat estimate per image.
        else tokens += 1100;
      }
    }
    if (m.name) tokens += countText(m.name) + 1;
  }
  const exact = /^(gpt-4|gpt-3\.5|o[0-9])/i.test(upstreamModel);
  return { tokens, approximate: !exact };
}
