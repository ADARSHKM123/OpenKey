import type { ChatMessage } from "@openkey/shared";
import type { GuardrailContext, GuardrailPlugin, GuardrailRequestResult } from "./types.js";

// Heuristic prompt-injection detector. ADVISORY ONLY: it flags, it never
// blocks — heuristics have false positives and an employee's legitimate
// question must not bounce. Flags land in structured logs for review.

const PATTERNS: { name: string; re: RegExp }[] = [
  { name: "ignore_instructions", re: /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts?|rules)/i },
  { name: "reveal_system", re: /(reveal|print|show|repeat)\s+(your\s+)?(system\s+prompt|initial\s+instructions)/i },
  { name: "role_override", re: /you\s+are\s+now\s+(?:in\s+)?(dan|developer\s+mode|jailbreak)/i },
  { name: "exfil_marker", re: /base64\s+encode\s+(all|the)\s+(conversation|context|instructions)/i },
];

export class PromptInjectionGuardrail implements GuardrailPlugin {
  readonly name = "prompt-injection-heuristics";

  onRequest(messages: ChatMessage[], _ctx: GuardrailContext): GuardrailRequestResult {
    const flags: string[] = [];
    for (const m of messages) {
      const text =
        typeof m.content === "string"
          ? m.content
          : (m.content ?? []).map((p) => (p.type === "text" ? p.text : "")).join("\n");
      for (const { name, re } of PATTERNS) {
        if (re.test(text)) flags.push(`injection:${name}`);
      }
    }
    return { messages, redactionsApplied: 0, flags: [...new Set(flags)] };
  }
}
