"use client";

import { Loader2, RotateCcw, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { loadReturnContext, submitReturn } from "@/app/(app)/invoices/actions";
import { Money } from "@/components/money";
import { Segmented } from "@/components/segmented";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney, money, sum } from "@/lib/money";
import { returnCredit } from "@/lib/returns";
import { cn } from "@/lib/utils";
import type { ReturnContext, ReturnResult } from "@/server/services/return.service";

type Method = "CASH" | "BANK_TRANSFER" | "POS_CARD";
type Disposition = "RESTOCK" | "DEFECTIVE";
type LinePick = { quantity: number; disposition: Disposition };
const METHOD_LABEL: Record<Method, string> = { CASH: "Cash", BANK_TRANSFER: "Transfer", POS_CARD: "POS card" };

function ResultPanel({ result, onDone }: { result: ReturnResult; onDone: () => void }) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-col gap-4 p-6">
        <p className="inline-flex w-fit items-center gap-1.5 rounded-full border border-success-border bg-success-bg px-2.5 py-0.5 text-small font-medium text-success" role="status">
          <span aria-hidden className="size-1.5 rounded-full bg-success" /> Return recorded
        </p>
        <p className="font-mono text-[22px]">{result.number}</p>
        <dl className="rounded-xl border border-border p-4 text-body">
          <div className="flex justify-between py-0.5">
            <dt className="text-muted-foreground">Credit</dt>
            <dd><Money value={result.creditAmount} /></dd>
          </div>
          <div className="flex justify-between py-0.5">
            <dt className="text-muted-foreground">Taken off what they owed</dt>
            <dd><Money value={result.appliedToBalance} /></dd>
          </div>
          <div className="mt-1 flex justify-between border-t border-dashed border-border pt-2 font-semibold">
            <dt>Refund {result.refundMethod ? `(${METHOD_LABEL[result.refundMethod as Method]})` : ""}</dt>
            <dd><Money value={result.refundAmount} /></dd>
          </div>
        </dl>
        {Number(result.refundAmount) > 0 && <p className="text-body">Give the customer {formatMoney(result.refundAmount)} now.</p>}
      </div>
      <SheetFooter className="mt-auto flex-col gap-2 border-t border-border p-4">
        <Button asChild size="lg" className="w-full">
          <Link href={`/pos?swap=${result.returnId}`}>Swap: start replacement sale</Link>
        </Button>
        <Button type="button" variant="secondary" size="lg" className="w-full" onClick={onDone}>
          Done
        </Button>
      </SheetFooter>
    </div>
  );
}

