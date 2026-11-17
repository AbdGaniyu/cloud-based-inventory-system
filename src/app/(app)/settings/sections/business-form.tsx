"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

import { saveBusiness } from "@/app/(app)/settings/actions";
import { LabeledField, useSave } from "@/app/(app)/settings/sections/form-bits";
import { MoneyInput } from "@/components/ledger/money-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { BusinessSettings } from "@/server/services/admin.service";

function Group({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 border-b border-border py-6 first:pt-0 last:border-b-0 lg:grid-cols-[260px_minmax(0,1fr)]">
      <div>
        <h3 className="text-h3">{title}</h3>
        <p className="text-small text-muted-foreground">{description}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

/** Settings → Business: tax, payments, approval rules, returns, alerts, messaging retries, warranty. */
export function BusinessForm({ initial }: { initial: BusinessSettings }) {
  const [v, setV] = useState(initial);
  const { save, pending, error, fieldError } = useSave();
  const set = <K extends keyof BusinessSettings>(key: K, value: BusinessSettings[K]) => setV((s) => ({ ...s, [key]: value }));
  const int = (value: string) => (value === "" ? 0 : Math.trunc(Number(value)));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save(() => saveBusiness(v), "Business settings saved");
      }}
      className="rounded-xl border border-border bg-card p-6"
    >
      <Group title="Tax" description="VAT on new sales. Issued invoices keep the rate they were sold at.">
        <LabeledField label="VAT rate (%)" error={fieldError("vatRatePercent")}>
          <Input inputMode="decimal" value={v.vatRatePercent} onChange={(e) => set("vatRatePercent", e.target.value)} className="text-right tabular-nums" />
        </LabeledField>
      </Group>
      <Group title="Payments" description="Printed on invoices and sent in reminders.">
        <LabeledField label="How customers pay" className="sm:col-span-2" error={fieldError("paymentInstructions")}>
          <Textarea rows={2} value={v.paymentInstructions} onChange={(e) => set("paymentInstructions", e.target.value)} maxLength={300} />
        </LabeledField>
      </Group>
      <Group title="Instalment approval" description="Plans above the amount, or with less than the down payment, need a manager to approve.">
        <LabeledField label="Approval needed above" error={fieldError("approvalThreshold")}>
          <MoneyInput value={v.approvalThreshold} onChange={(e) => set("approvalThreshold", e.target.value)} />
        </LabeledField>
        <LabeledField label="Minimum down payment (%)" error={fieldError("minDownPaymentPercent")}>
          <Input inputMode="decimal" value={v.minDownPaymentPercent} onChange={(e) => set("minDownPaymentPercent", e.target.value)} className="text-right tabular-nums" />
        </LabeledField>
      </Group>
      <Group title="Returns and stock" description="Managers accept returns inside the window; later ones need you.">
        <LabeledField label="Return window (days)" error={fieldError("returnWindowDays")}>
          <Input type="number" min={0} max={365} value={v.returnWindowDays} onChange={(e) => set("returnWindowDays", int(e.target.value))} className="text-right tabular-nums" />
        </LabeledField>
        <LabeledField label="Aging alert after (days in stock)" error={fieldError("agingDays")}>
          <Input type="number" min={7} max={365} value={v.agingDays} onChange={(e) => set("agingDays", int(e.target.value))} className="text-right tabular-nums" />
        </LabeledField>
      </Group>
      <Group title="Messages" description="How many times a failed message is tried before it is left as failed.">
        <LabeledField label="Send attempts" error={fieldError("maxAttempts")}>
          <Input type="number" min={1} max={10} value={v.maxAttempts} onChange={(e) => set("maxAttempts", int(e.target.value))} className="text-right tabular-nums" />
        </LabeledField>
      </Group>
      <Group title="Warranty terms" description="Printed on every new warranty certificate.">
        <LabeledField label="Terms" className="sm:col-span-2" error={fieldError("warrantyTerms")}>
          <Textarea rows={3} value={v.warrantyTerms} onChange={(e) => set("warrantyTerms", e.target.value)} maxLength={1000} />
        </LabeledField>
      </Group>
      {error && <p role="alert" className="mb-3 text-small text-danger">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 aria-hidden className="animate-spin" />}
          Save changes
        </Button>
      </div>
    </form>
  );
}
