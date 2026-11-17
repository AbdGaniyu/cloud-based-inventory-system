"use client";

import { AlertTriangle, CheckCircle2, Circle, Loader2, ScanBarcode } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { receiveTransferAction } from "@/app/(app)/transfers/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUrlParams } from "@/hooks/use-url-params";
import { normalizeIdentifier } from "@/lib/identifiers";
import { cn } from "@/lib/utils";
import type { TransferItemView } from "@/server/services/transfer.service";

/**
 * Receiving checklist (DESIGN.md §5.9): every device is scanned or ticked, accessory quantities
 * confirmed. Short accessories raise a Warning banner before completing; missing devices block.
 */
export function ReceivePanel({ transferId, number, items }: { transferId: string; number: string; items: TransferItemView[] }) {
  const router = useRouter();
  const { setParams } = useUrlParams();
  const devices = items.filter((i) => i.serializedUnitId);
  const accessories = items.filter((i) => !i.serializedUnitId);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [quantities, setQuantities] = useState<Record<string, number>>(Object.fromEntries(accessories.map((a) => [a.id, a.quantity])));
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [scan, setScan] = useState("");
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(id: string, value?: boolean) {
    setTicked((current) => {
      const next = new Set(current);
      if (value ?? !next.has(id)) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function onScan() {
    const value = normalizeIdentifier(scan);
    setScan("");
    if (!value) return;
    const match = devices.find((d) => d.identifier === value);
    if (!match) return setScanMessage(`${value} is not on this transfer.`);
    toggle(match.id, true);
    setScanMessage(`${value} ✓ ${match.productName}`);
  }

  const missingDevices = devices.filter((d) => !ticked.has(d.id));
  const short = accessories.filter((a) => (quantities[a.id] ?? 0) < a.quantity);

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await receiveTransferAction({
        transferId,
        items: items.map((item) => ({
          itemId: item.id,
          receivedQuantity: item.serializedUnitId ? (ticked.has(item.id) ? 1 : 0) : (quantities[item.id] ?? 0),
          note: notes[item.id],
        })),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(result.data.hasDiscrepancy ? `${number} received with a shortfall recorded` : `${number} received`);
      setParams({ receive: null });
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="receive-heading" className="rounded-xl border-2 border-primary bg-card">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
        <div className="mr-auto">
          <h2 id="receive-heading" className="text-h3">
            Receive {number}
          </h2>
          <p className="text-small text-muted-foreground">Scan or tick each device, and count the accessories.</p>
        </div>
        <Button variant="ghost" onClick={() => setParams({ receive: null })}>
          Close
        </Button>
      </header>

      <div className="flex flex-col gap-5 p-5">
        {devices.length > 0 && (
          <div>
            <div className="relative max-w-md">
              <ScanBarcode aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={scan}
                onChange={(e) => setScan(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onScan();
                  }
                }}
                placeholder="Scan each device's IMEI or serial"
                aria-label="Scan device to tick it off"
                className="pl-9 font-mono"
              />
            </div>
            {scanMessage && <p className="mt-1.5 text-small text-muted-foreground" aria-live="polite">{scanMessage}</p>}
            <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
              {devices.map((d) => {
                const done = ticked.has(d.id);
                return (
                  <li key={d.id}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2">
                      <input type="checkbox" checked={done} onChange={() => toggle(d.id)} className="sr-only" />
                      {done ? <CheckCircle2 aria-hidden className="size-5 text-success" /> : <Circle aria-hidden className="size-5 text-border-strong" />}
                      <span className="min-w-0 flex-1 truncate text-body">{d.productName}</span>
                      <span className="font-mono text-small">{d.identifier}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {accessories.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {accessories.map((a) => {
              const qty = quantities[a.id] ?? 0;
              const isShort = qty < a.quantity;
              return (
                <li key={a.id} className={cn("flex flex-wrap items-center gap-3 px-3 py-2", isShort && "bg-warning-bg")}>
                  <span className="min-w-0 flex-1 truncate text-body">{a.productName}</span>
                  <span className="text-small text-muted-foreground tabular-nums">{a.quantity} shipped</span>
                  <Input
                    type="number"
                    min={0}
                    max={a.quantity}
                    inputMode="numeric"
                    value={Number.isFinite(qty) ? qty : ""}
                    onChange={(e) => setQuantities((q) => ({ ...q, [a.id]: Math.max(0, Math.min(a.quantity, e.target.valueAsNumber || 0)) }))}
                    aria-label={`${a.productName} received`}
                    className="h-8 w-20 text-right tabular-nums"
                  />
                  {isShort && (
                    <Input
                      value={notes[a.id] ?? ""}
                      onChange={(e) => setNotes((n) => ({ ...n, [a.id]: e.target.value }))}
                      placeholder="What happened? e.g. carton damaged"
                      aria-label={`Note for ${a.productName} shortfall`}
                      className="h-8 min-w-56 flex-1"
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {short.length > 0 && (
          <p role="status" className="flex items-start gap-2 rounded-lg border border-warning-border bg-warning-bg p-3 text-small text-warning">
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
            {short.map((a) => `${a.quantity - (quantities[a.id] ?? 0)} × ${a.productName}`).join(", ")} short. Receiving records the shortfall on
            the transfer; the missing quantity is not added to stock.
          </p>
        )}
        {error && <p role="alert" className="rounded-lg bg-danger-bg p-3 text-small text-danger">{error}</p>}

        <div className="flex flex-wrap items-center gap-3">
          <Button size="lg" disabled={pending || missingDevices.length > 0} onClick={confirm}>
            {pending && <Loader2 aria-hidden className="animate-spin" />}
            Confirm receipt
          </Button>
          {missingDevices.length > 0 && (
            <p className="text-small text-muted-foreground">
              {missingDevices.length} device{missingDevices.length === 1 ? "" : "s"} still to scan. If a device is missing, don&apos;t receive — tell the owner.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
