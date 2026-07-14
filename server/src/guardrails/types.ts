import type { ChatMessage } from "@openkey/shared";

// Pluggable guardrails, off by default and toggled per org in settings.
// onRequest runs BEFORE the request leaves the network — the transformed
// messages are what the model sees and what gets logged as request_body.
// A company adds its own guardrail (e.g. Bedrock ApplyGuardrail) by
// implementing this interface and registering it.

export interface GuardrailContext {
  orgId: string;
  userId: string;
  requestId: string;
}

export interface GuardrailRequestResult {
  messages: ChatMessage[];
  redactionsApplied: number;
  // Advisory flags land in structured logs, never block by themselves.
  flags: string[];
}

export interface GuardrailPlugin {
  readonly name: string;
  onRequest?(messages: ChatMessage[], ctx: GuardrailContext): GuardrailRequestResult | Promise<GuardrailRequestResult>;
  onResponse?(text: string, ctx: GuardrailContext): string | Promise<string>;
}
