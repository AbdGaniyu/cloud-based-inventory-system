import { Boxes, PackagePlus, Printer } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { IdentifierChip } from "@/components/identifier-chip";
import { Money } from "@/components/money";
import { PageBody } from "@/components/shell/page-body";
import { SectionHeader } from "@/components/shell/page-header";
import { PageSkeleton } from "@/components/shell/page-skeleton";
import { SummaryBand, type SummaryItem } from "@/components/summary-band";
import { Button } from "@/components/ui/button";
import { ConditionBadge, PurchaseOrderStatusBadge } from "@/components/ui/status-badge";
import { requirePageAccess } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";
import { getIntake, intakeUnitCount } from "@/server/services/intake.service";

export const metadata: Metadata = { title: "Stock intake" };

const dateTime = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Africa/Lagos",
});
const dateOnly = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

const TERMS_LABELS: Record<string, string> = {
  PAID_IN_FULL: "Paid in full",
  PARTIAL_DEPOSIT: "Partial deposit",
  NET_7: "Net 7",
  NET_15: "Net 15",
  NET_30: "Net 30",
};

export default function IntakeDetailPage({ params }: PageProps<"/inventory/intake/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: { params: PageProps<"/inventory/intake/[id]">["params"] }) {
  const ctx = await requirePageAccess("intake.create");
  const { id } = await params;
  const summary = await getIntake(ctx, id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });

  const items: SummaryItem[] = [
    { label: "Supplier", value: <span className="text-h2">{summary.supplierName}</span>, sub: summary.supplierReference ?? "No supplier reference" },
    { label: "Received at", value: <span className="text-h2">{summary.branch.name}</span>, sub: `${dateTime.format(new Date(summary.receivedAt))} · ${summary.receivedBy}` },
    { label: "Items received", value: intakeUnitCount(summary).toLocaleString(), sub: `${summary.lines.length} product line${summary.lines.length === 1 ? "" : "s"}` },
    ...(summary.totalCost !== undefined
      ? [
          { label: "Total cost", value: <Money value={summary.totalCost} />, sub: summary.amountPaid ? <>Paid now <Money value={summary.amountPaid} /></> : undefined },
        ]
      : []),
    {
      label: "Terms",
      value: <span className="text-h2">{TERMS_LABELS[summary.paymentTerms]}</span>,
      sub: summary.dueDate ? `Balance due ${dateOnly.format(new Date(`${summary.dueDate}T00:00:00Z`))}` : "Nothing owed",
    },
  ];

  return (
    <>
      <SummaryBand
        title={`${summary.number} received`}
        items={items}
        actions={<PurchaseOrderStatusBadge status={summary.status} />}
      />
      <PageBody>
        <div className="mb-6 flex flex-wrap gap-2">
          <Button asChild>
            <Link href={`/print/intake/${summary.id}/labels`} target="_blank" rel="noopener">
              <Printer aria-hidden data-icon="inline-start" /> Print barcode labels
            </Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/inventory/intake">
              <PackagePlus aria-hidden data-icon="inline-start" /> Receive more stock
            </Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/inventory">
              <Boxes aria-hidden data-icon="inline-start" /> View inventory
            </Link>
          </Button>
        </div>

        <SectionHeader title="What was received" />
        <div className="flex flex-col gap-4">
          {summary.lines.map((line) => (
            <section key={line.productId} className="rounded-xl border border-border" aria-label={line.productName}>
              <header className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
                <div className="mr-auto">
                  <p className="text-body font-medium">{line.productName}</p>
                  <p className="font-mono text-small text-muted-foreground">{line.sku}</p>
                </div>
                <p className="text-body tabular-nums">
                  {line.quantity} {line.trackingType === "SERIALIZED" ? (line.quantity === 1 ? "device" : "devices") : "items"}
                </p>
                {line.trackingType === "NON_SERIALIZED" && <Money value={line.unitSellingPrice} className="text-muted-foreground" />}
              </header>
              {line.units.length > 0 && (
                <ul className="grid gap-x-6 gap-y-2 px-5 py-3 md:grid-cols-2 xl:grid-cols-3">
                  {line.units.map((unit) => (
                    <li key={unit.id} className="flex items-center justify-between gap-2">
                      <Link href={`/inventory?unit=${unit.id}`} className="min-w-0 hover:underline">
                        <IdentifierChip value={unit.identifier} />
                      </Link>
                      <span className="flex items-center gap-2">
                        <ConditionBadge condition={unit.condition} />
                        <Money value={unit.sellingPrice} className="text-small" />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </PageBody>
    </>
  );
}
