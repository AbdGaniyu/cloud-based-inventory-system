"use client";

import { ArrowLeftRight, PackageCheck, Repeat, RotateCcw, ShoppingBag, XCircle } from "lucide-react";
import Link from "next/link";

import { IdentifierChip } from "@/components/identifier-chip";
import { Money } from "@/components/money";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ConditionBadge, UnitStatusBadge } from "@/components/ui/status-badge";
import { useUrlParams } from "@/hooks/use-url-params";
import type { UnitDetail, UnitEvent } from "@/server/services/inventory.service";

const EVENT_ICONS: Record<UnitEvent["kind"], typeof PackageCheck> = {
  received: PackageCheck,
  traded_in: Repeat,
  transfer_shipped: ArrowLeftRight,
  transfer_received: PackageCheck,
  transfer_cancelled: XCircle,
  sold: ShoppingBag,
  returned: RotateCcw,
};

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" });

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-2.5 last:border-b-0">
      <dt className="text-body text-muted-foreground">{label}</dt>
      <dd className="text-right text-body text-foreground">{children}</dd>
    </div>
  );
}

/** Right-side detail sheet for one device (DESIGN.md §4 "Detail sheet", §5.7 history timeline). */
export function UnitSheet({ detail, error }: { detail: UnitDetail | null; error: string | null }) {
  const { setParams } = useUrlParams();
  const open = Boolean(detail || error);
  const close = () => setParams({ unit: null }, { keepPage: true });

  return (
    <Sheet open={open} onOpenChange={(value) => !value && close()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[480px]">
        {error || !detail ? (
          <SheetHeader className="p-6">
            <SheetTitle>Device not available</SheetTitle>
            <SheetDescription>{error}</SheetDescription>
          </SheetHeader>
        ) : (
          <>
            <SheetHeader className="border-b border-border p-6">
              <div className="flex flex-wrap items-center gap-2">
                <UnitStatusBadge status={detail.unit.status} />
                <ConditionBadge condition={detail.unit.condition} />
              </div>
              <SheetTitle className="mt-2 text-h2">{detail.unit.productName}</SheetTitle>
              <SheetDescription className="flex flex-wrap gap-1.5">
                {detail.unit.imei && <IdentifierChip value={detail.unit.imei} />}
                {detail.unit.serialNumber && <IdentifierChip value={detail.unit.serialNumber} />}
              </SheetDescription>
            </SheetHeader>
            <div className="p-6">
              <dl>
                <Row label="Branch">
                  {detail.unit.branchName} <span className="font-mono text-small text-muted-foreground">{detail.unit.branchCode}</span>
                </Row>
                {detail.unit.storage && <Row label="Storage">{detail.unit.storage}</Row>}
                {detail.unit.ram && <Row label="RAM">{detail.unit.ram}</Row>}
                {detail.unit.color && <Row label="Colour">{detail.unit.color}</Row>}
                {detail.unit.batteryHealth !== null && <Row label="Battery health">{detail.unit.batteryHealth}%</Row>}
                <Row label="Received">
                  {dateFormat.format(new Date(detail.unit.receivedAt))}{" "}
                  <span className="text-muted-foreground">· {detail.unit.daysInStock} days ago</span>
                </Row>
                <Row label="Selling price">
                  <Money value={detail.unit.sellingPrice} className="font-medium" />
                </Row>
                {detail.unit.costPrice && (
                  <Row label="Cost">
                    <Money value={detail.unit.costPrice} />
                  </Row>
                )}
              </dl>
              {detail.unit.notes && <p className="mt-4 rounded-lg bg-surface p-3 text-small text-muted-foreground">{detail.unit.notes}</p>}

              <h3 className="mt-8 mb-3 text-h3">History</h3>
              {detail.events.length === 0 ? (
                <p className="text-body text-muted-foreground">No movements recorded yet.</p>
              ) : (
                <ol className="relative ml-3 border-l border-border">
                  {detail.events.map((event, index) => {
                    const Icon = EVENT_ICONS[event.kind];
                    return (
                      <li key={`${event.kind}-${index}`} className="mb-5 ml-6 last:mb-0">
                        <span className="absolute -left-3 flex size-6 items-center justify-center rounded-full border border-border bg-background">
                          <Icon aria-hidden className="size-3.5 text-muted-foreground" />
                        </span>
                        <p className="text-body font-medium text-foreground">
                          {event.href ? (
                            <Link href={event.href} className="hover:underline">
                              {event.title}
                            </Link>
                          ) : (
                            event.title
                          )}
                        </p>
                        <p className="text-small text-muted-foreground">
                          {event.meta} · {dateFormat.format(new Date(event.at))}
                        </p>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
