"use client";

import { saleMessages } from "@/app/(app)/pos/actions";
import { CHANNEL_LABEL, useInvoiceMessages } from "@/components/notifications/use-messages";
import { Badge, NOTIFICATION_STATUS_LABELS, type Tone } from "@/components/ui/status-badge";
import type { NotificationStatus } from "@/generated/prisma/enums";

const TONE: Record<NotificationStatus, Tone> = { QUEUED: "neutral", SENT: "info", DELIVERED: "success", FAILED: "danger", SKIPPED: "neutral" };

/** POS success state: "Receipt · WhatsApp · Queued" chips that update as messages go out. */
export function MessageChips({ invoiceId }: { invoiceId: string }) {
  const { messages } = useInvoiceMessages(invoiceId, saleMessages, null);
  if (messages === null) return <Badge tone="neutral">Preparing messages…</Badge>;
  if (messages.length === 0) return <Badge tone="neutral">No messages sent</Badge>;
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Messages to the customer" aria-live="polite">
      {[...messages].reverse().map((m) => (
        <li key={m.id}>
          <Badge tone={TONE[m.status]}>
            {m.label} · {CHANNEL_LABEL[m.channel]} · {NOTIFICATION_STATUS_LABELS[m.status]}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
