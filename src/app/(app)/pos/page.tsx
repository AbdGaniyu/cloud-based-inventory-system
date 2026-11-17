import type { Metadata } from "next";
import { Suspense } from "react";

import { PosScreen } from "@/app/(app)/pos/pos-screen";
import { Skeleton } from "@/components/ui/skeleton";
import { todayInStoreTz } from "@/lib/dates";
import { can } from "@/server/auth/permissions";
import { requirePageAccess } from "@/server/auth/session";
import { db } from "@/server/db";
import { getCheckoutSettings } from "@/server/services/invoice.service";
import { listSellableCategories, quickPickAccessories, resolvePosBranch, searchCatalog } from "@/server/services/pos.service";

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

export default function PosPage() {
  return (
    <Suspense fallback={<PosSkeleton />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const ctx = await requirePageAccess("invoice.create");
  const branch = await resolvePosBranch(ctx);
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
      categories={categories}
      initialCatalog={initialCatalog}
      quickPicks={quickPicks}
      settings={settings}
      canSelfApprove={can(ctx, "installment.approve", { branchId: branch.id })}
      today={todayInStoreTz()}
      deviceModels={deviceModels}
    />
  );
}
