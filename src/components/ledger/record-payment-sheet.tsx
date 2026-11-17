"use client";

import { Loader2, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { loadPaymentContext, recordPayment } from "@/app/(app)/ledger/actions";
import { MoneyInput } from "@/components/ledger/money-input";
import { Money } from "@/components/money";
import { CHANNEL_LABEL } from "@/components/notifications/use-messages";
import { Segmented } from "@/components/segmented";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { allocateSchedule } from "@/lib/ledger";
import { formatMoney, money } from "@/lib/money";
import type { PaymentContext } from "@/server/services/ledger.service";

type Method = "CASH" | "BANK_TRANSFER" | "POS_CARD";
const METHODS: { value: Method; label: string }[] = [
  { value: "CASH", label: "Cash" },
  { value: "BANK_TRANSFER", label: "Transfer" },
  { value: "POS_CARD", label: "POS card" },
];
const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;
const calendar = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const cal = (d: string) => calendar.format(new Date(`${d}T00:00:00Z`));

function listWords(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** "After this payment" (DESIGN.md §5.4): the new balance and which instalments it settles. */
function preview(context: PaymentContext, amountText: string): { balance: string; note: string } | { error: string } | null {
  const amount = amountText.replace(/,/g, "").trim();
  if (!amount) return null;
  if (!AMOUNT.test(amount) || money(amount).lte(0)) return { error: "Enter an amount like 250000 or 250000.50" };
  if (money(amount).gt(context.balance)) return { error: `More than the balance of ${formatMoney(context.balance)}` };
  const balance = money(context.balance).minus(amount).toFixed(2);
  if (context.schedule.length === 0) return { balance, note: money(balance).lte(0) ? "Settles the invoice." : "" };
  const after = allocateSchedule(context.schedule, { paid: money(context.installmentPaid).plus(amount), waived: context.waived, today: context.today }, context.schedule);
  const settled = after.newlySettled.map((s) => `#${s}`);
  const partial = after.rows.find((r, i) => !after.newlySettled.includes(r.sequence) && money(r.amountPaid).gt(context.schedule[i]?.amountPaid ?? 0));
  const parts = [settled.length ? `Settles instalment${settled.length > 1 ? "s" : ""} ${listWords(settled)}` : null, partial ? `part-pays #${partial.sequence}` : null].filter(Boolean);
  const tail = after.nextDueDate && money(balance).gt(0) ? ` Next due ${cal(after.nextDueDate)}.` : money(balance).lte(0) ? " Completes the plan." : "";
  return { balance, note: `${parts.join(", ")}${parts.length ? "." : ""}${tail}` };
}

export function RecordPaymentSheet({ invoiceId, onClose }: { invoiceId: string | null; onClose: () => void }) {
  const router = useRouter();
  const [context, setContext] = useState<PaymentContext | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<Method>("CASH");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!invoiceId) return;
    let cancelled = false;
    loadPaymentContext(invoiceId).then((result) => {
      if (cancelled) return;
      if (!result.ok) return setLoadError(result.error);
      setContext(result.data);
      setAmount(result.data.nextAmountDue ?? result.data.balance);
    });
    return () => {
      cancelled = true;
      setContext(null);
      setLoadError(null);
      setAmount("");
      setMethod("CASH");
      setReference("");
      setError(null);
    };
  }, [invoiceId]);

  const after = useMemo(() => (context ? preview(context, amount) : null), [context, amount]);
  const valid = after !== null && !("error" in after);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!context || !valid) return;
    setError(null);
    startTransition(async () => {
      const result = await recordPayment({ invoiceId: context.invoiceId, amount, method, reference });
      if (!result.ok) return setError(result.error);
      const c = result.data.confirmation;
      toast.success(
        `Payment recorded · ${c ? (c.status === "SKIPPED" ? "customer has opted out of messages" : `Confirmation queued to ${CHANNEL_LABEL[c.channel]}`) : "no confirmation sent"}`,
      );
      onClose();
      router.refresh();
    });
  }

  return (
    <Sheet open={invoiceId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[460px]">
        <SheetHeader className="border-b border-border p-6">
          <SheetTitle className="text-h2">Record payment</SheetTitle>
          <SheetDescription>{context ? `${context.number} · ${context.customerName}` : (loadError ?? "Loading invoice…")}</SheetDescription>
        </SheetHeader>
        {!context ? (
          !loadError && (
            <div className="flex flex-col gap-3 p-6">
              <Skeleton className="h-24" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          )
        ) : (
          <form onSubmit={submit} className="flex flex-1 flex-col">
            <div className="flex flex-col gap-5 p-6">
              <dl className="rounded-xl border border-border bg-surface p-4 text-body">
                <div className="flex justify-between py-0.5">
                  <dt className="text-muted-foreground">Total</dt>
                  <dd><Money value={context.total} /></dd>
                </div>
                <div className="flex justify-between py-0.5">
                  <dt className="text-muted-foreground">Paid so far</dt>
                  <dd><Money value={context.amountPaid} /></dd>
                </div>
                <div className="mt-1 flex justify-between border-t border-dashed border-border pt-2 font-semibold">
                  <dt>Balance</dt>
                  <dd><Money value={context.balance} /></dd>
                </div>
                <p className="mt-1 text-small text-muted-foreground">Sold at {context.branchName}</p>
              </dl>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="payment-amount" className="text-small font-medium">Amount</label>
                  <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => setAmount(context.balance)}>
                    Pay full balance
                  </Button>
                </div>
                <MoneyInput id="payment-amount" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-12 text-[20px]" aria-invalid={after !== null && "error" in after} aria-describedby="payment-after" autoFocus />
                {context.nextAmountDue && <p className="text-small text-muted-foreground">Next instalment: {formatMoney(context.nextAmountDue)}</p>}
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-small font-medium">Method</span>
                <Segmented label="Payment method" value={method} onChange={setMethod} options={METHODS} />
              </div>

              <label className="flex flex-col gap-1.5 text-small font-medium">
                Reference {method === "CASH" && <span className="font-normal text-muted-foreground">(optional)</span>}
                <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={method === "CASH" ? "Receipt book number" : "Transfer or terminal reference"} maxLength={80} />
              </label>

              <div id="payment-after" aria-live="polite" className="rounded-xl border border-border p-4">
                {after === null ? (
                  <p className="text-small text-muted-foreground">Enter an amount to see the new balance.</p>
                ) : "error" in after ? (
                  <p className="text-small text-danger">{after.error}</p>
                ) : (
                  <>
                    <p className="flex items-baseline justify-between text-body">
                      <span className="text-muted-foreground">After this payment</span>
                      <Money value={after.balance} className="text-h3 font-semibold" />
                    </p>
                    {after.note && <p className="mt-1 text-small text-muted-foreground">{after.note}</p>}
                  </>
                )}
              </div>
              {error && <p role="alert" className="text-small text-danger">{error}</p>}
              <p className="text-small text-muted-foreground">
                {context.messageChannel ? `A confirmation goes to the customer on ${CHANNEL_LABEL[context.messageChannel]}.` : "The customer has opted out of messages; no confirmation will be sent."}
              </p>
            </div>
            <SheetFooter className="mt-auto border-t border-border p-4">
              <Button type="submit" size="lg" className="w-full" disabled={!valid || pending}>
                {pending ? <Loader2 aria-hidden className="animate-spin" /> : <Wallet aria-hidden data-icon="inline-start" />}
                Record {valid ? formatMoney(amount.replace(/,/g, "")) : "payment"}
              </Button>
            </SheetFooter>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** A button that opens the sheet for one invoice. */
export function RecordPaymentButton({ invoiceId, children, ...props }: { invoiceId: string; children?: React.ReactNode } & Omit<React.ComponentProps<typeof Button>, "onClick">) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" {...props} onClick={() => setOpen(true)}>
        {children ?? "Record payment"}
      </Button>
      <RecordPaymentSheet invoiceId={open ? invoiceId : null} onClose={() => setOpen(false)} />
    </>
  );
}
