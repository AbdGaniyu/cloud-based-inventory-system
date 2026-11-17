import type { Metadata } from "next";
import { Suspense } from "react";

import { IntakeForm } from "@/app/(app)/inventory/intake/intake-form";
import { PageBody } from "@/components/shell/page-body";
import { PageSkeleton } from "@/components/shell/page-skeleton";
import { todayInStoreTz } from "@/lib/dates";
import { can } from "@/server/auth/permissions";
import { requirePageAccess } from "@/server/auth/session";
import { listScopeBranches } from "@/server/services/branch.service";
import { listIntakeProducts } from "@/server/services/intake.service";
import { listSupplierOptions } from "@/server/services/supplier.service";

export const metadata: Metadata = { title: "Stock intake" };

export default function IntakePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const ctx = await requirePageAccess("intake.create");
  const [suppliers, products, branches] = await Promise.all([listSupplierOptions(ctx), listIntakeProducts(ctx), listScopeBranches(ctx)]);
  const isOwner = ctx.role === "OWNER";
  const home = ctx.homeBranch;

  return (
    <PageBody>
      <IntakeForm
        suppliers={suppliers}
        products={products}
        branches={branches.map((b) => ({ id: b.id, name: b.name, code: b.code }))}
        fixedBranch={isOwner || !home ? null : { id: home.id, name: home.name, code: home.code }}
        defaultBranchId={isOwner ? ctx.activeBranchId : (home?.id ?? null)}
        canPay={can(ctx, "supplier.payout")}
        canEditPrices={can(ctx, "price.edit")}
        today={todayInStoreTz()}
      />
    </PageBody>
  );
}
