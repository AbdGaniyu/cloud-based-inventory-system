import type { Metadata } from "next";
import { Suspense } from "react";
import { z } from "zod";

import { SuppliersTable } from "@/app/(app)/suppliers/suppliers-table";
import { PageBody } from "@/components/shell/page-body";
import { PageSkeleton } from "@/components/shell/page-skeleton";
import { requirePageAccess } from "@/server/auth/session";
import { listSuppliers } from "@/server/services/payables.service";

export const metadata: Metadata = { title: "Suppliers" };

export default function SuppliersPage({ searchParams }: PageProps<"/suppliers">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: PageProps<"/suppliers">["searchParams"] }) {
  const ctx = await requirePageAccess("payables.view");
  const raw = await searchParams;
  const q = z.string().trim().max(80).optional().catch(undefined).parse(Array.isArray(raw.q) ? raw.q[0] : raw.q);
  const rows = await listSuppliers(ctx, { q });
  return (
    <PageBody>
      <SuppliersTable rows={rows} />
    </PageBody>
  );
}
