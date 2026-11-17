"use client";

import { ArrowLeftRight, Ban, ClipboardPen, Loader2, PackageCheck, Repeat, RotateCcw, ShoppingBag, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { releaseTradeIn } from "@/app/(app)/inventory/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { STORE } from "@/config/store";
import { UnitCondition } from "@/generated/prisma/enums";

import { IdentifierChip } from "@/components/identifier-chip";
import { AdjustUnitSection } from "@/components/inventory/adjust-stock";
import { Money } from "@/components/money";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CONDITION_LABELS, ConditionBadge, UnitStatusBadge } from "@/components/ui/status-badge";
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
  sale_voided: Ban,
  adjusted: ClipboardPen,
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

/** Owner inspects a traded-in device, sets condition and price, and releases it for sale. */
function ReleaseTradeIn({ unit }: { unit: UnitDetail["unit"] }) {
  const router = useRouter();
  const [condition, setCondition] = useState<UnitCondition>(unit.condition);
  const [battery, setBattery] = useState(unit.batteryHealth === null ? "" : String(unit.batteryHealth));
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function release() {
    setError(null);
    startTransition(async () => {
      const result = await releaseTradeIn({
        unitId: unit.id,
        condition,
        batteryHealth: battery === "" ? null : Number(battery),
        sellingPrice: price,
      });
      if (!result.ok) return setError(result.error);
      toast.success("Trade-in released for sale");
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="release-heading" className="mt-6 rounded-xl border border-warning-border bg-warning-bg p-4">
      <h3 id="release-heading" className="text-h3 text-foreground">
        Inspect and release for sale
      </h3>
      <p className="mb-3 text-small text-muted-foreground">Booked at the trade-in credit. Check it over, then set its selling price.</p>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-small font-medium">
          Condition
          <Select value={condition} onValueChange={(v) => setCondition(v as UnitCondition)}>
            <SelectTrigger className="w-full bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.values(UnitCondition).map((c) => (
                <SelectItem key={c} value={c}>
                  {CONDITION_LABELS[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex flex-col gap-1.5 text-small font-medium">
          Battery health %
          <Input type="number" min={0} max={100} value={battery} onChange={(e) => setBattery(e.target.value)} className="bg-background text-right tabular-nums" />
        </label>
        <label className="col-span-2 flex flex-col gap-1.5 text-small font-medium">
          Selling price
          <span className="relative">
            <span aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">{STORE.currencySymbol}</span>
            <Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className="bg-background pl-7 text-right tabular-nums" />
          </span>
        </label>
      </div>
      {error && <p role="alert" className="mt-2 text-small text-danger">{error}</p>}
      <Button className="mt-3 w-full" disabled={pending || !price.trim()} onClick={release}>
        {pending && <Loader2 aria-hidden className="animate-spin" />}
        Release for sale
      </Button>
    </section>
  );
}

/** Right-side detail sheet for one device (DESIGN.md §4 "Detail sheet", §5.7 history timeline). */
export function UnitSheet({
  detail,
  error,
  canReleaseTradeIns = false,
  canAdjust = false,
}: {
  detail: UnitDetail | null;
  error: string | null;
  canReleaseTradeIns?: boolean;
  canAdjust?: boolean;
}) {
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
              {detail.unit.status === "TRADED_IN" && canReleaseTradeIns && <ReleaseTradeIn key={detail.unit.id} unit={detail.unit} />}
              {canAdjust && <AdjustUnitSection key={`${detail.unit.id}:${detail.unit.status}`} unitId={detail.unit.id} status={detail.unit.status} />}

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
