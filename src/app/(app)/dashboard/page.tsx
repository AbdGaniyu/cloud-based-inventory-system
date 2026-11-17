import type { Metadata } from "next";
import { Suspense } from "react";
import { z } from "zod";

import { BranchPerformanceList } from "@/components/dashboard/branch-performance";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { AgingPanel, AlertsPanel, Change, DueThisWeek, RangeTabs } from "@/components/dashboard/widgets";
import { Money } from "@/components/money";
import { PaidGauge } from "@/components/paid-gauge";
import { PageBody } from "@/components/shell/page-body";
import { SectionHeader } from "@/components/shell/page-header";
import { PageSkeleton } from "@/components/shell/page-skeleton";
import { type SummaryItem, SummaryBand } from "@/components/summary-band";
import { formatMoney, formatMoneyCompact, sum } from "@/lib/money";
import { can } from "@/server/auth/permissions";
import { requirePageAccess } from "@/server/auth/session";
import { getDashboard } from "@/server/services/dashboard.service";

export const metadata: Metadata = { title: "Overview" };

const rangeSchema = z.enum(["today", "7d", "30d", "month"]).catch("7d");

export default function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-NG")} ${n === 1 ? one : many}`;

function Compact({ value }: { value: string }) {
  return <span title={formatMoney(value)}>{formatMoneyCompact(value)}</span>;
}

/** Executive dashboard (DESIGN.md §5.1, mockup: overview). */
async function Content({ searchParams }: { searchParams: PageProps<"/dashboard">["searchParams"] }) {
  const ctx = await requirePageAccess("dashboard.view");
  const raw = (await searchParams).range;
  const range = rangeSchema.parse(Array.isArray(raw) ? raw[0] : raw);
  const d = await getDashboard(ctx, range);
  const { kpis } = d;
  const hourly = range === "today";

  const items: SummaryItem[] = [
    { label: "Invoiced sales", value: <Compact value={kpis.invoiced.value} />, sub: <Change percent={kpis.invoiced.changePercent} /> },
    {
      label: "Cash collected",
      value: (
        <span className="flex items-center gap-2">
          {kpis.collected.collectionRate !== null && <PaidGauge percent={kpis.collected.collectionRate} className="h-7 w-12 shrink-0" />}
          <Compact value={kpis.collected.value} />
        </span>
      ),
      sub: (
        <span className="flex flex-wrap gap-x-2">
          <Change percent={kpis.collected.changePercent} suffix="" />
          {kpis.collected.collectionRate !== null && <span className="text-muted-foreground">{kpis.collected.collectionRate}% collected</span>}
        </span>
      ),
    },
  ];
  if (kpis.netProfit) {
    items.push({ label: "Net profit", value: <Compact value={kpis.netProfit.value} />, sub: <Change percent={kpis.netProfit.changePercent} />, tone: Number(kpis.netProfit.value) < 0 ? "danger" : undefined });
  }
  items.push({ label: "Receivables", value: <Compact value={kpis.receivables.value} />, sub: <Change percent={kpis.receivables.changePercent} goodWhen="down" />, href: "/ledger/receivables" });
  if (kpis.payables) {
    items.push({ label: "Supplier payables", value: <Compact value={kpis.payables.value} />, sub: <Change percent={kpis.payables.changePercent} goodWhen="down" />, href: "/ledger/payables" });
  }
  if (kpis.inventory) {
    items.push({
      label: kpis.inventory.basis === "cost" ? "Inventory value" : "Inventory value (retail)",
      value: <Compact value={kpis.inventory.value} />,
      sub: `${plural(kpis.inventory.devices, "device")} · ${plural(kpis.inventory.accessories, "accessory", "accessories")} · at ${kpis.inventory.basis === "cost" ? "cost" : "selling price"}`,
      href: "/inventory",
    });
  }

  const invoicedTotal = sum(d.trend.map((t) => t.invoiced)).toFixed(2);
  const collectedTotal = sum(d.trend.map((t) => t.collected)).toFixed(2);

  return (
    <>
      <SummaryBand title="Business statistic" actions={<RangeTabs range={range} />} items={items} />
      <PageBody className="flex flex-col gap-6">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
          <section aria-labelledby="trend-heading" className="rounded-xl border border-border bg-card p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 id="trend-heading" className="text-h3">Invoiced vs collected</h2>
              <ul className="flex flex-wrap gap-4 text-small" aria-label="Legend">
                <li className="flex items-center gap-1.5">
                  <span aria-hidden className="size-2.5 rounded-sm bg-chart-1" /> Invoiced <Money value={invoicedTotal} className="font-medium" />
                </li>
                <li className="flex items-center gap-1.5">
                  <span aria-hidden className="size-2.5 rounded-sm bg-chart-2" /> Collected <Money value={collectedTotal} className="font-medium" />
                </li>
              </ul>
            </div>
            <TrendChart hourly={hourly} data={d.trend.map((t) => ({ ...t, invoiced: Number(t.invoiced), collected: Number(t.collected) }))} />
            <details className="mt-2 text-small">
              <summary className="cursor-pointer text-muted-foreground">Show as table</summary>
              <table className="mt-2 w-full">
                <caption className="sr-only">Invoiced and collected by {hourly ? "hour" : "day"}</caption>
                <thead>
                  <tr className="text-muted-foreground">
                    <th scope="col" className="py-1 text-left font-medium">{hourly ? "Hour" : "Day"}</th>
                    <th scope="col" className="py-1 text-right font-medium">Invoiced</th>
                    <th scope="col" className="py-1 text-right font-medium">Collected</th>
                  </tr>
                </thead>
                <tbody>
                  {d.trend.map((t) => (
                    <tr key={t.key} className="border-t border-border">
                      <th scope="row" className="py-1 text-left font-normal">{t.label}</th>
                      <td className="py-1 text-right"><Money value={t.invoiced} /></td>
                      <td className="py-1 text-right"><Money value={t.collected} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </section>
          <AgingPanel aging={d.aging} reportHref={can(ctx, "report.view") ? "/reports/aging" : null} />
        </div>

        {d.branches ? (
          <section aria-labelledby="branches-heading">
            <SectionHeader id="branches-heading" title="Branch performance" description="Select a branch to see its own dashboard." />
            <BranchPerformanceList branches={d.branches} />
          </section>
        ) : (
          d.topProducts && (
            <section aria-labelledby="top-heading">
              <SectionHeader id="top-heading" title="Top products" description="By sales value in this period." />
              {d.topProducts.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-body text-muted-foreground">No sales in this period yet.</p>
              ) : (
                <ol className="divide-y divide-border rounded-xl border border-border bg-card">
                  {d.topProducts.map((p, i) => (
                    <li key={p.productId} className="flex items-center gap-4 px-4 py-3 text-body">
                      <span className="w-5 text-muted-foreground tabular-nums">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                      <span className="text-muted-foreground tabular-nums">{p.units} sold</span>
                      <Money value={p.revenue} className="w-36 text-right font-medium" />
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <DueThisWeek rows={d.dueThisWeek} total={d.dueThisWeekTotal} />
          <AlertsPanel alerts={d.alerts} count={d.alertCount} />
        </div>
      </PageBody>
    </>
  );
}
