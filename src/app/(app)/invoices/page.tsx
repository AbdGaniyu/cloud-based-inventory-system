import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/shell/page-header";
import { PageSkeleton } from "@/components/shell/page-skeleton";
import { UpcomingScreen } from "@/components/shell/upcoming-screen";
import { requirePageAccess } from "@/server/auth/session";

export const metadata: Metadata = { title: "Invoices" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  await requirePageAccess("invoice.view");
  return (
    <>
      <PageHeader title="Invoices" description="Every sale at the branches in scope." />
      <UpcomingScreen step={6} summary="Invoice list and detail with PDF invoice and thermal receipt." />
    </>
  );
}
