"use client";

import { Loader2, PackageCheck, Printer, Truck, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { cancelTransferAction, shipTransferAction } from "@/app/(app)/transfers/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useUrlParams } from "@/hooks/use-url-params";

/** Context-aware actions for one transfer (DESIGN.md §5.9). Destructive actions confirm and state the consequence. */
export function TransferControls({
  transfer,
}: {
  transfer: {
    id: string;
    number: string;
    status: string;
    driverName: string | null;
    devices: number;
    accessoryQuantity: number;
    toName: string;
    fromName: string;
    can: { ship: boolean; receive: boolean; cancel: boolean };
  };
}) {
  const router = useRouter();
  const { setParams } = useUrlParams();
  const [dialog, setDialog] = useState<"ship" | "cancel" | null>(null);
  const [driver, setDriver] = useState(transfer.driverName ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const shipped = transfer.status === "IN_TRANSIT" || transfer.status === "RECEIVED";
  const itemsText = [
    transfer.devices ? `${transfer.devices} device${transfer.devices === 1 ? "" : "s"}` : null,
    transfer.accessoryQuantity ? `${transfer.accessoryQuantity} accessor${transfer.accessoryQuantity === 1 ? "y" : "ies"}` : null,
  ]
    .filter(Boolean)
    .join(" and ");

  function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      toast.success(success);
      setDialog(null);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {shipped && (
        <Button asChild variant="secondary">
          <a href={`/api/pdf/waybill/${transfer.id}`} target="_blank" rel="noopener">
            <Printer aria-hidden data-icon="inline-start" /> Print waybill
          </a>
        </Button>
      )}
      {transfer.can.cancel && (
        <Button variant="secondary" onClick={() => setDialog("cancel")}>
          <XCircle aria-hidden data-icon="inline-start" /> Cancel transfer
        </Button>
      )}
      {transfer.can.ship && (
        <Button onClick={() => setDialog("ship")}>
          <Truck aria-hidden data-icon="inline-start" /> Mark as shipped
        </Button>
      )}
      {transfer.can.receive && (
        <Button onClick={() => setParams({ receive: "1" })}>
          <PackageCheck aria-hidden data-icon="inline-start" /> Receive stock
        </Button>
      )}
      {!transfer.can.ship && !transfer.can.receive && transfer.status === "IN_TRANSIT" && (
        <Link href="/transfers" className="text-small text-muted-foreground">
          Waiting for {transfer.toName} to receive
        </Link>
      )}

      <Dialog open={dialog === "ship"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="shadow-dialog sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ship {transfer.number}?</DialogTitle>
            <DialogDescription>
              {itemsText} will leave {transfer.fromName} and stay locked from sale until {transfer.toName} receives them.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="ship-driver">Driver (optional)</FieldLabel>
            <Input id="ship-driver" value={driver} onChange={(e) => setDriver(e.target.value)} placeholder="Name on the waybill" />
          </Field>
          {error && <p role="alert" className="text-small text-danger">{error}</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog(null)}>
              Not yet
            </Button>
            <Button
              disabled={pending}
              onClick={() => run(() => shipTransferAction({ transferId: transfer.id, driverName: driver }), `${transfer.number} shipped`)}
            >
              {pending && <Loader2 aria-hidden className="animate-spin" />}
              Mark as shipped
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "cancel"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="shadow-dialog sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel {transfer.number}?</DialogTitle>
            <DialogDescription>
              {transfer.status === "IN_TRANSIT"
                ? `${itemsText} will go back into stock at ${transfer.fromName} and can be sold again.`
                : "The draft is closed. No stock has moved."}
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="cancel-reason">Reason</FieldLabel>
            <Textarea id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="e.g. Van broke down, will resend tomorrow" />
          </Field>
          {error && <p role="alert" className="text-small text-danger">{error}</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog(null)}>
              Keep transfer
            </Button>
            <Button
              variant="destructive"
              disabled={pending || reason.trim().length < 3}
              onClick={() => run(() => cancelTransferAction({ transferId: transfer.id, reason }), `${transfer.number} cancelled`)}
            >
              {pending && <Loader2 aria-hidden className="animate-spin" />}
              Cancel transfer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
