import { Mail, MapPin, Phone } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PayablesTable } from "@/components/ledger/payables-table";
import { Money } from "@/components/money";
import { PageBody } from "@/components/shell/page-body";
import { SectionHeader } from "@/components/shell/page-header";
import { PageSkeleton } from "@/components/shell/page-skeleton";
import { SummaryBand } from "@/components/summary-band";
import { formatPhoneDisplay } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { requirePageAccess } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";
import { getSupplierProfile } from "@/server/services/payables.service";

export const metadata: Metadata = { title: "Supplier" };

const dateTime = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });
const METHOD = { CASH: "Cash", BANK_TRANSFER: "Bank transfer", POS_CARD: "Card" } as const;

export default function SupplierPage({ params }: PageProps<"/suppliers/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={params} />
    </Suspense>
  );
}

/** Supplier profile (CLAUDE.md §7.2): running payable balance, purchase orders, payouts. */
async function Content({ params }: { params: PageProps<"/suppliers/[id]">["params"] }) {
  const ctx = await requirePageAccess("payables.view");
  const { id } = await params;
  const supplier = await getSupplierProfile(ctx, id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const contact = [
    supplier.phone ? { icon: Phone, text: formatPhoneDisplay(supplier.phone) } : null,
    supplier.email ? { icon: Mail, text: supplier.email } : null,
    supplier.address ? { icon: MapPin, text: supplier.address } : null,
  ].filter((c) => c !== null);

  return (
    <>
      <SummaryBand
        title={supplier.name}
        actions={
          contact.length > 0 && (
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-small text-muted-foreground">
              {supplier.contactPerson && <li>{supplier.contactPerson}</li>}
              {contact.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-1.5">
                  <Icon aria-hidden className="size-3.5" /> {text}
                </li>
              ))}
            </ul>
          )
        }
        items={[
          { label: "Balance owed", value: <Money value={supplier.balance} /> },
          { label: "Overdue", value: <Money value={supplier.overdueBalance} />, tone: Number(supplier.overdueBalance) > 0 ? "danger" : undefined },
          { label: "Purchased to date", value: <Money value={supplier.totalPurchased} /> },
        ]}
      />
      <PageBody className="flex flex-col gap-8">
        <section aria-labelledby="orders-heading">
          <SectionHeader id="orders-heading" title="Purchase orders" description="Record a payout against the order it settles." />
          <PayablesTable rows={supplier.orders} showSupplier={false} />
        </section>
        <section aria-labelledby="payouts-heading">
          <SectionHeader id="payouts-heading" title="Payouts" />
          {supplier.payments.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-body text-muted-foreground">No payouts yet.</p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {supplier.payments.map((p) => (
                <li key={p.id} className={cn("flex flex-wrap items-center gap-3 px-4 py-3 text-body", p.isReversal && "text-muted-foreground")}>
                  <span className="w-44 text-muted-foreground tabular-nums">{dateTime.format(new Date(p.paidAt))}</span>
                  <span className="font-mono text-small">{p.purchaseOrderNumber}</span>
                  <span className="flex-1">
                    {p.isReversal ? "Reversal" : METHOD[p.method]} · {p.paidByName}
                  </span>
                  {p.reference && <span className="font-mono text-small text-muted-foreground">{p.reference}</span>}
                  <Money value={p.amount} className="font-medium" />
                </li>
              ))}
            </ul>
          )}
        </section>
      </PageBody>
    </>
  );
}
