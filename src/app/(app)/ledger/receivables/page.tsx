import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/shell/page-header";
import { PageSkeleton } from "@/components/shell/page-skeleton";
import { UpcomingScreen } from "@/components/shell/upcoming-screen";
import { requirePageAccess } from "@/server/auth/session";

export const metadata: Metadata = { title: "Receivables" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  await requirePageAccess("payment.record");
  return (
    <>
      <PageHeader title="Receivables" description="What customers owe, and repayments." />
      <UpcomingScreen step={8} summary="Receivables ledger with instant payment confirmation." />
    </>
  );
}
