import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";

import { CountForm } from "@/app/(app)/inventory/count/count-form";
import { PageBody } from "@/components/shell/page-body";
import { PageSkeleton } from "@/components/shell/page-skeleton";
import { SummaryBand } from "@/components/summary-band";
import { requirePageAccess } from "@/server/auth/session";
import { listScopeBranches } from "@/server/services/branch.service";
import { getCountSheet } from "@/server/services/stock-adjustment.service";

export const metadata: Metadata = { title: "Stock count" };

const paramsSchema = z.object({ branch: z.guid().optional().catch(undefined) });

export default function StockCountPage({ searchParams }: PageProps<"/inventory/count">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

/** Owner: count one branch's shelf, review the differences, then apply them as adjustments. */
async function Content({ searchParams }: { searchParams: PageProps<"/inventory/count">["searchParams"] }) {
  const ctx = await requirePageAccess("stock.adjust");
  const raw = await searchParams;
  const params = paramsSchema.parse({ branch: Array.isArray(raw.branch) ? raw.branch[0] : raw.branch });
  const branchId = params.branch ?? ctx.activeBranchId;

  if (!branchId) {
    const branches = await listScopeBranches(ctx);
    return (
      <>
        <SummaryBand title="Stock count" items={[]} />
        <PageBody>
          <section aria-labelledby="pick-heading" className="max-w-lg rounded-xl border border-border bg-card p-5">
            <h2 id="pick-heading" className="text-h3">Which branch are you counting?</h2>
            <ul className="mt-3 flex flex-col gap-2">
              {branches.map((b) => (
                <li key={b.id}>
                  <Link href={`/inventory/count?branch=${b.id}`} className="flex items-center justify-between rounded-lg border border-border px-4 py-3 text-body hover:bg-secondary">
                    {b.name} <span className="font-mono text-small text-muted-foreground">{b.code}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </PageBody>
      </>
    );
  }

  const sheet = await getCountSheet(ctx, branchId);
  return (
    <>
      <SummaryBand
        title={`Stock count · ${sheet.branch.name}`}
        items={[
          { label: "Accessory lines", value: sheet.accessories.length.toLocaleString() },
          { label: "Devices in stock", value: sheet.units.length.toLocaleString() },
        ]}
      />
      <PageBody>
        <CountForm sheet={sheet} />
      </PageBody>
    </>
  );
}
