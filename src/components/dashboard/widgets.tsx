import { ArrowDown, ArrowUp, BellRing, Boxes, Calculator, CalendarClock, MessageSquareWarning, PackageMinus, Receipt, ServerCrash } from "lucide-react";
import Link from "next/link";

import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";
import { AGING_BUCKETS, AGING_LABELS } from "@/lib/aging";
import { money } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { BucketTotals } from "@/server/services/aging.service";
import { DASHBOARD_RANGES, type Dashboard, type DashboardAlert, type DashboardRange } from "@/server/services/dashboard.service";

const calendar = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const cal = (d: string) => calendar.format(new Date(`${d}T00:00:00Z`));

/** Period tabs (mockup: Today · 7d · 30d · This month), as links so the range lives in the URL. */
export function RangeTabs({ range }: { range: DashboardRange }) {
  return (
    <nav aria-label="Period" className="inline-flex rounded-lg bg-secondary p-1">
      {DASHBOARD_RANGES.map((r) => (
        <Link
          key={r.value}
          href={r.value === "7d" ? "/dashboard" : `/dashboard?range=${r.value}`}
          scroll={false}
          aria-current={r.value === range ? "page" : undefined}
          className={cn(
            "flex h-8 items-center rounded-md px-3 text-small font-medium transition-colors duration-150",
            r.value === range ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {r.label}
        </Link>
      ))}
    </nav>
  );
}

/** "↑ 8.2% vs previous": green when the move is good for the business, red when it is not. */
export function Change({ percent, goodWhen = "up", suffix = "vs previous" }: { percent: number | null; goodWhen?: "up" | "down"; suffix?: string }) {
  if (percent === null) return <span className="text-muted-foreground">No earlier figures to compare</span>;
  if (percent === 0) return <span className="text-muted-foreground">No change {suffix}</span>;
  const up = percent > 0;
  const good = up === (goodWhen === "up");
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn("inline-flex items-center font-medium", good ? "text-success" : "text-danger")}>
        <Icon aria-hidden className="size-3.5" />
        <span className="sr-only">{up ? "Up" : "Down"} </span>
        {Math.abs(percent).toLocaleString("en-NG", { maximumFractionDigits: 1 })}%
      </span>
      <span className="text-muted-foreground">{suffix}</span>
    </span>
  );
}

const AGING_COLOR = ["bg-aging-1", "bg-aging-2", "bg-aging-3", "bg-aging-4", "bg-aging-5"];

/** Receivables aging: one stacked bar (2px gaps between segments) and a legend with amounts and shares. */
export function AgingPanel({ aging, reportHref }: { aging: { total: string; buckets: BucketTotals }; reportHref: string | null }) {
  const total = money(aging.total);
  const share = (amount: string) => (total.gt(0) ? Math.round(money(amount).div(total).times(100).toNumber()) : 0);
  return (
    <section aria-labelledby="aging-heading" className="flex flex-col rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="aging-heading" className="text-h3">Receivables aging</h2>
          <p className="text-small text-muted-foreground">
            <Money value={aging.total} /> outstanding
          </p>
        </div>
        {reportHref && (
          <Button asChild variant="ghost" size="sm">
            <Link href={reportHref}>Report</Link>
          </Button>
        )}
      </div>
      {total.gt(0) ? (
        <>
          <div className="mt-4 flex h-3 w-full gap-0.5 overflow-hidden rounded-full" role="img" aria-label={AGING_BUCKETS.map((b) => `${AGING_LABELS[b]} ${share(aging.buckets[b].amount)}%`).join(", ")}>
            {AGING_BUCKETS.map((b, i) =>
              money(aging.buckets[b].amount).gt(0) ? <span key={b} className={cn("h-full", AGING_COLOR[i])} style={{ width: `${Math.max(1, share(aging.buckets[b].amount))}%` }} /> : null,
            )}
          </div>
          <ul className="mt-4 divide-y divide-border">
            {AGING_BUCKETS.map((b, i) => (
              <li key={b}>
                <Link href={reportHref ? `${reportHref}?bucket=${b}` : "#"} className={cn("flex items-center gap-2 py-2.5 text-body", !reportHref && "pointer-events-none")}>
                  <span aria-hidden className={cn("size-2 shrink-0 rounded-full", AGING_COLOR[i])} />
                  <span className="flex-1">{AGING_LABELS[b]}</span>
                  <Money value={aging.buckets[b].amount} className="tabular-nums" />
                  <span className="w-10 text-right text-muted-foreground tabular-nums">{share(aging.buckets[b].amount)}%</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-6 text-body text-muted-foreground">Nothing owed. Every account is settled.</p>
      )}
    </section>
  );
}

export function DueThisWeek({ rows, total }: { rows: Dashboard["dueThisWeek"]; total: string }) {
  return (
    <section aria-labelledby="due-heading" className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 id="due-heading" className="text-h3">Installments due this week</h2>
          <p className="text-small text-muted-foreground">
            <Money value={total} /> expected in the next 7 days
          </p>
        </div>
        <Button asChild variant="secondary" size="sm">
          <Link href="/ledger/receivables?filter=due_soon">View ledger</Link>
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-body text-muted-foreground">
          <CalendarClock aria-hidden className="mx-auto mb-2 size-5" />
          No instalments fall due this week.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={`${r.invoiceId}-${r.sequence}`} className="flex items-center gap-3 py-2.5 text-body">
              <span className="w-24 shrink-0 text-small text-muted-foreground tabular-nums">{cal(r.dueDate)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{r.customerName}</span>
                <span className="font-mono text-small text-muted-foreground">
                  {r.number} · #{r.sequence}
                </span>
              </span>
              <Money value={r.amount} className="font-medium" />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const ALERT_ICON: Record<DashboardAlert["kind"], typeof Boxes> = { LOW_STOCK: PackageMinus, AGING: Boxes, OVERDUE_BILL: Receipt, FAILED_MESSAGE: MessageSquareWarning, SYSTEM: ServerCrash, CASHUP: Calculator };
const ALERT_TONE: Record<DashboardAlert["kind"], string> = { LOW_STOCK: "text-warning", AGING: "text-warning", OVERDUE_BILL: "text-danger", FAILED_MESSAGE: "text-danger", SYSTEM: "text-danger", CASHUP: "text-warning" };

export function AlertsPanel({ alerts, count }: { alerts: DashboardAlert[]; count: number }) {
  return (
    <section aria-labelledby="alerts-heading" className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="alerts-heading" className="text-h3">Alerts</h2>
        {count > alerts.length && <span className="text-small text-muted-foreground">{alerts.length} of {count}</span>}
      </div>
      {alerts.length === 0 ? (
        <p className="py-6 text-center text-body text-muted-foreground">
          <BellRing aria-hidden className="mx-auto mb-2 size-5" />
          Nothing needs attention.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {alerts.map((a) => {
            const Icon = ALERT_ICON[a.kind];
            return (
              <li key={a.id}>
                <Link href={a.href} className="flex items-start gap-3 py-2.5 hover:bg-muted/50">
                  <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", ALERT_TONE[a.kind])} />
                  <span className="min-w-0">
                    <span className="block text-body font-medium">{a.title}</span>
                    <span className="block truncate text-small text-muted-foreground">{a.detail}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
