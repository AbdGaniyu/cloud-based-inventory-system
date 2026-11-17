import { describe, expect, it } from "vitest";

import { lineCreditValues, returnCredit } from "@/lib/returns";

describe("return credit", () => {
  const invoice = {
    // Phone 1,000,000 + 3 chargers at 15,000; 10,000 invoice discount; VAT 7.5%; 50,000 trade-in.
    subtotal: "1045000.00",
    total: "1061625.00",
    lines: [
      { invoiceItemId: "a-phone", lineTotal: "1000000.00" },
      { invoiceItemId: "b-chargers", lineTotal: "45000.00" },
    ],
  };

  it("values each line at its share of the invoice total, the last line absorbing rounding", () => {
    const values = lineCreditValues(invoice);
    expect(values.get("a-phone")?.toFixed(2)).toBe("1015909.09");
    expect(values.get("b-chargers")?.toFixed(2)).toBe("45715.91");
    expect(values.get("a-phone")?.plus(values.get("b-chargers") ?? 0).toFixed(2)).toBe("1061625.00");
  });

  it("credits partial quantities cumulatively, so returning every unit adds up exactly", () => {
    const chargers = lineCreditValues(invoice).get("b-chargers") ?? "0";
    const first = returnCredit(chargers, 3, 0, 1);
    const second = returnCredit(chargers, 3, 1, 1);
    const third = returnCredit(chargers, 3, 2, 1);
    expect([first, second, third].map((v) => v.toFixed(2))).toEqual(["15238.64", "15238.63", "15238.64"]);
    expect(first.plus(second).plus(third).toFixed(2)).toBe("45715.91");
    expect(() => returnCredit(chargers, 3, 2, 2)).toThrow(RangeError);
  });

  it("returns zero for a free invoice", () => {
    expect(lineCreditValues({ subtotal: "0", total: "0", lines: [{ invoiceItemId: "x", lineTotal: "0" }] }).get("x")?.toFixed(2)).toBe("0.00");
  });
});
