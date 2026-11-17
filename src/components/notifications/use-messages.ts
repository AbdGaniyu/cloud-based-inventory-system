"use client";

import { useCallback, useEffect, useState } from "react";

import type { ActionResult } from "@/server/action-result";
import type { MessageView } from "@/server/services/message.service";

const POLL_MS = 2000;
const MAX_POLLS = 15;

export type LoadMessages = (invoiceId: string) => Promise<ActionResult<MessageView[]>>;

/**
 * Message rows for an invoice, re-fetched every 2s while any are still queued (up to 30s), so
 * staff see "Queued" turn into "Sent" or "Failed" without reloading. `initial` null loads on mount.
 */
export function useInvoiceMessages(invoiceId: string, load: LoadMessages, initial: MessageView[] | null) {
  const [messages, setMessages] = useState<MessageView[] | null>(initial);
  const [polls, setPolls] = useState(0);
  const pending = messages === null || messages.some((m) => m.status === "QUEUED");

  useEffect(() => {
    if (!pending || polls >= MAX_POLLS) return;
    const timer = setTimeout(
      async () => {
        const result = await load(invoiceId);
        if (result.ok) setMessages(result.data);
        setPolls((n) => n + 1);
      },
      messages === null ? 0 : POLL_MS,
    );
    return () => clearTimeout(timer);
  }, [pending, polls, invoiceId, load, messages]);

  const refresh = useCallback(async () => {
    const result = await load(invoiceId);
    if (result.ok) {
      setMessages(result.data);
      setPolls(0);
    }
  }, [invoiceId, load]);

  return { messages, refresh };
}

export const CHANNEL_LABEL = { WHATSAPP: "WhatsApp", SMS: "SMS" } as const;
