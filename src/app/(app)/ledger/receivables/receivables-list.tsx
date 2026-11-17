"use client";

import { BellRing, Eye, HandCoins, MoreHorizontal, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { sendReminder } from "@/app/(app)/invoices/actions";
import { toggleReminders } from "@/app/(app)/ledger/actions";
import { EmptyState } from "@/components/empty-state";
import { IdentifierChip } from "@/components/identifier-chip";
import { RecordPaymentSheet } from "@/components/ledger/record-payment-sheet";
import { Money } from "@/components/money";
import { CHANNEL_LABEL } from "@/components/notifications/use-messages";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { InvoiceStatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { formatPhoneDisplay } from "@/lib/phone";
import { cn } from "@/lib/utils";
import type { ReceivableRow } from "@/server/services/ledger.service";

const calendar = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const cal = (d: string) => calendar.format(new Date(`${d}T00:00:00Z`));
const GAUGE_TICKS = 12;
/** Server and browser Math.sin differ in the last digit; rounding keeps hydration identical. */
const px = (n: number) => Math.round(n * 100) / 100;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase();
}

/** Half-ring of ticks filled to the paid share (mockup): green when paid, amber from half, red below. */
function PaidGauge({ percent }: { percent: number }) {
  const filled = Math.round((percent / 100) * GAUGE_TICKS);
  const tone = percent >= 100 ? "var(--success)" : percent >= 50 ? "var(--warning)" : "var(--danger)";
  return (
    <svg viewBox="0 0 64 36" className="h-9 w-16 shrink-0" aria-hidden>
      {Array.from({ length: GAUGE_TICKS }, (_, i) => {
        const angle = Math.PI - (i / (GAUGE_TICKS - 1)) * Math.PI;
        const [cx, cy, r1, r2] = [32, 32, 20, 28];
        return (
          <line
            key={i}
            x1={px(cx + r1 * Math.cos(angle))}
            y1={px(cy - r1 * Math.sin(angle))}
            x2={px(cx + r2 * Math.cos(angle))}
            y2={px(cy - r2 * Math.sin(angle))}
            stroke={i < filled ? tone : "var(--border)"}
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        );
      })}
    </svg>
  );
}

function DueText({ row }: { row: ReceivableRow }) {
  if (row.balance === "0.00" || row.nextDueDate === null || row.dueInDays === null) {
    return (
      <div>
        <p className="text-small text-muted-foreground">{row.balance === "0.00" ? "Completed" : "No schedule"}</p>
        <p className="text-body">—</p>
      </div>
    );
  }
  const d = row.dueInDays;
  const label = d > 0 ? `${d} day${d === 1 ? "" : "s"} overdue` : d === 0 ? "Due today" : `Due in ${-d} day${d === -1 ? "" : "s"}`;
  return (
    <div>
      <p className={cn("text-small", d > 0 ? "text-danger" : d >= -3 ? "text-warning" : "text-muted-foreground")}>{label}</p>
      <p className="text-body font-medium tabular-nums">{cal(row.nextDueDate)}</p>
    </div>
  );
}

function RemindersSwitch({ row, compact = false }: { row: ReceivableRow; compact?: boolean }) {
  const [checked, setChecked] = useState(row.remindersEnabled ?? false);
  const [pending, startTransition] = useTransition();
  if (row.remindersEnabled === null) return <span aria-hidden />;
  const id = `reminders-${row.invoiceId}${compact ? "-compact" : ""}`;
  return (
    <div className={compact ? "flex flex-row-reverse items-center gap-2" : "flex flex-col items-start gap-1"}>
      <label htmlFor={id} className="text-small text-muted-foreground">
        Reminders
      </label>
      <Switch
        id={id}
        checked={checked}
        disabled={!row.canManageReminders || pending}
        title={row.canManageReminders ? undefined : "Managers switch automatic reminders on or off"}
        onCheckedChange={(next) => {
          setChecked(next);
          startTransition(async () => {
            const result = await toggleReminders({ invoiceId: row.invoiceId, enabled: next });
            if (!result.ok) {
              setChecked(!next);
              toast.error(result.error);
            } else toast.success(`Automatic reminders ${next ? "on" : "off"} for ${row.number}`);
          });
        }}
      />
    </div>
  );
}

/** Receivables ledger rows (mockup: receivables). One Record payment sheet serves every row. */
export function ReceivablesList({ rows, canSend }: { rows: ReceivableRow[]; canSend: boolean }) {
  const router = useRouter();
  const [payingId, setPayingId] = useState<string | null>(null);

  async function remind(row: ReceivableRow) {
    const result = await sendReminder(row.invoiceId);
    if (!result.ok) return toast.error(result.error);
    toast.success(result.data.created ? `Reminder queued to ${CHANNEL_LABEL[result.data.channel]}` : "Reminder was already sent a moment ago");
    router.refresh();
  }

  if (rows.length === 0) {
    return <EmptyState icon={HandCoins} title="No accounts here" description="Instalment sales and invoices with a balance appear here." />;
  }

  return (
    <>
      <ul className="flex flex-col gap-2" aria-label="Customer accounts">
        {rows.map((row) => {
          const open = row.balance !== "0.00";
          const overdue = row.status === "OVERDUE";
          return (
            <li
              key={row.invoiceId}
              className={cn(
                "grid items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-card px-4 py-3",
                "grid-cols-[minmax(0,1fr)_auto] xl:grid-cols-[minmax(176px,1fr)_124px_minmax(108px,auto)_112px_112px_108px_64px_auto]",
                overdue && "shadow-[inset_2px_0_0_var(--danger)]",
              )}
            >
              <div className="flex min-w-0 items-center gap-3">
                <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-secondary text-small font-semibold">
                  {initials(row.customerName)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-body font-medium">{row.customerName}</p>
                  <p className="text-small whitespace-nowrap text-muted-foreground tabular-nums">{formatPhoneDisplay(row.customerPhone)}</p>
                </div>
              </div>
              <div className="hidden xl:block">
                <IdentifierChip value={row.number} copyable={false} />
                <p className="mt-1 text-small text-muted-foreground">{row.branchName}</p>
              </div>
              <div className="hidden items-center gap-2 xl:flex">
                <div>
                  <p className="text-small text-muted-foreground">
                    Paid <span className="font-medium text-foreground">{row.paidPercent}%</span>
                  </p>
                  <Money value={row.amountPaid} className="text-body font-medium" />
                </div>
                <span className="hidden 2xl:block">
                  <PaidGauge percent={row.paidPercent} />
                </span>
              </div>
              <div className="hidden text-right xl:block">
                <p className="text-small text-muted-foreground">Balance</p>
                <Money value={row.balance} className="text-body font-semibold" tone={overdue ? "danger" : undefined} />
              </div>
              <div className="hidden xl:block">
                <DueText row={row} />
              </div>
              <div className="hidden xl:block">
                <InvoiceStatusBadge status={row.status} />
              </div>
              <div className="hidden xl:block">
                <RemindersSwitch row={row} />
              </div>
              <div className="flex items-center justify-end gap-1">
                {open && (
                  <Button type="button" variant="secondary" size="sm" onClick={() => setPayingId(row.invoiceId)}>
                    Record payment
                  </Button>
                )}
                {row.canView && (
                  <Button asChild variant="ghost" size="icon" aria-label={`Open ${row.number}`}>
                    <Link href={`/invoices/${row.invoiceId}`}>
                      <Eye aria-hidden />
                    </Link>
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="ghost" size="icon" aria-label={`More for ${row.number}`}>
                      <MoreHorizontal aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem asChild>
                      <Link href={`/customers/${row.customerId}`}>
                        <UserRound aria-hidden /> View customer
                      </Link>
                    </DropdownMenuItem>
                    {open && canSend && row.canView && (
                      <DropdownMenuItem onSelect={() => void remind(row)}>
                        <BellRing aria-hidden /> Send reminder now
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {/* Below 1280px: the same facts on one wrapping line. */}
              <div className="col-span-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-small text-muted-foreground xl:hidden">
                <span className="font-mono">{row.number}</span>
                <span>{row.branchName}</span>
                <span>
                  Paid {row.paidPercent}% · Balance <Money value={row.balance} className="font-medium text-foreground" />
                </span>
                <InvoiceStatusBadge status={row.status} />
                {row.nextDueDate && row.balance !== "0.00" && <span>Next due {cal(row.nextDueDate)}</span>}
                {row.remindersEnabled !== null && <RemindersSwitch row={row} compact />}
              </div>
            </li>
          );
        })}
      </ul>
      <RecordPaymentSheet invoiceId={payingId} onClose={() => setPayingId(null)} />
    </>
  );
}
