import { describe, expect, it } from "vitest";
import { redactText, PiiRedactionGuardrail } from "./piiRedaction.js";

describe("redactText", () => {
  it("redacts emails", () => {
    const { text, count } = redactText("contact jane.doe+x@acme.co for help");
    expect(text).toBe("contact [REDACTED:EMAIL] for help");
    expect(count).toBe(1);
  });

  it("redacts valid credit cards but not random 16-digit numbers", () => {
    const valid = redactText("card: 4242 4242 4242 4242"); // Luhn-valid test number
    expect(valid.text).toContain("[REDACTED:CREDIT_CARD]");
    const invalid = redactText("order id 1234 5678 9012 3456"); // fails Luhn
    expect(invalid.text).toContain("1234 5678 9012 3456");
    expect(invalid.count).toBe(0);
  });

  it("redacts AWS access keys and private key blocks", () => {
    expect(redactText("key AKIAIOSFODNN7EXAMPLE leaked").text).toContain("[REDACTED:AWS_KEY]");
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----";
    expect(redactText(pem).text).toBe("[REDACTED:PRIVATE_KEY]");
  });

  it("redacts SSN and PAN formats", () => {
    expect(redactText("ssn 123-45-6789").text).toContain("[REDACTED:SSN]");
    expect(redactText("pan ABCDE1234F").text).toContain("[REDACTED:PAN]");
  });

  it("leaves clean text alone", () => {
    const { text, count } = redactText("What is the capital of France?");
    expect(text).toBe("What is the capital of France?");
    expect(count).toBe(0);
  });
});

describe("PiiRedactionGuardrail", () => {
  it("counts redactions across messages and preserves structure", () => {
    const g = new PiiRedactionGuardrail();
    const result = g.onRequest(
      [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "email me at a@b.com and ssn 123-45-6789" },
      ],
      { orgId: "o", userId: "u", requestId: "r" },
    );
    expect(result.redactionsApplied).toBe(2);
    expect(result.messages[0]?.content).toBe("You are helpful.");
    expect(result.messages[1]?.content).toBe("email me at [REDACTED:EMAIL] and ssn [REDACTED:SSN]");
  });
});
