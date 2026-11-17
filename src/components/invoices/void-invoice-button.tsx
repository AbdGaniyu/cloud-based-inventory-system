"use client";

import { Ban, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { loadVoidPreview, submitVoid } from "@/app/(app)/invoices/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/money";
import type { VoidPreview } from "@/server/services/void.service";

const METHOD_LABEL = { CASH: "in cash", BANK_TRANSFER: "by bank transfer", POS_CARD: "to the card (POS reversal)" } as const;

/** Void: loads what will happen (stock back, money to hand back by method), asks for a reason, confirms. */
export function VoidInvoiceButton({ invoiceId, number }: { invoiceId: string; number: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<VoidPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [pending, startTransition] = useTransition();

  function openDialog() {
    setOpen(true);
    setPreview(null);
    setLoadError(null);
    setError(null);
    startLoading(async () => {
      const r = await loadVoidPreview(invoiceId);
      if (r.ok) setPreview(r.data);
      else setLoadError(r.error);
    });
  }

  const goods = preview
    ? [preview.devices && `${preview.devices} device${preview.devices === 1 ? "" : "s"}`, preview.accessories && `${preview.accessories} accessor${preview.accessories === 1 ? "y" : "ies"}`].filter(Boolean).join(" and ")
    : "";

  return (
    <>
      <Button type="button" variant="ghost" onClick={openDialog}>
        <Ban aria-hidden data-icon="inline-start" /> Void
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              startTransition(async () => {
                const r = await submitVoid({ invoiceId, reason });
                if (!r.ok) return setError(r.error);
                setOpen(false);
                setReason("");
                toast.success(Number(r.data.refundTotal) > 0 ? `${r.data.number} voided. Hand back ${formatMoney(r.data.refundTotal)}.` : `${r.data.number} voided.`);
                router.refresh();
              });
            }}
          >
            <DialogHeader>
              <DialogTitle>Void invoice {number}?</DialogTitle>
              <DialogDescription>For a sale that should not have happened. The invoice stays on record marked VOID; this cannot be undone.</DialogDescription>
            </DialogHeader>
            {loading && <Skeleton className="h-28" />}
            {loadError && <p role="alert" className="text-small text-danger">{loadError}</p>}
            {preview?.blocker && <p role="alert" className="rounded-lg border border-warning-border bg-warning-bg p-3 text-body">{preview.blocker}</p>}
            {preview && !preview.blocker && (
              <>
                <ul className="flex list-disc flex-col gap-1 pl-5 text-body">
                  {goods && <li>{goods} {preview.devices + preview.accessories === 1 ? "goes" : "go"} back into stock at this branch.</li>}
                  {preview.refunds.length > 0 ? (
                    preview.refunds.map((r) => (
                      <li key={r.method}>
                        Hand back <strong className="tabular-nums">{formatMoney(r.amount)}</strong> {METHOD_LABEL[r.method]}.
                      </li>
                    ))
                  ) : (
                    <li>No money was taken, so nothing to hand back.</li>
                  )}
                  {preview.hasPlan && <li>The instalment plan is cancelled; no more reminders go out.</li>}
                  {preview.warranties > 0 && <li>{preview.warranties} warranty card{preview.warranties === 1 ? " is" : "s are"} voided.</li>}
                </ul>
                <label className="flex flex-col gap-1.5 text-small font-medium">
                  Reason
                  <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Rang up the wrong phone; customer bought the 256 GB instead" rows={3} autoFocus />
                </label>
              </>
            )}
            {error && <p role="alert" className="text-small text-danger">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" variant="destructive" disabled={pending || !preview || Boolean(preview.blocker) || reason.trim().length < 5}>
                {pending && <Loader2 aria-hidden className="animate-spin" />}
                Void invoice
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
