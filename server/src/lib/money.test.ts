import { describe, expect, it } from "vitest";
import { microToUsdString, monthKey, nextMonthResetIso, tokenCostMicro, usdToMicro } from "./money.js";

// Money math is the one place a subtle bug becomes a customer-facing billing
// dispute. These tests pin the integer-only guarantees.

describe("usdToMicro", () => {
  it("parses decimal strings without float drift", () => {
    expect(usdToMicro("0.1")).toBe(100_000);
    expect(usdToMicro("0.000001")).toBe(1);
    expect(usdToMicro("12.345678")).toBe(12_345_678);
    expect(usdToMicro("500")).toBe(500_000_000);
    expect(usdToMicro("-0.5")).toBe(-500_000);
  });

  it("round-trips with microToUsdString", () => {
    for (const s of ["0.000001", "1.000000", "42.123456", "-3.140000"]) {
      expect(microToUsdString(usdToMicro(s))).toBe(
        s.includes(".") ? s.padEnd(s.indexOf(".") + 7, "0") : `${s}.000000`,
      );
    }
  });
});

describe("tokenCostMicro", () => {
  it("computes cost per 1M tokens in integers", () => {
    // 1000 tokens at $3/1M = $0.003 = 3000 micro
    expect(tokenCostMicro(1000, "3.0000")).toBe(3000);
    // 8 tokens at $1/1M = 8 micro
    expect(tokenCostMicro(8, "1.0000")).toBe(8);
  });

  it("rounds UP so reservations never under-estimate", () => {
    // 1 token at $0.15/1M = 0.15 micro → must reserve 1, not 0
    expect(tokenCostMicro(1, "0.1500")).toBe(1);
  });

  it("is exact at large volumes", () => {
    // 10M tokens at $15/1M = $150 exactly
    expect(tokenCostMicro(10_000_000, "15.0000")).toBe(150_000_000);
  });
});

describe("month windows", () => {
  it("uses UTC calendar months", () => {
    expect(monthKey(new Date("2026-07-31T23:59:59Z"))).toBe("2026-07");
    expect(monthKey(new Date("2026-12-15T00:00:00Z"))).toBe("2026-12");
  });

  it("resets on the first of next month, UTC", () => {
    expect(nextMonthResetIso(new Date("2026-07-13T10:00:00Z"))).toBe("2026-08-01T00:00:00.000Z");
    expect(nextMonthResetIso(new Date("2026-12-31T23:59:00Z"))).toBe("2027-01-01T00:00:00.000Z");
  });
});
