import { describe, expect, it } from "vitest";

import { allocateSchedule, deriveInvoiceStatus, type ScheduleInput } from "@/lib/ledger";

const rows: ScheduleInput[] = [
  { sequence: 1, dueDate: "2026-12-01", amountDue: "100000.00" },
  { sequence: 2, dueDate: "2027-01-01", amountDue: "100000.00" },
  { sequence: 3, dueDate: "2027-02-01", amountDue: "100000.03" },
];
const view = (r: ReturnType<typeof allocateSchedule>["rows"]) => r.map((x) => `${x.sequence}:${x.amountPaid}/${x.amountWaived}:${x.status}`);

describe("allocateSchedule", () => {
  it("applies payments to the oldest row first and rolls the overpayment into the next", () => {
    const result = allocateSchedule(rows, { paid: "150000", waived: "0", today: "2026-11-20" });
    expect(view(result.rows)).toEqual(["1:100000.00/0.00:PAID", "2:50000.00/0.00:PARTIAL", "3:0.00/0.00:PENDING"]);
    expect(result.nextDueDate).toBe("2027-01-01");
    expect(result.newlySettled).toEqual([1]);
  });

  it("marks past-due rows that are not fully covered as overdue, even when part paid", () => {
    const result = allocateSchedule(rows, { paid: "40000", waived: "0", today: "2027-01-05" });
    expect(view(result.rows)).toEqual(["1:40000.00/0.00:OVERDUE", "2:0.00/0.00:OVERDUE", "3:0.00/0.00:PENDING"]);
    expect(result.nextDueDate).toBe("2026-12-01");
  });

  it("is due on its due date, not overdue", () => {
    expect(allocateSchedule(rows, { paid: "0", waived: "0", today: "2026-12-01" }).rows[0].status).toBe("PENDING");
  });

  it("applies waivers to the newest rows first, so waived rows are never chased", () => {
    const result = allocateSchedule(rows, { paid: "100000", waived: "150000.03", today: "2026-11-20" });
    expect(view(result.rows)).toEqual(["1:100000.00/0.00:PAID", "2:0.00/50000.00:PENDING", "3:0.00/100000.03:WAIVED"]);
    expect(result.nextDueDate).toBe("2027-01-01");
    const settled = allocateSchedule(rows, { paid: "100000", waived: "200000.03", today: "2026-11-20" });
    expect(settled.rows.map((r) => r.status)).toEqual(["PAID", "WAIVED", "WAIVED"]);
    expect(settled.nextDueDate).toBeNull();
  });

  it("reports which rows a payment would settle, given what was already settled", () => {
    const before = allocateSchedule(rows, { paid: "100000", waived: "0", today: "2026-11-20" });
    const after = allocateSchedule(rows, { paid: "300000.03", waived: "0", today: "2026-11-20" }, before.rows);
    expect(after.newlySettled).toEqual([2, 3]);
    expect(after.nextDueDate).toBeNull();
  });

  it("rejects allocations larger than the schedule", () => {
    expect(() => allocateSchedule(rows, { paid: "300000.04", waived: "0", today: "2026-11-20" })).toThrow(RangeError);
  });
});

describe("deriveInvoiceStatus", () => {
  it("follows the ledger: unpaid, partially paid, paid; void and returned stay as they are", () => {
    expect(deriveInvoiceStatus("UNPAID", { amountPaid: "0", balance: "500" })).toBe("UNPAID");
    expect(deriveInvoiceStatus("UNPAID", { amountPaid: "100", balance: "400" })).toBe("PARTIALLY_PAID");
    expect(deriveInvoiceStatus("PARTIALLY_PAID", { amountPaid: "400", balance: "0" })).toBe("PAID");
    expect(deriveInvoiceStatus("PARTIALLY_PAID", { amountPaid: "0", balance: "0" })).toBe("PAID");
    expect(deriveInvoiceStatus("VOID", { amountPaid: "0", balance: "0" })).toBe("VOID");
    expect(deriveInvoiceStatus("RETURNED", { amountPaid: "0", balance: "0" })).toBe("RETURNED");
  });
});
