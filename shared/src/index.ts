// Schemas and types shared verbatim between server and client so the two
// can never drift apart. Grows with each milestone.

import { z } from "zod";

export const OPENKEY_KEY_PREFIX = "sk-ok-live-";

export const RoleSchema = z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"]);
export type Role = z.infer<typeof RoleSchema>;

export const ProviderKindSchema = z.enum([
  "bedrock",
  "azure_openai",
  "anthropic",
  "openai",
  "vertex",
  "ollama",
  "mock",
]);
export type ProviderKind = z.infer<typeof ProviderKindSchema>;

// ============ OpenAI-compatible chat completions ============
// Validated at the gateway edge; unknown provider-specific fields are
// deliberately passed through so new upstream features work day one.

const ContentPartSchema = z.union([
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("image_url"),
    image_url: z.object({ url: z.string(), detail: z.string().optional() }),
  }),
]);

export const ChatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.union([z.string(), z.array(ContentPartSchema), z.null()]),
  name: z.string().optional(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatCompletionRequestSchema = z
  .object({
    model: z.string().min(1),
    messages: z.array(ChatMessageSchema).min(1),
    stream: z.boolean().optional(),
    max_tokens: z.number().int().positive().optional(),
    max_completion_tokens: z.number().int().positive().optional(),
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().min(0).max(1).optional(),
    stop: z.union([z.string(), z.array(z.string())]).optional(),
    n: z.literal(1).optional(), // multiple choices are not supported; budget math assumes one
    user: z.string().optional(),
  })
  .passthrough();
export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequestSchema>;

// The gateway always returns OpenAI-shaped errors — clients parse this shape.
export interface OpenAIErrorBody {
  error: {
    message: string;
    type: string;
    param?: string | null;
    code?: string | null;
    // OpenKey extensions for budget errors (machine-readable 429s):
    scope?: "org" | "team" | "user" | "key";
    limit?: number;
    spent?: number;
    reset_at?: string;
    contact?: string;
  };
}
