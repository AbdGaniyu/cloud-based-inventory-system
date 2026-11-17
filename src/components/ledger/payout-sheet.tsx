"use client";

import { Banknote, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { paySupplier } from "@/app/(app)/ledger/actions";
import { MoneyInput } from "@/components/ledger/money-input";
import { Money } from "@/components/money";
import { Segmented } from "@/components/segmented";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatMoney, money } from "@/lib/money";

export type PayoutTarget = { purchaseOrderId: string; number: string; supplierName: string; totalCost: string; amountPaid: string; balance: string };

type Method = "CASH" | "BANK_TRANSFER" | "POS_CARD";
const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;

/** Record payout (DESIGN.md §5.5): pays one purchase order, never more than its balance. */
function PayoutForm({ target, onDone }: { target: PayoutTarget; onDone: () => void }) {
  const router = useRouter();
  const [amount, setAmount] = useState(target.balance);
  const [method, setMethod] = useState<Method>("BANK_TRANSFER");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const clean = amount.replace(/,/g, "").trim();
  const problem = !clean ? null : !AMOUNT.test(clean) || money(clean).lte(0) ? "Enter an amount like 500000" : money(clean).gt(target.balance) ? `More than the balance of ${formatMoney(target.balance)}` : null;
  const valid = Boolean(clean) && !problem;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await paySupplier({ purchaseOrderId: target.purchaseOrderId, amount: clean, method, reference, notes });
      if (!result.ok) return setError(result.error);
      toast.success(`Paid ${formatMoney(result.data.amount)} to ${result.data.supplierName} · ${result.data.purchaseOrderNumber} balance ${formatMoney(result.data.balance)}`);
      onDone();
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-1 flex-col">
      <div className="flex flex-col gap-5 p-6">
        <dl className="rounded-xl border border-border bg-surface p-4 text-body">
          <div className="flex justify-between py-0.5">
            <dt className="text-muted-foreground">Order total</dt>
            <dd><Money value={target.totalCost} /></dd>
          </div>
          <div className="flex justify-between py-0.5">
            <dt className="text-muted-foreground">Paid so far</dt>
            <dd><Money value={target.amountPaid} /></dd>
          </div>
          <div className="mt-1 flex justify-between border-t border-dashed border-border pt-2 font-semibold">
            <dt>Balance owed</dt>
            <dd><Money value={target.balance} /></dd>
          </div>
        </dl>
        <label className="flex flex-col gap-1.5 text-small font-medium">
          Amount
          <MoneyInput value={amount} onChange={(e) => setAmount(e.target.value)} className="h-12 text-[20px]" aria-invalid={problem !== null} autoFocus />
          {problem ? <span className="font-normal text-danger">{problem}</span> : valid && <span className="font-normal text-muted-foreground">Balance after this payout: {formatMoney(money(target.balance).minus(clean))}</span>}
        </label>
        <div className="flex flex-col gap-1.5">
          <span className="text-small font-medium">Method</span>
          <Segmented label="Payout method" value={method} onChange={setMethod} options={[{ value: "BANK_TRANSFER", label: "Transfer" }, { value: "CASH", label: "Cash" }, { value: "POS_CARD", label: "Card" }]} />
        </div>
        <label className="flex flex-col gap-1.5 text-small font-medium">
          Reference <span className="font-normal text-muted-foreground">(optional)</span>
          <Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} placeholder="Bank transfer reference" />
        </label>
        <label className="flex flex-col gap-1.5 text-small font-medium">
          Note <span className="font-normal text-muted-foreground">(optional)</span>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} />
        </label>
        {error && <p role="alert" className="text-small text-danger">{error}</p>}
      </div>
      <SheetFooter className="mt-auto border-t border-border p-4">
        <Button type="submit" size="lg" className="w-full" disabled={!valid || pending}>
          {pending ? <Loader2 aria-hidden className="animate-spin" /> : <Banknote aria-hidden data-icon="inline-start" />}
          Pay {valid ? formatMoney(clean) : "supplier"}
        </Button>
      </SheetFooter>
    </form>
  );
}

export function PayoutSheet({ target, onClose }: { target: PayoutTarget | null; onClose: () => void }) {
  return (
    <Sheet open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[440px]">
        <SheetHeader className="border-b border-border p-6">
          <SheetTitle className="text-h2">Record payout</SheetTitle>
          <SheetDescription>{target ? `${target.number} · ${target.supplierName}` : ""}</SheetDescription>
        </SheetHeader>
        {target && <PayoutForm key={target.purchaseOrderId} target={target} onDone={onClose} />}
      </SheetContent>
    </Sheet>
  );
}
