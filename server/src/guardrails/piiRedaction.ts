import type { ChatMessage } from "@openkey/shared";
import type { GuardrailContext, GuardrailPlugin, GuardrailRequestResult } from "./types.js";

// Pre-flight PII redaction: the redacted body is what leaves the building.
// Patterns are deliberately conservative — a false redaction is annoying, a
// missed credit card is a compliance incident.

interface Rule {
  name: string;
  pattern: RegExp;
  validate?: (match: string) => boolean;
}

// Luhn check keeps 16-digit order numbers from being flagged as cards.
function luhn(raw: string): boolean {
  const digits = raw.replace(/[\s-]/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

const RULES: Rule[] = [
  { name: "EMAIL", pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { name: "CREDIT_CARD", pattern: /\b(?:\d[ -]?){13,19}\b/g, validate: luhn },
  { name: "SSN", pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  // Lookarounds keep this from matching 12-digit runs inside longer numbers
  // (e.g. the first three groups of a 16-digit card/order number).
  { name: "AADHAAR", pattern: /(?<!\d)(?<!\d[\s-])\d{4}\s\d{4}\s\d{4}(?![\s-]?\d)/g },
  { name: "PAN", pattern: /\b[A-Z]{5}\d{4}[A-Z]\b/g },
  // Deliberately conservative: international (+CC …) or 3-3-4 groupings only.
  // Uniform 4-4-4… digit runs are card/ID shaped and handled above.
  { name: "PHONE", pattern: /\+\d{1,3}(?:[\s-]?\d){8,12}\b|(?:\(\d{3}\)|\b\d{3})[\s-]\d{3}[\s-]\d{4}\b(?![\s-]?\d)/g,
    validate: (m) => m.replace(/\D/g, "").length >= 10 },
  { name: "AWS_KEY", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: "AWS_SECRET", pattern: /\baws_secret_access_key\s*[=:]\s*\S+/gi },
  { name: "PRIVATE_KEY", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
];

export function redactText(text: string): { text: string; count: number } {
  let count = 0;
  let out = text;
  for (const rule of RULES) {
    out = out.replace(rule.pattern, (match) => {
      if (rule.validate && !rule.validate(match)) return match;
      count++;
      return `[REDACTED:${rule.name}]`;
    });
  }
  return { text: out, count };
}

export class PiiRedactionGuardrail implements GuardrailPlugin {
  readonly name = "pii-redaction";

  onRequest(messages: ChatMessage[], _ctx: GuardrailContext): GuardrailRequestResult {
    let total = 0;
    const redacted = messages.map((m) => {
      if (typeof m.content === "string") {
        const { text, count } = redactText(m.content);
        total += count;
        return count > 0 ? { ...m, content: text } : m;
      }
      if (Array.isArray(m.content)) {
        let changed = false;
        const parts = m.content.map((p) => {
          if (p.type !== "text") return p;
          const { text, count } = redactText(p.text);
          if (count === 0) return p;
          total += count;
          changed = true;
          return { ...p, text };
        });
        return changed ? { ...m, content: parts } : m;
      }
      return m;
    });
    return { messages: redacted, redactionsApplied: total, flags: [] };
  }
}
