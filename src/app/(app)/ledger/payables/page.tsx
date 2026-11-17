import type { Metadata } from "next";
import { Suspense } from "react";
import { z } from "zod";

import { FilterChips } from "@/components/filter-chips";
import { PayablesTable } from "@/components/ledger/payables-table";
import { Money } from "@/components/money";
import { Pagination } from "@/components/pagination";
import { SearchInput } from "@/components/search-input";
import { PageBody } from "@/components/shell/page-body";
import { PageSkeleton } from "@/components/shell/page-skeleton";
import { SummaryBand } from "@/components/summary-band";
import { requirePageAccess } from "@/server/auth/session";
import { listPayables } from "@/server/services/payables.service";

export const metadata: Metadata = { title: "Payables" };

const paramsSchema = z.object({
  filter: z.enum(["due_soon", "overdue", "paid"]).optional().catch(undefined),
  q: z.string().trim().max(80).optional().catch(undefined),
  page: z.coerce.number().int().min(1).optional().catch(undefined),
});

export default function PayablesPage({ searchParams }: PageProps<"/ledger/payables">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

/** Payables ledger, owner only (DESIGN.md §5.5): what is owed to suppliers, by purchase order. */
async function Content({ searchParams }: { searchParams: PageProps<"/ledger/payables">["searchParams"] }) {
  const ctx = await requirePageAccess("payables.view");
  const raw = await searchParams;
  const params = paramsSchema.parse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])));
  const ledger = await listPayables(ctx, params);
  const href = (filter?: string) => {
    const search = new URLSearchParams();
    if (filter) search.set("filter", filter);
    if (params.q) search.set("q", params.q);
    const q = search.toString();
    return q ? `/ledger/payables?${q}` : "/ledger/payables";
  };
  const chips = (
    [
      ["All", undefined, ledger.counts.all],
      ["Due this week", "due_soon", ledger.counts.due_soon],
      ["Overdue", "overdue", ledger.counts.overdue],
      ["Paid", "paid", ledger.counts.paid],
    ] as const
  ).map(([label, filter, count]) => ({ label, count, href: href(filter), active: params.filter === filter }));

  return (
    <>
      <SummaryBand
        title="Payables summary"
        items={[
          { label: "Total owed", value: <Money value={ledger.summary.totalOwed} /> },
          { label: "Due this week", value: <Money value={ledger.summary.dueThisWeek} /> },
          { label: "Overdue", value: <Money value={ledger.summary.overdue} />, tone: Number(ledger.summary.overdue) > 0 ? "danger" : undefined, href: "/ledger/payables?filter=overdue" },
        ]}
      />
      <PageBody>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <FilterChips label="Purchase order status" items={chips} />
          <div className="w-full sm:w-80">
            <SearchInput placeholder="PO number, supplier or reference" label="Search purchase orders" />
          </div>
        </div>
        <PayablesTable rows={ledger.rows} />
        <Pagination page={ledger.page} pageSize={ledger.pageSize} total={ledger.total} noun="purchase orders" params={{ filter: params.filter, q: params.q }} />
      </PageBody>
    </>
  );
}
