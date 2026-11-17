"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import { saveTemplate } from "@/app/(app)/settings/actions";
import { LabeledField, useSave } from "@/app/(app)/settings/sections/form-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { smsSegments } from "@/lib/sms";
import { cn } from "@/lib/utils";
import { renderTemplate, SAMPLE_VARIABLES } from "@/server/notifications/templates";
import type { TemplateRow } from "@/server/services/messaging-settings.service";

/** Inserts {{name}} at the cursor of a textarea and keeps focus there. */
function insertAtCursor(el: HTMLTextAreaElement | null, value: string, text: string, onChange: (v: string) => void) {
  const start = el?.selectionStart ?? value.length;
  const end = el?.selectionEnd ?? value.length;
  const next = value.slice(0, start) + text + value.slice(end);
  onChange(next);
  requestAnimationFrame(() => {
    el?.focus();
    el?.setSelectionRange(start + text.length, start + text.length);
  });
}

function Bubble({ text, channel }: { text: string; channel: "WhatsApp" | "SMS" }) {
  return (
    <div className="rounded-2xl bg-[#e7f6d9] p-3 text-[13px] leading-5 text-zinc-900 shadow-sm dark:bg-[#1f3a2a] dark:text-zinc-100" aria-label={`${channel} preview`}>
      <p className="whitespace-pre-wrap break-words">{text || "…"}</p>
      <p className="mt-1 text-right text-[10px] text-zinc-500">{channel} · 09:41</p>
    </div>
  );
}

export function TemplateEditor({ templates, selectedKey }: { templates: TemplateRow[]; selectedKey: string }) {
  const template = templates.find((t) => t.key === selectedKey) ?? templates[0];
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[240px_minmax(0,1fr)]">
      <nav aria-label="Message templates" className="flex flex-col gap-1">
        {templates.map((t) => (
          <Link
            key={t.key}
            href={`/settings?section=templates&template=${t.key}`}
            scroll={false}
            aria-current={t.key === template.key ? "page" : undefined}
            className={cn("flex items-center justify-between rounded-lg px-3 py-2 text-body", t.key === template.key ? "bg-accent font-medium" : "hover:bg-muted")}
          >
            {t.label}
            {!t.isActive && <Badge tone="neutral" dot={false}>Off</Badge>}
          </Link>
        ))}
      </nav>
      <Editor key={template.key} template={template} />
    </div>
  );
}

function Editor({ template }: { template: TemplateRow }) {
  const [body, setBody] = useState(template.body);
  const [smsBody, setSmsBody] = useState(template.smsBody ?? "");
  const [waName, setWaName] = useState(template.whatsappTemplateName ?? "");
  const [waLang, setWaLang] = useState(template.whatsappTemplateLanguage);
  const [active, setActive] = useState(template.isActive);
  const [focused, setFocused] = useState<"body" | "sms">("body");
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const smsRef = useRef<HTMLTextAreaElement>(null);
  const { save, pending, error } = useSave();

  const sms = smsBody.trim() ? smsBody : body;
  const smsRendered = renderTemplate(sms, SAMPLE_VARIABLES);
  const segments = smsSegments(smsRendered);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save(() => saveTemplate({ key: template.key, body, smsBody, whatsappTemplateName: waName, whatsappTemplateLanguage: waLang, isActive: active }), `${template.label} saved`);
      }}
      className="grid gap-6 rounded-xl border border-border bg-card p-5 lg:grid-cols-[minmax(0,1fr)_300px]"
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-h2">{template.label}</h2>
          <label className="flex items-center gap-2 text-small">
            <Switch checked={active} onCheckedChange={setActive} aria-label="Send this message" /> {active ? "Sending" : "Off"}
          </label>
        </div>
        <div className="flex flex-wrap gap-1.5" aria-label="Insert a variable">
          {template.variables.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() =>
                focused === "sms" ? insertAtCursor(smsRef.current, smsBody, `{{${v}}}`, setSmsBody) : insertAtCursor(bodyRef.current, body, `{{${v}}}`, setBody)
              }
              className="rounded-full border border-border bg-secondary px-2.5 py-0.5 font-mono text-[12px] hover:bg-secondary-hover"
            >
              {v}
            </button>
          ))}
        </div>
        <LabeledField label="WhatsApp message">
          <Textarea ref={bodyRef} rows={5} value={body} onFocus={() => setFocused("body")} onChange={(e) => setBody(e.target.value)} maxLength={1024} />
        </LabeledField>
        <LabeledField label="SMS version (optional)" hint="Used for SMS and fallbacks; keep links instead of attachments. Leave empty to reuse the WhatsApp text.">
          <Textarea ref={smsRef} rows={3} value={smsBody} onFocus={() => setFocused("sms")} onChange={(e) => setSmsBody(e.target.value)} maxLength={480} />
        </LabeledField>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_120px]">
          <LabeledField label="Approved WhatsApp template name" hint="As registered with Meta, or a Twilio Content SID (HX…).">
            <Input value={waName} onChange={(e) => setWaName(e.target.value)} className="font-mono" />
          </LabeledField>
          <LabeledField label="Language">
            <Input value={waLang} onChange={(e) => setWaLang(e.target.value)} className="font-mono" />
          </LabeledField>
        </div>
        {error && <p role="alert" className="text-small text-danger">{error}</p>}
        <Button type="submit" className="self-start" disabled={pending}>
          {pending && <Loader2 aria-hidden className="animate-spin" />}
          Save template
        </Button>
      </div>
      <aside className="flex flex-col gap-4 rounded-xl bg-surface p-4" aria-label="Preview with sample values">
        <p className="text-small font-medium text-muted-foreground">Preview</p>
        <Bubble text={renderTemplate(body, SAMPLE_VARIABLES)} channel="WhatsApp" />
        <Bubble text={smsRendered} channel="SMS" />
        <p className={cn("text-small", segments.segments > 2 ? "text-warning" : "text-muted-foreground")}>
          SMS: {segments.characters} characters · {segments.segments} part{segments.segments === 1 ? "" : "s"} ({segments.encoding}
          {segments.encoding === "UCS-2" ? " — a character like ₦ makes every part shorter" : ""})
        </p>
      </aside>
    </form>
  );
}
