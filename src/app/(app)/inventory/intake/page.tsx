import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/shell/page-header";
import { PageSkeleton } from "@/components/shell/page-skeleton";
import { UpcomingScreen } from "@/components/shell/upcoming-screen";
import { requirePageAccess } from "@/server/auth/session";

export const metadata: Metadata = { title: "Stock intake" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  await requirePageAccess("intake.create");
  return (
    <>
      <PageHeader title="Stock intake" description="Receive stock from a supplier into a branch." />
      <UpcomingScreen step={3} summary="Intake form with IMEI paste/scan, supplier credit terms and barcode labels." />
    </>
  );
}
