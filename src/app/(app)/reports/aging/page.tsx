import type { Metadata } from "next";
import { Suspense } from "react";

import { PageBody } from "@/components/shell/page-body";
import { PageSkeleton } from "@/components/shell/page-skeleton";
import { UpcomingScreen } from "@/components/shell/upcoming-screen";
import { requirePageAccess } from "@/server/auth/session";

export const metadata: Metadata = { title: "Aging" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  await requirePageAccess("report.view");
  return (
    <PageBody>
      <UpcomingScreen step={10} summary="Aging buckets with CSV export." />
    </PageBody>
  );
}
