import { describe, expect, it } from "vitest";

import { computeInvoiceTotals } from "@/lib/invoice-totals";
import { formatMoney, money, percentOf, round2, splitEvenly, sum, toDb } from "@/lib/money";

describe("money", () => {
  it("refuses floats but accepts integers and decimal strings", () => {
    expect(() => money(0.1)).toThrow(TypeError);
    expect(money(5).toFixed(2)).toBe("5.00");
    expect(money("0.1").plus("0.2").toFixed(2)).toBe("0.30");
  });

  it("accepts Decimal-likes such as Prisma.Decimal", () => {
    expect(money({ toFixed: () => "1234.50" }).toFixed(2)).toBe("1234.50");
  });

  it("rounds half-up to kobo", () => {
    expect(round2("1.005").toFixed(2)).toBe("1.01");
    expect(round2("1.004").toFixed(2)).toBe("1.00");
    expect(toDb("102637.5")).toBe("102637.50");
  });

  it("sums exactly", () => {
    expect(sum(["0.10", "0.20", "0.30"]).toFixed(2)).toBe("0.60");
  });

  it("computes VAT", () => {
    expect(percentOf("1368500", "7.5").toFixed(2)).toBe("102637.50");
  });

  it("splits evenly with the remainder on the last part", () => {
    expect(splitEvenly("100", 3).map((m) => m.toFixed(2))).toEqual(["33.33", "33.33", "33.34"]);
    expect(() => splitEvenly("100", 0)).toThrow(RangeError);
  });

  it("formats naira", () => {
    expect(formatMoney("1350000")).toMatch(/^₦\s?1,350,000\.00$/);
    expect(formatMoney("1350000", { symbol: false })).toBe("1,350,000.00");
  });
});

describe("computeInvoiceTotals", () => {
  it("applies line discount, invoice discount, VAT and trade-in in order", () => {
    const totals = computeInvoiceTotals({
      lines: [
        { quantity: 1, unitPrice: "1350000" },
        { quantity: 1, unitPrice: "3500" },
        { quantity: 1, unitPrice: "15000" },
      ],
      taxRatePercent: "7.5",
      tradeInCredit: "150000",
    });
    expect(totals.subtotal.toFixed(2)).toBe("1368500.00");
    expect(totals.taxAmount.toFixed(2)).toBe("102637.50");
    expect(totals.total.toFixed(2)).toBe("1321137.50");
  });

  it("taxes the amount after the invoice discount", () => {
    const totals = computeInvoiceTotals({
      lines: [{ quantity: 2, unitPrice: "1000", discount: "100" }],
      discount: "100",
      taxRatePercent: "7.5",
    });
    expect(totals.lineTotals[0].toFixed(2)).toBe("1900.00");
    expect(totals.taxAmount.toFixed(2)).toBe("135.00");
    expect(totals.total.toFixed(2)).toBe("1935.00");
  });

  it("rejects discounts and trade-ins larger than what they reduce", () => {
    expect(() =>
      computeInvoiceTotals({ lines: [{ quantity: 1, unitPrice: "100", discount: "101" }], taxRatePercent: "0" }),
    ).toThrow(RangeError);
    expect(() => computeInvoiceTotals({ lines: [{ quantity: 1, unitPrice: "100" }], discount: "101", taxRatePercent: "0" })).toThrow(
      RangeError,
    );
    expect(() =>
      computeInvoiceTotals({ lines: [{ quantity: 1, unitPrice: "100" }], taxRatePercent: "0", tradeInCredit: "100.01" }),
    ).toThrow(RangeError);
  });

  it("rejects empty invoices and bad quantities", () => {
    expect(() => computeInvoiceTotals({ lines: [], taxRatePercent: "7.5" })).toThrow(RangeError);
    expect(() => computeInvoiceTotals({ lines: [{ quantity: 0, unitPrice: "1" }], taxRatePercent: "7.5" })).toThrow(RangeError);
  });
});
