import { describe, expect, it } from "vitest";

import { installmentApproval } from "@/lib/installments";
import { checkoutSchema } from "@/lib/validators/checkout";

const rules = { threshold: "1000000", minDownPaymentPercent: "30" };

describe("installmentApproval", () => {
  it("needs no approval when the plan is within limits", () => {
    expect(installmentApproval({ total: "1343750", downPayment: "403125", ...rules })).toEqual({ required: false, reasons: [] });
  });

  it("flags plans financing more than the threshold", () => {
    const result = installmentApproval({ total: "1827500", downPayment: "731000", ...rules });
    expect(result.required).toBe(true);
    expect(result.reasons[0]).toMatch(/Financed amount is above/);
  });

  it("flags down payments below the minimum percentage, exactly at the boundary too", () => {
    expect(installmentApproval({ total: "1000", downPayment: "299.99", ...rules }).required).toBe(true);
    expect(installmentApproval({ total: "1000", downPayment: "300", ...rules }).required).toBe(false);
  });
});

describe("checkoutSchema", () => {
  const base = {
    customerId: "019a0000-0000-7000-8000-000000000001",
    lines: [{ kind: "unit", unitId: "019a0000-0000-7000-8000-000000000002" }],
    payment: { type: "FULL", payments: [{ method: "CASH", amount: "1,000" }] },
  };

  it("accepts a cash sale and normalises amounts", () => {
    const parsed = checkoutSchema.parse(base);
    expect(parsed.payment.type === "FULL" && parsed.payment.payments[0].amount).toBe("1000");
  });

  it("requires a customer and at least one line", () => {
    expect(checkoutSchema.safeParse({ ...base, customerId: "" }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, lines: [] }).success).toBe(false);
  });

  it("requires model and IMEI when a trade-in goes into stock", () => {
    const tradeIn = { description: "iPhone 11", condition: "UK_USED", creditAmount: "150000", addToStock: true };
    expect(checkoutSchema.safeParse({ ...base, tradeIn }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, tradeIn: { ...tradeIn, addToStock: false } }).success).toBe(true);
  });
});
