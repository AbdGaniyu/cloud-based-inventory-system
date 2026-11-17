"use client";

import { Download, Eraser, Loader2, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { erasePersonalData, markNoticeGiven } from "@/app/(app)/customers/[id]/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

const when = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" });

/** NDPA: privacy notice record for everyone; export and erasure for the owner. */
export function PrivacyPanel({
  customerId,
  noticeGivenAt,
  noticeGivenByName,
  canRecord,
  canManage,
  owes,
}: {
  customerId: string;
  noticeGivenAt: string | null;
  noticeGivenByName: string | null;
  canRecord: boolean;
  canManage: boolean;
  owes: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [erasing, setErasing] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <section aria-labelledby="privacy-heading" className="rounded-xl border border-border bg-card p-5">
      <h2 id="privacy-heading" className="mb-2 flex items-center gap-2 text-h3">
        <ShieldCheck aria-hidden className="size-4" /> Privacy
      </h2>
      <p className="text-body">
        {noticeGivenAt ? (
          <>Privacy notice given {when.format(new Date(noticeGivenAt))}{noticeGivenByName ? ` by ${noticeGivenByName}` : ""}.</>
        ) : (
          <span className="text-warning">No record that this customer was given the privacy notice.</span>
        )}
      </p>
      {!noticeGivenAt && canRecord && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="mt-2"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await markNoticeGiven(customerId);
              if (!r.ok) return void toast.error(r.error);
              toast.success("Recorded");
              router.refresh();
            })
          }
        >
          {pending && <Loader2 aria-hidden className="animate-spin" />} I&apos;ve told them now
        </Button>
      )}
      {canManage && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
          <Button asChild size="sm" variant="secondary">
            <a href={`/api/customers/${customerId}/export`} download>
              <Download aria-hidden data-icon="inline-start" /> Export their data
            </a>
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setErasing(true)}>
            <Eraser aria-hidden data-icon="inline-start" /> Erase personal details
          </Button>
        </div>
      )}
      <Dialog open={erasing} onOpenChange={setErasing}>
        <DialogContent className="sm:max-w-md">
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              startTransition(async () => {
                const r = await erasePersonalData({ customerId, reason });
                if (!r.ok) return setError(r.error);
                setErasing(false);
                toast.success("Personal details erased");
                router.refresh();
              });
            }}
          >
            <DialogHeader>
              <DialogTitle>Erase this customer&apos;s personal details?</DialogTitle>
              <DialogDescription>
                For a customer who asked to be forgotten. Their name, phone, email, address, notes, guarantor details and message texts are removed
                for good and no more messages go out. Invoices, payments and warranties stay (tax law) under &ldquo;Erased customer&rdquo;.
              </DialogDescription>
            </DialogHeader>
            {owes ? (
              <p role="alert" className="rounded-lg border border-warning-border bg-warning-bg p-3 text-body">
                This customer still owes money. Settle or waive the balance first.
              </p>
            ) : (
              <label className="flex flex-col gap-1.5 text-small font-medium">
                Who asked, and how
                <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer asked in person at Ikeja, 17 Nov; ID checked" autoFocus />
              </label>
            )}
            {error && <p role="alert" className="text-small text-danger">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setErasing(false)}>Cancel</Button>
              <Button type="submit" variant="destructive" disabled={pending || owes || reason.trim().length < 5}>
                {pending && <Loader2 aria-hidden className="animate-spin" />} Erase for good
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
