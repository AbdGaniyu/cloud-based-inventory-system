"use client";

import { ChevronDown, Plus, X } from "lucide-react";

import { METHOD_LABELS, newKey, type PaymentRow, type PlanDraft } from "@/app/(app)/pos/cart";
import { Money } from "@/components/money";
import { Segmented } from "@/components/segmented";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { STORE } from "@/config/store";
import type { InstallmentFrequency, PaymentMethod } from "@/generated/prisma/enums";
import { type CalendarDate, generateInstallmentSchedule } from "@/lib/dates";
import type { Money as MoneyValue } from "@/lib/money";
import { MAX_INSTALLMENTS } from "@/lib/validators/checkout";

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
export const formatCalendarDate = (date: string) => dateFormat.format(new Date(`${date}T00:00:00Z`));

/** Payment rows: method, amount, reference (mockups). Split payments are extra rows. */
export function PaymentRows({
  rows,
  onChange,
  remaining,
  label,
}: {
  rows: PaymentRow[];
  onChange: (rows: PaymentRow[]) => void;
  remaining: MoneyValue;
  label: string;
}) {
  const update = (key: string, patch: Partial<PaymentRow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  function allocate() {
    // Put what's left on the last row (or the first empty one).
    const target = rows.find((r) => !r.amount.trim()) ?? rows[rows.length - 1];
    if (!target) return;
    const current = Number.isNaN(Number(target.amount.replace(/,/g, ""))) ? "0" : target.amount.replace(/,/g, "") || "0";
    const next = remaining.plus(current);
    update(target.key, { amount: next.gt(0) ? next.toFixed(2) : "" });
  }

  return (
    <div className="flex flex-col gap-2" role="group" aria-label={label}>
      {rows.map((row, index) => (
        <div key={row.key} className="flex items-center gap-2">
          <Select value={row.method} onValueChange={(v) => update(row.key, { method: v as PaymentMethod })}>
            <SelectTrigger aria-label={`Payment ${index + 1} method`} className="h-11 w-28 shrink-0 bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(METHOD_LABELS) as PaymentMethod[]).map((m) => (
                <SelectItem key={m} value={m}>
                  {METHOD_LABELS[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative min-w-0 flex-[3]">
            <span aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">{STORE.currencySymbol}</span>
            <Input
              value={row.amount}
              onChange={(e) => update(row.key, { amount: e.target.value })}
              inputMode="decimal"
              placeholder="0.00"
              aria-label={`Payment ${index + 1} amount`}
              className="h-11 bg-background pl-7 text-right tabular-nums"
            />
          </div>
          <Input
            value={row.reference}
            onChange={(e) => update(row.key, { reference: e.target.value })}
            placeholder="Reference"
            aria-label={`Payment ${index + 1} reference`}
            className="h-11 min-w-0 flex-[2] bg-background"
          />
          <button
            type="button"
            onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
            disabled={rows.length === 1 && label !== "Down payment"}
            aria-label={`Remove payment ${index + 1}`}
            className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary disabled:opacity-30"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
      ))}
      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="secondary"
          className="h-11"
          disabled={rows.length >= 6}
          onClick={() => onChange([...rows, { key: newKey("pay"), method: "CASH", amount: "", reference: "" }])}
        >
          <Plus aria-hidden data-icon="inline-start" /> {rows.length ? "Add split" : "Add payment"}
        </Button>
        <p className="flex items-center gap-2 text-body" aria-live="polite">
          <span className="text-muted-foreground">{remaining.lt(0) ? "Over by" : "Remaining"}</span>
          <Money value={remaining.abs()} className={remaining.lt(0) ? "font-semibold text-danger" : "font-semibold"} />
          {remaining.gt(0) && rows.length > 0 && (
            <button type="button" onClick={allocate} className="font-medium underline underline-offset-4">
              Allocate
            </button>
          )}
        </p>
      </div>
    </div>
  );
}

const FREQUENCY_OPTIONS: { value: InstallmentFrequency; label: string }[] = [
  { value: "WEEKLY", label: "Weekly" },
  { value: "BI_WEEKLY", label: "Bi-weekly" },
  { value: "MONTHLY", label: "Monthly" },
];

/** Installment calculator with live schedule preview (DESIGN.md §5.2). */
export function InstallmentCalculator({
  plan,
  onChange,
  financed,
  today,
  approval,
}: {
  plan: PlanDraft;
  onChange: (plan: PlanDraft) => void;
  financed: MoneyValue;
  today: CalendarDate;
  approval: { required: boolean; reasons: string[]; canSelfApprove: boolean };
}) {
  let schedule: ReturnType<typeof generateInstallmentSchedule> = [];
  if (financed.gt(0) && plan.firstDueDate > today) {
    try {
      schedule = generateInstallmentSchedule({
        financedAmount: financed,
        numberOfInstallments: plan.numberOfInstallments,
        frequency: plan.frequency,
        startDate: plan.firstDueDate as CalendarDate,
      });
    } catch {
      // Amount too small to split into that many rows: the preview stays empty and checkout explains why.
      schedule = [];
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-small font-medium">
          Instalments
          <Select value={String(plan.numberOfInstallments)} onValueChange={(v) => onChange({ ...plan, numberOfInstallments: Number(v) })}>
            <SelectTrigger className="h-11 w-full bg-background" aria-label="Number of instalments">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: MAX_INSTALLMENTS }, (_, i) => i + 1).map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex flex-col gap-1.5 text-small font-medium">
          First due date
          <Input type="date" min={today} value={plan.firstDueDate} onChange={(e) => onChange({ ...plan, firstDueDate: e.target.value })} className="h-11 bg-background" />
        </label>
      </div>
      <Segmented label="Frequency" value={plan.frequency} onChange={(frequency) => onChange({ ...plan, frequency })} options={FREQUENCY_OPTIONS} />

      <div className="rounded-xl border border-border bg-background">
        <div className="flex items-center justify-between border-b border-border px-3 py-2 text-small">
          <span>
            Financed <Money value={financed.gt(0) ? financed : "0"} className="font-semibold" />
          </span>
          {schedule[0] && (
            <span>
              <Money value={schedule[0].amountDue} className="font-semibold" /> × {schedule.length}
            </span>
          )}
        </div>
        {schedule.length > 0 ? (
          <table className="w-full text-small">
            <caption className="sr-only">Payment schedule preview</caption>
            <thead className="text-caption text-muted-foreground uppercase">
              <tr>
                <th scope="col" className="px-3 py-1.5 text-left font-medium">#</th>
                <th scope="col" className="px-3 py-1.5 text-left font-medium">Due</th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {schedule.map((row) => (
                <tr key={row.sequence} className="border-t border-border">
                  <td className="px-3 py-1.5 tabular-nums">{row.sequence}</td>
                  <td className="px-3 py-1.5 tabular-nums">{formatCalendarDate(row.dueDate)}</td>
                  <td className="px-3 py-1.5 text-right">
                    <Money value={row.amountDue} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="px-3 py-3 text-small text-muted-foreground">
            {plan.firstDueDate <= today ? "Choose a first due date after today." : "Set a down payment below the total to see the schedule."}
          </p>
        )}
      </div>

      <details className="group rounded-xl border border-border bg-background">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3 text-body font-medium">
          Guarantor and ID (optional)
          <ChevronDown aria-hidden className="size-4 transition-transform group-open:rotate-180" />
        </summary>
        <div className="grid gap-3 border-t border-border p-3 sm:grid-cols-2">
          <Input value={plan.guarantorName} onChange={(e) => onChange({ ...plan, guarantorName: e.target.value })} placeholder="Guarantor name" aria-label="Guarantor name" />
          <Input value={plan.guarantorPhone} onChange={(e) => onChange({ ...plan, guarantorPhone: e.target.value })} placeholder="Guarantor phone" aria-label="Guarantor phone" type="tel" />
          <Input
            className="sm:col-span-2"
            value={plan.idVerificationNotes}
            onChange={(e) => onChange({ ...plan, idVerificationNotes: e.target.value })}
            placeholder="ID checked, e.g. NIN slip sighted"
            aria-label="ID verification notes"
          />
        </div>
      </details>

      {approval.required && (
        <p className="rounded-lg border border-warning-border bg-warning-bg px-3 py-2 text-small text-warning">
          {approval.reasons.join(". ")}.{" "}
          {approval.canSelfApprove ? "You're approving this plan as manager." : "A manager must approve it to complete the sale."}
        </p>
      )}
    </div>
  );
}
