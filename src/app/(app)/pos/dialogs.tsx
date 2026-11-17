"use client";

import { ShieldCheck } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CONDITION_LABELS } from "@/components/ui/status-badge";
import { STORE } from "@/config/store";
import { UnitCondition } from "@/generated/prisma/enums";
import type { TradeInInput } from "@/lib/validators/checkout";
import { isMoneyText } from "@/app/(app)/pos/cart";

/** Trade-in credit, optionally booked into stock as a TRADED_IN device (CLAUDE.md §7.4). */
export function TradeInDialog({
  open,
  onOpenChange,
  value,
  onSave,
  deviceModels,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: TradeInInput | null;
  onSave: (tradeIn: TradeInInput | null) => void;
  deviceModels: { id: string; name: string }[];
}) {
  const [draft, setDraft] = useState<TradeInInput>(
    value ?? { description: "", identifier: "", condition: "UK_USED", creditAmount: "", addToStock: true, productId: undefined },
  );
  const problems = [
    draft.description.trim().length < 3 && "Describe the device",
    !isMoneyText(draft.creditAmount) && "Enter the credit amount",
    draft.addToStock && !draft.productId && "Choose its model to add it to stock",
    draft.addToStock && !draft.identifier?.trim() && "Scan its IMEI/serial to add it to stock",
  ].filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="shadow-dialog sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Trade-in</DialogTitle>
          <DialogDescription>The credit is taken off the total after VAT.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="ti-desc">Device</FieldLabel>
            <Input id="ti-desc" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="iPhone 11 64GB, black, scratched back" />
          </Field>
          <Field>
            <FieldLabel htmlFor="ti-id">IMEI / serial</FieldLabel>
            <Input id="ti-id" className="font-mono" value={draft.identifier ?? ""} onChange={(e) => setDraft({ ...draft, identifier: e.target.value })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="ti-cond">Condition</FieldLabel>
            <Select value={draft.condition} onValueChange={(v) => setDraft({ ...draft, condition: v as UnitCondition })}>
              <SelectTrigger id="ti-cond" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(UnitCondition).map((c) => (
                  <SelectItem key={c} value={c}>
                    {CONDITION_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="ti-credit">Credit</FieldLabel>
            <div className="relative">
              <span aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">{STORE.currencySymbol}</span>
              <Input id="ti-credit" inputMode="decimal" className="pl-7 text-right tabular-nums" value={draft.creditAmount} onChange={(e) => setDraft({ ...draft, creditAmount: e.target.value })} />
            </div>
          </Field>
          <Field>
            <FieldLabel htmlFor="ti-model">Model {draft.addToStock ? "" : "(optional)"}</FieldLabel>
            <Select value={draft.productId} onValueChange={(v) => setDraft({ ...draft, productId: v })}>
              <SelectTrigger id="ti-model" className="w-full">
                <SelectValue placeholder="Choose model" />
              </SelectTrigger>
              <SelectContent>
                {deviceModels.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <label className="flex min-h-11 items-center gap-2 text-body sm:col-span-2">
            <input type="checkbox" className="size-4 accent-primary" checked={draft.addToStock} onChange={(e) => setDraft({ ...draft, addToStock: e.target.checked })} />
            Add to stock as a traded-in device for inspection and resale
          </label>
        </div>
        {problems.length > 0 && <p className="text-small text-muted-foreground">{problems[0]}</p>}
        <DialogFooter>
          {value && (
            <Button variant="ghost" onClick={() => onSave(null)}>
              Remove trade-in
            </Button>
          )}
          <Button disabled={problems.length > 0} onClick={() => onSave({ ...draft, identifier: draft.identifier?.trim() || undefined })}>
            Apply trade-in
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Manager sign-in to approve a plan that needs it, without logging the cashier out. */
export function ApprovalDialog({
  open,
  onOpenChange,
  reasons,
  onApprove,
  pending,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reasons: string[];
  onApprove: (approver: { email: string; password: string }) => void;
  pending: boolean;
  error: string | null;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="shadow-dialog sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck aria-hidden className="size-5" /> Manager approval
          </DialogTitle>
          <DialogDescription>{reasons.join(". ")}. A branch manager or the owner signs in below to approve and complete the sale.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onApprove({ email, password });
          }}
          className="flex flex-col gap-4"
        >
          <Field>
            <FieldLabel htmlFor="ap-email">Manager email</FieldLabel>
            <Input id="ap-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="ap-password">Password</FieldLabel>
            <Input id="ap-password" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {error && <p role="alert" className="text-small text-danger">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending || !email || !password}>
              Approve and complete sale
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
