import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";

import { TransfersTable } from "@/app/(app)/transfers/transfers-table";
import { FilterChips } from "@/components/filter-chips";
import { Pagination } from "@/components/pagination";
import { PageBody } from "@/components/shell/page-body";
import { PageSkeleton } from "@/components/shell/page-skeleton";
import { SummaryBand } from "@/components/summary-band";
import { Button } from "@/components/ui/button";
import { TransferStatus } from "@/generated/prisma/enums";
import { can } from "@/server/auth/permissions";
import { requirePageAccess } from "@/server/auth/session";
import { listTransfers } from "@/server/services/transfer.service";

export const metadata: Metadata = { title: "Transfers" };

const paramsSchema = z.object({
  status: z.enum(TransferStatus).optional().catch(undefined),
  direction: z.enum(["incoming", "outgoing"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).optional().catch(undefined),
});

export default function TransfersPage({ searchParams }: PageProps<"/transfers">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

function href(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) search.set(k, v);
  const q = search.toString();
  return q ? `/transfers?${q}` : "/transfers";
}

async function Content({ searchParams }: { searchParams: PageProps<"/transfers">["searchParams"] }) {
  const ctx = await requirePageAccess("transfer.view");
  const raw = await searchParams;
  const params = paramsSchema.parse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])));
  const list = await listTransfers(ctx, { status: params.status, direction: params.direction, page: params.page });
  const canCreate = ctx.role === "OWNER" || can(ctx, "transfer.create");

  const statusChips = [
    { label: "All", status: undefined, count: list.counts.ALL },
    { label: "Drafts", status: "DRAFT", count: list.counts.DRAFT },
    { label: "In transit", status: "IN_TRANSIT", count: list.counts.IN_TRANSIT },
    { label: "Received", status: "RECEIVED", count: list.counts.RECEIVED },
    { label: "Cancelled", status: "CANCELLED", count: list.counts.CANCELLED },
  ].map((c) => ({
    label: c.label,
    count: c.count,
    active: params.status === c.status,
    href: href({ status: c.status, direction: params.direction }),
  }));

  const directionChips = list.scopeBranchId
    ? [
        { label: "Both directions", direction: undefined },
        { label: "Incoming", direction: "incoming" },
        { label: "Outgoing", direction: "outgoing" },
      ].map((c) => ({ label: c.label, active: params.direction === c.direction, href: href({ status: params.status, direction: c.direction }) }))
    : [];

  const newButton = canCreate ? (
    <Button asChild>
      <Link href="/transfers/new">
        <Plus aria-hidden data-icon="inline-start" /> New transfer
      </Link>
    </Button>
  ) : null;

  return (
    <>
      <SummaryBand
        title="Transfer summary"
        actions={newButton}
        items={[
          { label: "In transit", value: list.counts.IN_TRANSIT, sub: "Locked from sale until received", href: href({ status: "IN_TRANSIT" }) },
          { label: "Drafts", value: list.counts.DRAFT, sub: "Not shipped yet", href: href({ status: "DRAFT" }) },
          { label: "Received", value: list.counts.RECEIVED, sub: "Completed transfers", href: href({ status: "RECEIVED" }) },
          { label: "Cancelled", value: list.counts.CANCELLED, sub: "Stock returned to source", href: href({ status: "CANCELLED" }) },
        ]}
      />
      <PageBody>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <FilterChips label="Transfer status" items={statusChips} />
          {directionChips.length > 0 && <FilterChips label="Direction" items={directionChips} />}
        </div>
        <TransfersTable rows={list.rows} emptyAction={newButton} />
        <Pagination page={list.page} pageSize={list.pageSize} total={list.total} noun="transfers" params={{ status: params.status, direction: params.direction }} />
      </PageBody>
    </>
  );
}
