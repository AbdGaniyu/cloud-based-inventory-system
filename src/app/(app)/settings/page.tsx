import type { Metadata } from "next";
import { Suspense } from "react";

import { PageBody } from "@/components/shell/page-body";
import { PageSkeleton } from "@/components/shell/page-skeleton";
import { UpcomingScreen } from "@/components/shell/upcoming-screen";
import { requirePageAccess } from "@/server/auth/session";

export const metadata: Metadata = { title: "Settings" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  await requirePageAccess("settings.view");
  return (
    <PageBody>
      <UpcomingScreen step={12} summary="Store settings for the owner." />
    </PageBody>
  );
}
