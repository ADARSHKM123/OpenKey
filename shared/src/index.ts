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
