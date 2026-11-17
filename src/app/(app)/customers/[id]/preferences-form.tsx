"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { saveCustomerPreferences } from "@/app/(app)/ledger/actions";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

/** Message opt-ins (invariant 12) and staff notes, saved together and audited. */
export function PreferencesForm({ customerId, whatsappOptIn, smsOptIn, notes, canEdit }: { customerId: string; whatsappOptIn: boolean; smsOptIn: boolean; notes: string | null; canEdit: boolean }) {
  const router = useRouter();
  const [whatsapp, setWhatsapp] = useState(whatsappOptIn);
  const [sms, setSms] = useState(smsOptIn);
  const [text, setText] = useState(notes ?? "");
  const [pending, startTransition] = useTransition();
  const dirty = whatsapp !== whatsappOptIn || sms !== smsOptIn || text.trim() !== (notes ?? "");

  function save(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await saveCustomerPreferences({ customerId, whatsappOptIn: whatsapp, smsOptIn: sms, notes: text });
      if (!result.ok) return void toast.error(result.error);
      toast.success("Customer preferences saved");
      router.refresh();
    });
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
      <h2 className="text-h3">Messages and notes</h2>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="optin-whatsapp" className="text-body">Receipts and reminders on WhatsApp</label>
        <Switch id="optin-whatsapp" checked={whatsapp} onCheckedChange={setWhatsapp} disabled={!canEdit} />
      </div>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="optin-sms" className="text-body">SMS (and fallback when WhatsApp fails)</label>
        <Switch id="optin-sms" checked={sms} onCheckedChange={setSms} disabled={!canEdit} />
      </div>
      {!whatsapp && !sms && <p className="text-small text-warning">This customer will receive no receipts, confirmations or reminders.</p>}
      <label className="flex flex-col gap-1.5 text-small font-medium">
        Notes
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={2000} disabled={!canEdit} placeholder="Preferred contact times, ID seen, guarantor details…" />
      </label>
      {canEdit && (
        <Button type="submit" variant="secondary" disabled={!dirty || pending} className="self-end">
          {pending && <Loader2 aria-hidden className="animate-spin" />}
          Save
        </Button>
      )}
    </form>
  );
}
