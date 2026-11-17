import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/shell/page-header";
import { PageSkeleton } from "@/components/shell/page-skeleton";
import { UpcomingScreen } from "@/components/shell/upcoming-screen";
import { requirePageAccess } from "@/server/auth/session";

export const metadata: Metadata = { title: "Notifications" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  await requirePageAccess("notification.view");
  return (
    <>
      <PageHeader title="Notifications" description="Every WhatsApp and SMS message sent." />
      <UpcomingScreen step={12} summary="Notification centre with delivery status and one-click resend." />
    </>
  );
}
