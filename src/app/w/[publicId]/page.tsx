import { CheckCircle2, ShieldOff, ShieldQuestion, TimerOff } from "lucide-react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { CONDITION_LABELS } from "@/components/ui/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { STORE } from "@/config/store";
import { formatPhoneDisplay } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { getPublicWarranty } from "@/server/services/document.service";

export const metadata: Metadata = { title: "Warranty check", robots: { index: false, follow: false } };

const calendar = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const format = (date: string) => calendar.format(new Date(`${date}T00:00:00Z`));

/** Public warranty verification (DESIGN.md §6.3): device facts only, IMEI masked, no customer data. */
export default function WarrantyCheckPage({ params }: PageProps<"/w/[publicId]">) {
  return (
    <main className="flex min-h-dvh items-start justify-center bg-surface px-4 py-10 sm:items-center">
      <div className="w-full max-w-md">
        <p className="mb-4 text-center text-h3 font-semibold">{STORE.name}</p>
        <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
          <WarrantyCard params={params} />
        </Suspense>
        <p className="mt-6 text-center text-small text-muted-foreground">
          Questions about this warranty? Visit any {STORE.name} branch with your invoice, call{" "}
          <a href={`tel:${STORE.contact.phone}`} className="underline-offset-4 hover:underline">
            {formatPhoneDisplay(STORE.contact.phone)}
          </a>{" "}
          or email{" "}
          <a href={`mailto:${STORE.contact.email}`} className="underline-offset-4 hover:underline">
            {STORE.contact.email}
          </a>
          .
        </p>
      </div>
    </main>
  );
}

async function WarrantyCard({ params }: { params: PageProps<"/w/[publicId]">["params"] }) {
  const { publicId } = await params;
  // Status depends on today's date: always render at request time.
  await connection();
  const warranty = await getPublicWarranty(publicId);

  if (!warranty) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center">
        <ShieldQuestion aria-hidden className="mx-auto size-10 text-muted-foreground" />
        <h1 className="mt-3 text-h2">We couldn&apos;t find this warranty</h1>
        <p className="mt-1 text-body text-muted-foreground">Check the code on your warranty card, or scan its QR code again.</p>
      </div>
    );
  }

  const banner = {
    ACTIVE: { tone: "border-success-border bg-success-bg text-success", icon: CheckCircle2, text: `Warranty active · expires ${format(warranty.expiresAt)}` },
    EXPIRED: { tone: "border-neutral-border bg-neutral-bg text-neutral", icon: TimerOff, text: `Warranty expired on ${format(warranty.expiresAt)}` },
    VOID: { tone: "border-danger-border bg-danger-bg text-danger", icon: ShieldOff, text: "Warranty void" },
  }[warranty.status];
  const Icon = banner.icon;
  const rows: [string, string, boolean?][] = [
    ["Device", warranty.deviceName],
    ...(warranty.spec ? ([["Specification", warranty.spec]] as [string, string][]) : []),
    ["IMEI / serial", warranty.maskedIdentifier, true],
    ["Condition when sold", CONDITION_LABELS[warranty.condition]],
    ["Bought at", `${STORE.name} ${warranty.branchName}`],
    ["Purchase date", format(warranty.purchasedOn)],
    ["Covered until", format(warranty.expiresAt)],
    ["Warranty ID", warranty.publicId, true],
  ];

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div role="status" className={cn("flex items-center gap-3 border-b px-5 py-5", banner.tone)}>
        <Icon aria-hidden className="size-7 shrink-0" />
        <h1 className="text-h2 font-semibold">{banner.text}</h1>
      </div>
      <dl className="divide-y divide-border px-5">
        {rows.map(([label, value, mono]) => (
          <div key={label} className="flex items-baseline justify-between gap-4 py-3">
            <dt className="text-body text-muted-foreground">{label}</dt>
            <dd className={cn("text-right text-body font-medium", mono && "font-mono tracking-wide")}>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
