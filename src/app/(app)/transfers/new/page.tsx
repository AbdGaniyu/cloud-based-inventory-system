import type { Metadata } from "next";
import { Suspense } from "react";

import { NewTransferForm } from "@/app/(app)/transfers/new/new-transfer-form";
import { PageBody } from "@/components/shell/page-body";
import { SectionHeader } from "@/components/shell/page-header";
import { PageSkeleton } from "@/components/shell/page-skeleton";
import { requirePageAccess } from "@/server/auth/session";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "New transfer" };

export default function NewTransferPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const ctx = await requirePageAccess("transfer.create");
  // Destinations can be any active branch, so every role needs the full list here (names only).
  const branches = await db.branch.findMany({
    where: { isActive: true },
    select: { id: true, name: true, code: true },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });
  const home = ctx.homeBranch;

  return (
    <PageBody>
      <SectionHeader title="New transfer" description="Saved as a draft. Stock is only locked when the transfer is shipped." />
      <NewTransferForm
        branches={branches}
        fixedFrom={ctx.role === "OWNER" || !home ? null : { id: home.id, name: home.name, code: home.code }}
        defaultFromId={ctx.role === "OWNER" ? ctx.activeBranchId : (home?.id ?? null)}
      />
    </PageBody>
  );
}
