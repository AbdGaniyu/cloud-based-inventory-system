import { Calculator } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { z } from "zod";

import { DrawerForm, SignOffButton, VarianceText } from "@/app/(app)/cash-up/cash-up-forms";
import { EmptyState } from "@/components/empty-state";
import { FilterChips } from "@/components/filter-chips";
import { Money } from "@/components/money";
import { Pagination } from "@/components/pagination";
import { PageBody } from "@/components/shell/page-body";
import { PageSkeleton } from "@/components/shell/page-skeleton";
import { SummaryBand } from "@/components/summary-band";
import { Badge } from "@/components/ui/status-badge";
import { can } from "@/server/auth/permissions";
import { requirePageAccess } from "@/server/auth/session";
import { getDrawerStatus, listCashUps, pendingDrawers } from "@/server/services/cashup.service";

export const metadata: Metadata = { title: "Cash-up" };

const time = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });
const day = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const paramsSchema = z.object({
  status: z.enum(["SUBMITTED", "REVIEWED"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined),
});

export default function CashUpPage({ searchParams }: PageProps<"/cash-up">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

/** Cash-up: count your own drawer (blind); managers and the owner also see and sign off the branch's. */
async function Content({ searchParams }: { searchParams: PageProps<"/cash-up">["searchParams"] }) {
  const ctx = await requirePageAccess("cashup.submit");
  const raw = await searchParams;
  const params = paramsSchema.parse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])));
  const reviewer = can(ctx, "cashup.review");
  const [drawer, list, pending] = await Promise.all([
    getDrawerStatus(ctx),
    listCashUps(ctx, { status: params.status, page: params.page }),
    reviewer ? pendingDrawers(ctx) : Promise.resolve([]),
  ]);
  const awaiting = list.rows.filter((r) => r.canReview).length;

  return (
    <>
      <SummaryBand
        title="Cash-up"
        items={[
          { label: "Your drawer", value: drawer.branch ? `${drawer.paymentCount} payment${drawer.paymentCount === 1 ? "" : "s"}` : "—", sub: drawer.periodStart ? `Since ${time.format(new Date(drawer.periodStart))}` : "Choose a branch" },
          ...(reviewer
            ? [
                { label: "Not cashed up yet", value: pending.length.toString(), sub: pending.length ? "People holding takings" : "Everyone is cashed up" },
                { label: "Waiting for sign-off", value: awaiting.toString(), sub: "On this page" },
              ]
            : []),
        ]}
      />
      <PageBody className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="flex min-w-0 flex-col gap-6 xl:order-2">
          <section aria-labelledby="drawer-heading" className="rounded-xl border border-border bg-card p-5">
            <h2 id="drawer-heading" className="mb-1 text-h3">Count your drawer{drawer.branch ? ` · ${drawer.branch.name}` : ""}</h2>
            {drawer.branch ? (
              <DrawerForm paymentCount={drawer.paymentCount} />
            ) : (
              <p className="text-body text-muted-foreground">Choose the branch you&apos;re cashing up at with the branch switcher (top left).</p>
            )}
          </section>
        </div>

        <div className="flex min-w-0 flex-col gap-6 xl:order-1">
          {reviewer && pending.length > 0 && (
            <section aria-labelledby="pending-heading">
              <h2 id="pending-heading" className="mb-3 text-h3">Not cashed up yet</h2>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-small">
                  <caption className="sr-only">Takings not cashed up yet</caption>
                  <thead className="bg-surface text-caption text-muted-foreground uppercase">
                    <tr className="border-b border-border">
                      <th scope="col" className="h-10 px-3 text-left font-medium">Person</th>
                      <th scope="col" className="px-3 text-left font-medium">Since</th>
                      <th scope="col" className="px-3 text-right font-medium">Cash</th>
                      <th scope="col" className="px-3 text-right font-medium">Card</th>
                      <th scope="col" className="px-3 text-right font-medium">Transfers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.map((d) => (
                      <tr key={`${d.userId}:${d.branchId}`} className="border-b border-border last:border-b-0">
                        <td className="px-3 py-2.5">
                          <p className="text-body font-medium">{d.userName}</p>
                          <p className="text-muted-foreground">{d.branchName} · {d.payments} payment{d.payments === 1 ? "" : "s"}</p>
                        </td>
                        <td className="px-3 whitespace-nowrap">
                          {time.format(new Date(d.since))} {d.fromBeforeToday && <Badge tone="danger">Overdue</Badge>}
                        </td>
                        <td className="px-3 text-right"><Money value={d.cash} /></td>
                        <td className="px-3 text-right"><Money value={d.card} /></td>
                        <td className="px-3 text-right"><Money value={d.transfer} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section aria-labelledby="history-heading">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 id="history-heading" className="text-h3">{list.scope === "branch" ? "Cash-ups" : "Your cash-ups"}</h2>
              <FilterChips
                label="Cash-up status"
                items={[
                  { label: "All", href: "/cash-up", active: !params.status },
                  { label: "Waiting for sign-off", href: "/cash-up?status=SUBMITTED", active: params.status === "SUBMITTED" },
                  { label: "Signed off", href: "/cash-up?status=REVIEWED", active: params.status === "REVIEWED" },
                ]}
              />
            </div>
            {list.rows.length === 0 ? (
              <EmptyState icon={Calculator} title="No cash-ups yet" description="Each drawer's count, what was expected and any difference will be listed here." />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-small">
                  <caption className="sr-only">Cash-ups</caption>
                  <thead className="bg-surface text-caption text-muted-foreground uppercase">
                    <tr className="border-b border-border">
                      <th scope="col" className="h-10 px-3 text-left font-medium">Day</th>
                      <th scope="col" className="px-3 text-left font-medium">Person</th>
                      <th scope="col" className="px-3 text-right font-medium">Cash</th>
                      <th scope="col" className="px-3 text-right font-medium">Card</th>
                      <th scope="col" className="px-3 text-right font-medium">Transfers</th>
                      <th scope="col" className="px-3 text-left font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.rows.map((c) => (
                      <tr key={c.id} className="border-b border-border align-top last:border-b-0">
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          {day.format(new Date(`${c.businessDate}T00:00:00Z`))}
                          <p className="text-muted-foreground">{time.format(new Date(c.periodEnd)).split(", ")[1]}</p>
                        </td>
                        <td className="px-3 py-2.5">
                          <p className="text-body font-medium">{c.userName}</p>
                          <p className="text-muted-foreground">{c.branchName} · {c.paymentCount} payment{c.paymentCount === 1 ? "" : "s"}</p>
                        </td>
                        <td className="px-3 py-2.5 text-right"><VarianceText value={c.variance.cash} /></td>
                        <td className="px-3 py-2.5 text-right"><VarianceText value={c.variance.card} /></td>
                        <td className="px-3 py-2.5 text-right"><VarianceText value={c.variance.transfer} /></td>
                        <td className="px-3 py-2.5">
                          {c.status === "REVIEWED" ? (
                            <>
                              <Badge tone="success">Signed off</Badge>
                              <p className="mt-1 text-muted-foreground">{c.reviewedByName}{c.reviewNote ? `: ${c.reviewNote}` : ""}</p>
                            </>
                          ) : c.canReview ? (
                            <SignOffButton cashUp={c} />
                          ) : (
                            <Badge tone="neutral">Waiting for sign-off</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Pagination page={list.page} pageSize={list.pageSize} total={list.total} noun="cash-ups" params={{ status: params.status }} />
          </section>
        </div>
      </PageBody>
    </>
  );
}
