"use client";

import { MessageCircle, MessageSquareText, RotateCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { resendNotification } from "@/app/(app)/invoices/actions";
import { CHANNEL_LABEL } from "@/components/notifications/use-messages";
import { Button } from "@/components/ui/button";
import { NotificationStatusBadge } from "@/components/ui/status-badge";
import { formatPhoneDisplay } from "@/lib/phone";
import type { NotificationRow } from "@/server/services/message.service";

const when = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });

/** Notification centre rows (CLAUDE.md §9): status, channel, time, body preview, provider error, one-click Resend. */
export function NotificationList({ rows, canSend }: { rows: NotificationRow[]; canSend: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function resend(row: NotificationRow) {
    setBusy(row.id);
    startTransition(async () => {
      const result = await resendNotification(row.id);
      setBusy(null);
      if (!result.ok) return void toast.error(result.error);
      toast.success(result.data.created ? `${row.label} queued to ${CHANNEL_LABEL[result.data.channel]}` : `${row.label} was already sent a moment ago`);
      router.refresh();
    });
  }

  return (
    <ol className="divide-y divide-border rounded-xl border border-border bg-card">
      {rows.map((m) => {
        const Icon = m.channel === "WHATSAPP" ? MessageCircle : MessageSquareText;
        return (
          <li key={m.id} className="flex gap-3 px-4 py-3">
            <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/customers/${m.customer.id}`} className="text-body font-medium hover:underline">
                  {m.customer.name}
                </Link>
                <span className="text-body text-muted-foreground">
                  {m.label} · {CHANNEL_LABEL[m.channel]}
                  {m.isFallback ? " (fallback)" : ""}
                </span>
                <NotificationStatusBadge status={m.status} />
                {m.attempts > 1 && <span className="text-small text-muted-foreground">{m.attempts} attempts</span>}
              </div>
              <p className="text-small text-muted-foreground">
                {when.format(new Date(m.deliveredAt ?? m.sentAt ?? m.createdAt))} · {formatPhoneDisplay(m.to)} · {m.triggeredByName ?? "Automatic"}
                {m.invoice && (
                  <>
                    {" · "}
                    <Link href={`/invoices/${m.invoice.id}`} className="font-mono hover:underline">
                      {m.invoice.number}
                    </Link>
                  </>
                )}
              </p>
              <p className="mt-1 line-clamp-2 text-small">{m.body}</p>
              {m.error && <p className="mt-1 text-small text-danger">{m.error}</p>}
            </div>
            {canSend && !m.isFallback && (
              <Button type="button" variant="ghost" size="sm" className="shrink-0 self-start" disabled={pending} onClick={() => resend(m)} aria-label={`Resend ${m.label.toLowerCase()} to ${m.customer.name}`}>
                <RotateCw aria-hidden data-icon="inline-start" /> {busy === m.id ? "Sending…" : "Resend"}
              </Button>
            )}
          </li>
        );
      })}
    </ol>
  );
}
