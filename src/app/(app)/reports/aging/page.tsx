import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";

import { FilterChips } from "@/components/filter-chips";
import { Money } from "@/components/money";
import { Pagination } from "@/components/pagination";
import { PageBody } from "@/components/shell/page-body";
import { PageSkeleton } from "@/components/shell/page-skeleton";
import { Button } from "@/components/ui/button";
import { AGING_BUCKETS, AGING_LABELS, type AgingBucket } from "@/lib/aging";
import { money } from "@/lib/money";
import { formatPhoneDisplay } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { can } from "@/server/auth/permissions";
import { requirePageAccess } from "@/server/auth/session";
import { type AgingReport, type BucketTotals, type PayableAgingRow, payablesAging, type ReceivableAgingRow, receivablesAging } from "@/server/services/aging.service";

export const metadata: Metadata = { title: "Aging" };

const PAGE_SIZE = 50;
const paramsSchema = z.object({
  tab: z.enum(["receivables", "payables"]).catch("receivables"),
  bucket: z.enum(AGING_BUCKETS).optional().catch(undefined),
  page: z.coerce.number().int().min(1).optional().catch(undefined),
});
const calendar = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const cal = (d: string | null) => (d ? calendar.format(new Date(`${d}T00:00:00Z`)) : "—");
const AGING_COLOR = ["bg-aging-1", "bg-aging-2", "bg-aging-3", "bg-aging-4", "bg-aging-5"];

