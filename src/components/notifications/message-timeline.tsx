"use client";

import { BellRing, MessageCircle, MessageSquareText, RotateCw } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { invoiceMessages, resendNotification, sendReminder } from "@/app/(app)/invoices/actions";
import { CHANNEL_LABEL, useInvoiceMessages } from "@/components/notifications/use-messages";
import { Button } from "@/components/ui/button";
import { NotificationStatusBadge } from "@/components/ui/status-badge";
import { formatPhoneDisplay } from "@/lib/phone";
import type { MessageView } from "@/server/services/message.service";

const when = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });

function queuedToast(message: { created: boolean; channel: "WHATSAPP" | "SMS"; status: string }, what: string) {
  if (!message.created) toast.info(`${what} was already sent a moment ago`);
  else if (message.status === "SKIPPED") toast.warning("Not sent: the customer has opted out of messages");
  else toast.success(`${what} queued to ${CHANNEL_LABEL[message.channel]}`);
}

/** Invoice "Messages" timeline (DESIGN.md §5.3, §5.7): channel, template, status, body preview, Resend. */
export function MessageTimeline({
  invoiceId,
  initial,
  canSend,
  canRemind,
}: {
  invoiceId: string;
  initial: MessageView[];
  canSend: boolean;
  canRemind: boolean;
}) {
  const { messages, refresh } = useInvoiceMessages(invoiceId, invoiceMessages, initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (key: string, what: string, action: () => ReturnType<typeof sendReminder>) => {
    setBusyId(key);
    startTransition(async () => {
      const result = await action();
      setBusyId(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      queuedToast(result.data, what);
      await refresh();
    });
  };

  const list = messages ?? [];
  return (
    <section aria-labelledby="messages-heading">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="messages-heading" className="text-h3">
          Messages
        </h2>
        {canSend && canRemind && (
          <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => run("reminder", "Reminder", () => sendReminder(invoiceId))}>
            <BellRing aria-hidden data-icon="inline-start" /> {busyId === "reminder" ? "Sending…" : "Send reminder"}
          </Button>
        )}
      </div>
      {list.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-body text-muted-foreground">No messages sent for this invoice yet.</p>
      ) : (
        <ol className="divide-y divide-border rounded-xl border border-border" aria-live="polite">
          {list.map((m) => {
            const Icon = m.channel === "WHATSAPP" ? MessageCircle : MessageSquareText;
            return (
              <li key={m.id} className="flex gap-3 px-4 py-3">
                <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-body font-medium">
                      {m.label} · {CHANNEL_LABEL[m.channel]}
                      {m.isFallback && <span className="font-normal text-muted-foreground"> (fallback)</span>}
                    </p>
                    <NotificationStatusBadge status={m.status} />
                  </div>
                  <p className="text-small text-muted-foreground">
                    {m.triggeredByName ?? "Automatic"} · {formatPhoneDisplay(m.to)} · {when.format(new Date(m.deliveredAt ?? m.sentAt ?? m.createdAt))}
                  </p>
                  <p className="mt-1 line-clamp-2 text-small">{m.body}</p>
                  {m.error && <p className="mt-1 text-small text-danger">{m.error}</p>}
                </div>
                {canSend && !m.isFallback && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0 self-start"
                    disabled={pending}
                    aria-label={`Resend ${m.label.toLowerCase()}`}
                    onClick={() => run(m.id, m.label, () => resendNotification(m.id))}
                  >
                    <RotateCw aria-hidden data-icon="inline-start" /> {busyId === m.id ? "Sending…" : "Resend"}
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
