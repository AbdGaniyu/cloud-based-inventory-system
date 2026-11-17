"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { signOffCashUp, submitDrawer } from "@/app/(app)/cash-up/actions";
import { MoneyInput } from "@/components/ledger/money-input";
import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { CashUpView } from "@/server/services/cashup.service";

/** "Balanced", "Short ₦5,000" or "Over ₦500" for one method. */
export function VarianceText({ value, className }: { value: string | null; className?: string }) {
  if (value === null) return <span className={cn("text-muted-foreground", className)}>Not checked</span>;
  const n = Number(value);
  if (n === 0) return <span className={cn("text-success", className)}>Balanced</span>;
  return (
    <span className={cn(n < 0 ? "text-danger" : "text-warning", className)}>
      {n < 0 ? "Short" : "Over"} <Money value={Math.abs(n).toFixed(2)} />
    </span>
  );
}

/** Expected against counted, per method, once the count is in. */
export function CashUpBreakdown({ cashUp }: { cashUp: CashUpView }) {
  const lines = [
    { label: "Cash", expected: (Number(cashUp.expected.cash) + Number(cashUp.openingFloat)).toFixed(2), counted: cashUp.counted.cash, variance: cashUp.variance.cash, hint: Number(cashUp.openingFloat) > 0 ? `Includes the ${formatMoney(cashUp.openingFloat)} float` : null },
    { label: "POS card", expected: cashUp.expected.card, counted: cashUp.counted.card, variance: cashUp.variance.card, hint: null },
    { label: "Transfers", expected: cashUp.expected.transfer, counted: cashUp.counted.transfer, variance: cashUp.variance.transfer, hint: null },
  ];
  return (
    <table className="w-full text-body">
      <caption className="sr-only">Cash-up breakdown</caption>
      <thead className="text-caption text-muted-foreground uppercase">
        <tr className="border-b border-border">
          <th scope="col" className="py-2 text-left font-medium">Method</th>
          <th scope="col" className="py-2 text-right font-medium">Expected</th>
          <th scope="col" className="py-2 text-right font-medium">Counted</th>
          <th scope="col" className="py-2 text-right font-medium">Difference</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.label} className="border-b border-border last:border-b-0">
            <td className="py-2">
              {l.label}
              {l.hint && <p className="text-small text-muted-foreground">{l.hint}</p>}
            </td>
            <td className="py-2 text-right"><Money value={l.expected} /></td>
            <td className="py-2 text-right">{l.counted === null ? <span className="text-muted-foreground">—</span> : <Money value={l.counted} />}</td>
            <td className="py-2 text-right font-medium"><VarianceText value={l.variance} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Blind count: the form never shows what the system expects. The person counts the drawer, checks
 * the POS terminal's batch total and the bank app, and only then sees how it compares.
 */
export function DrawerForm({ paymentCount }: { paymentCount: number }) {
  const router = useRouter();
  const [values, setValues] = useState({ openingFloat: "", countedCash: "", countedCard: "", countedTransfer: "", note: "" });
  const [result, setResult] = useState<CashUpView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();
  const set = (k: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValues((v) => ({ ...v, [k]: e.target.value }));
  const field = (name: string) => fieldErrors[name]?.[0];

  if (result) {
    const balanced = [result.variance.cash, result.variance.card, result.variance.transfer].every((v) => v === null || Number(v) === 0);
    return (
      <div className="flex flex-col gap-4">
        <p className={cn("flex items-center gap-2 text-h3", balanced ? "text-success" : "text-warning")}>
          {balanced ? <CheckCircle2 aria-hidden className="size-5" /> : null}
          {balanced ? "Your drawer balances." : "Your drawer doesn't balance. A manager will check it with you."}
        </p>
        <CashUpBreakdown cashUp={result} />
        <Button type="button" variant="secondary" className="self-start" onClick={() => { setResult(null); router.refresh(); }}>
          Done
        </Button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setFieldErrors({});
        startTransition(async () => {
          const r = await submitDrawer(values);
          if (!r.ok) {
            setError(r.error);
            setFieldErrors(r.fieldErrors ?? {});
            return;
          }
          toast.success("Cash-up submitted");
          setValues({ openingFloat: "", countedCash: "", countedCard: "", countedTransfer: "", note: "" });
          setResult(r.data);
        });
      }}
    >
      <p className="text-body text-muted-foreground">
        {paymentCount} payment{paymentCount === 1 ? "" : "s"} to cash up. Count first; the expected amounts appear after you submit.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-small font-medium">
          Opening float
          <MoneyInput value={values.openingFloat} onChange={set("openingFloat")} placeholder="0" aria-describedby="float-hint" />
          <span id="float-hint" className="font-normal text-muted-foreground">{field("openingFloat") ?? "Change you started with."}</span>
        </label>
        <label className="flex flex-col gap-1.5 text-small font-medium">
          Cash in the drawer now
          <MoneyInput value={values.countedCash} onChange={set("countedCash")} placeholder="0" aria-describedby="cash-hint" />
          <span id="cash-hint" className={cn("font-normal", field("countedCash") ? "text-danger" : "text-muted-foreground")}>{field("countedCash") ?? "Everything, float included."}</span>
        </label>
        <label className="flex flex-col gap-1.5 text-small font-medium">
          POS terminal total <span className="font-normal text-muted-foreground">(optional)</span>
          <MoneyInput value={values.countedCard} onChange={set("countedCard")} placeholder="Leave blank to skip" />
          <span className="font-normal text-muted-foreground">From the terminal&apos;s end-of-day / batch slip.</span>
        </label>
        <label className="flex flex-col gap-1.5 text-small font-medium">
          Transfers confirmed <span className="font-normal text-muted-foreground">(optional)</span>
          <MoneyInput value={values.countedTransfer} onChange={set("countedTransfer")} placeholder="Leave blank to skip" />
          <span className="font-normal text-muted-foreground">Credits you can see on the bank app.</span>
        </label>
      </div>
      <label className="flex flex-col gap-1.5 text-small font-medium">
        Note <span className="font-normal text-muted-foreground">(optional)</span>
        <Textarea rows={2} value={values.note} onChange={set("note")} placeholder="Anything the manager should know" />
      </label>
      {error && <p role="alert" className="text-small text-danger">{error}</p>}
      <Button type="submit" className="self-start" disabled={pending || values.countedCash.trim() === "" || values.openingFloat.trim() === ""}>
        {pending && <Loader2 aria-hidden className="animate-spin" />}
        Submit cash-up
      </Button>
    </form>
  );
}

/** Reviewer: sign off a cash-up, noting what was found when it didn't balance. */
export function SignOffButton({ cashUp }: { cashUp: CashUpView }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const off = [cashUp.variance.cash, cashUp.variance.card, cashUp.variance.transfer].some((v) => v !== null && Number(v) !== 0);
  return (
    <>
      <Button type="button" size="sm" variant={off ? "default" : "secondary"} onClick={() => setOpen(true)}>
        Sign off
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              startTransition(async () => {
                const r = await signOffCashUp({ id: cashUp.id, note });
                if (!r.ok) return setError(r.error);
                toast.success(`Signed off ${cashUp.userName}'s cash-up`);
                setOpen(false);
                router.refresh();
              });
            }}
          >
            <DialogHeader>
              <DialogTitle>Sign off {cashUp.userName}&apos;s cash-up</DialogTitle>
              <DialogDescription>
                {cashUp.branchName} · {cashUp.paymentCount} payment{cashUp.paymentCount === 1 ? "" : "s"}
                {cashUp.note ? ` · “${cashUp.note}”` : ""}
              </DialogDescription>
            </DialogHeader>
            <CashUpBreakdown cashUp={cashUp} />
            <label className="flex flex-col gap-1.5 text-small font-medium">
              {off ? "What did you find?" : "Note"} {!off && <span className="font-normal text-muted-foreground">(optional)</span>}
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={off ? "e.g. Recounted together: ₦1,000 change given from the float" : ""} autoFocus />
            </label>
            {error && <p role="alert" className="text-small text-danger">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={pending || (off && note.trim().length < 3)}>
                {pending && <Loader2 aria-hidden className="animate-spin" />}
                Sign off
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
