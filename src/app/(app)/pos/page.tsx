import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/shell/page-header";
import { PageSkeleton } from "@/components/shell/page-skeleton";
import { UpcomingScreen } from "@/components/shell/upcoming-screen";
import { requirePageAccess } from "@/server/auth/session";

export const metadata: Metadata = { title: "POS" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  await requirePageAccess("invoice.create");
  return (
    <>
      <PageHeader title="POS" description="Scan or search, build the cart and take payment." />
      <UpcomingScreen step={5} summary="Invoice builder with IMEI scanning, split payment and the installment calculator." />
    </>
  );
}
