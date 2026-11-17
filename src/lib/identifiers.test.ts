import { describe, expect, it } from "vitest";

import { parseCalendarDate } from "@/lib/dates";
import { checkIdentifier, findDuplicates, isValidImei, parseIdentifierList } from "@/lib/identifiers";
import { intakeAmountPaid, intakeTerms, intakeTotalCost } from "@/lib/validators/intake";
import { money } from "@/lib/money";

describe("IMEI / serial checks", () => {
  it("accepts a valid IMEI and rejects a wrong check digit", () => {
    expect(isValidImei("490154203237518")).toBe(true);
    expect(isValidImei("490154203237519")).toBe(false);
    expect(checkIdentifier("49 015420 323751 8")).toEqual({ ok: true, kind: "IMEI", value: "490154203237518" });
    expect(checkIdentifier("490154203237519")).toMatchObject({ ok: false, reason: expect.stringContaining("check digit") });
  });

  it("flags digit strings that look like IMEIs but have the wrong length", () => {
    expect(checkIdentifier("49015420323751")).toMatchObject({ ok: false, reason: "IMEIs have exactly 15 digits" });
  });

  it("treats other alphanumerics as serials, upper-cased", () => {
    expect(checkIdentifier(" fvfhm3mba0a1 ")).toEqual({ ok: true, kind: "SERIAL", value: "FVFHM3MBA0A1" });
    expect(checkIdentifier("5CG-1234")).toEqual({ ok: true, kind: "SERIAL", value: "5CG-1234" });
    expect(checkIdentifier("ab")).toMatchObject({ ok: false });
    expect(checkIdentifier("bad serial!")).toMatchObject({ ok: false });
  });

  it("parses scanner and spreadsheet paste formats and finds duplicates", () => {
    const list = parseIdentifierList("490154203237518\r\n\n fvfhm3mba0a1 ,490154203237518\tC02X");
    expect(list).toEqual(["490154203237518", "FVFHM3MBA0A1", "490154203237518", "C02X"]);
    expect([...findDuplicates(list)]).toEqual(["490154203237518"]);
  });
});

describe("intake terms", () => {
  const receivedOn = parseCalendarDate("2026-11-17");

  it("computes due dates from net terms", () => {
    expect(intakeTerms({ mode: "CREDIT", netDays: 30 }, receivedOn)).toEqual({ paymentTerms: "NET_30", dueDate: "2026-12-17" });
    expect(
      intakeTerms({ mode: "PARTIAL_DEPOSIT", netDays: 7, amountPaid: "10", method: "CASH" }, receivedOn),
    ).toEqual({ paymentTerms: "PARTIAL_DEPOSIT", dueDate: "2026-11-24" });
    expect(intakeTerms({ mode: "PAID_IN_FULL", method: "BANK_TRANSFER" }, receivedOn)).toEqual({
      paymentTerms: "PAID_IN_FULL",
      dueDate: null,
    });
  });

  it("totals serialized unit costs and accessory quantities exactly", () => {
    const total = intakeTotalCost({
      serializedLines: [{ units: [{ costPrice: "1150000" }, { costPrice: "1149999.99" }] }],
      accessoryLines: [{ quantity: 3, unitCost: "9500.10" }],
    });
    expect(total.toFixed(2)).toBe("2328500.29");
  });

  it("derives the amount paid now from the payment mode", () => {
    const total = money("1000");
    expect(intakeAmountPaid({ mode: "PAID_IN_FULL", method: "CASH" }, total).toFixed(2)).toBe("1000.00");
    expect(intakeAmountPaid({ mode: "CREDIT", netDays: 15 }, total).toFixed(2)).toBe("0.00");
    expect(
      intakeAmountPaid({ mode: "PARTIAL_DEPOSIT", netDays: 15, amountPaid: "250.50", method: "CASH" }, total).toFixed(2),
    ).toBe("250.50");
  });
});

describe("intake schema", () => {
  it("treats a blank accessory selling price as not provided (managers never see that field)", async () => {
    const { accessoryLineSchema } = await import("@/lib/validators/intake");
    const parsed = accessoryLineSchema.parse({
      productId: "019a0000-0000-7000-8000-000000000001",
      quantity: 5,
      unitCost: "9,600",
      unitSellingPrice: "",
    });
    expect(parsed).toEqual({ productId: "019a0000-0000-7000-8000-000000000001", quantity: 5, unitCost: "9600", unitSellingPrice: undefined });
  });
});
