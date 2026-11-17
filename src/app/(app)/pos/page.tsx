import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";

import { PosScreen } from "@/app/(app)/pos/pos-screen";
import { Skeleton } from "@/components/ui/skeleton";
import { todayInStoreTz } from "@/lib/dates";
import { can } from "@/server/auth/permissions";
import { requirePageAccess } from "@/server/auth/session";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { getCheckoutSettings } from "@/server/services/invoice.service";
import { getSwapContext, type SwapContext } from "@/server/services/return.service";
import { listPosStores, listSellableCategories, POS_BRANCH_COOKIE, quickPickAccessories, resolvePosBranch, searchCatalog } from "@/server/services/pos.service";

export const metadata: Metadata = { title: "New sale" };

function PosSkeleton() {
  return (
    <div className="grid h-full lg:grid-cols-[3fr_2fr]" aria-busy="true" aria-label="Loading">
      <div className="flex flex-col gap-4 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-14" />
        <Skeleton className="h-11 w-96" />
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <div className="border-l border-border bg-surface p-4">
        <Skeleton className="h-16" />
      </div>
    </div>
  );
}

export default function PosPage({ searchParams }: PageProps<"/pos">) {
  return (
    <Suspense fallback={<PosSkeleton />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: PageProps<"/pos">["searchParams"] }) {
  const ctx = await requirePageAccess("invoice.create");
  const swapParam = (await searchParams).swap;
  const swapId = typeof swapParam === "string" && /^[0-9a-f-]{36}$/i.test(swapParam) ? swapParam : null;
  // ?swap=<returnId>: a replacement sale linked to a return (CLAUDE.md §7.6).
  let swap: SwapContext | null = null;
  let swapError: string | null = null;
  if (swapId) {
    try {
      swap = await getSwapContext(ctx, swapId);
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      swapError = error.message;
    }
  }
  const remembered = (await cookies()).get(POS_BRANCH_COOKIE)?.value;
  const branch = await resolvePosBranch(ctx, swap?.branchId ?? remembered);
  // Owner in all-branches view picks the selling store on the POS itself.
  const storeChoices = ctx.role === "OWNER" && ctx.activeBranchId === null ? await listPosStores(ctx) : null;
  const [initialCatalog, quickPicks, categories, settings, deviceModels] = await Promise.all([
    searchCatalog(ctx, { branchId: branch.id }),
    quickPickAccessories(ctx, branch.id),
    listSellableCategories(),
    getCheckoutSettings(),
    db.product.findMany({ where: { isActive: true, trackingType: "SERIALIZED" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <PosScreen
      // Remount when the owner switches branch in the rail.
      key={branch.id}
      branch={branch}
      isOwner={ctx.role === "OWNER"}
      storeChoices={storeChoices}
      categories={categories}
      initialCatalog={initialCatalog}
      quickPicks={quickPicks}
      settings={settings}
      canSelfApprove={can(ctx, "installment.approve", { branchId: branch.id })}
      today={todayInStoreTz()}
      deviceModels={deviceModels}
      swap={swap}
      swapError={swapError}
    />
  );
}
