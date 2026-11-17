import type { Metadata } from "next";
import { Suspense } from "react";

import { PageBody } from "@/components/shell/page-body";
import { SectionHeader } from "@/components/shell/page-header";
import { PageSkeleton } from "@/components/shell/page-skeleton";
import { UpcomingScreen } from "@/components/shell/upcoming-screen";
import { requirePageAccess } from "@/server/auth/session";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Overview" };

export default function DashboardPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const ctx = await requirePageAccess("dashboard.view");
  const scope = ctx.activeBranchId
    ? await db.branch.findUnique({ where: { id: ctx.activeBranchId }, select: { name: true } })
    : null;
  const firstName = ctx.name.split(/\s+/)[0] ?? ctx.name;

  return (
    <PageBody>
      <SectionHeader
        title={`Welcome, ${firstName}`}
        description={scope ? `Showing ${scope.name}.` : "Showing all branches."}
      />
      <UpcomingScreen
        step={10}
        summary="Business statistic KPIs, invoiced vs collected, receivables aging, branch performance, installments due this week and alerts — built to docs/design/mockups/overview.png."
      />
    </PageBody>
  );
}
