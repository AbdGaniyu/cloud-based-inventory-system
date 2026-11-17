import type { Metadata } from "next";
import { Suspense } from "react";

import { PageBody } from "@/components/shell/page-body";
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
    <PageBody>
      <UpcomingScreen step={5} summary="Invoice builder with IMEI scanning, split payment and the installment calculator." />
    </PageBody>
  );
}
