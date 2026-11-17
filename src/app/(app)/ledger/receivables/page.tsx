import type { Metadata } from "next";
import { Suspense } from "react";
import { z } from "zod";

import { ReceivablesList } from "@/app/(app)/ledger/receivables/receivables-list";
import { FilterChips } from "@/components/filter-chips";
import { Money } from "@/components/money";
import { Pagination } from "@/components/pagination";
import { SearchInput } from "@/components/search-input";
import { PageBody } from "@/components/shell/page-body";
import { PageSkeleton } from "@/components/shell/page-skeleton";
import { SummaryBand } from "@/components/summary-band";
import { can } from "@/server/auth/permissions";
import { requirePageAccess } from "@/server/auth/session";
import { listReceivables } from "@/server/services/ledger.service";

export const metadata: Metadata = { title: "Receivables" };

const paramsSchema = z.object({
  filter: z.enum(["due_soon", "overdue", "completed"]).optional().catch(undefined),
  q: z.string().trim().max(80).optional().catch(undefined),
  page: z.coerce.number().int().min(1).optional().catch(undefined),
});

export default function ReceivablesPage({ searchParams }: PageProps<"/ledger/receivables">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

/** Receivables ledger (DESIGN.md §5.4, mockup: receivables). */
async function Content({ searchParams }: { searchParams: PageProps<"/ledger/receivables">["searchParams"] }) {
  const ctx = await requirePageAccess("payment.record");
  const raw = await searchParams;
  const params = paramsSchema.parse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])));
  const ledger = await listReceivables(ctx, params);
  const href = (filter?: string) => {
    const search = new URLSearchParams();
    if (filter) search.set("filter", filter);
    if (params.q) search.set("q", params.q);
    const q = search.toString();
    return q ? `/ledger/receivables?${q}` : "/ledger/receivables";
  };
  const chips = (
    [
      ["All", undefined, ledger.counts.all],
      ["Due soon", "due_soon", ledger.counts.due_soon],
      ["Overdue", "overdue", ledger.counts.overdue],
      ["Completed", "completed", ledger.counts.completed],
    ] as const
  ).map(([label, filter, count]) => ({ label, count, href: href(filter), active: params.filter === filter }));
  const { summary } = ledger;

  return (
    <>
      <SummaryBand
        title="Ledger summary"
        items={[
          { label: "Total outstanding", value: <Money value={summary.totalOutstanding} /> },
          { label: "Due this week", value: <Money value={summary.dueThisWeek} /> },
          { label: "Overdue amount", value: <Money value={summary.overdueAmount} />, tone: Number(summary.overdueAmount) > 0 ? "danger" : undefined },
          { label: "Overdue accounts", value: summary.overdueAccounts, tone: summary.overdueAccounts > 0 ? "danger" : undefined, href: "/ledger/receivables?filter=overdue" },
        ]}
      />
      <PageBody>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <FilterChips label="Account status" items={chips} />
          <div className="w-full sm:w-80">
            <SearchInput placeholder="Customer, phone or invoice" label="Search accounts" />
          </div>
        </div>
        {ledger.searchingAllBranches && (
          <p role="status" className="mb-3 text-small text-muted-foreground">
            Searching every branch: you can record a payment for any customer, wherever they bought.
          </p>
        )}
        <ReceivablesList rows={ledger.rows} canSend={can(ctx, "message.send")} />
        <Pagination page={ledger.page} pageSize={ledger.pageSize} total={ledger.total} noun="accounts" params={{ filter: params.filter, q: params.q }} />
      </PageBody>
    </>
  );
}