export default function AgingPage({ searchParams }: PageProps<"/reports/aging">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

function href(tab: string, bucket?: AgingBucket) {
  const search = new URLSearchParams();
  if (tab !== "receivables") search.set("tab", tab);
  if (bucket) search.set("bucket", bucket);
  const q = search.toString();
  return q ? `/reports/aging?${q}` : "/reports/aging";
}

/** Bucket cards double as filters (DESIGN.md §5.6). */
function BucketCards({ report, tab, active }: { report: { total: string; buckets: BucketTotals }; tab: string; active?: AgingBucket }) {
  const total = money(report.total);
  return (
    <nav aria-label="Aging buckets" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {AGING_BUCKETS.map((b, i) => {
        const selected = active === b;
        const { amount, count } = report.buckets[b];
        return (
          <Link
            key={b}
            href={selected ? href(tab) : href(tab, b)}
            scroll={false}
            aria-current={selected ? "page" : undefined}
            className={cn(
              "rounded-xl border bg-card p-4 transition-colors hover:bg-muted/40",
              selected ? "border-foreground ring-1 ring-foreground" : "border-border",
            )}
          >
            <span className="flex items-center gap-2 text-small text-muted-foreground">
              <span aria-hidden className={cn("size-2 rounded-full", AGING_COLOR[i])} />
              {AGING_LABELS[b]}
            </span>
            <Money value={amount} className={cn("mt-1 block text-h2 font-semibold", i >= 3 && money(amount).gt(0) && "text-danger")} />
            <span className="text-small text-muted-foreground">
              {count} line{count === 1 ? "" : "s"} · {total.gt(0) ? Math.round(money(amount).div(total).times(100).toNumber()) : 0}%
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

function DaysCell({ days }: { days: number }) {
  return days > 0 ? <span className={days > 14 ? "text-danger" : "text-warning"}>{days}</span> : <span className="text-muted-foreground">—</span>;
}

function ReceivablesTable({ rows, linkInvoices }: { rows: ReceivableAgingRow[]; linkInvoices: boolean }) {
  return (
    <table className="w-full text-small">
      <caption className="sr-only">Amounts owed by customers, by instalment</caption>
      <thead className="bg-surface text-caption text-muted-foreground uppercase">
        <tr className="border-b border-border">
          <th scope="col" className="h-10 px-3 text-left font-medium">Customer</th>
          <th scope="col" className="px-3 text-left font-medium">Invoice</th>
          <th scope="col" className="px-3 text-left font-medium">Branch</th>
          <th scope="col" className="px-3 text-left font-medium">Due</th>
          <th scope="col" className="px-3 text-right font-medium">Days overdue</th>
          <th scope="col" className="px-3 text-right font-medium">Owed</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.invoiceId}-${r.sequence ?? 0}`} className={cn("border-b border-border last:border-b-0", r.daysOverdue > 0 && "shadow-[inset_2px_0_0_var(--danger)]")}>
            <td className="px-3 py-2.5">
              <p className="text-body font-medium">{r.customerName}</p>
              <p className="text-muted-foreground tabular-nums">{formatPhoneDisplay(r.customerPhone)}</p>
            </td>
            <td className="px-3 font-mono">
              {linkInvoices ? <Link href={`/invoices/${r.invoiceId}`} className="hover:underline">{r.number}</Link> : r.number}
              {r.sequence !== null && <span className="text-muted-foreground"> #{r.sequence}</span>}
            </td>
            <td className="px-3">{r.branchName}</td>
            <td className="px-3 tabular-nums">{cal(r.dueDate)}</td>
            <td className="px-3 text-right tabular-nums"><DaysCell days={r.daysOverdue} /></td>
            <td className="px-3 text-right"><Money value={r.amount} className="font-medium" /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PayablesTable({ rows }: { rows: PayableAgingRow[] }) {
  return (
    <table className="w-full text-small">
      <caption className="sr-only">Amounts owed to suppliers, by purchase order</caption>
      <thead className="bg-surface text-caption text-muted-foreground uppercase">
        <tr className="border-b border-border">
          <th scope="col" className="h-10 px-3 text-left font-medium">Supplier</th>
          <th scope="col" className="px-3 text-left font-medium">Purchase order</th>
          <th scope="col" className="px-3 text-left font-medium">Branch</th>
          <th scope="col" className="px-3 text-left font-medium">Due</th>
          <th scope="col" className="px-3 text-right font-medium">Days overdue</th>
          <th scope="col" className="px-3 text-right font-medium">Owed</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.purchaseOrderId} className={cn("h-12 border-b border-border last:border-b-0", r.daysOverdue > 0 && "shadow-[inset_2px_0_0_var(--danger)]")}>
            <td className="px-3"><Link href={`/suppliers/${r.supplierId}`} className="text-body font-medium hover:underline">{r.supplierName}</Link></td>
            <td className="px-3 font-mono">{r.number}</td>
            <td className="px-3">{r.branchName}</td>
            <td className="px-3 tabular-nums">{cal(r.dueDate)}</td>
            <td className="px-3 text-right tabular-nums"><DaysCell days={r.daysOverdue} /></td>
            <td className="px-3 text-right"><Money value={r.amount} className="font-medium" /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Upcoming<Row extends { dueDate: string | null; amount: string }>({ report, describe }: { report: AgingReport<Row>; describe: (row: Row) => { key: string; title: string; sub: string } }) {
  return (
    <aside aria-labelledby="upcoming-heading" className="rounded-xl border border-border bg-card p-5 xl:sticky xl:top-6">
      <h2 id="upcoming-heading" className="text-h3">Upcoming in 7 days</h2>
      <p className="mb-3 text-small text-muted-foreground"><Money value={report.upcomingTotal} /> falls due</p>
      {report.upcoming.length === 0 ? (
        <p className="text-body text-muted-foreground">Nothing falls due this week.</p>
      ) : (
        <ul className="divide-y divide-border">
          {report.upcoming.map((r) => {
            const d = describe(r);
            return (
              <li key={d.key} className="flex items-center gap-3 py-2.5 text-body">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{d.title}</span>
                  <span className="block text-small text-muted-foreground">{d.sub} · {cal(r.dueDate)}</span>
                </span>
                <Money value={r.amount} className="font-medium" />
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

/** Aging reports (CLAUDE.md §7.8, DESIGN.md §5.6). */
async function Content({ searchParams }: { searchParams: PageProps<"/reports/aging">["searchParams"] }) {
  const ctx = await requirePageAccess("report.view");
  const raw = await searchParams;
  const params = paramsSchema.parse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])));
  const seesPayables = can(ctx, "payables.view");
  const tab = params.tab === "payables" && seesPayables ? "payables" : "receivables";
  const page = params.page ?? 1;
  const query = { bucket: params.bucket, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE };
  const csvHref = `/api/reports/aging?tab=${tab}${params.bucket ? `&bucket=${params.bucket}` : ""}`;

  const tabs = [
    { label: "Receivables", href: href("receivables"), active: tab === "receivables" },
    ...(seesPayables ? [{ label: "Payables", href: href("payables"), active: tab === "payables" }] : []),
  ];

  const body =
    tab === "payables" ? (
      await (async () => {
        const report = await payablesAging(ctx, query);
        return { report, table: <PayablesTable rows={report.rows} />, upcoming: <Upcoming report={report} describe={(r) => ({ key: r.purchaseOrderId, title: r.supplierName, sub: r.number })} /> };
      })()
    ) : (
      await (async () => {
        const report = await receivablesAging(ctx, query);
        return {
          report,
          table: <ReceivablesTable rows={report.rows} linkInvoices />,
          upcoming: <Upcoming report={report} describe={(r) => ({ key: `${r.invoiceId}-${r.sequence ?? 0}`, title: r.customerName, sub: `${r.number}${r.sequence ? ` #${r.sequence}` : ""}` })} />,
        };
      })()
    );
  const { report } = body;

  return (
    <PageBody className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterChips label="Report" items={tabs} />
        <div className="flex items-center gap-3">
          <span className="text-body text-muted-foreground">
            Total <Money value={report.total} className="font-semibold text-foreground" />
          </span>
          <Button asChild variant="secondary">
            <a href={csvHref} download>
              <Download aria-hidden data-icon="inline-start" /> Export CSV
            </a>
          </Button>
        </div>
      </div>
      <BucketCards report={report} tab={tab} active={params.bucket} />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-label={params.bucket ? AGING_LABELS[params.bucket] : "All lines"} className="min-w-0">
          {report.rows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-body text-muted-foreground">
              {params.bucket ? `Nothing in ${AGING_LABELS[params.bucket].toLowerCase()}.` : tab === "payables" ? "Nothing owed to suppliers." : "No customer owes anything."}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">{body.table}</div>
          )}
          <Pagination page={page} pageSize={PAGE_SIZE} total={report.rowCount} noun="lines" params={{ tab: tab === "receivables" ? undefined : tab, bucket: params.bucket }} />
        </section>
        {body.upcoming}
      </div>
    </PageBody>
  );
}
