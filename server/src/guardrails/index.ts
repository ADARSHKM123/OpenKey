import type { ChatMessage } from "@openkey/shared";
import type { GuardrailContext, GuardrailPlugin } from "./types.js";
import { PiiRedactionGuardrail } from "./piiRedaction.js";
import { PromptInjectionGuardrail } from "./promptInjection.js";

// Guardrails are org policy, resolved per request from org settings that
// ride the cached key context — no extra I/O on the hot path.

const piiRedaction = new PiiRedactionGuardrail();
const promptInjection = new PromptInjectionGuardrail();

export interface OrgGuardrailSettings {
  redactPii?: boolean;
  detectInjection?: boolean;
}

export async function runGuardrails(
  settings: OrgGuardrailSettings,
  messages: ChatMessage[],
  ctx: GuardrailContext,
): Promise<{ messages: ChatMessage[]; redactionsApplied: number; flags: string[] }> {
  const active: GuardrailPlugin[] = [];
  if (settings.redactPii) active.push(piiRedaction);
  if (settings.detectInjection) active.push(promptInjection);

  let current = messages;
  let redactions = 0;
  const flags: string[] = [];
  for (const plugin of active) {
    if (!plugin.onRequest) continue;
    const result = await plugin.onRequest(current, ctx);
    current = result.messages;
    redactions += result.redactionsApplied;
    flags.push(...result.flags);
  }
  return { messages: current, redactionsApplied: redactions, flags };
}
