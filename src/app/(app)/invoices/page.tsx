import type { Metadata } from "next";
import { Suspense } from "react";
import { z } from "zod";

import { InvoicesTable } from "@/app/(app)/invoices/invoices-table";
import { FilterChips } from "@/components/filter-chips";
import { Pagination } from "@/components/pagination";
import { PageBody } from "@/components/shell/page-body";
import { PageSkeleton } from "@/components/shell/page-skeleton";
import { requirePageAccess } from "@/server/auth/session";
import { listInvoices } from "@/server/services/invoice.service";

export const metadata: Metadata = { title: "Invoices" };

const paramsSchema = z.object({
  status: z.enum(["PAID", "PARTIALLY_PAID", "UNPAID", "OVERDUE", "VOID", "RETURNED"]).optional().catch(undefined),
  q: z.string().trim().max(80).optional().catch(undefined),
  page: z.coerce.number().int().min(1).optional().catch(undefined),
});

export default function InvoicesPage({ searchParams }: PageProps<"/invoices">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: PageProps<"/invoices">["searchParams"] }) {
  const ctx = await requirePageAccess("invoice.view");
  const raw = await searchParams;
  const params = paramsSchema.parse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])));
  const list = await listInvoices(ctx, params);
  const href = (status?: string) => {
    const search = new URLSearchParams();
    if (status) search.set("status", status);
    if (params.q) search.set("q", params.q);
    const q = search.toString();
    return q ? `/invoices?${q}` : "/invoices";
  };
  const chips = (
    [
      ["All", undefined, list.counts.ALL],
      ["Overdue", "OVERDUE", list.counts.OVERDUE],
      ["Partially paid", "PARTIALLY_PAID", list.counts.PARTIALLY_PAID],
      ["Unpaid", "UNPAID", list.counts.UNPAID],
      ["Paid", "PAID", list.counts.PAID],
      ["Void", "VOID", list.counts.VOID],
    ] as const
  ).map(([label, status, count]) => ({ label, count, href: href(status), active: params.status === status }));

  return (
    <PageBody>
      <div className="mb-4">
        <FilterChips label="Invoice status" items={chips} />
      </div>
      <InvoicesTable rows={list.rows} showBranch={ctx.role === "OWNER" && ctx.activeBranchId === null} />
      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} noun="invoices" params={{ status: params.status, q: params.q }} />
    </PageBody>
  );
}
