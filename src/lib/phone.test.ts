import { describe, expect, it } from "vitest";

import { randomPublicId } from "@/lib/ids";
import { formatDocumentNumber } from "@/lib/invoice-number";
import { normalizePhone, normalizePhoneOrThrow } from "@/lib/phone";

describe("normalizePhone", () => {
  it.each([
    ["0803 123 4567", "+2348031234567"],
    ["+234 803 123 4567", "+2348031234567"],
    ["2348031234567", "+2348031234567"],
    ["(0)803-123-4567", "+2348031234567"],
    ["+44 7911 123456", "+447911123456"],
  ])("normalises %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it("returns null for invalid numbers", () => {
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("not a phone")).toBeNull();
    expect(() => normalizePhoneOrThrow("12345")).toThrow(RangeError);
  });
});

describe("document numbers", () => {
  it("formats with prefix, branch code and 6-digit sequence", () => {
    expect(formatDocumentNumber("INVOICE", "IKJ", 123)).toBe("INV-IKJ-000123");
    expect(formatDocumentNumber("TRANSFER", "WH", 1)).toBe("TRF-WH-000001");
    expect(formatDocumentNumber("PURCHASE_ORDER", "MAIN", 42)).toBe("PO-MAIN-000042");
  });
});

describe("randomPublicId", () => {
  it("returns base62 IDs of the requested length without collisions in a small sample", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => randomPublicId()));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(id).toMatch(/^[0-9A-Za-z]{10}$/);
  });
});
