"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { reversePayment, waiveBalance } from "@/app/(app)/ledger/actions";
import { MoneyInput } from "@/components/ledger/money-input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/money";
import type { ActionResult } from "@/server/action-result";

/** Shared body for owner-only ledger corrections: an optional amount, a required reason, audited server-side. */
function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  amountLabel,
  defaultAmount,
  confirmLabel,
  tone,
  onConfirm,
  success,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  amountLabel?: string;
  defaultAmount?: string;
  confirmLabel: string;
  tone: "destructive" | "default";
  onConfirm: (input: { amount: string; reason: string }) => Promise<ActionResult<unknown>>;
  success: string;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState(defaultAmount ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await onConfirm({ amount: amount.replace(/,/g, ""), reason });
      if (!result.ok) return setError(result.error);
      toast.success(success);
      onOpenChange(false);
      setReason("");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={confirm} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {amountLabel && (
            <label className="flex flex-col gap-1.5 text-small font-medium">
              {amountLabel}
              <MoneyInput value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
          )}
          <label className="flex flex-col gap-1.5 text-small font-medium">
            Reason
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={300} placeholder="Recorded in the audit log" />
          </label>
          {error && <p role="alert" className="text-small text-danger">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant={tone} disabled={pending || reason.trim().length < 5 || (amountLabel !== undefined && !amount.trim())}>
              {pending && <Loader2 aria-hidden className="animate-spin" />}
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function WaiveDebtButton({ invoiceId, balance }: { invoiceId: string; balance: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Waive debt
      </Button>
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title="Waive debt"
        description={`Forgive part or all of the ${formatMoney(balance)} balance. Waived instalments are never chased, starting with the last.`}
        amountLabel="Amount to waive"
        defaultAmount={balance}
        confirmLabel="Waive"
        tone="destructive"
        success="Debt waived"
        onConfirm={({ amount, reason }) => waiveBalance({ invoiceId, amount, reason })}
      />
    </>
  );
}

export function ReversePaymentButton({ paymentId, amount }: { paymentId: string; amount: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label={`Reverse payment of ${formatMoney(amount)}`}>
        Reverse
      </Button>
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title="Reverse payment"
        description={`Cancels the ${formatMoney(amount)} payment with an offsetting entry, for a bounced transfer or a payment recorded against the wrong invoice. The original stays on record.`}
        confirmLabel="Reverse payment"
        tone="destructive"
        success="Payment reversed"
        onConfirm={({ reason }) => reversePayment({ paymentId, reason })}
      />
    </>
  );
}
