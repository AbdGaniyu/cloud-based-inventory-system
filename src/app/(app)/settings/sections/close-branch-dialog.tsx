"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { closeBranch, loadBranchClosure } from "@/app/(app)/settings/actions";
import { LabeledField, useSave } from "@/app/(app)/settings/sections/form-bits";
import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { BranchClosurePreview } from "@/server/services/admin.service";

/** Close a branch and move its stock, staff and open accounts to another store, after a preview. */
export function CloseBranchDialog({ branchId, onClose }: { branchId: string; onClose: () => void }) {
  const [preview, setPreview] = useState<BranchClosurePreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const { save, pending, error } = useSave();

  useEffect(() => {
    let cancelled = false;
    loadBranchClosure(branchId).then((r) => {
      if (cancelled) return;
      if (!r.ok) return setLoadError(r.error);
      setPreview(r.data);
      if (r.data.targets.length === 1) setTarget(r.data.targets[0].id);
    });
    return () => {
      cancelled = true;
    };
  }, [branchId]);

  const targetName = preview?.targets.find((t) => t.id === target)?.name ?? "the chosen store";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{preview ? `Close ${preview.branch.name}` : "Close branch"}</DialogTitle>
          <DialogDescription>
            Everything it holds moves to another store and the branch stops appearing anywhere. Past sales, payments and returns keep the branch they happened at, and document
            numbers stay as issued.
          </DialogDescription>
        </DialogHeader>
        {loadError ? (
          <p role="alert" className="text-small text-danger">{loadError}</p>
        ) : !preview ? (
          <Skeleton className="h-40" />
        ) : (
          <div className="flex flex-col gap-4">
            <LabeledField label="Move everything to">
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Choose a store" /></SelectTrigger>
                <SelectContent>{preview.targets.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
            </LabeledField>
            <ul className="flex flex-col gap-1.5 rounded-xl border border-border p-4 text-body">
              <li>{preview.devices} device{preview.devices === 1 ? "" : "s"} and {preview.accessoryQuantity} accessor{preview.accessoryQuantity === 1 ? "y" : "ies"}</li>
              <li>{preview.staff.length === 0 ? "No staff" : `Staff: ${preview.staff.map((s) => s.name).join(", ")}`}</li>
              {preview.openInvoices.length > 0 && (
                <li>
                  Customer accounts still owing:{" "}
                  {preview.openInvoices.map((i, n) => (
                    <span key={i.number}>
                      {n > 0 && ", "}
                      <span className="font-mono">{i.number}</span> (<Money value={i.balance} />)
                    </span>
                  ))}
                </li>
              )}
              {preview.openPurchaseOrders.length > 0 && (
                <li>
                  Supplier bills still owed:{" "}
                  {preview.openPurchaseOrders.map((o, n) => (
                    <span key={o.number}>
                      {n > 0 && ", "}
                      <span className="font-mono">{o.number}</span> (<Money value={o.owed} />)
                    </span>
                  ))}
                </li>
              )}
              {preview.transfersToCancel.length > 0 && (
                <li className="text-warning">
                  Cancelled: {preview.transfersToCancel.map((t) => `${t.number} (${t.status === "IN_TRANSIT" ? "in transit — stock returns to its sender" : "draft"})`).join(", ")}
                </li>
              )}
            </ul>
            {error && <p role="alert" className="text-small text-danger">{error}</p>}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!preview || !target || pending}
            onClick={() => preview && save(() => closeBranch({ branchId: preview.branch.id, targetBranchId: target }), `${preview.branch.name} closed; everything moved to ${targetName}`, onClose)}
          >
            {pending && <Loader2 aria-hidden className="animate-spin" />}
            Move everything and close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
