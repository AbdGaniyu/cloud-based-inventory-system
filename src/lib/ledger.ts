import type { CalendarDate } from "@/lib/dates";
import { money, type Money, type MoneyInput, ZERO } from "@/lib/money";

/**
 * Installment ledger maths, shared by the server (inside the payment transaction) and the Record
 * payment sheet (the "After this payment" preview). Allocations are recomputed from ledger totals
 * every time, so reversals and waivers can never leave a row out of step with the payments.
 */

export type ScheduleStatus = "PENDING" | "PARTIAL" | "PAID" | "OVERDUE" | "WAIVED";
export type InvoiceLedgerStatus = "UNPAID" | "PARTIALLY_PAID" | "PAID" | "VOID" | "RETURNED";

export type ScheduleInput = { sequence: number; dueDate: CalendarDate; amountDue: MoneyInput };
export type AllocatedRow = { sequence: number; dueDate: CalendarDate; amountDue: string; amountPaid: string; amountWaived: string; status: ScheduleStatus };

function statusOf(due: Money, paid: Money, waived: Money, dueDate: CalendarDate, today: CalendarDate): ScheduleStatus {
  if (waived.gte(due)) return "WAIVED";
  if (paid.plus(waived).gte(due)) return "PAID";
  if (dueDate < today) return "OVERDUE";
  return paid.gt(0) ? "PARTIAL" : "PENDING";
}

const minMoney = (a: Money, b: Money): Money => (a.lt(b) ? a : b);

const settled = (status: ScheduleStatus) => status === "PAID" || status === "WAIVED";

/**
 * Waivers cover the newest rows first (the debt forgiven is the tail of the plan); instalment
 * payments then fill the oldest rows first, overpayment rolling into the next row.
 * `previous` (the rows before this change) lets callers tell which rows a payment newly settles.
 */
export function allocateSchedule(
  schedule: readonly ScheduleInput[],
  totals: { paid: MoneyInput; waived: MoneyInput; today: CalendarDate },
  previous?: readonly Pick<AllocatedRow, "sequence" | "status">[],
): { rows: AllocatedRow[]; nextDueDate: CalendarDate | null; newlySettled: number[] } {
  const ordered = [...schedule].sort((a, b) => a.sequence - b.sequence);
  const capacity = ordered.reduce((acc, r) => acc.plus(money(r.amountDue)), ZERO);
  let paidLeft = money(totals.paid);
  let waivedLeft = money(totals.waived);
  if (paidLeft.lt(0) || waivedLeft.lt(0) || paidLeft.plus(waivedLeft).gt(capacity)) {
    throw new RangeError("Payments and waivers exceed the instalment schedule");
  }

  const waivedBySequence = new Map<number, Money>();
  for (const row of [...ordered].reverse()) {
    const take = minMoney(waivedLeft, money(row.amountDue));
    waivedBySequence.set(row.sequence, take);
    waivedLeft = waivedLeft.minus(take);
  }

  const rows = ordered.map((row) => {
    const due = money(row.amountDue);
    const waived = waivedBySequence.get(row.sequence) ?? ZERO;
    const paid = minMoney(paidLeft, due.minus(waived));
    paidLeft = paidLeft.minus(paid);
    return {
      sequence: row.sequence,
      dueDate: row.dueDate,
      amountDue: due.toFixed(2),
      amountPaid: paid.toFixed(2),
      amountWaived: waived.toFixed(2),
      status: statusOf(due, paid, waived, row.dueDate, totals.today),
    };
  });

  const wasSettled = new Set((previous ?? []).filter((r) => settled(r.status)).map((r) => r.sequence));
  return {
    rows,
    nextDueDate: rows.find((r) => !settled(r.status))?.dueDate ?? null,
    newlySettled: rows.filter((r) => settled(r.status) && !wasSettled.has(r.sequence)).map((r) => r.sequence),
  };
}

/** Invoice status from its cached totals. VOID and RETURNED are terminal and set by their own flows. */
export function deriveInvoiceStatus(current: InvoiceLedgerStatus, totals: { amountPaid: MoneyInput; balance: MoneyInput }): InvoiceLedgerStatus {
  if (current === "VOID" || current === "RETURNED") return current;
  if (money(totals.balance).lte(0)) return "PAID";
  return money(totals.amountPaid).gt(0) ? "PARTIALLY_PAID" : "UNPAID";
}
