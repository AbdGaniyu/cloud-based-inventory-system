import { AlertTriangle, ArrowRight, Check, Info, XCircle } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ReceivePanel } from "@/app/(app)/transfers/[id]/receive-panel";
import { TransferControls } from "@/app/(app)/transfers/[id]/transfer-controls";
import { IdentifierChip } from "@/components/identifier-chip";
import { PageBody } from "@/components/shell/page-body";
import { SectionHeader } from "@/components/shell/page-header";
import { PageSkeleton } from "@/components/shell/page-skeleton";
import { SummaryBand } from "@/components/summary-band";
import { ConditionBadge, TransferStatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { requirePageAccess } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";
import { getTransfer, type TransferDetail } from "@/server/services/transfer.service";

export const metadata: Metadata = { title: "Transfer" };

const dateTime = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });

export default function TransferPage({ params, searchParams }: PageProps<"/transfers/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={params} searchParams={searchParams} />
    </Suspense>
  );
}

/** Draft → In transit → Received (DESIGN.md §4 "Stepper"). */
function Stepper({ transfer }: { transfer: TransferDetail }) {
  const steps = [
    { label: "Draft", at: transfer.createdAt, by: transfer.createdBy },
    { label: "In transit", at: transfer.shippedAt, by: transfer.shippedBy },
    { label: "Received", at: transfer.receivedAt, by: transfer.receivedBy },
  ];
  const current = transfer.status === "DRAFT" ? 0 : transfer.status === "IN_TRANSIT" ? 1 : transfer.status === "RECEIVED" ? 2 : -1;
  return (
    <ol className="flex flex-wrap items-center gap-2" aria-label="Transfer progress">
      {steps.map((step, index) => {
        const done = step.at !== null && (current >= index || transfer.status === "CANCELLED");
        const active = index === current;
        return (
          <li key={step.label} className="flex items-center gap-2">
            {index > 0 && <span aria-hidden className={cn("h-px w-8 md:w-16", done ? "bg-foreground" : "bg-border")} />}
            <span
              aria-current={active ? "step" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-full border px-3 py-1 text-small",
                active ? "border-foreground bg-foreground text-background" : done ? "border-border-strong" : "border-border text-muted-foreground",
              )}
            >
              {done && !active ? <Check aria-hidden className="size-3.5" /> : <span aria-hidden className="tabular-nums">{index + 1}</span>}
              {step.label}
            </span>
          </li>
        );
      })}
      {transfer.status === "CANCELLED" && (
        <li className="flex items-center gap-2">
          <span aria-hidden className="h-px w-8 bg-border md:w-16" />
          <span aria-current="step" className="flex items-center gap-1.5 rounded-full border border-neutral-border bg-neutral-bg px-3 py-1 text-small text-neutral">
            <XCircle aria-hidden className="size-3.5" /> Cancelled
          </span>
        </li>
      )}
    </ol>
  );
}