/** Return items (DESIGN.md §5.3 "More → Return"): pick lines and quantities, say why, refund the rest. */
export function ReturnSheet({ invoiceId, onClose }: { invoiceId: string | null; onClose: () => void }) {
  const router = useRouter();
  const [context, setContext] = useState<ReturnContext | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, LinePick>>({});
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState<Method>("CASH");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReturnResult | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!invoiceId) return;
    let cancelled = false;
    loadReturnContext(invoiceId).then((r) => {
      if (cancelled) return;
      if (r.ok) setContext(r.data);
      else setLoadError(r.error);
    });
    return () => {
      cancelled = true;
      setContext(null);
      setLoadError(null);
      setPicks({});
      setReason("");
      setMethod("CASH");
      setReference("");
      setError(null);
      setResult(null);
    };
  }, [invoiceId]);

  const preview = useMemo(() => {
    if (!context) return null;
    const credits = context.lines.flatMap((l) => {
      const p = picks[l.invoiceItemId];
      return p && p.quantity > 0 ? [returnCredit(l.creditValue, l.quantity, l.returnedQuantity, p.quantity)] : [];
    });
    if (credits.length === 0) return null;
    const credit = sum(credits);
    const applied = credit.lt(context.balance) ? credit : money(context.balance);
    return { credit: credit.toFixed(2), applied: applied.toFixed(2), refund: credit.minus(applied).toFixed(2) };
  }, [context, picks]);

  function setPick(id: string, next: Partial<LinePick>) {
    setPicks((current) => {
      const base: LinePick = current[id] ?? { quantity: 0, disposition: "RESTOCK" };
      return { ...current, [id]: { ...base, ...next } };
    });
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!context || !preview) return;
    setError(null);
    startTransition(async () => {
      const lines = Object.entries(picks)
        .filter(([, p]) => p.quantity > 0)
        .map(([invoiceItemId, p]) => ({ invoiceItemId, quantity: p.quantity, disposition: p.disposition }));
      const response = await submitReturn({ invoiceId: context.invoiceId, reason, lines, refundMethod: method, refundReference: reference });
      if (!response.ok) return setError(response.error);
      toast.success(`${response.data.number} recorded`);
      setResult(response.data);
      router.refresh();
    });
  }

  const blocked = context?.blockedByWindow ?? false;
  return (
    <Sheet open={invoiceId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[520px]">
        <SheetHeader className="border-b border-border p-6">
          <SheetTitle className="text-h2">Return items</SheetTitle>
          <SheetDescription>{context ? `${context.number} · ${context.customerName} · sold ${context.daysSinceSale === 0 ? "today" : `${context.daysSinceSale} day${context.daysSinceSale === 1 ? "" : "s"} ago`} at ${context.saleBranchName}` : (loadError ?? "Loading invoice…")}</SheetDescription>
        </SheetHeader>
        {result ? (
          <ResultPanel result={result} onDone={onClose} />
        ) : !context ? (
          !loadError && (
            <div className="flex flex-col gap-3 p-6">
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
          )
        ) : (
          <form onSubmit={submit} className="flex flex-1 flex-col">
            <div className="flex flex-col gap-5 p-6">
              {blocked && (
                <p role="alert" className="flex gap-2 rounded-xl border border-warning-border bg-warning-bg p-3 text-small text-warning">
                  <ShieldAlert aria-hidden className="size-4 shrink-0" />
                  This sale is past the {context.windowDays}-day return window. Ask the owner to take the return.
                </p>
              )}
              <fieldset className="flex flex-col gap-2" disabled={blocked}>
                <legend className="mb-1 text-small font-medium">What is coming back?</legend>
                {context.lines.map((line) => {
                  const left = line.quantity - line.returnedQuantity;
                  const pick = picks[line.invoiceItemId];
                  const chosen = (pick?.quantity ?? 0) > 0;
                  return (
                    <div key={line.invoiceItemId} className={cn("rounded-xl border p-3", chosen ? "border-foreground" : "border-border", left === 0 && "opacity-60")}>
                      <div className="flex items-start gap-3">
                        {line.serialized ? (
                          <input
                            type="checkbox"
                            className="mt-1 size-4 accent-[var(--primary)]"
                            aria-label={`Return ${line.description}`}
                            disabled={left === 0}
                            checked={chosen}
                            onChange={(e) => setPick(line.invoiceItemId, { quantity: e.target.checked ? 1 : 0 })}
                          />
                        ) : (
                          <Input
                            type="number"
                            min={0}
                            max={left}
                            value={pick?.quantity ?? 0}
                            disabled={left === 0}
                            aria-label={`Quantity of ${line.description} to return`}
                            onChange={(e) => setPick(line.invoiceItemId, { quantity: Math.max(0, Math.min(left, Number(e.target.value) || 0)) })}
                            className="h-8 w-16 text-right tabular-nums"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-body font-medium">{line.description}</p>
                          <p className="text-small text-muted-foreground">
                            {line.identifier && <span className="font-mono">{line.identifier} · </span>}
                            {left === 0 ? "Already returned" : line.serialized ? "1 sold" : `${left} of ${line.quantity} can come back`}
                          </p>
                        </div>
                      </div>
                      {chosen && (
                        <div className="mt-2 pl-7">
                          <Segmented
                            label={`Condition of ${line.description}`}
                            value={pick?.disposition ?? "RESTOCK"}
                            onChange={(d) => setPick(line.invoiceItemId, { disposition: d })}
                            options={[
                              { value: "RESTOCK", label: "Back into stock" },
                              { value: "DEFECTIVE", label: "Defective" },
                            ]}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </fieldset>

              <label className="flex flex-col gap-1.5 text-small font-medium">
                Reason
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} disabled={blocked} placeholder="e.g. Screen flickers out of the box" />
              </label>

              {preview && Number(preview.refund) > 0 && (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-small font-medium">Refund by</span>
                    <Segmented label="Refund method" value={method} onChange={setMethod} options={(Object.keys(METHOD_LABEL) as Method[]).map((m) => ({ value: m, label: METHOD_LABEL[m] }))} />
                  </div>
                  {method !== "CASH" && (
                    <label className="flex flex-col gap-1.5 text-small font-medium">
                      Reference <span className="font-normal text-muted-foreground">(optional)</span>
                      <Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} />
                    </label>
                  )}
                </div>
              )}

              <div aria-live="polite" className="rounded-xl border border-border p-4 text-body">
                {preview ? (
                  <dl>
                    <div className="flex justify-between py-0.5">
                      <dt className="text-muted-foreground">Credit for these items</dt>
                      <dd><Money value={preview.credit} /></dd>
                    </div>
                    {Number(preview.applied) > 0 && (
                      <div className="flex justify-between py-0.5">
                        <dt className="text-muted-foreground">Taken off what they still owe</dt>
                        <dd><Money value={preview.applied} /></dd>
                      </div>
                    )}
                    <div className="mt-1 flex justify-between border-t border-dashed border-border pt-2 font-semibold">
                      <dt>Refund</dt>
                      <dd><Money value={preview.refund} /></dd>
                    </div>
                  </dl>
                ) : (
                  <p className="text-small text-muted-foreground">Choose what is coming back to see the credit and refund.</p>
                )}
                {context.hasTradeIn && <p className="mt-2 text-small text-muted-foreground">Trade-in credit is shared across the items and is not paid out; the traded-in device stays with the store.</p>}
              </div>
              {error && <p role="alert" className="text-small text-danger">{error}</p>}
            </div>
            <SheetFooter className="mt-auto border-t border-border p-4">
              <Button type="submit" size="lg" className="w-full" disabled={!preview || reason.trim().length < 5 || pending || blocked}>
                {pending ? <Loader2 aria-hidden className="animate-spin" /> : <RotateCcw aria-hidden data-icon="inline-start" />}
                {preview && Number(preview.refund) > 0 ? `Record return and refund ${formatMoney(preview.refund)}` : "Record return"}
              </Button>
            </SheetFooter>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function ReturnItemsButton({ invoiceId, ...props }: { invoiceId: string } & Omit<React.ComponentProps<typeof Button>, "onClick">) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="secondary" {...props} onClick={() => setOpen(true)}>
        <RotateCcw aria-hidden data-icon="inline-start" /> Return items
      </Button>
      <ReturnSheet invoiceId={open ? invoiceId : null} onClose={() => setOpen(false)} />
    </>
  );
}
