import type { Metadata } from "next";
import { Suspense } from "react";

import { PageBody } from "@/components/shell/page-body";
import { PageSkeleton } from "@/components/shell/page-skeleton";
import { UpcomingScreen } from "@/components/shell/upcoming-screen";
import { requirePageAccess } from "@/server/auth/session";

export const metadata: Metadata = { title: "Transfers" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  await requirePageAccess("transfer.view");
  return (
    <PageBody>
      <UpcomingScreen step={4} summary="Draft → In transit → Received workflow with the printable waybill." />
    </PageBody>
  );
}
