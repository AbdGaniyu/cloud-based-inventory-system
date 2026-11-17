import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/shell/page-header";
import { PageSkeleton } from "@/components/shell/page-skeleton";
import { UpcomingScreen } from "@/components/shell/upcoming-screen";
import { requirePageAccess } from "@/server/auth/session";

export const metadata: Metadata = { title: "Inventory" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  await requirePageAccess("inventory.view");
  return (
    <>
      <PageHeader title="Inventory" description="Serialized units, accessories and products." />
      <UpcomingScreen step={3} summary="Serialized unit list, per-branch accessory quantities and stock alerts." />
    </>
  );
}
