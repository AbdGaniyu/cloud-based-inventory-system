import { describe, expect, it } from "vitest";

import {
  addDays,
  addMonths,
  calendarDateInStoreTz,
  daysBetween,
  fromDbDate,
  generateInstallmentSchedule,
  parseCalendarDate,
  storeInstant,
  toDbDate,
} from "@/lib/dates";
import { sum } from "@/lib/money";

describe("calendar helpers", () => {
  it("rejects impossible dates", () => {
    expect(() => parseCalendarDate("2026-02-30")).toThrow(RangeError);
    expect(() => parseCalendarDate("17/11/2026")).toThrow(RangeError);
  });

  it("resolves the Lagos calendar date, not the UTC one", () => {
    // 23:30 UTC on 16 Nov is 00:30 on 17 Nov in Lagos (UTC+1).
    expect(calendarDateInStoreTz(new Date("2026-11-16T23:30:00Z"))).toBe("2026-11-17");
    expect(calendarDateInStoreTz(new Date("2026-11-16T22:59:00Z"))).toBe("2026-11-16");
  });

  it("round-trips @db.Date values", () => {
    const d = parseCalendarDate("2026-03-01");
    expect(toDbDate(d).toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(fromDbDate(toDbDate(d))).toBe(d);
  });

  it("adds days across month and year boundaries", () => {
    expect(addDays(parseCalendarDate("2026-12-30"), 3)).toBe("2027-01-02");
    expect(addDays(parseCalendarDate("2026-03-01"), -1)).toBe("2026-02-28");
  });

  it("clamps month addition to the end of shorter months", () => {
    expect(addMonths(parseCalendarDate("2026-01-31"), 1)).toBe("2026-02-28");
    expect(addMonths(parseCalendarDate("2028-01-31"), 1)).toBe("2028-02-29");
    expect(addMonths(parseCalendarDate("2026-10-31"), 4)).toBe("2027-02-28");
  });

  it("counts days between dates", () => {
    expect(daysBetween(parseCalendarDate("2026-11-01"), parseCalendarDate("2026-11-17"))).toBe(16);
    expect(daysBetween(parseCalendarDate("2026-11-17"), parseCalendarDate("2026-11-01"))).toBe(-16);
  });

  it("builds a store-timezone instant", () => {
    expect(storeInstant(parseCalendarDate("2026-11-17"), 9, 0).toISOString()).toBe("2026-11-17T08:00:00.000Z");
  });
});

describe("generateInstallmentSchedule", () => {
  it("splits evenly and lets the last instalment absorb rounding", () => {
    const rows = generateInstallmentSchedule({
      financedAmount: "940625.00",
      numberOfInstallments: 6,
      frequency: "BI_WEEKLY",
      startDate: parseCalendarDate("2026-10-22"),
    });
    expect(rows.map((r) => r.amountDue.toFixed(2))).toEqual([
      "156770.83",
      "156770.83",
      "156770.83",
      "156770.83",
      "156770.83",
      "156770.85",
    ]);
    expect(sum(rows.map((r) => r.amountDue)).toFixed(2)).toBe("940625.00");
  });

  it("numbers rows from 1 and spaces bi-weekly rows 14 days apart", () => {
    const rows = generateInstallmentSchedule({
      financedAmount: "1000",
      numberOfInstallments: 3,
      frequency: "BI_WEEKLY",
      startDate: parseCalendarDate("2026-12-20"),
    });
    expect(rows.map((r) => [r.sequence, r.dueDate])).toEqual([
      [1, "2026-12-20"],
      [2, "2027-01-03"],
      [3, "2027-01-17"],
    ]);
  });

  it("spaces weekly rows 7 days apart", () => {
    const rows = generateInstallmentSchedule({
      financedAmount: "300",
      numberOfInstallments: 3,
      frequency: "WEEKLY",
      startDate: parseCalendarDate("2026-11-17"),
    });
    expect(rows.map((r) => r.dueDate)).toEqual(["2026-11-17", "2026-11-24", "2026-12-01"]);
  });

  it("anchors monthly rows to the start date so month-end clamping does not drift", () => {
    const rows = generateInstallmentSchedule({
      financedAmount: "400",
      numberOfInstallments: 4,
      frequency: "MONTHLY",
      startDate: parseCalendarDate("2026-01-31"),
    });
    expect(rows.map((r) => r.dueDate)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("never produces a negative or zero last row", () => {
    const rows = generateInstallmentSchedule({
      financedAmount: "0.05",
      numberOfInstallments: 4,
      frequency: "WEEKLY",
      startDate: parseCalendarDate("2026-11-17"),
    });
    expect(rows.map((r) => r.amountDue.toFixed(2))).toEqual(["0.01", "0.01", "0.01", "0.02"]);
  });

  it("rejects amounts too small to split", () => {
    expect(() =>
      generateInstallmentSchedule({
        financedAmount: "0.03",
        numberOfInstallments: 4,
        frequency: "WEEKLY",
        startDate: parseCalendarDate("2026-11-17"),
      }),
    ).toThrow(RangeError);
  });
});
