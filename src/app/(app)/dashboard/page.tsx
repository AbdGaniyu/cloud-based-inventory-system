import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/shell/page-header";
import { PageSkeleton } from "@/components/shell/page-skeleton";
import { UpcomingScreen } from "@/components/shell/upcoming-screen";
import { requirePageAccess } from "@/server/auth/session";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Dashboard" };

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
    <>
      <PageHeader title={`Welcome, ${firstName}`} description={scope ? `Showing ${scope.name}.` : "Showing all branches."} />
      <UpcomingScreen
        step={10}
        summary="KPIs, invoiced vs collected, branch performance, installments due this week and alerts."
      />
    </>
  );
}
