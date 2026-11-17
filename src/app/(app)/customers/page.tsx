import type { Metadata } from "next";
import { Suspense } from "react";
import { z } from "zod";

import { CustomersTable } from "@/app/(app)/customers/customers-table";
import { FilterChips } from "@/components/filter-chips";
import { Pagination } from "@/components/pagination";
import { PageBody } from "@/components/shell/page-body";
import { PageSkeleton } from "@/components/shell/page-skeleton";
import { requirePageAccess } from "@/server/auth/session";
import { listCustomers } from "@/server/services/customer.service";

export const metadata: Metadata = { title: "Customers" };

const paramsSchema = z.object({
  owing: z.literal("1").optional().catch(undefined),
  q: z.string().trim().max(80).optional().catch(undefined),
  page: z.coerce.number().int().min(1).optional().catch(undefined),
});

export default function CustomersPage({ searchParams }: PageProps<"/customers">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: PageProps<"/customers">["searchParams"] }) {
  const ctx = await requirePageAccess("customer.view");
  const raw = await searchParams;
  const params = paramsSchema.parse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])));
  const list = await listCustomers(ctx, { q: params.q, owing: params.owing === "1", page: params.page });
  const qs = params.q ? `q=${encodeURIComponent(params.q)}` : "";
  return (
    <PageBody>
      <div className="mb-4">
        <FilterChips
          label="Customers"
          items={[
            { label: "All", href: qs ? `/customers?${qs}` : "/customers", active: !params.owing },
            { label: "Owing", count: list.owingCount, href: `/customers?owing=1${qs ? `&${qs}` : ""}`, active: params.owing === "1" },
          ]}
        />
      </div>
      <CustomersTable rows={list.rows} />
      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} noun="customers" params={{ owing: params.owing, q: params.q }} />
    </PageBody>
  );
}