async function Content({ params, searchParams }: { params: PageProps<"/transfers/[id]">["params"]; searchParams: PageProps<"/transfers/[id]">["searchParams"] }) {
  const ctx = await requirePageAccess("transfer.view");
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const transfer = await getTransfer(ctx, id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const receiving = query.receive === "1" && transfer.can.receive;
  const received = transfer.status === "RECEIVED";

  const events = [
    { at: transfer.createdAt, title: "Draft created", meta: transfer.createdBy },
    transfer.shippedAt && { at: transfer.shippedAt, title: "Shipped", meta: [transfer.shippedBy, transfer.driverName && `driver ${transfer.driverName}`].filter(Boolean).join(" · ") },
    transfer.receivedAt && { at: transfer.receivedAt, title: transfer.hasDiscrepancy ? "Received with a shortfall" : "Received in full", meta: transfer.receivedBy ?? "" },
    transfer.cancelledAt && { at: transfer.cancelledAt, title: "Cancelled", meta: [transfer.cancelledBy, transfer.cancelReason].filter(Boolean).join(" · ") },
  ].filter((e): e is { at: string; title: string; meta: string } => Boolean(e));

  return (
    <>
      <SummaryBand
        title={`Transfer ${transfer.number}`}
        actions={
          <TransferControls
            transfer={{
              id: transfer.id,
              number: transfer.number,
              status: transfer.status,
              driverName: transfer.driverName,
              devices: transfer.totals.devices,
              accessoryQuantity: transfer.totals.accessoryQuantity,
              toName: transfer.to.name,
              fromName: transfer.from.name,
              can: transfer.can,
            }}
          />
        }
        items={[
          { label: "From", value: <span className="text-h2">{transfer.from.name}</span>, sub: transfer.from.address },
          { label: "To", value: <span className="text-h2">{transfer.to.name}</span>, sub: transfer.to.address },
          { label: "Devices", value: transfer.totals.devices, sub: "Tracked by IMEI / serial" },
          { label: "Accessories", value: transfer.totals.accessoryQuantity, sub: `${transfer.totals.lines} manifest lines` },
          { label: "Status", value: <TransferStatusBadge status={transfer.status} />, sub: transfer.driverName ? `Driver: ${transfer.driverName}` : "No driver recorded" },
        ]}
      />
      <PageBody className="flex flex-col gap-5">
        <Stepper transfer={transfer} />

        {transfer.status === "IN_TRANSIT" && (
          <p role="status" className="flex items-center gap-2 rounded-lg border border-info-border bg-info-bg px-4 py-3 text-body text-info">
            <Info aria-hidden className="size-4 shrink-0" /> These items are locked from sale until received.
          </p>
        )}
        {received && transfer.hasDiscrepancy && (
          <p role="status" className="flex items-center gap-2 rounded-lg border border-warning-border bg-warning-bg px-4 py-3 text-body text-warning">
            <AlertTriangle aria-hidden className="size-4 shrink-0" /> Received short — see the notes on the manifest below.
          </p>
        )}
        {transfer.status === "CANCELLED" && (
          <p role="status" className="flex items-center gap-2 rounded-lg border border-neutral-border bg-neutral-bg px-4 py-3 text-body text-neutral">
            <XCircle aria-hidden className="size-4 shrink-0" /> Cancelled{transfer.cancelReason ? `: ${transfer.cancelReason}` : ""}. Stock stayed at or returned to {transfer.from.name}.
          </p>
        )}

        {receiving ? (
          <ReceivePanel transferId={transfer.id} number={transfer.number} items={transfer.items} />
        ) : (
          <section aria-labelledby="manifest-heading">
            <SectionHeader id="manifest-heading" title="Manifest" description={<span className="flex items-center gap-1.5 font-mono text-small">{transfer.from.code} <ArrowRight aria-label="to" className="size-3.5" /> {transfer.to.code}</span>} />
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-small">
                <caption className="sr-only">Items on {transfer.number}</caption>
                <thead className="bg-surface text-caption text-muted-foreground uppercase">
                  <tr className="border-b border-border">
                    <th scope="col" className="h-10 w-10 px-3 text-left font-medium">#</th>
                    <th scope="col" className="px-3 text-left font-medium">Product</th>
                    <th scope="col" className="px-3 text-left font-medium">IMEI / serial</th>
                    <th scope="col" className="px-3 text-left font-medium">Condition</th>
                    <th scope="col" className="px-3 text-right font-medium">Qty</th>
                    {received && <th scope="col" className="px-3 text-right font-medium">Received</th>}
                  </tr>
                </thead>
                <tbody>
                  {transfer.items.map((item, index) => {
                    const short = item.receivedQuantity !== null && item.receivedQuantity < item.quantity;
                    return (
                      <tr key={item.id} className={cn("h-11 border-b border-border last:border-b-0", short && "bg-warning-bg")}>
                        <td className="px-3 text-muted-foreground tabular-nums">{index + 1}</td>
                        <td className="px-3 py-2">
                          <p className="font-medium text-body">{item.productName}</p>
                          {item.discrepancyNote && <p className="text-small text-warning">{item.discrepancyNote}</p>}
                        </td>
                        <td className="px-3">{item.identifier ? <IdentifierChip value={item.identifier} /> : <span className="font-mono text-muted-foreground">{item.sku}</span>}</td>
                        <td className="px-3">{item.condition ? <ConditionBadge condition={item.condition} /> : "—"}</td>
                        <td className="px-3 text-right tabular-nums">{item.quantity}</td>
                        {received && <td className={cn("px-3 text-right tabular-nums", short && "font-medium text-warning")}>{item.receivedQuantity ?? "—"}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section aria-labelledby="activity-heading">
          <SectionHeader id="activity-heading" title="Activity" />
          <ol className="relative ml-3 border-l border-border">
            {events.map((event) => (
              <li key={event.title} className="mb-4 ml-5 last:mb-0">
                <span aria-hidden className="absolute -left-1.5 mt-1.5 size-3 rounded-full border-2 border-background bg-foreground" />
                <p className="text-body font-medium">{event.title}</p>
                <p className="text-small text-muted-foreground">
                  {event.meta} · {dateTime.format(new Date(event.at))}
                </p>
              </li>
            ))}
          </ol>
          {transfer.notes && <p className="mt-4 rounded-lg bg-surface p-3 text-small text-muted-foreground">Note: {transfer.notes}</p>}
        </section>
      </PageBody>
    </>
  );
}
