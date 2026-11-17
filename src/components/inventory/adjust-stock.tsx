"use client";

import { Loader2, SlidersHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { adjustAccessoryStock, adjustUnitStatus } from "@/app/(app)/inventory/actions";
import { Segmented } from "@/components/segmented";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { StockAdjustmentReason, UnitStatus } from "@/generated/prisma/enums";
import { ACCESSORY_REASONS, REASON_LABELS, unitTransitions } from "@/lib/stock-adjustments";

const STATUS_WORDS: Partial<Record<UnitStatus, string>> = { IN_STOCK: "Back in stock", DEFECTIVE: "Defective (not for sale)", WRITTEN_OFF: "Written off (lost, stolen, scrapped)" };

function ReasonFields({ reasons, reason, setReason, note, setNote }: { reasons: readonly StockAdjustmentReason[]; reason: StockAdjustmentReason | ""; setReason: (r: StockAdjustmentReason) => void; note: string; setNote: (n: string) => void }) {
  return (
    <>
      <label className="flex flex-col gap-1.5 text-small font-medium">
        Reason
        <Select value={reason} onValueChange={(v) => setReason(v as StockAdjustmentReason)}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Choose a reason" />
          </SelectTrigger>
          <SelectContent>
            {reasons.map((r) => (
              <SelectItem key={r} value={r}>
                {REASON_LABELS[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="flex flex-col gap-1.5 text-small font-medium">
        Note {reason === "OTHER" ? "" : <span className="font-normal text-muted-foreground">(optional)</span>}
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What happened, who found it, police report number…" />
      </label>
    </>
  );
}

/** Owner: change an accessory's quantity at one branch, by an amount or to a counted figure. */
export function AdjustAccessoryButton({ name, productId, branches, defaultBranchId }: { name: string; productId: string; branches: { id: string; name: string; quantity: number }[]; defaultBranchId: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [branchId, setBranchId] = useState(defaultBranchId ?? branches[0]?.id ?? "");
  const [mode, setMode] = useState<"remove" | "add" | "set">("remove");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState<StockAdjustmentReason | "">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const current = branches.find((b) => b.id === branchId)?.quantity ?? 0;
  const n = Number(quantity);
  const valid = quantity.trim() !== "" && Number.isInteger(n) && n >= 0 && (mode === "set" || n > 0);
  const after = !valid ? null : mode === "set" ? n : mode === "add" ? current + n : current - n;
  const reasons = mode === "add" ? ACCESSORY_REASONS.add : mode === "remove" ? ACCESSORY_REASONS.remove : (["COUNT_CORRECTION", "OTHER"] as const);

  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setOpen(true); }} aria-label={`Adjust stock of ${name}`}>
        <SlidersHorizontal aria-hidden />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              startTransition(async () => {
                const r = await adjustAccessoryStock({ branchId, productId, mode: mode === "set" ? "set" : "change", quantity: mode === "remove" ? -n : n, reason, note });
                if (!r.ok) return setError(r.error);
                toast.success(`${name}: ${r.data.quantityBefore} → ${r.data.quantityAfter}`);
                setOpen(false);
                setQuantity("");
                setNote("");
                setReason("");
                router.refresh();
              });
            }}
          >
            <DialogHeader>
              <DialogTitle>Adjust {name}</DialogTitle>
              <DialogDescription>For damage, loss, finds and recounts. Sales, deliveries, transfers and returns update stock on their own.</DialogDescription>
            </DialogHeader>
            {branches.length > 1 && (
              <label className="flex flex-col gap-1.5 text-small font-medium">
                Branch
                <Select value={branchId} onValueChange={setBranchId}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>{b.name} ({b.quantity} on the shelf)</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            )}
            <Segmented
              label="Kind of change"
              value={mode}
              onChange={(v) => { setMode(v); setReason(""); }}
              options={[{ value: "remove", label: "Remove" }, { value: "add", label: "Add" }, { value: "set", label: "Set to a count" }]}
            />
            <label className="flex flex-col gap-1.5 text-small font-medium">
              {mode === "set" ? "Counted on the shelf" : mode === "add" ? "How many to add" : "How many to remove"}
              <Input inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/[^\d]/g, ""))} className="w-32 text-right tabular-nums" autoFocus />
              <span className={after !== null && after < 0 ? "font-normal text-danger" : "font-normal text-muted-foreground"}>
                {after === null ? `${current} on the shelf now.` : after < 0 ? `Only ${current} on the shelf.` : `${current} → ${after} on the shelf.`}
              </span>
            </label>
            <ReasonFields reasons={reasons} reason={reason} setReason={setReason} note={note} setNote={setNote} />
            {error && <p role="alert" className="text-small text-danger">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={pending || !valid || after === null || after < 0 || after === current || !reason || (reason === "OTHER" && note.trim().length < 3)}>
                {pending && <Loader2 aria-hidden className="animate-spin" />}
                Save adjustment
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Owner, in the device sheet: mark damaged, write off, repaired or found. */
export function AdjustUnitSection({ unitId, status }: { unitId: string; status: UnitStatus }) {
  const router = useRouter();
  const options = unitTransitions(status);
  const [to, setTo] = useState<UnitStatus | "">("");
  const [reason, setReason] = useState<StockAdjustmentReason | "">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (options.length === 0) return null;
  const reasons = options.find((o) => o.to === to)?.reasons ?? [];

  return (
    <section aria-labelledby="adjust-unit-heading" className="mt-6 rounded-xl border border-border p-4">
      <h3 id="adjust-unit-heading" className="text-h3">Adjust status</h3>
      <p className="mb-3 text-small text-muted-foreground">For damage, loss, theft, repairs and finds. Recorded with your name and reason.</p>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5 text-small font-medium">
          New status
          <Select value={to} onValueChange={(v) => { setTo(v as UnitStatus); setReason(""); }}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Choose" /></SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.to} value={o.to}>{STATUS_WORDS[o.to] ?? o.to}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        {to && <ReasonFields reasons={reasons} reason={reason} setReason={setReason} note={note} setNote={setNote} />}
        {error && <p role="alert" className="text-small text-danger">{error}</p>}
        <Button
          type="button"
          variant={to === "WRITTEN_OFF" ? "destructive" : "default"}
          disabled={pending || !to || !reason || (reason === "OTHER" && note.trim().length < 3)}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const r = await adjustUnitStatus({ unitId, toStatus: to, reason, note });
              if (!r.ok) return setError(r.error);
              toast.success("Device status updated");
              setTo("");
              setReason("");
              setNote("");
              router.refresh();
            })
          }
        >
          {pending && <Loader2 aria-hidden className="animate-spin" />}
          {to === "WRITTEN_OFF" ? "Write off" : "Save"}
        </Button>
      </div>
    </section>
  );
}
