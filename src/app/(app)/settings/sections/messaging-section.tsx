"use client";

import { Loader2, Send } from "lucide-react";
import { useState } from "react";

import { clearSecret, saveProviders, saveSecret, sendTest } from "@/app/(app)/settings/actions";
import { LabeledField, useSave } from "@/app/(app)/settings/sections/form-bits";
import { Segmented } from "@/components/segmented";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/status-badge";
import type { MessagingSetup } from "@/server/services/messaging-settings.service";

const PROVIDER_LABEL: Record<string, string> = { "whatsapp-cloud": "WhatsApp Cloud API (Meta)", twilio: "Twilio", termii: "Termii", console: "Console (development: messages are printed, not sent)" };

function SecretRow({ field }: { field: MessagingSetup["fields"][number] }) {
  const [replacing, setReplacing] = useState(false);
  const [value, setValue] = useState("");
  const { save, pending, error } = useSave();
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-48 flex-1">
        <p className="text-body font-medium">{field.label}</p>
        <p className="font-mono text-small text-muted-foreground">{field.name}</p>
      </div>
      {replacing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save(() => saveSecret({ name: field.name, value }), `${field.label} saved`, () => {
              setReplacing(false);
              setValue("");
            });
          }}
          className="flex flex-1 flex-wrap items-center gap-2"
        >
          <Input type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} aria-label={`New ${field.label}`} className="min-w-56 flex-1 font-mono" autoFocus />
          <Button type="submit" size="sm" disabled={pending || !value.trim()}>
            {pending && <Loader2 aria-hidden className="animate-spin" />} Save
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setReplacing(false)}>Cancel</Button>
          {error && <span role="alert" className="w-full text-small text-danger">{error}</span>}
        </form>
      ) : (
        <>
          <span className="font-mono text-small">{field.masked ?? "—"}</span>
          {field.source === "settings" ? <Badge tone="success" dot={false}>Saved here</Badge> : field.source === "env" ? <Badge tone="info" dot={false}>From environment</Badge> : <Badge tone="neutral" dot={false}>Not set</Badge>}
          <Button type="button" size="sm" variant="secondary" onClick={() => setReplacing(true)}>{field.source ? "Replace" : "Add"}</Button>
          {field.source === "settings" && (
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => save(() => clearSecret(field.name), `${field.label} removed`)}>
              Remove
            </Button>
          )}
        </>
      )}
    </li>
  );
}

export function MessagingSection({ setup }: { setup: MessagingSetup }) {
  const [whatsapp, setWhatsapp] = useState(setup.whatsapp.provider);
  const [sms, setSms] = useState(setup.sms.provider);
  const [channel, setChannel] = useState<"WHATSAPP" | "SMS">("WHATSAPP");
  const [phone, setPhone] = useState("");
  const providers = useSave();
  const test = useSave();
  const groups = ["whatsapp-cloud", "twilio", "termii"].filter((p) => p === whatsapp || p === sms);

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="providers-heading" className="rounded-xl border border-border bg-card p-5">
        <h2 id="providers-heading" className="text-h2">Messaging providers</h2>
        <p className="mb-4 text-small text-muted-foreground">WhatsApp goes first; SMS is the fallback. Choices here override WHATSAPP_PROVIDER and SMS_PROVIDER.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            providers.save(() => saveProviders({ whatsapp, sms }), "Providers saved");
          }}
          className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        >
          <LabeledField label="WhatsApp">
            <Select value={whatsapp} onValueChange={(v) => setWhatsapp(v as typeof whatsapp)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{["whatsapp-cloud", "twilio", "console"].map((p) => <SelectItem key={p} value={p}>{PROVIDER_LABEL[p]}</SelectItem>)}</SelectContent>
            </Select>
          </LabeledField>
          <LabeledField label="SMS">
            <Select value={sms} onValueChange={(v) => setSms(v as typeof sms)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{["termii", "twilio", "console"].map((p) => <SelectItem key={p} value={p}>{PROVIDER_LABEL[p]}</SelectItem>)}</SelectContent>
            </Select>
          </LabeledField>
          <Button type="submit" disabled={providers.pending}>Save</Button>
        </form>
        {providers.error && <p role="alert" className="mt-2 text-small text-danger">{providers.error}</p>}
      </section>

      {groups.length === 0 && (
        <p className="rounded-xl border border-dashed border-border px-4 py-4 text-small text-muted-foreground">
          Console needs no keys. Pick WhatsApp Cloud, Twilio or Termii above to enter their keys; they apply once you save the choice.
        </p>
      )}
      {groups.map((provider) => (
        <section key={provider} aria-label={`${PROVIDER_LABEL[provider]} keys`} className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-h3">{PROVIDER_LABEL[provider]}</h3>
          <p className="text-small text-muted-foreground">Stored encrypted; only the last four characters are ever shown.</p>
          <ul className="divide-y divide-border">
            {setup.fields.filter((f) => f.provider === provider).map((f) => <SecretRow key={f.name} field={f} />)}
          </ul>
          <p className="mt-2 text-small text-muted-foreground">
            Delivery webhook: <span className="font-mono">{provider === "whatsapp-cloud" ? setup.webhooks.whatsapp : provider === "twilio" ? setup.webhooks.twilio : setup.webhooks.termii}</span>
          </p>
        </section>
      ))}

      <section aria-labelledby="test-heading" className="rounded-xl border border-border bg-card p-5">
        <h2 id="test-heading" className="text-h3">Send a test message</h2>
        <p className="mb-3 text-small text-muted-foreground">Goes straight through the saved provider. Not logged against any customer.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            test.save(() => sendTest({ channel, phone }), "Test message sent");
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <div className="w-56">
            <Segmented label="Channel" value={channel} onChange={setChannel} options={[{ value: "WHATSAPP", label: "WhatsApp" }, { value: "SMS", label: "SMS" }]} />
          </div>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="0803 123 4567" aria-label="Phone number" className="w-52" />
          <Button type="submit" variant="secondary" disabled={test.pending || phone.trim().length < 7}>
            {test.pending ? <Loader2 aria-hidden className="animate-spin" /> : <Send aria-hidden data-icon="inline-start" />} Send test
          </Button>
        </form>
        {test.error && <p role="alert" className="mt-2 text-small text-danger">{test.error}</p>}
      </section>
    </div>
  );
}
